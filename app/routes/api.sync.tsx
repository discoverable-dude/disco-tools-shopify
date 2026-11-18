import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { verifyPlatformRequest } from "../platform.server";
import { startSync, type Resource } from "../sync.server";
import { retryPending } from "../outbox.server";

/** POST /api/sync (signed): { shop, resource } starts a bulk export. { retry: true } flushes the outbox. */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const verified = await verifyPlatformRequest(request);
  if (!verified.ok) return new Response(null, { status: verified.status });
  const body = JSON.parse(verified.body);

  if (body.retry) return Response.json({ retried: await retryPending() });

  if (!["products", "orders", "customers"].includes(body.resource)) {
    return Response.json({ error: "Invalid resource" }, { status: 400 });
  }
  const { admin } = await unauthenticated.admin(body.shop);
  const run = await startSync(admin, body.shop, body.resource as Resource);
  return Response.json({ runId: run.id, status: run.status });
};
