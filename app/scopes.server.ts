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

/** Plain-English description of each permission, shown to the store owner. */
export const SCOPE_INFO: { scope: string; label: string; detail: string; used: boolean }[] = [
  { scope: "read_products", label: "Products and collections", detail: "Read titles, descriptions, SEO fields and image alt text to check on-page SEO.", used: true },
  { scope: "write_products", label: "Edit product SEO", detail: "Update SEO fields only when your Discoverable team applies an approved change. Every change is logged below and can be undone.", used: true },
  { scope: "read_orders", label: "Orders (sales only)", detail: "Order totals, items and sales channel for reporting. Customer names, emails, phone numbers and addresses are never sent to Discoverable.", used: true },
  { scope: "read_customers", label: "Customer totals", detail: "Anonymous customer counts, order counts and spend. No names, emails or addresses are sent to Discoverable.", used: true },
  { scope: "read_inventory", label: "Stock levels", detail: "Know when products go out of stock so reports and ads stay accurate.", used: true },
  { scope: "read_reports", label: "Store analytics", detail: "Visits, conversion rate and traffic sources from Shopify's own analytics. Totals only, no customer details.", used: true },
  { scope: "read_content", label: "Pages and blog posts", detail: "Reserved for page and blog SEO checks. Not used yet.", used: false },
  { scope: "write_content", label: "Edit pages and blog posts", detail: "Reserved for approved page and blog SEO changes. Not used yet.", used: false },
  { scope: "read_online_store_navigation", label: "Menus and redirects", detail: "Reserved for redirect and navigation checks. Not used yet.", used: false },
  { scope: "read_markets", label: "Markets", detail: "Reserved for international SEO checks. Not used yet.", used: false },
];

/** True when the scope, or its write_ counterpart, was granted. */
export function hasScope(granted: string[], scope: string) {
  return granted.includes(scope) || (scope.startsWith("read_") && granted.includes(scope.replace("read_", "write_")));
}
