import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { brand } from "../brand";
import { getOrderInsights, getSeoAudit } from "../insights.server";
import { hasScope, missingScopes, SCOPE_INFO } from "../scopes.server";
import { TOPIC_LABELS } from "../labels";
import { recordSnapshot, seoHistory } from "../seo-history.server";
import { BrandHeader, fmt, money } from "../ui";
import { BarChart, Card, Delta, Grid, HBars, Kpi, LineChart, palette, Pill, Ring, Row } from "../charts";

const DAY = 86_400_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const since = new Date(Date.now() - 30 * DAY);

  // Each insight is isolated so a missing scope or schema change only blanks its own card.
  const safe = async <T,>(fn: () => Promise<T>): Promise<{ data: T | null; error: string | null }> => {
    try {
      return { data: await fn(), error: null };
    } catch (e) {
      return { data: null, error: (e as Error).message };
    }
  };

  const [link, shopRes, sales, seo] = await Promise.all([
    db.shopLink.findUnique({ where: { shop } }),
    admin.graphql(`#graphql
      query ShopName { shop { name } }`),
    safe(() => getOrderInsights(admin)),
    safe(() => getSeoAudit(admin)),
  ]);
  const shopName: string = (await shopRes.json()).data?.shop?.name ?? shop;

  // Progress history and what Discoverable has accessed or changed.
  const [history, byTopic, delivery, runs, pushes] = await Promise.all([
    safe(async () => {
      if (seo.data) await recordSnapshot(shop, seo.data);
      return seoHistory(shop);
    }),
    db.webhookEvent.groupBy({ by: ["topic"], where: { shop, receivedAt: { gte: since } }, _count: { _all: true } }),
    db.webhookEvent.groupBy({ by: ["status"], where: { shop, receivedAt: { gte: since } }, _count: { _all: true } }),
    db.syncRun.findMany({ where: { shop, startedAt: { gte: since } }, orderBy: { startedAt: "desc" }, take: 6 }),
    db.pushAudit.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);

  const granted = (session.scope ?? "").split(",").filter(Boolean);
  return {
    shopName,
    link,
    sales,
    seo,
    history: history.data ?? [],
    events: byTopic.map((t) => ({ topic: t.topic, count: t._count._all })).sort((a, b) => b.count - a.count),
    delivery: Object.fromEntries(delivery.map((d) => [d.status, d._count._all])) as Record<string, number>,
    runs,
    pushes: pushes.map((p) => ({
      id: p.id,
      resource: p.resource,
      resourceId: p.resourceId,
      fields: Object.keys(JSON.parse(p.changes) as Record<string, unknown>),
      status: p.status,
      createdAt: p.createdAt,
    })),
    granted,
    scopeRows: SCOPE_INFO.map((s) => ({ ...s, granted: hasScope(granted, s.scope) })),
    missing: missingScopes(granted),
    brand: { ...brand },
  };
};

