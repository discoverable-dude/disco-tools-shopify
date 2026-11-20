import db from "./db.server";
import { authenticate, unauthenticated } from "./shopify.server";
import { sendBatch } from "./platform.server";

type Admin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];
export type Resource = "products" | "orders" | "customers";

// Bulk query bodies. Keep fields lean; add more as the platform needs them.
const QUERIES: Record<Resource, string> = {
  products: `{ products { edges { node {
    id title handle status vendor productType tags updatedAt onlineStoreUrl
    seo { title description }
    featuredMedia { ... on MediaImage { alt image { url } } }
    variants { edges { node { id sku price inventoryQuantity } } }
    collections { edges { node { id handle } } }
  } } } }`,
  orders: `{ orders { edges { node {
    id name createdAt processedAt displayFinancialStatus displayFulfillmentStatus
    currencyCode sourceName
    totalPriceSet { shopMoney { amount currencyCode } }
    subtotalPriceSet { shopMoney { amount } }
    totalDiscountsSet { shopMoney { amount } }
    totalRefundedSet { shopMoney { amount } }
    lineItems { edges { node { id title quantity sku product { id } } } }
  } } } }`,
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

export async function startSync(admin: Admin, shop: string, resource: Resource) {
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
    { variables: { q: QUERIES[resource] } },
  );
  const json = await res.json();
  const result = json.data?.bulkOperationRunQuery;
  const errors = result?.userErrors ?? [];
  if (errors.length || !result?.bulkOperation) {
    const message = errors.map((e: { message: string }) => e.message).join("; ") || "Bulk operation failed to start";
    return db.syncRun.create({ data: { shop, resource, status: "failed", error: message, finishedAt: new Date() } });
  }
  return db.syncRun.create({ data: { shop, resource, bulkOpId: result.bulkOperation.id } });
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
          if (current) batch.push(current);
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
      if (current) batch.push(current);
      await flush();
    }
    await sendBatch(shop, run.resource, run.id, [], true);

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
