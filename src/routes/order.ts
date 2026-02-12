import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPayToAddress } from "../lib/stripe.js";
import menuData from "../data/menu.json" with { type: "json" };

export const orderRoutes = new Hono();

// Default facilitator for x402 protocol
const facilitatorClient = new HTTPFacilitatorClient("https://x402.org/facilitator");

// Create resource server with EVM scheme for Base Sepolia
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:84532", new ExactEvmScheme());

// Order request body type
interface OrderRequest {
  items: string[];
  fulfillment: "pickup" | "delivery";
  customer: {
    name: string;
    phone: string;
    email?: string;
  };
  pickup_time?: string;
  delivery_address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  delivery_window?: string;
  location?: "shop-1" | "shop-2";
}

/**
 * Calculate order total from item IDs
 */
function calculateOrderTotal(itemIds: string[]): { 
  items: Array<{ id: string; name: string; price: number }>;
  subtotal: number;
  tax: number;
  total: number;
} {
  const allItems = [
    ...menuData.sandwiches,
    ...menuData.sides,
    ...menuData.drinks,
  ];
  
  const foundItems: Array<{ id: string; name: string; price: number }> = [];
  
  for (const id of itemIds) {
    const item = allItems.find((i) => i.id === id);
    if (item) {
      foundItems.push({ id: item.id, name: item.name, price: item.price });
    }
  }
  
  const subtotal = foundItems.reduce((sum, item) => sum + item.price, 0);
  const tax = subtotal * menuData.tax.rate;
  const total = subtotal + tax;
  
  return {
    items: foundItems,
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

/**
 * POST /api/order
 * Place a sandwich order - requires x402 USDC payment
 * 
 * Without payment: Returns 402 with payment details
 * With valid payment: Creates order and returns confirmation
 */
orderRoutes.post(
  "/order",
  paymentMiddleware(
    {
      "POST /order": {
        accepts: [
          {
            scheme: "exact",
            price: "$20.00", // Default price, actual calculated dynamically
            network: "eip155:84532", // Base Sepolia testnet
            payTo: createPayToAddress,
          },
        ],
        description: "Order a PBC sandwich for pickup or delivery. Pay with USDC on Base.",
        mimeType: "application/json",
      },
    },
    resourceServer
  ),
  async (c) => {
    // If we reach here, payment has been verified
    const body = await c.req.json<OrderRequest>();
    
    // Validate required fields
    if (!body.items || body.items.length === 0) {
      return c.json({ error: "No items specified" }, 400);
    }
    
    if (!body.customer?.name || !body.customer?.phone) {
      return c.json({ error: "Customer name and phone required" }, 400);
    }
    
    if (!body.fulfillment) {
      return c.json({ error: "Fulfillment type required (pickup or delivery)" }, 400);
    }
    
    // Calculate totals
    const orderDetails = calculateOrderTotal(body.items);
    
    if (orderDetails.items.length === 0) {
      return c.json({ error: "No valid items found", requestedIds: body.items }, 400);
    }
    
    // Generate order ID
    const orderId = `PBC-${Date.now().toString(36).toUpperCase()}`;
    
    // Get payment info from context (set by middleware after verification)
    const paymentHeader = c.req.header("X-PAYMENT");
    
    // Build order confirmation
    const order = {
      orderId,
      status: "confirmed",
      customer: body.customer,
      fulfillment: body.fulfillment,
      location: body.location || "shop-1",
      pickup_time: body.pickup_time,
      delivery_address: body.delivery_address,
      delivery_window: body.delivery_window,
      items: orderDetails.items,
      subtotal: orderDetails.subtotal,
      tax: orderDetails.tax,
      taxDescription: menuData.tax.description,
      total: orderDetails.total,
      payment: {
        method: "USDC",
        network: "Base Sepolia (testnet)",
        status: "verified",
      },
      createdAt: new Date().toISOString(),
      _note: "This is a testnet order. In production, this would be sent to ChowNow for fulfillment.",
    };
    
    console.log(`✅ Order ${orderId} confirmed:`, JSON.stringify(order, null, 2));
    
    return c.json(order, 201);
  }
);

/**
 * GET /api/order/:id
 * Check order status (placeholder for now)
 */
orderRoutes.get("/order/:id", (c) => {
  const orderId = c.req.param("id");
  
  // In a real implementation, this would look up the order
  return c.json({
    orderId,
    status: "unknown",
    message: "Order lookup not yet implemented. Check ChowNow dashboard.",
  });
});
