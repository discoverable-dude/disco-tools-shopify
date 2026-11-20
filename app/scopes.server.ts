/** Scopes the app needs. write_X implies read_X in Shopify, so it counts as granting it. */
export const REQUIRED_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_customers",
  "read_inventory",
  "read_content",
  "write_content",
  "read_online_store_navigation",
  "read_markets",
];

export function missingScopes(granted: string[]) {
  const has = new Set(granted);
  return REQUIRED_SCOPES.filter((s) => {
    if (has.has(s)) return false;
    if (s.startsWith("read_") && has.has(s.replace("read_", "write_"))) return false;
    return true;
  });
}