const RESOURCE_LABEL: Record<string, string> = { products: "Products and collections", orders: "Orders", customers: "Customer totals" };
const FIELD_LABEL: Record<string, string> = {
  title: "title",
  handle: "URL handle",
  seoTitle: "meta title",
  seoDescription: "meta description",
  descriptionHtml: "description",
};
const short = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const linked = d.link?.status === "linked";
  const b = d.brand;
  const seo = d.seo.data;
  const sales = d.sales.data;
  const cur = sales?.currency ?? "GBP";
  const eventTotal = d.events.reduce((a, e) => a + e.count, 0);

  return (
    <s-page heading={d.shopName}>
      <BrandHeader
        name={b.agency}
        tagline={b.tagline}
        accent={b.accent}
        accentText={b.accentText}
        logoUrl={b.logoUrl}
        title={`Your store performance, ${d.shopName}`}
        subtitle={linked ? `Connected · last data ${fmt(d.link?.lastSyncAt)}` : "Setup in progress"}
      />

      {d.missing.length > 0 && (
        <s-banner tone="warning" heading="Permissions need updating">
          This app needs additional access ({d.missing.join(", ")}). Your {b.agency} team will send an update to approve.
        </s-banner>
      )}
      {!linked && (
        <s-banner tone="info" heading="Almost there">
          Your {b.agency} team is finishing the connection to your reporting. Nothing else is needed from you.
        </s-banner>
      )}

      <s-section heading="Sales overview">
        {d.sales.error && <s-banner tone="critical">Could not load sales: {d.sales.error}</s-banner>}
        {sales && (
          <div style={{ display: "grid", gap: 14 }}>
            <Grid min={200}>
              <Kpi label="Revenue (30 days)" value={money(sales.revenue, cur)} delta={<Delta current={sales.revenue} previous={sales.previous.revenue} />} />
              <Kpi label="Orders" value={String(sales.orders)} delta={<Delta current={sales.orders} previous={sales.previous.orders} />} accent={palette.teal3} />
              <Kpi label="Average order value" value={money(sales.aov, cur)} delta={<Delta current={sales.aov} previous={sales.previous.aov} />} accent={palette.teal2} />
              <Kpi label="Refunded" value={money(sales.refunded, cur)} delta={<Delta current={sales.refunded} previous={sales.previous.refunded} invert />} accent={palette.warn} />
            </Grid>
            <Card title="Revenue by day" subtitle="Last 30 days">
              <BarChart
                data={sales.daily.map((x) => ({
                  label: short(x.date),
                  value: x.revenue,
                  tip: `${short(x.date)}: ${money(x.revenue, cur)} from ${x.orders} order${x.orders === 1 ? "" : "s"}`,
                }))}
                format={(n) => money(n, cur)}
              />
            </Card>
            <Grid min={300}>
              <Card title="Best sellers" subtitle="By revenue">
                <HBars
                  items={sales.topProducts.map((p) => ({ label: p.title, value: p.revenue, display: `${money(p.revenue, cur)} · ${p.units} sold` }))}
                  empty="No orders in this period."
                />
              </Card>
              <Card title="Where orders come from" subtitle="Sales channel, by revenue">
                <HBars
                  color={palette.teal3}
                  items={sales.channels.map((c) => ({ label: c.name, value: c.revenue, display: `${money(c.revenue, cur)} · ${c.orders} orders` }))}
                  empty="No orders in this period."
                />
              </Card>
            </Grid>
            {sales.capped && <s-text>Based on the most recent 800 orders.</s-text>}
          </div>
        )}
      </s-section>

      <s-section heading="On-page SEO health">
        {d.seo.error && <s-banner tone="critical">Could not run the SEO check: {d.seo.error}</s-banner>}
        {seo && (
          <div style={{ display: "grid", gap: 14 }}>
            <Grid min={280}>
              <Card>
                <Ring
                  value={seo.score}
                  label="SEO health score"
                  sub={`${seo.audited - seo.withIssues} of ${seo.audited} pages pass every check`}
                />
              </Card>
              <Card title="What needs attention" subtitle={`${seo.products} live products and ${seo.collections} collections checked`}>
                <HBars
                  color={palette.warn}
                  items={[
                    { label: "Missing meta titles", value: seo.missingMetaTitle },
                    { label: "Missing meta descriptions", value: seo.missingMetaDescription },
                    { label: "Meta description too long or short", value: seo.metaDescriptionTooLong + seo.metaDescriptionTooShort },
                    { label: "Meta titles over 60 characters", value: seo.metaTitleTooLong },
                    { label: "Duplicate titles", value: seo.duplicateTitles },
                    { label: "Main images without alt text", value: seo.missingAlt },
                  ]}
                />
              </Card>
            </Grid>
            <Card title="SEO score over time" subtitle="Updated each day the dashboard is opened">
              <LineChart data={d.history.map((h) => ({ date: h.date, value: h.score }))} />
            </Card>
            {seo.worst.length > 0 && (
              <Card title="Quick wins" subtitle="Pages with the most issues">
                {seo.worst.map((i, idx) => (
                  <Row key={i.id} last={idx === seo.worst.length - 1}>
                    <span style={{ flex: 1 }}>
                      <s-link href={`shopify:admin/${i.kind === "product" ? "products" : "collections"}/${i.id.split("/").pop()}`}>{i.title}</s-link>
                      <div style={{ color: palette.muted, fontSize: 12 }}>{i.problems.join(" · ")}</div>
                    </span>
                    <Pill tone="warn">{i.problems.length} issue{i.problems.length === 1 ? "" : "s"}</Pill>
                  </Row>
                ))}
              </Card>
            )}
          </div>
        )}
      </s-section>

      <s-section heading={`What ${b.agency} can see and has done`}>
        <div style={{ display: "grid", gap: 14 }}>
          <Grid min={300}>
            <Card title="Data shared in the last 30 days" subtitle={`${eventTotal} store updates sent securely to ${b.agency}`}>
              <HBars
                items={d.events.map((e) => ({ label: TOPIC_LABELS[e.topic] ?? e.topic.toLowerCase().replace(/_/g, " "), value: e.count }))}
                empty="No updates yet. They appear as your store changes."
              />
              {eventTotal > 0 && (
                <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Pill tone="good">{d.delivery.delivered ?? 0} delivered</Pill>
                  {(d.delivery.pending ?? 0) > 0 && <Pill tone="warn">{d.delivery.pending} waiting to send</Pill>}
                  {(d.delivery.failed ?? 0) > 0 && <Pill tone="bad">{d.delivery.failed} failed</Pill>}
                </div>
              )}
            </Card>
            <Card title="Full data refreshes" subtitle="When a complete copy of your data was sent for reporting">
              {d.runs.length === 0 && <div style={{ color: palette.muted, fontSize: 13 }}>No refreshes in the last 30 days.</div>}
              {d.runs.map((r, idx) => (
                <Row key={r.id} last={idx === d.runs.length - 1}>
                  <span style={{ flex: 1 }}>
                    {RESOURCE_LABEL[r.resource] ?? r.resource}
                    <div style={{ color: palette.muted, fontSize: 12 }}>{fmt(r.startedAt)} · {r.recordCount} records</div>
                  </span>
                  <Pill tone={r.status === "completed" ? "good" : r.status === "failed" ? "bad" : "warn"}>{r.status}</Pill>
                </Row>
              ))}
            </Card>
          </Grid>

          <Card title={`Changes ${b.agency} has made to your store`} subtitle="Every change is recorded and can be undone">
            {d.pushes.length === 0 && <div style={{ color: palette.muted, fontSize: 13 }}>No changes yet. {b.agency} only edits your store when an update is approved.</div>}
            {d.pushes.map((p, idx) => (
              <Row key={p.id} last={idx === d.pushes.length - 1}>
                <span style={{ flex: 1 }}>
                  {p.resource === "product" ? "Product" : "Collection"} {p.resourceId.split("/").pop()}: {p.fields.map((f) => FIELD_LABEL[f] ?? f).join(", ")}
                  <div style={{ color: palette.muted, fontSize: 12 }}>{fmt(p.createdAt)}</div>
                </span>
                <Pill tone={p.status === "applied" ? "good" : p.status === "rolled_back" ? "neutral" : "bad"}>
                  {p.status === "rolled_back" ? "undone" : p.status}
                </Pill>
              </Row>
            ))}
          </Card>

          <Card title="Permissions this app has" subtitle="What each one is used for">
            {d.scopeRows.map((s, idx) => (
              <Row key={s.scope} last={idx === d.scopeRows.length - 1}>
                <span style={{ flex: 1 }}>
                  <strong style={{ fontWeight: 600 }}>{s.label}</strong>
                  <div style={{ color: palette.muted, fontSize: 12 }}>{s.detail}</div>
                </span>
                <Pill tone={!s.granted ? "bad" : s.used ? "good" : "neutral"}>{!s.granted ? "not granted" : s.used ? "in use" : "not used yet"}</Pill>
              </Row>
            ))}
            <div style={{ marginTop: 10, fontSize: 12, color: palette.muted }}>
              Customer names, emails, phone numbers and addresses are removed before anything is sent to {b.agency}.
            </div>
          </Card>
        </div>
      </s-section>

      <s-section heading={`Your ${b.agency} team`}>
        <s-stack gap="base">
          <s-text>
            Traffic, rankings and ad performance for {d.shopName} are reported by {b.agency}. SEO fixes above are applied by
            your team with a preview and the ability to undo any change.
          </s-text>
          <s-stack direction="inline" gap="small">
            {b.bookingUrl && <s-button href={b.bookingUrl} target="_blank" variant="primary">Book a call</s-button>}
            {b.contactEmail && <s-button href={`mailto:${b.contactEmail}`}>Email us</s-button>}
            <s-button href={b.website} target="_blank">{b.website.replace("https://", "")}</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
