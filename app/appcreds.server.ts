import crypto from "node:crypto";
import db from "./db.server";

/**
 * Per-store Shopify app credentials, so one deployment can run a separate custom app for
 * each client store. Secrets are encrypted at rest with APP_ENCRYPTION_KEY (64 hex chars).
 */
export type Creds = { apiKey: string; apiSecret: string };

function key() {
  const k = process.env.APP_ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(k)) throw new Error("APP_ENCRYPTION_KEY must be 64 hex characters");
  return Buffer.from(k, "hex");
}

export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decrypt(blob: string) {
  const raw = Buffer.from(blob, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

const TTL_MS = 60_000;
const cache = new Map<string, { creds: Creds | null; at: number }>();

const normalise = (shop: string) => shop.trim().toLowerCase();

export async function credentialsForShop(shop: string): Promise<Creds | null> {
  const s = normalise(shop);
  const hit = cache.get(s);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.creds;

  const row = await db.appCredential.findUnique({ where: { shop: s } });
  const creds = row ? { apiKey: row.clientId, apiSecret: decrypt(row.clientSecretEnc) } : null;
  cache.set(s, { creds, at: Date.now() });
  return creds;
}

export async function saveCredential(shop: string, clientId: string, clientSecret: string, label?: string) {
  const s = normalise(shop);
  const data = { clientId: clientId.trim(), clientSecretEnc: encrypt(clientSecret.trim()), label: label?.trim() || null };
  await db.appCredential.upsert({ where: { shop: s }, create: { shop: s, ...data }, update: data });
  cache.delete(s);
}

export async function deleteCredential(shop: string) {
  const s = normalise(shop);
  await db.appCredential.deleteMany({ where: { shop: s } });
  cache.delete(s);
}

export async function listCredentials() {
  return db.appCredential.findMany({
    select: { shop: true, clientId: true, label: true, updatedAt: true },
    orderBy: { shop: "asc" },
  });
}
