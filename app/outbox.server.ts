import db from "./db.server";
import { sendEvent } from "./platform.server";

const MAX_ATTEMPTS = 8;

/** Persist the event first so nothing is lost if the platform is down, then try to deliver. */
export async function recordAndDeliver(
  shop: string,
  topic: string,
  payload: unknown,
  webhookId?: string | null,
) {
  if (webhookId) {
    const existing = await db.webhookEvent.findFirst({ where: { webhookId } });
    if (existing) return existing; // Shopify retried - already stored
  }
  const event = await db.webhookEvent.create({
    data: { shop, topic, webhookId: webhookId ?? null, payload: JSON.stringify(payload) },
  });
  await deliver(event.id);
  return event;
}

export async function deliver(id: string) {
  const event = await db.webhookEvent.findUnique({ where: { id } });
  if (!event || event.status === "delivered") return;
  try {
    await sendEvent(event.shop, event.topic, JSON.parse(event.payload));
    await db.webhookEvent.update({
      where: { id },
      data: { status: "delivered", deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
  } catch (e) {
    await db.webhookEvent.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastError: (e as Error).message.slice(0, 500),
        status: event.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending",
      },
    });
  }
}

/** Retry anything still pending. Call from a cron hitting /api/retry or from the dashboard. */
export async function retryPending(limit = 100) {
  const pending = await db.webhookEvent.findMany({
    where: { status: "pending" },
    orderBy: { receivedAt: "asc" },
    take: limit,
  });
  for (const e of pending) await deliver(e.id);
  return pending.length;
}
