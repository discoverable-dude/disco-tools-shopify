import crypto from "node:crypto";

/**
 * Client for the Discoverable Tools platform API.
 *
 * Requests are signed with HMAC-SHA256 over `${timestamp}.${body}` using
 * DISCO_TOOLS_API_SECRET, sent as `x-disco-signature` + `x-disco-timestamp`.
 * The same scheme is verified on inbound calls (see verifyPlatformRequest).
 *
 * Endpoint paths below are the contract the platform should implement; change
 * them here once the real API is defined.
 */

const baseUrl = () => (process.env.DISCO_TOOLS_API_URL || "").replace(/\/$/, "");
const secret = () => process.env.DISCO_TOOLS_API_SECRET || "";

export function sign(body: string, timestamp: string) {
  return crypto
    .createHmac("sha256", secret())
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function platformConfigured() {
  return Boolean(baseUrl() && secret());
}

export async function platformPost(path: string, data: unknown) {
  if (!platformConfigured()) {
    throw new Error("DISCO_TOOLS_API_URL / DISCO_TOOLS_API_SECRET not set");
  }
  const body = JSON.stringify(data);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-disco-timestamp": timestamp,
      "x-disco-signature": sign(body, timestamp),
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Platform ${path} responded ${res.status}`);
  }
  return res;
}

/** Forward a single Shopify webhook event. */
export const sendEvent = (shop: string, topic: string, payload: unknown) =>
  platformPost("/api/shopify/events", { shop, topic, payload });

/** Forward a batch of records from a bulk export. */
export const sendBatch = (
  shop: string,
  resource: string,
  runId: string,
  records: unknown[],
  final: boolean,
) =>
  platformPost("/api/shopify/sync", { shop, resource, runId, records, final });

/** Ping used by the admin UI to show connection health. */
export async function platformHealth(): Promise<{ ok: boolean; detail: string }> {
  if (!platformConfigured()) return { ok: false, detail: "Not configured" };
  try {
    const res = await fetch(`${baseUrl()}/api/shopify/health`, {
      signal: AbortSignal.timeout(8_000),
    });
    return { ok: res.ok, detail: res.ok ? "Reachable" : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/** Verify a signed request coming FROM the platform (push / sync triggers). */
export async function verifyPlatformRequest(
  request: Request,
): Promise<{ ok: true; body: string } | { ok: false; status: number }> {
  if (!secret()) return { ok: false, status: 503 };
  const timestamp = request.headers.get("x-disco-timestamp") || "";
  const signature = request.headers.get("x-disco-signature") || "";
  const body = await request.text();
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !signature || Number.isNaN(age) || age > 300) {
    return { ok: false, status: 401 };
  }
  const expected = Buffer.from(sign(body, timestamp));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, status: 401 };
  }
  return { ok: true, body };
}
