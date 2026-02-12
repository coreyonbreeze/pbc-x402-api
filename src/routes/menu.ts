import { Hono } from "hono";
import menuData from "../data/menu.json" with { type: "json" };

export const menuRoutes = new Hono();

/**
 * GET /api/menu
 * Returns the full PBC sandwich menu with prices
 * This endpoint is FREE - no payment required
 */
menuRoutes.get("/menu", (c) => {
  return c.json({
    ...menuData,
    _meta: {
      timestamp: new Date().toISOString(),
      currency: "USD",
      paymentNote: "Use POST /api/order to place an order. Payment in USDC via x402 protocol.",
    },
  });
});

/**
 * GET /api/menu/:id
 * Returns a specific menu item by ID
 */
menuRoutes.get("/menu/:id", (c) => {
  const id = c.req.param("id");
  
  // Search all categories
  const allItems = [
    ...menuData.sandwiches,
    ...menuData.sides,
    ...menuData.drinks,
  ];
  
  const item = allItems.find((i) => i.id === id);
  
  if (!item) {
    return c.json({ error: "Item not found", id }, 404);
  }
  
  return c.json({
    item,
    tax: menuData.tax,
    _meta: {
      timestamp: new Date().toISOString(),
      currency: "USD",
    },
  });
});

/**
 * GET /api/menu/calculate
 * Calculate total with tax for given items
 * Query params: items=brisket,chips,soda
 */
menuRoutes.get("/menu/calculate", (c) => {
  const itemsParam = c.req.query("items");
  
  if (!itemsParam) {
    return c.json({ 
      error: "Missing items parameter", 
      usage: "GET /api/menu/calculate?items=brisket,chips,soda" 
    }, 400);
  }
  
  const itemIds = itemsParam.split(",").map(s => s.trim());
  const allItems = [
    ...menuData.sandwiches,
    ...menuData.sides,
    ...menuData.drinks,
  ];
  
  const foundItems: Array<{ id: string; name: string; price: number }> = [];
  const notFound: string[] = [];
  
  for (const id of itemIds) {
    const item = allItems.find((i) => i.id === id);
    if (item) {
      foundItems.push({ id: item.id, name: item.name, price: item.price });
    } else {
      notFound.push(id);
    }
  }
  
  const subtotal = foundItems.reduce((sum, item) => sum + item.price, 0);
  const tax = subtotal * menuData.tax.rate;
  const total = subtotal + tax;
  
  return c.json({
    items: foundItems,
    notFound: notFound.length > 0 ? notFound : undefined,
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    taxRate: menuData.tax.rate,
    taxDescription: menuData.tax.description,
    total: Math.round(total * 100) / 100,
    totalInCents: Math.round(total * 100),
    _meta: {
      timestamp: new Date().toISOString(),
      currency: "USD",
    },
  });
});
