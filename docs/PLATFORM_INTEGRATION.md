# Discoverable Tools: Shopify integration (instructions for Lovable)

Paste the section **"Prompt for Lovable"** into Lovable. Everything above it is context for humans.

## How the pieces fit

```
Client's Shopify store
   |  webhooks + bulk exports
   v
Discoverable Connector (Shopify app, embedded admin UI)
   |  HMAC-signed HTTPS                  ^  HMAC-signed HTTPS
   v                                     |
Discoverable Tools (Lovable + Supabase edge functions)
   - stores data per client, joins it with GSC / GA4 / Ads / Ahrefs / DiscoRank
   - bulk SEO editor pushes changes back through the connector
```

Connector -> platform (Supabase edge functions under `DISCO_TOOLS_API_URL`, e.g. `https://<project>.supabase.co/functions/v1`):

| Function | Method | Purpose |
|---|---|---|
| `shopify-events` | POST | one Shopify webhook event at a time |
| `shopify-sync` | POST | batches of records from a bulk export |
| `shopify-health` | GET | connection check shown in the connector dashboard |

Platform -> connector (`SHOPIFY_CONNECTOR_URL` = the connector's public production URL, **not** the dev tunnel):

| Endpoint | Purpose |
|---|---|
| `POST /api/sync` | `{ "shop": "x.myshopify.com", "resource": "products" \| "orders" \| "customers" }` starts a bulk export. `{ "retry": true }` flushes the connector's webhook outbox. |
| `POST /api/push/seo` | push title / handle / meta fields; supports `dryRun` and `rollback` |

### Signing (both directions)
Headers `x-disco-timestamp` (unix seconds) and `x-disco-signature` = hex HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` using the shared secret. Reject if the timestamp is more than 300s old. Compare in constant time. GET `shopify-health` is unsigned.

### Payloads
`shopify-events`: `{ "shop": "morghew.myshopify.com", "topic": "PRODUCTS_UPDATE", "payload": { ...raw Shopify webhook JSON... } }`
Topics are upper-case enums: `PRODUCTS_CREATE|UPDATE|DELETE`, `COLLECTIONS_CREATE|UPDATE|DELETE`, `ORDERS_CREATE`, `ORDERS_UPDATED`, `CUSTOMERS_CREATE|UPDATE`, `INVENTORY_LEVELS_UPDATE`, `APP_UNINSTALLED`, and the compliance topics `CUSTOMERS_DATA_REQUEST`, `CUSTOMERS_REDACT`, `SHOP_REDACT`.
Webhook payloads are Shopify REST-style (snake_case, numeric `id` plus `admin_graphql_api_id`) and **do not include SEO meta fields**.

`shopify-sync`: `{ "shop", "resource", "runId", "records": [...], "final": boolean }`. Batches of up to 500; `final: true` arrives last with an empty `records`. Records are Shopify GraphQL shapes (camelCase, GID ids) with children already nested:
- product: `id title handle status vendor productType tags updatedAt onlineStoreUrl seo{title,description} featuredMedia{alt,image{url}} variants[{id sku price inventoryQuantity}] collections[{id handle}]`
- order: `id name createdAt processedAt displayFinancialStatus displayFulfillmentStatus currencyCode sourceName totalPriceSet subtotalPriceSet totalDiscountsSet totalRefundedSet lineItems[{id title quantity sku product{id}}]`
- customer (minimal until Protected Customer Data is approved): `id createdAt updatedAt numberOfOrders state amountSpent`

Respond 2xx fast and idempotently. Any non-2xx makes the connector retry (up to 8 attempts).

### `/api/push/seo` request
```json
{ "shop": "x.myshopify.com", "resource": "product", "id": "gid://shopify/Product/123",
  "dryRun": true,
  "changes": { "title": "...", "handle": "...", "seoTitle": "...", "seoDescription": "...", "descriptionHtml": "..." } }
```
Returns `{ dryRun: true, previous, changes }` for a preview, or `{ ok: true, auditId }` when applied. Undo with `{ "shop": "...", "rollback": "<auditId>" }`. Changing `handle` does not create a redirect, so create one separately where needed.

---

## Prompt for Lovable

> Add a **Shopify integration** to Discoverable Tools. A separate Shopify app ("Discoverable Connector") is already built and installed on client stores. It sends data to our Supabase edge functions and accepts commands back. Build the platform side exactly as follows, following our existing patterns for clients, auth, RLS, report data sources and UI components.
>
> **1. Secrets (Supabase edge function secrets)**
> - `SHOPIFY_CONNECTOR_SECRET`: shared HMAC secret (I will set the value).
> - `SHOPIFY_CONNECTOR_URL`: public base URL of the connector (I will set the value).
>
> **2. Database (migrations, RLS on every table; users only see rows for clients they can already access; edge functions write with the service role)**
> - `shopify_stores`: `id`, `shop_domain` (unique), `client_id` (nullable FK to our clients table), `status` (`installed|linked|uninstalled`), `installed_at`, `last_event_at`, `last_sync_at`, `last_sync_status`.
> - `shopify_products`: `id` (GID, primary key with `shop_domain`), `shop_domain`, `title`, `handle`, `status`, `vendor`, `product_type`, `tags text[]`, `meta_title`, `meta_description`, `featured_image_url`, `featured_image_alt`, `url`, `variants jsonb`, `collections jsonb`, `shopify_updated_at`, `deleted_at`, `last_seen_run_id`.
> - `shopify_collections`: same idea (`id`, `shop_domain`, `title`, `handle`, `meta_title`, `meta_description`, `deleted_at`).
> - `shopify_orders`: `id` (GID), `shop_domain`, `name`, `created_at`, `processed_at`, `financial_status`, `fulfillment_status`, `currency`, `source_name`, `total`, `subtotal`, `discounts`, `refunded`, `line_items jsonb`, `last_seen_run_id`. Add an index on `(shop_domain, created_at)`.
> - `shopify_customers`: `id`, `shop_domain`, `created_at`, `orders_count`, `amount_spent`, `state`. No names or emails.
> - `shopify_events`: raw log: `id`, `shop_domain`, `topic`, `payload jsonb`, `received_at`. Keep 30 days, then delete via a scheduled job. For `CUSTOMERS_*` and compliance topics store only the topic and customer id, never the full payload.
> - `shopify_sync_runs`: `run_id`, `shop_domain`, `resource`, `records_received`, `status`, `started_at`, `finished_at`.
> - `shopify_push_log`: `id`, `shop_domain`, `user_id`, `resource`, `resource_id`, `changes jsonb`, `previous jsonb`, `connector_audit_id`, `status`, `created_at`.
>
> **3. Edge functions** (set `verify_jwt = false` in `supabase/config.toml` for `shopify-events`, `shopify-sync` and `shopify-health`, because they authenticate with HMAC instead)
> - **`shopify-health`**: GET, returns `{ ok: true }`.
> - **`shopify-events`**: POST. Verify the HMAC signature from the headers `x-disco-timestamp` and `x-disco-signature` over `` `${timestamp}.${rawBody}` `` with `SHOPIFY_CONNECTOR_SECRET` using Web Crypto (`crypto.subtle`), constant-time comparison, reject if older than 300 seconds (401). Upsert `shopify_stores` by shop (create unlinked if unknown, never error for an unknown shop). Then by topic:
>   - `PRODUCTS_CREATE/UPDATE`: upsert title, handle, status, vendor, product_type, tags, `shopify_updated_at` using `payload.admin_graphql_api_id` as id. Do NOT overwrite `meta_title` or `meta_description` (webhooks don't include them).
>   - `PRODUCTS_DELETE` / `COLLECTIONS_DELETE`: set `deleted_at`.
>   - `COLLECTIONS_CREATE/UPDATE`: upsert title and handle only.
>   - `ORDERS_CREATE/UPDATED`: upsert the order (map snake_case fields: `total_price`, `subtotal_price`, `total_discounts`, `currency`, `source_name`, `financial_status`, `fulfillment_status`, `line_items`).
>   - `CUSTOMERS_CREATE/UPDATE`: upsert `orders_count`, `total_spent`, `state` only.
>   - `APP_UNINSTALLED`: set store status `uninstalled`. Keep the historical data.
>   - `CUSTOMERS_REDACT`, `CUSTOMERS_DATA_REQUEST`, `SHOP_REDACT`: write an entry to a `shopify_compliance_requests` table (`shop_domain`, `topic`, `customer_id`, `received_at`, `handled_at`) and show these in an admin page so a human actions them within 30 days. For `SHOP_REDACT` delete all rows for the shop once handled.
>   - Always insert into `shopify_events` and return 200 quickly. Errors return 500 so the connector retries.
> - **`shopify-sync`**: POST, same signature check. Upsert records into the right table keyed by id and `shop_domain`, stamping `last_seen_run_id = runId`. Maintain `shopify_sync_runs`. When `final` is true, mark the run complete, update `shopify_stores.last_sync_at`, and for products/orders soft-delete rows for that shop whose `last_seen_run_id` differs from this run (products and collections only; never delete orders). Map GraphQL shapes as documented (`seo.title` -> `meta_title`, `seo.description` -> `meta_description`, `featuredMedia.alt` -> `featured_image_alt`, money objects `.shopMoney.amount` -> numeric).
> - **`shopify-trigger-sync`** (JWT required, any user with access to the client): body `{ store_id, resource }`. Sign `{ shop, resource }` and POST to `${SHOPIFY_CONNECTOR_URL}/api/sync`.
> - **`shopify-push-seo`** (JWT required, editor role): body `{ store_id, resource, id, changes, dryRun }`. Sign and POST to `${SHOPIFY_CONNECTOR_URL}/api/push/seo`. Log to `shopify_push_log`, store the returned `auditId`. Add a `rollback` mode that sends `{ shop, rollback: auditId }`.
> - Write one shared `_shared/hmac.ts` with sign and verify helpers used by all of the above.
> - Schedule with `pg_cron`: nightly `shopify-trigger-sync` for `products` and `collections` for every linked store (webhooks lack SEO fields, so the nightly sync keeps meta data fresh), plus orders every night, and every 5 minutes a call to the connector with `{ "retry": true }` to flush its outbox.
>
> **4. UI**
> - **Client page, new "Shopify" tab**: store domain, link/unlink to this client, connection status, last sync time, sync buttons (products, collections, orders), counts, and recent sync runs. An admin page lists unlinked stores so we can attach them to clients.
> - **Shopify SEO editor**: table of products and collections with current title, handle, meta title, meta description, character counters (title 60, description 160), filters for "missing meta title/description", "too long", "duplicate title", "image missing alt". Allow editing inline or bulk-generating suggestions with our existing AI helper using the client's brand guidelines. Show a diff and run `dryRun` first, then **Apply**. A history view shows `shopify_push_log` with a **Rollback** button.
> - **Report data source "Shopify"** available in our existing query/report builder. Metrics: revenue, orders, average order value, refunds, units sold, revenue by product, revenue by sales channel, new vs returning is NOT available. Dimensions: date, product, collection, channel. Then add these cross-source views:
>   - Organic traffic and conversions (GA4) next to Shopify revenue, by day/week.
>   - Product page performance: join Search Console pages to `shopify_products` where the page path is `/products/{handle}`, so we can see clicks, impressions and position against units sold and revenue per product. The same for `/collections/{handle}`.
>   - Products with high impressions but low CTR and a weak meta description (a prioritised "SEO opportunities" list that feeds the SEO editor).
>   - Ad spend (Google Ads / Meta) vs Shopify revenue for a blended MER/ROAS.
>   - Ranking changes (DiscoRank) against revenue for the ranking pages' products.
> - Add the new Shopify section to existing client report templates as an optional block.
>
> **5. Quality**
> - All edge functions idempotent and fast (< 10s); batch upserts (500 rows); handle duplicate deliveries.
> - Never log secrets or customer data. Do not store customer names, emails or addresses.
> - Add a short README section describing the secrets, functions and cron jobs.

---

## After Lovable builds it

1. Set the secrets in Supabase: `SHOPIFY_CONNECTOR_SECRET`, `SHOPIFY_CONNECTOR_URL`.
2. In the connector's `.env`, set `DISCO_TOOLS_API_URL=https://<project>.supabase.co/functions/v1` and the **same** `DISCO_TOOLS_API_SECRET` value.
3. Run `npm run dev`; the connector dashboard should show **Discoverable Tools: Reachable**.
4. In the connector dashboard click **Sync products**. You should see the sync run complete, and rows appear in `shopify_products`.
5. Edit a product in Shopify admin and confirm a `PRODUCTS_UPDATE` row lands in `shopify_events`.
6. In the SEO editor change a meta description with **dry run**, apply it, check it in Shopify, then roll it back.
7. For production, host the connector somewhere long-running (Fly.io, Render, Railway) on Postgres, run `npm run deploy`, and use that URL for `SHOPIFY_CONNECTOR_URL`.

## Per-client install checklist
1. Partner Dashboard -> app -> Distribution -> Custom -> generate install link for the store.
2. Client (or you, as collaborator) approves the install.
3. In Discoverable Tools, link the new store to the client (or set it in the connector dashboard).
4. Run a full sync of products, collections and orders.

---

## Dashboard data endpoint: `shopify-dashboard` (search, ads and rankings in the Shopify dashboard)

The Connector's dashboard inside each client's Shopify admin shows a "Search and ads" section. It calls one
Supabase edge function per page load (6 second timeout, so cache aggressively). Until the function exists the
section shows a "will appear here once connected" message.

**Request:** `POST {DISCO_TOOLS_API_URL}/shopify-dashboard`, signed like every other call (`x-disco-timestamp`,
`x-disco-signature` over `${timestamp}.${rawBody}`), body `{ "shop": "store.myshopify.com" }`.

**Response (JSON, every section optional, omit what is not connected for that client):**
```json
{
  "updatedAt": "2026-11-26T04:00:00Z",
  "period": { "from": "2026-10-28", "to": "2026-11-26" },
  "organic": {
    "clicks": 1840, "impressions": 61200, "ctr": 0.030, "position": 14.2,
    "previous": { "clicks": 1510, "impressions": 55800 },
    "daily": [{ "date": "2026-11-25", "clicks": 62, "impressions": 2100 }],
    "topQueries": [{ "query": "blackberry locket", "clicks": 120, "impressions": 3400, "position": 4.1 }],
    "topPages": [{ "url": "https://store.com/products/blackberry-mouse-locket", "clicks": 210 }]
  },
  "paid": {
    "currency": "GBP", "spend": 2450, "revenue": 9800, "roas": 4.0, "clicks": 3100,
    "previous": { "spend": 2300, "revenue": 8700 },
    "daily": [{ "date": "2026-11-25", "spend": 80, "revenue": 340 }]
  },
  "traffic": {
    "sessions": 18400, "newUsers": 12100, "returningUsers": 4300, "conversionRate": 0.021,
    "previous": { "sessions": 16900 },
    "channels": [
      { "channel": "Organic Search", "sessions": 8200, "newUsers": 5900, "returningUsers": 1800, "conversions": 190, "revenue": 11200 }
    ]
  },
  "rankings": {
    "tracked": 120, "top3": 14, "top10": 47,
    "movers": [{ "keyword": "mouse locket", "position": 3, "change": 2 }]
  }
}
```
`traffic` (Google Analytics, last 30 days) feeds the Customers tab. `ctr` and `conversionRate` are fractions (0.03 = 3%). `change` is positions gained (positive) or lost (negative) versus the previous period.

### Prompt for Lovable
> Add a Supabase edge function **`shopify-dashboard`** (`verify_jwt = false`, HMAC-authenticated exactly like `shopify-events`, using `_shared/hmac.ts`). It receives `{ shop }`, looks up `shopify_stores` by `shop_domain` and its linked client, and returns JSON in the shape documented in `docs/PLATFORM_INTEGRATION.md` ("Dashboard data endpoint"), built from the data we already hold for that client: Google Search Console (clicks, impressions, CTR, average position, top queries, top pages, daily clicks, last 30 days vs the previous 30), Google Ads / Meta Ads spend, attributed revenue and ROAS (daily and totals, with previous period), and DiscoRank keyword tracking (tracked, top 3, top 10, biggest movers), and GA4 website traffic (sessions, new vs returning users, conversion rate and sessions by default channel group, last 30 days vs the previous 30). Return only the sections that are connected for that client, return `{}` for an unlinked store, never return another client's data, and respond in under 4 seconds (read from pre-aggregated or cached tables, refresh them with a scheduled job). Log nothing sensitive. Then add a small "Shopify dashboard preview" in the client's Shopify tab showing the same JSON so we can check what the store owner will see.
