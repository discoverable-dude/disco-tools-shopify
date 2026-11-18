import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, apiVersion } from "../shopify.server";
import db from "../db.server";
import { platformHealth } from "../platform.server";
import { retryPending } from "../outbox.server";
import { startSync, type Resource } from "../sync.server";

const RESOURCES: Resource[] = ["products", "orders", "customers"];
const since = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [shopRes, link, health, events24h, pending, failed, lastEvent, runs, pushes] =
    await Promise.all([
      admin.graphql(`#graphql
        query { shop { name myshopifyDomain currencyCode plan { displayName } primaryDomain { url } }
                productsCount { count } collectionsCount { count } }`),
      db.shopLink.findUnique({ where: { shop } }),
      platformHealth(),
      db.webhookEvent.count({ where: { shop, receivedAt: { gte: since() } } }),
      db.webhookEvent.count({ where: { shop, status: "pending" } }),
      db.webhookEvent.count({ where: { shop, status: "failed" } }),
      db.webhookEvent.findFirst({ where: { shop }, orderBy: { receivedAt: "desc" } }),
      db.syncRun.findMany({ where: { shop }, orderBy: { startedAt: "desc" }, take: 8 }),
      db.pushAudit.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 8 }),
    ]);
  const data = (await shopRes.json()).data;

  return {
    shop,
    shopInfo: data.shop,
    productsCount: data.productsCount.count,
    collectionsCount: data.collectionsCount.count,
    link,
    health,
    scopes: (session.scope ?? "").split(",").filter(Boolean),
    apiVersion,
    webhooks: { events24h, pending, failed, last: lastEvent?.receivedAt ?? null },
    runs,
    pushes,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "link") {
    const clientSlug = String(form.get("clientSlug") || "").trim();
    const platformClientId = String(form.get("platformClientId") || "").trim();
    await db.shopLink.update({
      where: { shop: session.shop },
      data: {
        clientSlug: clientSlug || null,
        platformClientId: platformClientId || null,
        status: clientSlug || platformClientId ? "linked" : "installed",
        linkedAt: clientSlug || platformClientId ? new Date() : null,
      },
    });
  } else if (intent === "sync") {
    const resource = String(form.get("resource")) as Resource;
    if (RESOURCES.includes(resource)) await startSync(admin, session.shop, resource);
  } else if (intent === "retry") {
    await retryPending();
  }
  return null;
};

const fmt = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-GB") : "Never";
const tone = (s: string) =>
  ["completed", "applied", "delivered", "linked"].includes(s)
    ? "success"
    : ["failed"].includes(s)
      ? "critical"
      : "caution";

export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";

  return (
    <s-page heading="Discoverable Connector">
      <s-section heading="Connection">
        <s-stack gap="small">
          <s-stack direction="inline" gap="small">
            <s-text>Discoverable Tools:</s-text>
            <s-badge tone={d.health.ok ? "success" : "critical"}>{d.health.detail}</s-badge>
          </s-stack>
          <s-stack direction="inline" gap="small">
            <s-text>Client link:</s-text>
            <s-badge tone={tone(d.link?.status ?? "installed")}>{d.link?.status ?? "installed"}</s-badge>
            {d.link?.clientSlug && <s-text>{d.link.clientSlug}</s-text>}
          </s-stack>
          <s-text>Store: {d.shopInfo.name} ({d.shopInfo.myshopifyDomain}) · {d.shopInfo.plan.displayName}</s-text>
          <s-text>Installed {fmt(d.link?.installedAt)} · API {d.apiVersion}</s-text>
          <s-text>Granted scopes: {d.scopes.join(", ") || "none"}</s-text>
        </s-stack>
      </s-section>

      <s-section heading="Link to a Discoverable client">
        <Form method="post">
          <input type="hidden" name="intent" value="link" />
          <s-stack gap="base">
            <s-text-field label="Client slug" name="clientSlug" defaultValue={d.link?.clientSlug ?? ""} />
            <s-text-field label="Platform client ID" name="platformClientId" defaultValue={d.link?.platformClientId ?? ""} />
            <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>Save link</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Store snapshot">
        <s-stack direction="inline" gap="large">
          <s-text>Products: {d.productsCount}</s-text>
          <s-text>Collections: {d.collectionsCount}</s-text>
        </s-stack>
      </s-section>

      <s-section heading="Data sync">
        <s-stack gap="base">
          <s-text>Last sync: {fmt(d.link?.lastSyncAt)} {d.link?.lastSyncStatus ? `(${d.link.lastSyncStatus})` : ""}</s-text>
          <s-stack direction="inline" gap="small">
            {RESOURCES.map((r) => (
              <Form method="post" key={r}>
                <input type="hidden" name="intent" value="sync" />
                <input type="hidden" name="resource" value={r} />
                <s-button type="submit" {...(busy ? { disabled: true } : {})}>Sync {r}</s-button>
              </Form>
            ))}
          </s-stack>
          {d.runs.map((r) => (
            <s-stack direction="inline" gap="small" key={r.id}>
              <s-badge tone={tone(r.status)}>{r.status}</s-badge>
              <s-text>{r.resource} · {r.recordCount} records · {fmt(r.startedAt)}{r.error ? ` · ${r.error}` : ""}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Webhook delivery">
        <s-stack gap="base">
          <s-text>
            {d.webhooks.events24h} events in 24h · {d.webhooks.pending} pending · {d.webhooks.failed} failed · last {fmt(d.webhooks.last)}
          </s-text>
          {d.webhooks.pending > 0 && (
            <Form method="post">
              <input type="hidden" name="intent" value="retry" />
              <s-button type="submit">Retry pending</s-button>
            </Form>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Recent pushes from Discoverable Tools">
        <s-stack gap="small">
          {d.pushes.length === 0 && <s-text>No changes pushed yet.</s-text>}
          {d.pushes.map((p) => (
            <s-stack direction="inline" gap="small" key={p.id}>
              <s-badge tone={tone(p.status)}>{p.status}</s-badge>
              <s-text>{p.resource} {p.resourceId.split("/").pop()} · {fmt(p.createdAt)}{p.error ? ` · ${p.error}` : ""}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
