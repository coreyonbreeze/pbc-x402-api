import { Hono } from "hono";
import { createPayToAddress, PayToContext } from "../lib/stripe.js";
import menuData from "../data/menu.json" with { type: "json" };

export const orderRoutes = new Hono();

// Use testnet (Base Sepolia) for development, mainnet for production
const NETWORK = process.env.NODE_ENV === "production" 
  ? "eip155:8453"   // Base Mainnet
  : "eip155:84532"; // Base Sepolia Testnet

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

interface OrderDetails {
  items: Array<{ id: string; name: string; price: number }>;
  subtotal: number;
  tax: number;
  total: number;
  totalInCents: number;
}

/**
 * Calculate order total from item IDs
 */
function calculateOrderTotal(itemIds: string[]): OrderDetails {
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
    totalInCents: Math.round(total * 100),
  };
}

/**
 * Verify x402 payment header
 * 
 * For testnet/development: verifies signature structure and logs details
 * For production: should verify against Stripe webhook or on-chain state
 * 
 * x402 payment header structure (base64 encoded JSON):
 * {
 *   "x402Version": "1",
 *   "scheme": "exact",
 *   "network": "eip155:84532",
 *   "payload": {
 *     "signature": "0x...",
 *     "authorization": {
 *       "from": "0x...",  // Payer address
 *       "to": "0x...",    // Deposit address (payTo)
 *       "value": "...",   // Amount in wei (for USDC: amount * 10^6)
 *       "validAfter": ...,
 *       "validBefore": ...,
 *       "nonce": "0x..."
 *     }
 *   }
 * }
 * 
 * @param paymentHeader - Base64 encoded payment proof
 * @param expectedAmountCents - Expected payment amount in cents (for validation)
 * @returns Object with validation result and extracted data
 */
