import { Hono } from "hono";

export const menuRoutes = new Hono();

// Placeholder - will be implemented in api-002
menuRoutes.get("/menu", (c) => {
  return c.json({ message: "Menu endpoint - TODO" });
});
