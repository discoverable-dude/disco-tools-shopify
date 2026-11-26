import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { verifyPlatformRequest } from "../platform.server";
import { getVisitorAnalytics } from "../analytics.server";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/analytics (signed): { shop, from?, to? } returns Shopify's own visits, conversion rate and
 * traffic sources for the date range (default: last 30 days). Dates are YYYY-MM-DD in the store's timezone.
 * Returns { ok: false, reason } with 200 when visitor data is not switched on for the store yet.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const verified = await verifyPlatformRequest(request);
  if (!verified.ok) return new Response(null, { status: verified.status });
  const body = JSON.parse(verified.body) as { shop?: string; from?: string; to?: string };
  if (!body.shop) return Response.json({ error: "shop is required" }, { status: 400 });

  const to = body.to && DATE.test(body.to) ? body.to : new Date().toISOString().slice(0, 10);
  const from = body.from && DATE.test(body.from) ? body.from : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  if (from > to) return Response.json({ error: "from must not be after to" }, { status: 400 });

  try {
    const { admin } = await unauthenticated.admin(body.shop);
    return Response.json({ ok: true, ...(await getVisitorAnalytics(admin, from, to)) });
  } catch (e) {
    return Response.json({ ok: false, reason: (e as Error).message });
  }
};
