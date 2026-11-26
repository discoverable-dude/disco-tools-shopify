# Adding a client store

One Vercel deployment and one Lovable platform serve every client. Each client store gets its own
**custom** Shopify app (Shopify only allows a custom app on one store), but all of them point at the
same Connector address. Nothing changes in Lovable per client except linking the store to the client
under Admin -> Shopify stores. Lovable never needs the app keys.

Time per client: about 10 minutes. Run commands from the project folder (`cd ~/disco-tools-shopify`, `git pull` first).

## 1. Create the client's app (terminal)
```bash
npx shopify app config link
```
Choose **Create new app**, name it `Discoverable - ClientName` (Shopify limits app names to 29 characters, so keep the client name short), and give the config the client's name, for example `acme`.

```bash
npm run client:config -- acme --name "Discoverable - Acme"
```
This rewrites `shopify.app.acme.toml` with the standard scopes, webhooks and the Connector address.

```bash
npx shopify app deploy --config acme --force
```

## 2. Set up the app in the Dev Dashboard
Open the new app at dev.shopify.com -> Apps -> the app:
1. **Settings -> Enable bulk queries** (needed for syncing).
2. **Settings -> IP allowlist -> Manage**: ASN `16509`, country United Kingdom, run the test, turn on Enforce. (Required before installing on a store outside your organization.)
3. **Settings -> Protected customer data -> Manage** if you need customer sync (Shopify approves this).
4. **Overview -> Distribution card -> Select distribution method -> Custom distribution**, enter the client's `.myshopify.com` address and click **Generate link**. Choose "limit to a single store" unless the client is a Plus organization with several stores.
5. Copy the **Client ID** and the **Client secret** from Settings -> Credentials. The secret is behind the eye icon and starts `shpss_`. It is a different, longer value than the Client ID; pasting the Client ID into the secret field makes every login fail with a 401.

## 3. Register the app keys
Open `https://disco-tools-shopify.vercel.app/admin/clients`, enter the agency passcode, then the store address, Client ID and Client secret. The secret is stored encrypted. Check it by opening `https://disco-tools-shopify.vercel.app/api/diagnose?shop=<store>.myshopify.com`: `registeredAppForShop` should show the first 8 characters of the Client ID and a `secretLength` of 38.

## 4. Install and link
1. Send the install link to the store owner (or approve it yourself with collaborator access).
2. In Discoverable Tools: Admin -> Shopify stores -> link the store to the client.
3. In the app inside Shopify admin open Agency tools (`/app/agency`) and run **Sync products**.

## Creating the apps from the command line (no clicking to create them)
The CLI can create the apps too, so nothing needs creating in the Dev Dashboard first.
1. Make a file `clients.json` (git-ignored): `[{ "name": "Acme", "config": "acme", "store": "acme.myshopify.com" }]`. App names are `Discoverable - <name>` and must be 29 characters or fewer, so keep `name` to 14 characters or add an `"appName"` for that client.
2. Find your organization id in the Dev Dashboard address, `dev.shopify.com/dashboard/<organization-id>`, then run:
```bash
npm run clients:create -- clients.json --org <organization-id>
```
For each client this creates the app, writes and releases its config, and fetches its Client ID and secret. It is safe to re-run: apps already created are remembered in `clients.created.json`. **Try it with one client first.**
3. The lines to paste into `/admin/clients` -> **Add several at once** are saved in `clients.register.txt` (it contains secrets and is git-ignored). Delete it once pasted.
4. Per app in the Dev Dashboard: upload the icon (`public/app-icon-1200.jpg`), enable bulk queries, set the IP allowlist, then Distribution -> Custom distribution -> install link. These have no command-line equivalent.

## Setting up several clients at once
For a batch (for example six stores), do the Dev Dashboard parts per app first, then let one command do the terminal work:
1. In the Dev Dashboard click **Create app**, name each one `Discoverable - ClientName` (29 characters maximum), and copy its **Client ID** and real **Client secret** (`shpss_...`).
2. Copy `clients.example.json` to `clients.json` and fill in each client's name, a short config name and the Client ID. Then run:
```bash
npm run clients:add -- clients.json
```
This links each app, writes its config from the template and deploys and releases it, then prints a summary.
3. Per app in the Dev Dashboard: enable bulk queries, set the IP allowlist, then Distribution -> Custom distribution -> install link.
4. Open `/admin/clients`, use **Add several at once**, and paste one line per client: `store.myshopify.com, clientId, clientSecret, Client name`.
5. Send the install links, link each store in Discoverable Tools, and check `/api/diagnose?shop=<store>` for each.

## One-off setup (already done once)
In Vercel set `APP_ENCRYPTION_KEY` (openssl rand -hex 32), `AGENCY_PASSCODE`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
`DISCO_TOOLS_API_URL`, `DISCO_TOOLS_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`. `SHOPIFY_API_KEY` and
`SHOPIFY_API_SECRET` are only the default app, used for any store without an entry on the clients page.

## Why this works
The Connector picks the Shopify app by the store in each request (the store address, a Shopify session
token, or a webhook header), looks up that store's keys, and lets that app verify the request with its own
secret. The store name is only used to choose keys and is never trusted by itself.
