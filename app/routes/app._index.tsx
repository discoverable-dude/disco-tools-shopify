import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, apiVersion } from "../shopify.server";
import db from "../db.server";
import { platformHealth } from "../platform.server";
import { retryPending } from "../outbox.server";
import { startSync, type Resource } from "../sync.server";
import { getOrderInsights, getSeoAudit } from "../insights.server";

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

  // Each insight is isolated so a missing scope or schema change only blanks its own card.
  const safe = async <T,>(fn: () => Promise<T>): Promise<{ data: T | null; error: string | null }> => {
    try {
      return { data: await fn(), error: null };
    } catch (e) {
      return { data: null, error: (e as Error).message };
    }
  };
  const [sales, seo] = await Promise.all([
    safe(() => getOrderInsights(admin)),
    safe(() => getSeoAudit(admin)),
  ]);

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
    sales,
    seo,
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

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

function Metric({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background={bad ? "subdued" : "base"}>
      <s-stack gap="small-500">
        <s-text>{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

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
      <s-section heading={`Sales - last ${d.sales.data?.days ?? 30} days`}>
        {d.sales.error && <s-banner tone="critical">Could not load sales: {d.sales.error}</s-banner>}
        {d.sales.data && (
          <s-stack gap="base">
            <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
              <Metric label="Revenue" value={money(d.sales.data.revenue, d.sales.data.currency)} />
              <Metric label="Orders" value={String(d.sales.data.orders)} />
              <Metric label="Avg order value" value={money(d.sales.data.aov, d.sales.data.currency)} />
              <Metric label="Refunded" value={money(d.sales.data.refunded, d.sales.data.currency)} />
            </s-grid>
            {d.sales.data.capped && <s-text>Showing the most recent 400 orders only.</s-text>}
            <s-heading>Top products by revenue</s-heading>
            {d.sales.data.topProducts.map((p) => (
              <s-text key={p.title}>{p.title} · {p.units} sold · {money(p.revenue, d.sales.data!.currency)}</s-text>
            ))}
            <s-heading>Sales channels</s-heading>
            {d.sales.data.channels.map((c) => (
              <s-text key={c.name}>{c.name} · {c.orders} orders · {money(c.revenue, d.sales.data!.currency)}</s-text>
            ))}
            <s-text>Traffic sources, rankings and ad performance for this store live in Discoverable Tools.</s-text>
          </s-stack>
        )}
      </s-section>

      <s-section heading="On-page SEO health">
        {d.seo.error && <s-banner tone="critical">Could not run SEO audit: {d.seo.error}</s-banner>}
        {d.seo.data && (
          <s-stack gap="base">
            <s-text>
              Scanned {d.seo.data.products} active products and {d.seo.data.collections} collections
              {d.seo.data.capped ? " (first 1,000 of each)" : ""}. {d.seo.data.draftOrArchived} draft/archived products skipped.
            </s-text>
            <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
              <Metric label="Missing meta title" value={String(d.seo.data.missingMetaTitle)} bad={d.seo.data.missingMetaTitle > 0} />
              <Metric label="Missing meta description" value={String(d.seo.data.missingMetaDescription)} bad={d.seo.data.missingMetaDescription > 0} />
              <Metric label="Duplicate titles" value={String(d.seo.data.duplicateTitles)} bad={d.seo.data.duplicateTitles > 0} />
              <Metric label="Meta title over 60 chars" value={String(d.seo.data.metaTitleTooLong)} bad={d.seo.data.metaTitleTooLong > 0} />
              <Metric label="Meta description too long/short" value={String(d.seo.data.metaDescriptionTooLong + d.seo.data.metaDescriptionTooShort)} bad={d.seo.data.metaDescriptionTooLong + d.seo.data.metaDescriptionTooShort > 0} />
              <Metric label="Main image missing alt text" value={String(d.seo.data.missingAlt)} bad={d.seo.data.missingAlt > 0} />
            </s-grid>
            {d.seo.data.worst.length > 0 && <s-heading>Biggest opportunities</s-heading>}
            {d.seo.data.worst.map((i) => (
              <s-stack key={i.id} gap="small-500">
                <s-link href={`shopify:admin/${i.kind === "product" ? "products" : "collections"}/${i.id.split("/").pop()}`}>{i.title}</s-link>
                <s-text>{i.problems.join(" · ")}</s-text>
              </s-stack>
            ))}
            <s-text>Fixes can be pushed from Discoverable Tools with a diff preview and one-click rollback.</s-text>
          </s-stack>
        )}
      </s-section>
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
