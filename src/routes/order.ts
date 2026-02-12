import { Hono } from "hono";
import { createPayToAddress } from "../lib/stripe.js";
import menuData from "../data/menu.json" with { type: "json" };

export const orderRoutes = new Hono();

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
 * Verify x402 payment header
 * In production, this would verify the on-chain payment
 */
async function verifyPaymentHeader(paymentHeader: string): Promise<boolean> {
  try {
    // Decode the base64 payment header
    const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
    
    // Basic structure validation
    if (!decoded.payload?.authorization) {
      return false;
    }
    
    // In production: verify signature, check on-chain, confirm amount
    // For testnet/demo: accept any well-formed header
    console.log("📋 Payment header received:", JSON.stringify(decoded, null, 2));
    
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /api/order
 * Place a sandwich order - requires x402 USDC payment
 * 
 * Flow:
 * 1. Client sends POST /api/order with order details
 * 2. If no X-PAYMENT header → return 402 with payment requirements
 * 3. Client pays USDC to the provided address
 * 4. Client retries with X-PAYMENT header containing payment proof
 * 5. Server verifies payment and creates order
 */
orderRoutes.post("/order", async (c) => {
  const paymentHeader = c.req.header("X-PAYMENT");
  
  // Parse the order to calculate the price
  let body: OrderRequest;
  try {
    body = await c.req.json<OrderRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  
  // Validate required fields
  if (!body.items || body.items.length === 0) {
    return c.json({ error: "No items specified" }, 400);
  }
  
  // Calculate order total
  const orderDetails = calculateOrderTotal(body.items);
  
  if (orderDetails.items.length === 0) {
    return c.json({ error: "No valid items found", requestedIds: body.items }, 400);
  }
  
  // If no payment header, return 402 Payment Required
  if (!paymentHeader) {
    // Get a fresh deposit address from Stripe
    let payToAddress: string;
    try {
      payToAddress = await createPayToAddress({ request: c.req.raw });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ 
        error: "Failed to create payment address", 
        details: message,
        hint: "Ensure STRIPE_SECRET_KEY is set and crypto payins are enabled"
      }, 500);
    }
    
    // Return x402 payment requirements
    return c.json({
      x402Version: "1",
      accepts: [
        {
          scheme: "exact",
          network: "eip155:84532", // Base Sepolia testnet
          maxAmountRequired: `$${orderDetails.total.toFixed(2)}`,
          resource: `https://x402.org/facilitator`,
          payTo: payToAddress,
          maxTimeoutSeconds: 300,
          extra: {
            name: "USDC",
            decimals: 6,
          },
        },
      ],
      description: `Order ${orderDetails.items.length} item(s) from PBC. Total: $${orderDetails.total.toFixed(2)} (includes $${orderDetails.tax.toFixed(2)} tax)`,
      mimeType: "application/json",
      orderPreview: {
        items: orderDetails.items,
        subtotal: orderDetails.subtotal,
        tax: orderDetails.tax,
        total: orderDetails.total,
      },
    }, 402);
  }
  
  // Verify the payment header
  const isValid = await verifyPaymentHeader(paymentHeader);
  
  if (!isValid) {
    return c.json({ 
      error: "Invalid payment header",
      hint: "Ensure the X-PAYMENT header contains a valid base64-encoded payment proof"
    }, 401);
  }
  
  // Validate customer info
  if (!body.customer?.name || !body.customer?.phone) {
    return c.json({ error: "Customer name and phone required" }, 400);
  }
  
  if (!body.fulfillment) {
    return c.json({ error: "Fulfillment type required (pickup or delivery)" }, 400);
  }
  
  // Payment verified - create the order
  const orderId = `PBC-${Date.now().toString(36).toUpperCase()}`;
  
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
});

/**
 * GET /api/order/:id
 * Check order status (placeholder for now)
 */
orderRoutes.get("/order/:id", (c) => {
  const orderId = c.req.param("id");
  
  return c.json({
    orderId,
    status: "unknown",
    message: "Order lookup not yet implemented. Check ChowNow dashboard.",
  });
});
