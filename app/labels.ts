// Safe to import from components (not a .server module).
/** Friendly names for webhook topics. */
export const TOPIC_LABELS: Record<string, string> = {
  PRODUCTS_CREATE: "New products",
  PRODUCTS_UPDATE: "Product changes",
  PRODUCTS_DELETE: "Products removed",
  COLLECTIONS_CREATE: "New collections",
  COLLECTIONS_UPDATE: "Collection changes",
  COLLECTIONS_DELETE: "Collections removed",
  ORDERS_CREATE: "New orders",
  ORDERS_UPDATED: "Order updates",
  CUSTOMERS_CREATE: "New customers (totals only)",
  CUSTOMERS_UPDATE: "Customer total updates",
  INVENTORY_LEVELS_UPDATE: "Stock level changes",
};
