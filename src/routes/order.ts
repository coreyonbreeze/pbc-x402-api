import { Hono } from "hono";

export const orderRoutes = new Hono();

// Placeholder - will be implemented in api-003
orderRoutes.post("/order", (c) => {
  return c.json({ message: "Order endpoint - TODO" });
});
