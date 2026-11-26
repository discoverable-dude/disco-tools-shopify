/**
 * Data minimisation for what is forwarded to Discoverable Tools. Order and customer webhooks
 * from Shopify contain names, emails, phone numbers and addresses; only the fields needed for
 * reporting are kept (allow-list), so personal details never leave this app. The same
 * filtered copy is what is stored in the outbox.
 */
type Obj = Record<string, unknown>;

const pick = (obj: Obj | null | undefined, keys: string[]): Obj => {
  const out: Obj = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
};

const ORDER_KEYS = [
  "id", "admin_graphql_api_id", "name", "order_number", "created_at", "updated_at", "processed_at",
  "closed_at", "cancelled_at", "cancel_reason", "currency", "presentment_currency", "total_price",
  "subtotal_price", "total_discounts", "total_tax", "total_line_items_price", "financial_status",
  "fulfillment_status", "source_name", "landing_site", "referring_site", "test",
];
const LINE_ITEM_KEYS = ["id", "title", "name", "quantity", "sku", "price", "product_id", "variant_id", "vendor", "total_discount"];
const CUSTOMER_KEYS = ["id", "admin_graphql_api_id", "created_at", "updated_at", "orders_count", "total_spent", "currency", "state"];

const asArray = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

export function redactForPlatform(topic: string, payload: unknown): unknown {
  const p = (payload ?? {}) as Obj;
  switch (topic) {
    case "ORDERS_CREATE":
    case "ORDERS_UPDATED": {
      const customer = p.customer as Obj | null | undefined;
      return {
        ...pick(p, ORDER_KEYS),
        line_items: asArray(p.line_items).map((li) => pick(li, LINE_ITEM_KEYS)),
        refunds: asArray(p.refunds).map((r) => ({
          id: r.id,
          created_at: r.created_at,
          transactions: asArray(r.transactions).map((t) => pick(t, ["amount", "kind", "status", "currency"])),
        })),
        customer: customer?.id ? { id: customer.id } : null,
      };
    }
    case "CUSTOMERS_CREATE":
    case "CUSTOMERS_UPDATE":
      return pick(p, CUSTOMER_KEYS);
    case "CUSTOMERS_DATA_REQUEST":
      return {
        ...pick(p, ["shop_id", "shop_domain", "orders_requested"]),
        customer: pick(p.customer as Obj, ["id"]),
        data_request: pick(p.data_request as Obj, ["id"]),
      };
    case "CUSTOMERS_REDACT":
      return {
        ...pick(p, ["shop_id", "shop_domain", "orders_to_redact"]),
        customer: pick(p.customer as Obj, ["id"]),
      };
    case "SHOP_REDACT":
      return pick(p, ["shop_id", "shop_domain"]);
    default:
      return payload;
  }
}
