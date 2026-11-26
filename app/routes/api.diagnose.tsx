import type { LoaderFunctionArgs } from "react-router";
import { credentialsForShop } from "../appcreds.server";
import db from "../db.server";
import { envCreds } from "../shopify.server";

/**
 * GET /api/diagnose[?shop=x.myshopify.com]
 * Shows whether the Shopify key and secret the server is using look right, without revealing
 * them: only the first characters (the client ID is public) and the secret's length.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = new URL(request.url).searchParams.get("shop")?.toLowerCase() ?? null;
  const env = envCreds();
  const raw = process.env.SHOPIFY_API_SECRET ?? "";
  const rawKey = process.env.SHOPIFY_API_KEY ?? "";

  let database = "ok";
  try {
    await db.shopLink.count();
  } catch (e) {
    database = `error: ${(e as Error).message.slice(0, 120)}`;
  }

  let storeApp: { keyPrefix: string; secretLength: number } | null = null;
  if (shop) {
    try {
      const c = await credentialsForShop(shop);
      if (c) storeApp = { keyPrefix: c.apiKey.slice(0, 8), secretLength: c.apiSecret.length };
    } catch (e) {
      storeApp = { keyPrefix: `error: ${(e as Error).message.slice(0, 80)}`, secretLength: 0 };
    }
  }

  return Response.json(
    {
      defaultApp: {
        keyPrefix: env.apiKey.slice(0, 8),
        keyLength: env.apiKey.length,
        keyHadWhitespaceOrQuotes: rawKey !== env.apiKey && rawKey !== "",
        secretPrefix: env.apiSecret.slice(0, 6),
        secretLength: env.apiSecret.length,
        secretHadWhitespaceOrQuotes: raw !== env.apiSecret && raw !== "",
      },
      shop,
      registeredAppForShop: storeApp,
      appUrl: process.env.SHOPIFY_APP_URL ?? null,
      scopes: process.env.SCOPES ?? null,
      hasEncryptionKey: Boolean(process.env.APP_ENCRYPTION_KEY),
      hasPlatformSecret: Boolean(process.env.DISCO_TOOLS_API_SECRET),
      database,
    },
    { headers: { "cache-control": "no-store" } },
  );
};
