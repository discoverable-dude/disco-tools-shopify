# Discoverable Connector (Shopify app)

Custom-distribution Shopify app installed on client stores. Syncs Shopify data into
Discoverable Tools and lets the platform push SEO changes back.

## Setup (on your machine)
```bash
npm install
npx shopify app config link      # pick/create the app in the Partner Dashboard (distribution: Custom)
cp .env.example .env             # DISCO_TOOLS_API_URL / DISCO_TOOLS_API_SECRET
npm run dev                      # tunnel + install on a dev store
npm run deploy                   # push scopes/webhooks config
```
In the Partner Dashboard: choose **Custom distribution**, generate an install link per client store,
and request **Protected customer data** access (needed for customers/orders PII).

## What it does
| Piece | File |
|---|---|
| Webhooks -> outbox -> platform (retry on failure) | `app/routes/webhooks.tsx`, `app/outbox.server.ts` |
| Bulk pull of products/orders/customers (JSONL, 500/batch) | `app/sync.server.ts` |
| Signed platform client + inbound verification | `app/platform.server.ts` |
| Push SEO fields, with audit + rollback | `app/routes/api.push.seo.tsx` |
| Trigger sync / flush outbox from the platform | `app/routes/api.sync.tsx` |
| Admin dashboard (connection, sync, webhook health, pushes) | `app/routes/app._index.tsx` |

## Platform contract (all requests HMAC-SHA256 signed: `x-disco-timestamp`, `x-disco-signature` over `${ts}.${body}`)
App -> platform: `POST /api/shopify/events`, `POST /api/shopify/sync`, `GET /api/shopify/health`.
Platform -> app: `POST /api/push/seo`, `POST /api/sync`.

## Before production
- Switch Prisma to Postgres and re-create migrations; host somewhere long-running (the bulk download runs after the webhook returns).
- Schedule a call to `POST /api/sync {"retry":true}` every few minutes to flush the outbox.
- Customer/order fields are kept minimal until Protected Customer Data is approved.
