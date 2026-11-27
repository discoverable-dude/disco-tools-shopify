import db from "./db.server";
import { authenticate, unauthenticated } from "./shopify.server";
import { sendBatch } from "./platform.server";
import { SalesAggregator, saveSummary } from "./sales-summary.server";
import { CustomerAggregator, saveCustomerSummary } from "./customer-summary.server";

type Admin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];
export type Resource = "products" | "orders" | "customers";

// Bulk query bodies. Keep fields lean; add more as the platform needs them.
// Orders are limited to the last 60 days by default (Shopify's window without read_all_orders), which is
// also what the 30 + 30 day sales report needs. Set ORDERS_EXPORT_DAYS (up to 400) for apps that have
// the read_all_orders scope and need longer monthly history; stores without it still return 60 days.
const exportDays = () => Math.min(400, Math.max(60, Number(process.env.ORDERS_EXPORT_DAYS) || 60));
const ordersQuery = (extended: boolean) => {
  const from = new Date(Date.now() - exportDays() * 86_400_000).toISOString().slice(0, 10);
  // "Extended" adds the customer id and the visits before purchase, which give new vs returning
  // customers and traffic sources. If Shopify refuses them for a store, a basic export is used.
  const journey = extended
    ? `customer { id }
    customerJourneySummary { customerOrderIndex daysToConversion
      firstVisit { source sourceType } lastVisit { source sourceType } }`
    : "";
  return `{ orders(query: "created_at:>=${from}") { edges { node {
    id name createdAt processedAt displayFinancialStatus displayFulfillmentStatus
    currencyCode sourceName
    totalPriceSet { shopMoney { amount currencyCode } }
    subtotalPriceSet { shopMoney { amount } }
    totalDiscountsSet { shopMoney { amount } }
    totalRefundedSet { shopMoney { amount } }
    ${journey}
    lineItems { edges { node { id title quantity currentQuantity sku
      originalTotalSet { shopMoney { amount } }
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      totalDiscountSet { shopMoney { amount currencyCode } }
      discountedTotalSet { shopMoney { amount currencyCode } }
      product { id }
      variant { id inventoryItem { unitCost { amount currencyCode } } } } } }
  } } } }`;
};

const QUERIES: Record<Resource, string> = {
  products: `{ products { edges { node {
    id title handle status vendor productType tags updatedAt onlineStoreUrl
    seo { title description }
    featuredMedia { ... on MediaImage { alt image { url } } }
    variants { edges { node { id sku price inventoryQuantity inventoryItem { unitCost { amount currencyCode } } } } }
    collections { edges { node { id handle } } }
  } } } }`,
  orders: "",
  customers: `{ customers { edges { node {
    id createdAt updatedAt numberOfOrders state
    amountSpent { amount currencyCode }
  } } } }`,
};

const CHILD_KEYS: Record<string, string> = {
  ProductVariant: "variants",
  Collection: "collections",
  LineItem: "lineItems",
};

export async function startSync(admin: Admin, shop: string, resource: Resource, opts: { basic?: boolean } = {}): Promise<Awaited<ReturnType<typeof db.syncRun.create>>> {
  // A run whose finish webhook never arrived would block every later refresh, so give up on it after 20 minutes.
  await db.syncRun.updateMany({
    where: { shop, resource, status: { in: ["running", "delivering"] }, startedAt: { lt: new Date(Date.now() - 20 * 60_000) } },
    data: { status: "failed", error: "Timed out waiting for Shopify to finish the export", finishedAt: new Date() },
  });
  const running = await db.syncRun.findFirst({
    where: { shop, resource, status: { in: ["running", "delivering"] } },
  });
  if (running) return running;

  const res = await admin.graphql(
    `#graphql
    mutation Run($q: String!) {
      bulkOperationRunQuery(query: $q) {
        bulkOperation { id status }
        userErrors { field message }
      }
    }`,
    { variables: { q: resource === "orders" ? ordersQuery(!opts.basic) : QUERIES[resource] } },
  );
  const json = await res.json();
  const result = json.data?.bulkOperationRunQuery;
  const errors = result?.userErrors ?? [];
  if (errors.length || !result?.bulkOperation) {
    const message = errors.map((e: { message: string }) => e.message).join("; ") || "Bulk operation failed to start";
    // Shopify refused the extended fields: fall back to the basic export rather than failing.
    if (resource === "orders" && !opts.basic) return startSync(admin, shop, resource, { basic: true });
    return db.syncRun.create({ data: { shop, resource, status: "failed", error: message, variant: opts.basic ? "basic" : null, finishedAt: new Date() } });
  }
  return db.syncRun.create({ data: { shop, resource, bulkOpId: result.bulkOperation.id, variant: opts.basic ? "basic" : null } });
}

