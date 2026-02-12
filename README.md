# PBC x402 Sandwich API

Order Prospect Butcher Co sandwiches with USDC via the x402 protocol.

## What is x402?

x402 is an open payment protocol that enables machine-to-machine payments using HTTP 402 status codes. When you request a paid resource, the server returns payment details. After payment, you retry the request with a payment proof header.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your Stripe test key

# Run development server
npm run dev

# Test endpoints
curl http://localhost:3000/api/menu
curl -X POST http://localhost:3000/api/order
```

## Endpoints

### GET /api/menu (Free)
Returns the sandwich menu with prices and descriptions.

### POST /api/order (x402 Payment Required)
Place a sandwich order. Requires USDC payment on Base network.

Without payment header: Returns HTTP 402 with payment details
With valid payment: Returns order confirmation

## Testing with purl

```bash
# Install Stripe's purl CLI
npm install -g @anthropics/purl

# Test the order endpoint (will prompt for wallet payment)
purl http://localhost:3000/api/order
```

## Network Configuration

- **Testnet:** Base Sepolia (eip155:84532) - for development
- **Mainnet:** Base (eip155:8453) - for production

## Environment Variables

| Variable | Description |
|----------|-------------|
| STRIPE_SECRET_KEY | Stripe API key (sk_test_... for testing) |
| PORT | Server port (default: 3000) |

## Architecture

```
Client Request → x402 Middleware → 402 Response (payment details)
                                        ↓
                               Client pays USDC
                                        ↓
Client Retries → x402 Middleware → Verifies payment → Order Created
```

## License

MIT
