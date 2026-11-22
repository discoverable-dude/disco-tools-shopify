import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { credentialsForShop, type Creds } from "./appcreds.server";

/**
 * One deployment, many Shopify apps. Each client store has its own custom app (own client ID
 * and secret). The store is identified from the request, its credentials are looked up
 * (database first, then the SHOPIFY_API_KEY / SHOPIFY_API_SECRET env vars as the default app),
 * and the matching Shopify app instance handles the request. Every instance still verifies
 * signatures and tokens with its own secret, so the store name in a request is never trusted.
 */
function build(creds: Creds) {
  return shopifyApp({
    apiKey: creds.apiKey,
    apiSecretKey: creds.apiSecret,
    apiVersion: ApiVersion.October26,
    scopes: process.env.SCOPES?.split(","),
    appUrl: process.env.SHOPIFY_APP_URL || "",
    authPathPrefix: "/auth",
    sessionStorage: new PrismaSessionStorage(prisma),
    distribution: AppDistribution.AppStore,
    hooks: {
      afterAuth: async ({ session }) => {
        await prisma.shopLink.upsert({
          where: { shop: session.shop },
          create: { shop: session.shop },
          update: { status: "installed", uninstalledAt: null },
        });
      },
    },
    future: {
      expiringOfflineAccessTokens: true,
    },
    ...(process.env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });
}

type ShopifyApp = ReturnType<typeof build>;
const instances = new Map<string, ShopifyApp>();

function instance(creds: Creds): ShopifyApp {
  const id = `${creds.apiKey}:${creds.apiSecret}`;
  let app = instances.get(id);
  if (!app) {
    app = build(creds);
    instances.set(id, app);
  }
  return app;
}

const envCreds = (): Creds => ({
  apiKey: process.env.SHOPIFY_API_KEY || "unconfigured",
  apiSecret: process.env.SHOPIFY_API_SECRET || "unconfigured",
});

async function credsForShop(shop: string | null): Promise<Creds> {
  if (shop) {
    const found = await credentialsForShop(shop);
    if (found) return found;
  }
  return envCreds();
}

function shopFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return new URL(payload.dest).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Work out which store a request is for. Only used to pick credentials, never trusted. */
export async function shopFromRequest(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const q = url.searchParams.get("shop");
  if (q) return q.toLowerCase();

  const header = request.headers.get("x-shopify-shop-domain");
  if (header) return header.toLowerCase();

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const s = shopFromJwt(auth.slice(7));
    if (s) return s;
  }
  const idToken = url.searchParams.get("id_token");
  if (idToken) {
    const s = shopFromJwt(idToken);
    if (s) return s;
  }
  const type = request.headers.get("content-type") || "";
  if (request.method === "POST" && type.includes("form")) {
    try {
      const shop = (await request.clone().formData()).get("shop");
      if (typeof shop === "string" && shop) return shop.toLowerCase();
    } catch {
      // not a form body
    }
  }
  return null;
}

async function appFor(request: Request) {
  return instance(await credsForShop(await shopFromRequest(request)));
}

async function appForShop(shop: string) {
  return instance(await credsForShop(shop));
}

/** The client ID App Bridge needs for this request's store. */
export async function apiKeyFor(request: Request) {
  return (await credsForShop(await shopFromRequest(request))).apiKey;
}

export const apiVersion = ApiVersion.October26;

// Only sets security headers (frame-ancestors); not tied to a particular app's credentials.
export const addDocumentResponseHeaders = (request: Request, headers: Headers) =>
  instance(envCreds()).addDocumentResponseHeaders(request, headers);

export const authenticate = {
  admin: async (request: Request) => (await appFor(request)).authenticate.admin(request),
  webhook: async (request: Request) => (await appFor(request)).authenticate.webhook(request),
};

export const unauthenticated = {
  admin: async (shop: string) => (await appForShop(shop)).unauthenticated.admin(shop),
};

export const login = async (request: Request) => (await appFor(request)).login(request);
