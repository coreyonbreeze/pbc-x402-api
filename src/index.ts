import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { menuRoutes } from "./routes/menu.js";
import { orderRoutes } from "./routes/order.js";

const app = new Hono();

// Middleware
app.use("*", cors());

// Health check
app.get("/", (c) => {
  return c.json({
    name: "PBC x402 Sandwich API",
    version: "0.1.0",
    description: "Order Prospect Butcher Co sandwiches with USDC via x402 protocol",
    endpoints: {
      "GET /api/menu": "Get sandwich menu (free)",
      "POST /api/order": "Place order (requires x402 USDC payment)",
    },
  });
});

// Routes
app.route("/api", menuRoutes);
app.route("/api", orderRoutes);

const port = parseInt(process.env.PORT || "3000");

console.log(`🥪 PBC x402 API running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
