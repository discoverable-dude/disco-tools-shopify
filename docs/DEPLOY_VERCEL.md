# Deploying the Connector on Vercel

> One deployment serves every client store. For adding clients see `docs/ADD_A_CLIENT.md`. The
> "create a second app" step below applies to the first (default) app only; later clients use
> `npm run client:config` and the `/admin/clients` page.

The app runs as serverless functions on Vercel with a Postgres database. Webhook delivery and
bulk-sync downloads continue after the response using `waitUntil`, so Shopify gets its 200 inside
the 5 second limit.

## 1. Use a separate production app (recommended)
Keep the current Partner Dashboard app as your **dev** app. Create a second app for clients, because
the distribution choice (Custom) is permanent and production URLs differ from the dev tunnel.

```bash
npx shopify app config link
```
Choose **Create new app**, name it `Discoverable Connector`, and give the config a name such as
`production`. This creates `shopify.app.production.toml`. Edit it:
```toml
application_url = "https://<your-vercel-domain>"
[auth]
redirect_urls = ["https://<your-vercel-domain>/auth/callback"]
```
Then in the Partner Dashboard open the new app -> Distribution -> **Custom distribution**.

## 2. Database (Postgres)
Add a Postgres database: Vercel project -> Storage -> Neon (or Supabase, or any hosted Postgres).
- `DATABASE_URL`: the **pooled** connection string.
- `DATABASE_URL_UNPOOLED`: the **direct / unpooled** string (used by migrations during the build).
Use a separate database or branch for local development, with its own two strings in your local `.env`.
Migrations run automatically on every deploy (`vercel-build` runs `prisma migrate deploy`).

## 3. Vercel project
1. Merge the working branch into `main` on GitHub.
2. Vercel -> Add New -> Project -> import `discoverable-dude/disco-tools-shopify`. Framework preset: React Router. Leave the build command default; Vercel uses the `vercel-build` script.
3. Add environment variables (Production, and Preview if you want previews):

| Variable | Value |
|---|---|
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | from the **production** app in the Partner Dashboard |
| `SCOPES` | same list as `scopes` in the toml |
| `SHOPIFY_APP_URL` | `https://<your-vercel-domain>` |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | created by the Neon integration |
| `DISCO_TOOLS_API_URL` | `https://qjhhnukvfxtgpnphbrcy.supabase.co/functions/v1` |
| `DISCO_TOOLS_API_SECRET` | the shared secret (same as Lovable's `SHOPIFY_CONNECTOR_SECRET`) |
| `DISCO_TOOLS_APP_URL` | base URL of Discoverable Tools |
| `AGENCY_PASSCODE` | passcode for `/app/agency` |
| `BRAND_*` | optional overrides; defaults come from discoverable.co.uk |

4. Deploy. Note the production domain, put it into `shopify.app.production.toml` (step 1) and `SHOPIFY_APP_URL`, redeploy if you changed it.

## 4. Push the Shopify config
```bash
npx shopify app deploy --config production
```
This uploads scopes, webhooks (`/webhooks`) and URLs to the production app.

## 5. Connect the platform
In Supabase set the secret `SHOPIFY_CONNECTOR_URL` to `https://<your-vercel-domain>`. The platform's
Sync and SEO push buttons now work for real. Schedule the outbox retry from Supabase (pg_cron calling
`POST /api/sync` with `{"retry": true}`, signed as in `PLATFORM_INTEGRATION.md`).

## 6. Install on a client store
Partner Dashboard -> production app -> Distribution -> Custom distribution -> enter the client's
`.myshopify.com` domain -> copy the install link -> send to the store owner (or approve it yourself with
collaborator access). Then link the store in Discoverable Tools and run the first sync.

## Limits to know about
- Functions can run up to 300s on Vercel's defaults (more on Pro). A very large catalogue's bulk
  download happens in one function, so tens of thousands of products may need chunking later.
- Vercel's Hobby plan isn't allowed for commercial use; use Pro for client work.
- Sub-daily Vercel cron jobs need Pro, which is why outbox retries are triggered from the platform.
- The logo defaults to the Squarespace CDN copy. Host your own copy and set `BRAND_LOGO_URL`.