/** Called from the bulk_operations/finish webhook. */
export async function finishSync(shop: string, bulkOpId: string, status: string) {
  const run = await db.syncRun.findFirst({ where: { shop, bulkOpId } });
  if (!run) return;
  if (status !== "completed") {
    await db.syncRun.update({
      where: { id: run.id },
      data: { status: "failed", error: `Bulk operation ${status}`, finishedAt: new Date() },
    });
    // The extended orders export can fail at run time (for example customer data access not
    // granted). Retry once with the basic fields so the sales report still builds.
    if (run.resource === "orders" && run.variant !== "basic") {
      try {
        const { admin } = await unauthenticated.admin(shop);
        await startSync(admin, shop, "orders", { basic: true });
      } catch (e) {
        console.error("basic orders retry failed", e);
      }
    }
    return;
  }
  await db.syncRun.update({ where: { id: run.id }, data: { status: "delivering" } });

  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(
      `#graphql
      query Op($id: ID!) { node(id: $id) { ... on BulkOperation { url objectCount } } }`,
      { variables: { id: bulkOpId } },
    );
    const url: string | null = (await res.json()).data?.node?.url ?? null;

    let count = 0;
    const sales = run.resource === "orders" ? new SalesAggregator(30) : null;
    const customers = run.resource === "customers" ? new CustomerAggregator() : null;
    if (url) {
      // Stream JSONL; each line is a node, children carry __parentId.
      const file = await fetch(url);
      if (!file.ok || !file.body) throw new Error(`Download failed: ${file.status}`);
      const reader = file.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let batch: unknown[] = [];
      let current: Record<string, unknown> | null = null;
      const flush = async () => {
        if (!batch.length) return;
        await sendBatch(shop, run.resource, run.id, batch, false);
        count += batch.length;
        batch = [];
      };
      // Bulk JSONL lists children after their parent with __parentId. Re-nest them
      // (variants, collections, lineItems) so the platform receives one object per record.
      const handle = async (line: string) => {
        const row = JSON.parse(line) as Record<string, unknown>;
        const parentId = row.__parentId as string | undefined;
        if (!parentId) {
          if (current) {
            batch.push(current);
            sales?.add(current);
            customers?.add(current);
          }
          current = row;
          if (batch.length >= 500) await flush();
          return;
        }
        if (!current) return;
        const type = String(row.id).split("/")[3];
        const key = CHILD_KEYS[type] ?? `${type}s`;
        delete row.__parentId;
        ((current[key] ??= []) as unknown[]).push(row);
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buffer += value;
        const lines = buffer.split("\n");
        buffer = done ? "" : (lines.pop() ?? "");
        for (const line of lines) if (line.trim()) await handle(line);
        if (done) break;
      }
      if (current) {
        batch.push(current);
        sales?.add(current);
        customers?.add(current);
      }
      await flush();
    }
    await sendBatch(shop, run.resource, run.id, [], true);
    if (sales) await saveSummary(shop, sales.result());
    if (customers) await saveCustomerSummary(shop, customers.result());

    await db.syncRun.update({
      where: { id: run.id },
      data: { status: "completed", recordCount: count, finishedAt: new Date() },
    });
    await db.shopLink.update({
      where: { shop },
      data: { lastSyncAt: new Date(), lastSyncStatus: `${run.resource}: ${count} records` },
    });
  } catch (e) {
    await db.syncRun.update({
      where: { id: run.id },
      data: { status: "failed", error: (e as Error).message.slice(0, 500), finishedAt: new Date() },
    });
  }
}
