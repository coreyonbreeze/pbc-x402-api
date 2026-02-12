# Testing the PBC x402 API

## Prerequisites

1. **Node.js 18+** installed
2. **Stripe test API key** with crypto payins enabled
3. **purl CLI** for x402 testing

## Setup

```bash
# Clone the repo
git clone https://github.com/coreyonbreeze/pbc-x402-api.git
cd pbc-x402-api

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env and add your Stripe test key:
# STRIPE_SECRET_KEY=sk_test_...
```

## Get Stripe Test Key

If you have access to GCP Secret Manager:

```bash
gcloud secrets versions access latest --secret="stripe-test-secret-key" --project=data-lake-430420
```

Otherwise, get it from the Stripe Dashboard → Developers → API keys.

## Run the Server

```bash
npm run dev
```

Server runs at `http://localhost:3000`

## Test Endpoints

### 1. Health Check (Free)

```bash
curl http://localhost:3000/
```

Expected response:
```json
{
  "name": "PBC x402 Sandwich API",
  "version": "0.1.0",
  "endpoints": { ... }
}
```

### 2. Get Menu (Free)

```bash
curl http://localhost:3000/api/menu
```

Expected: Full menu JSON with sandwiches, sides, drinks, and tax info.

### 3. Calculate Order Total (Free)

```bash
curl "http://localhost:3000/api/menu/calculate?items=brisket,chips,soda"
```

Expected:
```json
{
  "items": [...],
  "subtotal": 23.00,
  "tax": 2.04,
  "total": 25.04
}
```

### 4. Place Order (Requires Payment)

**Without payment header (expect 402):**

```bash
curl -X POST http://localhost:3000/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "items": ["brisket", "chips"],
    "fulfillment": "pickup",
    "customer": {
      "name": "Test Customer",
      "phone": "555-1234"
    },
    "pickup_time": "2026-02-12T12:30:00-05:00"
  }'
```

Expected: HTTP 402 response with payment details:
```json
{
  "x402Version": "1",
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "price": "...",
    "payTo": "0x..."
  }],
  "description": "Order a PBC sandwich..."
}
```

## Testing with purl CLI

The `purl` CLI from Stripe handles the x402 payment flow automatically.

### Install purl

```bash
npm install -g @anthropics/purl
# or
npm install -g @stripe/purl
```

### Test the Full Flow

```bash
# This will:
# 1. Make initial request
# 2. Receive 402 with payment details
# 3. Prompt you to connect a wallet
# 4. Send USDC payment on Base Sepolia
# 5. Retry with payment proof
# 6. Return order confirmation

purl -X POST http://localhost:3000/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "items": ["pastrami", "soda"],
    "fulfillment": "pickup",
    "customer": {
      "name": "Purl Test",
      "phone": "555-0000"
    },
    "pickup_time": "2026-02-12T13:00:00-05:00"
  }'
```

### Getting Testnet USDC

For Base Sepolia testing, you'll need testnet USDC:

1. Get Base Sepolia ETH from a faucet: https://www.alchemy.com/faucets/base-sepolia
2. Get testnet USDC from Circle's faucet or use a testnet swap

## Verify in Stripe Dashboard

After a successful payment:

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/test/payments)
2. Look for PaymentIntents with metadata `source: pbc-x402-api`
3. Verify status shows "succeeded"

## Troubleshooting

### "Stripe API key not set"
- Ensure STRIPE_SECRET_KEY is set in .env
- Restart the dev server after changing .env

### "No Base deposit address"
- Your Stripe account may not have crypto payins enabled
- Contact Stripe support to enable the feature

### "402 Payment Required" (expected!)
- This is correct behavior! Use purl to complete the payment flow.

### Connection refused
- Make sure the server is running: `npm run dev`
- Check it's on port 3000 (or update your curl commands)

## Network Configuration

| Environment | Network | Chain ID |
|-------------|---------|----------|
| Development | Base Sepolia | eip155:84532 |
| Production | Base Mainnet | eip155:8453 |

To switch to production, update the network in `src/routes/order.ts`.
