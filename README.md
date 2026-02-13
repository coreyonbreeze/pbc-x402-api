# PBC x402 Sandwich API

Order Prospect Butcher Co sandwiches with USDC via the x402 protocol.

## What is x402?

x402 is an open payment protocol that enables machine-to-machine payments using HTTP 402 status codes. When you request a paid resource, the server returns payment details. After payment, you retry the request with a payment proof header.

**Protocol flow:**
1. Client requests `POST /api/order` with order details
2. Server returns `402 Payment Required` with USDC deposit address
3. Client sends USDC to the deposit address on Base network
4. Client retries request with `X-PAYMENT` header containing proof
5. Server verifies payment and creates order

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your Stripe test key

# Run development server
npm run dev

# Test the menu endpoint (free)
curl http://localhost:3000/api/menu

# Test order endpoint (returns 402)
curl -X POST http://localhost:3000/api/order \
  -H "Content-Type: application/json" \
  -d '{"items": ["brisket", "chips"]}'
```

## Endpoints

### `GET /` - API Info
Returns API metadata and available endpoints.

### `GET /api/menu` - Get Menu (Free)
Returns the full sandwich menu with prices and descriptions.

### `GET /api/menu/:id` - Get Item Details (Free)
Returns details for a specific menu item.

### `GET /api/menu/calculate?items=id1,id2` - Calculate Total (Free)
Calculates order total with tax for given item IDs.

### `POST /api/order` - Place Order (x402 Payment Required)
Place a sandwich order. Requires USDC payment on Base network.

**Request body:**
```json
{
  "items": ["brisket", "chips", "soda"],
  "fulfillment": "pickup",
  "customer": {
    "name": "Alice",
    "phone": "555-1234",
    "email": "alice@example.com"
  },
  "pickup_time": "2025-02-12T12:30:00-05:00",
  "location": "shop-1"
}
```

**Without payment:** Returns HTTP 402 with payment details
**With valid payment:** Returns HTTP 201 with order confirmation

## Testing with purl

[purl](https://github.com/stripe/purl) is Stripe's CLI tool for testing x402 payments:

```bash
# Install purl
npm install -g @stripe/purl

# Or use npx
npx @stripe/purl http://localhost:3000/api/order \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"items": ["pastrami"], "fulfillment": "pickup", "customer": {"name": "Test", "phone": "555-0000"}, "pickup_time": "2025-02-12T12:00:00-05:00"}'
```

purl will prompt your wallet to sign the USDC payment, then retry with the proof.

## Network Configuration

| Environment | Network | Chain ID |
|-------------|---------|----------|
| Development | Base Sepolia (testnet) | `eip155:84532` |
| Production | Base Mainnet | `eip155:8453` |

The API automatically uses testnet unless `NODE_ENV=production`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes* | Stripe API key (sk_test_... or sk_live_...) |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Set to "production" for mainnet |

*Without `STRIPE_SECRET_KEY`, the API runs in demo mode with a placeholder address.

## Deployment

### Docker

```bash
# Build image
docker build -t pbc-x402-api .

# Run container
docker run -p 3000:3000 \
  -e STRIPE_SECRET_KEY=sk_... \
  -e NODE_ENV=production \
  pbc-x402-api
```

### Fly.io

```bash
# First time setup
fly launch --name pbc-x402-api

# Set secrets
fly secrets set STRIPE_SECRET_KEY=sk_...

# Deploy
fly deploy

# Your API is live at https://pbc-x402-api.fly.dev
```

### Vercel

```bash
# Build first
npm run build

# Deploy with Vercel CLI
vercel --prod

# Set environment variables in Vercel dashboard:
# - STRIPE_SECRET_KEY
# - NODE_ENV=production
```

### Railway / Render

Both platforms can deploy directly from GitHub:
1. Connect your repository
2. Set environment variables
3. Deploy automatically on push

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   PBC x402 API                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   POST /api/order                                       │
│        │                                                │
│        ▼                                                │
│   ┌─────────────┐    No X-PAYMENT    ┌──────────────┐  │
│   │ Parse Order │──────header?──────▶│ Create Stripe │  │
│   │ Calculate $ │                    │ PaymentIntent │  │
│   └─────────────┘                    └───────┬──────┘  │
│        │                                     │         │
│        │ Has X-PAYMENT                       ▼         │
│        │ header                        402 Response    │
│        ▼                              + deposit addr   │
│   ┌─────────────┐                                      │
│   │ Verify      │                                      │
│   │ Payment     │                                      │
│   └──────┬──────┘                                      │
│          │                                             │
│          ▼                                             │
│   ┌─────────────┐                                      │
│   │ Create      │──────▶ 201 Order Confirmed          │
│   │ Order       │       (ChowNow in Phase 2)          │
│   └─────────────┘                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Payment Verification

The API verifies x402 payment headers by:

1. **Structure validation** - Ensures required fields exist
2. **Address validation** - Validates Ethereum addresses
3. **Signature presence** - Checks for cryptographic signature
4. **Timestamp validation** - Ensures payment isn't expired
5. **Amount validation** - Compares against expected order total

**Production TODO:** Full verification should also:
- Verify cryptographic signature
- Check on-chain payment status
- Validate against Stripe webhook events

## Development

```bash
# Install dependencies
npm install

# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Related Resources

- [x402 Protocol Spec](https://x402.org)
- [Stripe x402 Docs](https://docs.stripe.com/payments/machine/x402)
- [Stripe purl CLI](https://github.com/stripe/purl)
- [Base Network Docs](https://docs.base.org)
- [USDC on Base](https://www.circle.com/en/usdc)

## License

MIT