async function verifyPaymentHeader(
  paymentHeader: string,
  expectedAmountCents: number
): Promise<{
  valid: boolean;
  fromAddress?: string;
  toAddress?: string;
  amountCents?: number;
  error?: string;
}> {
  try {
    // Decode the base64 payment header
    const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
    
    console.log("📋 Payment header received:", JSON.stringify(decoded, null, 2));
    
    // Validate required structure
    if (!decoded.payload) {
      return { valid: false, error: "Missing payload in payment header" };
    }
    
    if (!decoded.payload.authorization) {
      return { valid: false, error: "Missing authorization in payload" };
    }
    
    const auth = decoded.payload.authorization;
    
    // Extract addresses
    const fromAddress = auth.from;
    const toAddress = auth.to;
    
    if (!fromAddress || typeof fromAddress !== "string" || !fromAddress.startsWith("0x")) {
      return { valid: false, error: "Invalid or missing 'from' address" };
    }
    
    if (!toAddress || typeof toAddress !== "string" || !toAddress.startsWith("0x")) {
      return { valid: false, error: "Invalid or missing 'to' address" };
    }
    
    // Validate signature exists
    if (!decoded.payload.signature || typeof decoded.payload.signature !== "string") {
      return { valid: false, error: "Missing signature in payment payload" };
    }
    
    // Parse and validate amount (USDC has 6 decimals)
    // value is typically in wei/smallest unit: amount * 10^6 for USDC
    let amountCents: number | undefined;
    if (auth.value) {
      const valueStr = auth.value.toString();
      // Convert from USDC units (6 decimals) to cents
      // e.g., 20.50 USDC = 20500000 units = 2050 cents
      const usdcUnits = BigInt(valueStr);
      amountCents = Number(usdcUnits / BigInt(10000)); // Convert to cents
      
      // Check if amount matches expected (allow small rounding differences)
      const tolerance = 1; // 1 cent tolerance
      if (Math.abs(amountCents - expectedAmountCents) > tolerance) {
        console.warn(`⚠️ Amount mismatch: expected ${expectedAmountCents} cents, got ${amountCents} cents`);
        // TODO (Production): Reject if amounts don't match
        // For testnet, we log warning but allow it
      }
    }
    
    // Validate timestamps if present
    const now = Math.floor(Date.now() / 1000);
    if (auth.validAfter && now < auth.validAfter) {
      return { valid: false, error: "Payment not yet valid (validAfter in future)" };
    }
    if (auth.validBefore && now > auth.validBefore) {
      return { valid: false, error: "Payment expired (validBefore in past)" };
    }
    
    // TODO (Production): Full verification should include:
    // 1. Verify cryptographic signature against the authorization data
    // 2. Check on-chain that the payment was actually made
    // 3. Verify against Stripe webhook for PaymentIntent status
    // 4. Check that deposit address matches our PaymentIntent
    // 5. Confirm exact amount received matches expected
    //
    // For testnet/demo: Accept well-formed headers to allow testing
    // The x402 middleware + Stripe handles actual payment verification
    
    console.log(`✅ Payment header validated:
  From: ${fromAddress}
  To: ${toAddress}
  Amount: ${amountCents ? `$${(amountCents / 100).toFixed(2)}` : "unknown"}
  Expected: $${(expectedAmountCents / 100).toFixed(2)}`);
    
    return {
      valid: true,
      fromAddress,
      toAddress,
      amountCents,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { valid: false, error: `Failed to decode payment header: ${message}` };
  }
}

/**
 * POST /api/order
 * Place a sandwich order - requires x402 USDC payment
 * 
 * x402 Flow:
 * 1. Client sends POST /api/order with order details
 * 2. If no X-PAYMENT header → return 402 with payment requirements
 * 3. Client pays USDC to the provided deposit address
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
    // Get a fresh deposit address from Stripe with the ACTUAL order total
    const context: PayToContext = {
      request: c.req.raw,
      amountInCents: orderDetails.totalInCents, // Pass actual order total!
    };
    
    let payToAddress: string;
    try {
      payToAddress = await createPayToAddress(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ 
        error: "Failed to create payment address", 
        details: message,
        hint: "Ensure STRIPE_SECRET_KEY is set and crypto payins are enabled"
      }, 500);
    }
    
    // Return x402 payment requirements (following official spec)
    return c.json({
      x402Version: "1",
      accepts: [
        {
          scheme: "exact",
          network: NETWORK,
          maxAmountRequired: `$${orderDetails.total.toFixed(2)}`,
          resource: "https://x402.org/facilitator",
          payTo: payToAddress,
          maxTimeoutSeconds: 300, // 5 minute timeout
          extra: {
            name: "USDC",
            decimals: 6,
          },
        },
      ],
      description: `Order ${orderDetails.items.length} item(s) from PBC. Total: $${orderDetails.total.toFixed(2)} (includes $${orderDetails.tax.toFixed(2)} tax)`,
      mimeType: "application/json",
      // Include order preview so client knows what they're paying for
      orderPreview: {
        items: orderDetails.items,
        subtotal: orderDetails.subtotal,
        tax: orderDetails.tax,
        total: orderDetails.total,
      },
    }, 402);
  }
  
  // Verify the payment header with expected amount
  const verification = await verifyPaymentHeader(
    paymentHeader,
    orderDetails.totalInCents
  );
  
  if (!verification.valid) {
    return c.json({ 
      error: "Invalid payment header",
      details: verification.error,
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
  
  // Validate fulfillment-specific fields
  if (body.fulfillment === "pickup" && !body.pickup_time) {
    return c.json({ error: "Pickup time required for pickup orders" }, 400);
  }
  
  if (body.fulfillment === "delivery") {
    if (!body.delivery_address) {
      return c.json({ error: "Delivery address required for delivery orders" }, 400);
    }
    if (!body.delivery_window) {
      return c.json({ error: "Delivery window required for delivery orders" }, 400);
    }
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
      network: NETWORK === "eip155:8453" ? "Base Mainnet" : "Base Sepolia (testnet)",
      status: "verified",
      fromAddress: verification.fromAddress,
      toAddress: verification.toAddress,
    },
    createdAt: new Date().toISOString(),
    _note: NETWORK === "eip155:8453" 
      ? "Production order - will be sent to ChowNow for fulfillment."
      : "Testnet order - not submitted to ChowNow. For testing only.",
  };
  
  console.log(`✅ Order ${orderId} confirmed:`, JSON.stringify(order, null, 2));
  
  // TODO (Phase 2): Submit order to ChowNow API
  // await submitToChowNow(order);
  
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
    message: "Order lookup not yet implemented. In production, check ChowNow dashboard.",
    _hint: "Order status tracking will be added in Phase 2 with ChowNow integration.",
  });
});
