import Stripe from "stripe";

// Initialize Stripe client (lazy - only when actually used)
let stripeClient: Stripe | null = null;

// Demo mode: when STRIPE_SECRET_KEY is not set, use a placeholder address
const DEMO_MODE = !process.env.STRIPE_SECRET_KEY;
const DEMO_DEPOSIT_ADDRESS = "0xDEMO_ADDRESS_SET_STRIPE_SECRET_KEY_FOR_REAL_PAYMENTS";

function getStripeClient(): Stripe {
  if (!stripeClient) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error(
        "STRIPE_SECRET_KEY not set. Get it from Stripe Dashboard or GCP Secret Manager."
      );
    }
    stripeClient = new Stripe(apiKey, {
      apiVersion: "2024-12-18.acacia",
    });
  }
  return stripeClient;
}

/**
 * Context passed by x402 middleware
 */
export interface PayToContext {
  paymentHeader?: string;
  request?: Request;
  amountInCents?: number; // Actual order total in cents
}

/**
 * Creates a PaymentIntent and returns a deposit address for USDC payment
 * This is called by the x402 middleware when generating 402 responses
 * 
 * @param context - Context with payment header info and order amount
 * @returns The Base deposit address for USDC payment
 */
export async function createPayToAddress(context: PayToContext): Promise<string> {
  // If there's already a payment header, extract the destination address from it
  if (context.paymentHeader) {
    try {
      const decoded = JSON.parse(
        Buffer.from(context.paymentHeader, "base64").toString()
      );
      const toAddress = decoded.payload?.authorization?.to;

      if (toAddress && typeof toAddress === "string") {
        return toAddress;
      }
    } catch {
      // If we can't decode the header, fall through to create a new PaymentIntent
    }
  }

  // Demo mode: return placeholder address for testing without Stripe
  if (DEMO_MODE) {
    console.log("⚠️  DEMO MODE: Returning placeholder deposit address. Set STRIPE_SECRET_KEY for real payments.");
    return DEMO_DEPOSIT_ADDRESS;
  }

  // Use actual order amount, or default to $20 if not provided
  // amountInCents should be passed by the order route based on calculated total
  const amountInCents = context.amountInCents || 2000;

  try {
    const paymentIntent = await getStripeClient().paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      payment_method_types: ["crypto"],
      payment_method_data: {
        type: "crypto",
      },
      payment_method_options: {
        crypto: {
          mode: "custom",
        },
      },
      confirm: true,
      metadata: {
        source: "pbc-x402-api",
        product: "sandwich-order",
        amountCents: amountInCents.toString(),
      },
    });

    // Extract the deposit address from the PaymentIntent
    const depositDetails = paymentIntent.next_action?.crypto_collect_deposit_details;
    
    if (!depositDetails?.deposit_addresses?.base?.address) {
      throw new Error("No Base deposit address in PaymentIntent response");
    }

    const payToAddress = depositDetails.deposit_addresses.base.address;
    
    console.log(`💰 Created PaymentIntent ${paymentIntent.id} for $${(amountInCents / 100).toFixed(2)} with deposit address: ${payToAddress}`);
    
    return payToAddress;
  } catch (error) {
    console.error("Error creating PaymentIntent:", error);
    throw error;
  }
}

/**
 * Check the status of a PaymentIntent
 */
export async function getPaymentIntentStatus(paymentIntentId: string): Promise<{
  status: string;
  amount: number;
  currency: string;
}> {
  const paymentIntent = await getStripeClient().paymentIntents.retrieve(paymentIntentId);
  
  return {
    status: paymentIntent.status,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
  };
}

/**
 * Get Stripe client for external use (e.g., webhooks)
 */
export function getStripe(): Stripe {
  return getStripeClient();
}
