import { waitUntil } from "@vercel/functions";
import db from "./db.server";
import { loadSummary } from "./sales-summary.server";
import { loadCustomerSummary } from "./customer-summary.server";
import { startSync } from "./sync.server";
import type { authenticate } from "./shopify.server";

type Admin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

const HOUR = 3_600_000;

/** Run something that may fail, returning the error instead of throwing, so one card can't break a page. */
export async function safe<T>(fn: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await fn(), error: null };
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }
}

async function state(shop: string, resource: "orders" | "customers", hasData: boolean) {
  const run = await db.syncRun.findFirst({ where: { shop, resource }, orderBy: { startedAt: "desc" } });
  const running = run?.status === "running" || run?.status === "delivering";
  return {
    building: !hasData && (!run || running),
    failed: !hasData && run?.status === "failed",
    error: !hasData && run?.status === "failed" ? run.error : null,
  };
}

/** The saved sales report; refreshes it in the background when older than 12 hours. */
export async function ordersReport(admin: Admin, shop: string) {
  const saved = await loadSummary(shop);
  const stale = !saved || Date.now() - saved.computedAt.getTime() > 12 * HOUR;
  if (stale) waitUntil(startSync(admin, shop, "orders").catch((e) => console.error("orders refresh failed", e)));
  return { data: saved?.data ?? null, updatedAt: saved?.computedAt ?? null, ...(await state(shop, "orders", Boolean(saved))) };
}

/** The saved customer report; refreshes it in the background when older than 24 hours. */
export async function customersReport(admin: Admin, shop: string) {
  const saved = await loadCustomerSummary(shop);
  const stale = !saved || Date.now() - saved.computedAt.getTime() > 24 * HOUR;
  if (stale) waitUntil(startSync(admin, shop, "customers").catch((e) => console.error("customers refresh failed", e)));
  return { data: saved?.data ?? null, updatedAt: saved?.computedAt ?? null, ...(await state(shop, "customers", Boolean(saved))) };
}
