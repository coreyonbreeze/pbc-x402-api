import Stripe from "stripe";

// Initialize Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-12-18.acacia",
});

/**
 * Context passed by x402 middleware
 */
interface PayToContext {
  paymentHeader?: string;
  request?: Request;
}

/**
 * Creates a PaymentIntent and returns a deposit address for USDC payment
 * This is called by the x402 middleware when generating 402 responses
 * 
 * @param context - Context from x402 middleware with payment header info
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

  // Create a new PaymentIntent to get a fresh crypto deposit address
  // USDC has 6 decimals, so $20.00 = 2000 cents = 20000000 in USDC units
  // Stripe wants amount in cents (smallest currency unit for USD)
  const amountInCents = 2000; // $20.00 default - actual amount will be determined by order

  try {
    const paymentIntent = await stripe.paymentIntents.create({
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
      },
    });

    // Extract the deposit address from the PaymentIntent
    const depositDetails = paymentIntent.next_action?.crypto_collect_deposit_details;
    
    if (!depositDetails?.deposit_addresses?.base?.address) {
      throw new Error("No Base deposit address in PaymentIntent response");
    }

    const payToAddress = depositDetails.deposit_addresses.base.address;
    
    console.log(`💰 Created PaymentIntent ${paymentIntent.id} with deposit address: ${payToAddress}`);
    
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
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  
  return {
    status: paymentIntent.status,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
  };
}
