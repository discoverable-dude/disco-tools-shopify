import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { brand } from "../brand";
import { getOrderInsights, liveToSummary } from "../insights.server";
import { ordersReport, safe } from "../tab-data.server";
import { fetchDashboardInsights } from "../platform.server";
import { hasScope, missingScopes, SCOPE_INFO } from "../scopes.server";
import { TOPIC_LABELS } from "../labels";
import { BrandHeader, fmt, money } from "../ui";
import { BarChart, Card, Delta, Grid, HBars, Kpi, palette, Pill, Ring, Row } from "../charts";

const DAY = 86_400_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const since = new Date(Date.now() - 30 * DAY);

  // The saved sales report (built from Shopify's bulk export) is the source of truth. Small stores
  // can use live numbers until the first report exists.
  const report = await ordersReport(admin, shop);

  const [link, shopRes, live, platform, snapshot, byTopic, delivery, runs, pushes] = await Promise.all([
    db.shopLink.findUnique({ where: { shop } }),
    admin.graphql(`#graphql
      query ShopName { shop { name } }`),
    report.data ? Promise.resolve({ data: null, error: null }) : safe(() => getOrderInsights(admin)),
    fetchDashboardInsights(shop),
    db.seoSnapshot.findFirst({ where: { shop }, orderBy: { takenAt: "desc" } }),
    db.webhookEvent.groupBy({ by: ["topic"], where: { shop, receivedAt: { gte: since } }, _count: { _all: true } }),
    db.webhookEvent.groupBy({ by: ["status"], where: { shop, receivedAt: { gte: since } }, _count: { _all: true } }),
    db.syncRun.findMany({ where: { shop, startedAt: { gte: since } }, orderBy: { startedAt: "desc" }, take: 6 }),
    db.pushAudit.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const shopName: string = (await shopRes.json()).data?.shop?.name ?? shop;

  // While the saved report is being built, busy stores still show the latest orders (clearly
  // labelled as partial) instead of an empty page.
  const liveSummary = live.data ? liveToSummary(live.data) : null;
  const salesData = report.data ?? liveSummary;
  const sales = {
    data: salesData,
    partial: !report.data && Boolean(live.data?.capped),
    updatedAt: report.updatedAt,
    building: report.building,
    failed: report.failed,
    error: live.error,
  };

  const granted = (session.scope ?? "").split(",").filter(Boolean);
  return {
    shopName,
    link,
    sales,
    seoScore: snapshot ? { score: snapshot.score, takenAt: snapshot.takenAt, withIssues: snapshot.withIssues, audited: snapshot.audited } : null,
    platform,
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

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const pct = (n: number) => `${n.toFixed(1)}%`;

export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const b = d.brand;
  const sales = d.sales.data;
  const plat = d.platform;
  const cur = sales?.currency ?? "GBP";
  const eventTotal = d.events.reduce((a, e) => a + e.count, 0);
  const linked = d.link?.status === "linked";
  const connected = linked || Boolean(d.link?.lastSyncAt) || (d.delivery.delivered ?? 0) > 0 || Boolean(d.sales.updatedAt);

  const aov = sales && sales.current.orders ? sales.current.revenue / sales.current.orders : 0;
  const prevAov = sales && sales.previous.orders ? sales.previous.revenue / sales.previous.orders : 0;
  const bestDay = sales ? [...sales.weekday].sort((x, y) => y.revenue - x.revenue)[0] : null;
  const gross = sales ? sales.current.revenue + sales.current.discounts : 0;

  return (
    <s-page heading={d.shopName}>
      <BrandHeader
        name={b.agency}
        tagline={b.tagline}
        accent={b.accent}
        accentText={b.accentText}
        logoUrl={b.logoUrl}
        title={`Your store performance, ${d.shopName}`}
        subtitle={connected ? `Connected · report updated ${fmt(d.sales.updatedAt ?? d.link?.lastSyncAt)}` : "Setting up your reporting"}
      />

      {d.missing.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <s-banner tone="warning" heading="Permissions need updating">
            This app needs additional access ({d.missing.join(", ")}). Your {b.agency} team will send an update to approve.
          </s-banner>
        </div>
      )}
      {!connected && (
        <div style={{ marginBottom: 16 }}>
          <s-banner tone="info" heading="Setting up your reporting">
            Your first data refresh is under way and your {b.agency} team is finishing the connection. Nothing is needed from you,
            and this message disappears once data starts flowing.
          </s-banner>
        </div>
      )}

      <s-section heading="Sales overview">
        <div style={{ display: "grid", gap: 14 }}>
          {d.sales.error && !sales && <s-banner tone="critical">Could not load sales: {d.sales.error}</s-banner>}
          {d.sales.partial && (
            <s-banner tone={d.sales.failed ? "warning" : "info"} heading={d.sales.failed ? "Showing your latest orders only" : "Building your full sales report"}>
              {d.sales.failed
                ? `We couldn't build the full 30-day report just now, so these figures cover only your most recent orders. Your ${b.agency} team can see the reason and will fix it.`
                : "These figures cover only your most recent orders while we pull the last 60 days to build the full report. It takes a minute or two for busy stores. Refresh shortly."}
            </s-banner>
          )}
          {!d.sales.partial && d.sales.building && (
            <s-banner tone="info" heading="Building your sales report">
              We&apos;re pulling the last 60 days of orders to build an accurate report. It takes a minute or two for busy stores, so
              refresh shortly.
            </s-banner>
          )}
          {!d.sales.partial && d.sales.failed && (
            <s-banner tone="warning" heading="Sales report unavailable">
              We couldn&apos;t refresh your sales report just now. Your {b.agency} team can see the reason and will fix it.
            </s-banner>
          )}
          {sales && (
            <>
              <Grid min={200}>
                <Kpi label={d.sales.partial ? "Revenue (latest orders)" : "Revenue (30 days)"} value={money(sales.current.revenue, cur)} delta={d.sales.partial ? undefined : <Delta current={sales.current.revenue} previous={sales.previous.revenue} />} />
                <Kpi label="Orders" value={sales.current.orders.toLocaleString("en-GB")} delta={d.sales.partial ? undefined : <Delta current={sales.current.orders} previous={sales.previous.orders} />} accent={palette.teal3} />
                <Kpi label="Average order value" value={money(aov, cur)} delta={d.sales.partial ? undefined : <Delta current={aov} previous={prevAov} />} accent={palette.teal2} />
                <Kpi label="Refunded" value={money(sales.current.refunded, cur)} delta={d.sales.partial ? undefined : <Delta current={sales.current.refunded} previous={sales.previous.refunded} invert />} accent={palette.warn} />
              </Grid>
              <Grid min={200}>
                <Kpi label="Refund rate" value={sales.current.revenue ? pct((sales.current.refunded / sales.current.revenue) * 100) : "0%"} accent={palette.warn} />
                {sales.current.units > 0 && (
                  <Kpi label="Items per order" value={(sales.current.units / Math.max(sales.current.orders, 1)).toFixed(1)} accent={palette.teal3} />
                )}
                {sales.current.discounts > 0 && (
                  <Kpi label="Discounts given" value={money(sales.current.discounts, cur)} delta={<span style={{ color: palette.muted, fontSize: 12 }}>{pct((sales.current.discounts / Math.max(gross, 1)) * 100)} of pre-discount sales</span>} accent={palette.teal2} />
                )}
              </Grid>
              <Card title="Revenue by day" subtitle={d.sales.partial ? "Most recent orders only, full report building" : `Last 30 days${sales.from ? `, ${short(sales.from)} to ${short(sales.to)}` : ""}`}>
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
                <Card
                  title="Strongest days of the week"
                  subtitle={bestDay && bestDay.revenue > 0 ? `${WEEKDAYS_LONG[bestDay.day]} brings in the most revenue` : "Revenue by weekday"}
                >
                  <BarChart
                    allLabels
                    height={150}
                    color={palette.teal3}
                    data={sales.weekday.map((w) => ({
                      label: WEEKDAYS[w.day],
                      value: w.revenue,
                      tip: `${WEEKDAYS_LONG[w.day]}: ${money(w.revenue, cur)} from ${w.orders} orders`,
                    }))}
                    format={(n) => money(n, cur)}
                  />
                </Card>
                <Card title="Where orders come from" subtitle="Sales channel, by revenue">
                  <HBars
                    color={palette.teal3}
                    items={sales.channels.slice(0, 6).map((c) => ({ label: c.name, value: c.revenue, display: `${money(c.revenue, cur)} · ${c.orders.toLocaleString("en-GB")} orders` }))}
                    empty="No orders in this period."
                  />
                </Card>
              </Grid>
              <Card title="Best sellers" subtitle={d.sales.partial ? "By revenue, most recent orders" : "By revenue, last 30 days"}>
                <HBars
                  items={sales.topProducts.map((p) => ({ label: p.title, value: p.revenue, display: `${money(p.revenue, cur)} · ${p.units.toLocaleString("en-GB")} sold` }))}
                  empty="No orders in this period."
                />
              </Card>
            </>
          )}
        </div>
      </s-section>

      <s-section heading={`Search and ads, from ${b.agency}`}>
        {!plat && (
          <Card>
            <div style={{ fontSize: 13, color: palette.muted }}>
              Organic search, paid ads and keyword ranking results for {d.shopName} will appear here once your {b.agency} team has
              connected them. They are reported from Google Search Console, Google Analytics and your ad accounts.
            </div>
          </Card>
        )}
        {plat && (
          <div style={{ display: "grid", gap: 14 }}>
            {plat.organic && (
              <>
                <Grid min={200}>
                  <Kpi label="Organic clicks" value={plat.organic.clicks.toLocaleString("en-GB")} delta={plat.organic.previous ? <Delta current={plat.organic.clicks} previous={plat.organic.previous.clicks} /> : undefined} />
                  <Kpi label="Impressions" value={plat.organic.impressions.toLocaleString("en-GB")} delta={plat.organic.previous ? <Delta current={plat.organic.impressions} previous={plat.organic.previous.impressions} /> : undefined} accent={palette.teal3} />
                  {plat.organic.ctr !== undefined && <Kpi label="Click-through rate" value={pct(plat.organic.ctr * 100)} accent={palette.teal2} />}
                  {plat.organic.position !== undefined && <Kpi label="Average position" value={plat.organic.position.toFixed(1)} accent={palette.warn} />}
                </Grid>
                {plat.organic.daily && plat.organic.daily.length > 0 && (
                  <Card title="Organic clicks by day">
                    <BarChart data={plat.organic.daily.map((x) => ({ label: short(x.date), value: x.clicks }))} />
                  </Card>
                )}
                <Grid min={300}>
                  {plat.organic.topQueries && plat.organic.topQueries.length > 0 && (
                    <Card title="Top search queries" subtitle="By clicks">
                      <HBars items={plat.organic.topQueries.slice(0, 8).map((q) => ({ label: q.query, value: q.clicks, display: `${q.clicks.toLocaleString("en-GB")} clicks${q.position ? ` · pos ${q.position.toFixed(1)}` : ""}` }))} />
                    </Card>
                  )}
                  {plat.organic.topPages && plat.organic.topPages.length > 0 && (
                    <Card title="Top organic landing pages" subtitle="By clicks">
                      <HBars color={palette.teal3} items={plat.organic.topPages.slice(0, 8).map((q) => ({ label: q.url.replace(/^https?:\/\/[^/]+/, "") || "/", value: q.clicks, display: `${q.clicks.toLocaleString("en-GB")} clicks` }))} />
                    </Card>
                  )}
                </Grid>
              </>
            )}
            {plat.paid && (
              <>
                <Grid min={200}>
                  <Kpi label="Ad spend" value={money(plat.paid.spend, plat.paid.currency ?? cur)} delta={plat.paid.previous ? <Delta current={plat.paid.spend} previous={plat.paid.previous.spend} invert /> : undefined} accent={palette.warn} />
                  {plat.paid.revenue !== undefined && <Kpi label="Ad-attributed revenue" value={money(plat.paid.revenue, plat.paid.currency ?? cur)} delta={plat.paid.previous?.revenue !== undefined ? <Delta current={plat.paid.revenue} previous={plat.paid.previous.revenue} /> : undefined} />}
                  {plat.paid.roas !== undefined && <Kpi label="Return on ad spend" value={`${plat.paid.roas.toFixed(2)}x`} accent={palette.teal2} />}
                </Grid>
                {plat.paid.daily && plat.paid.daily.length > 0 && (
                  <Card title="Ad spend by day">
                    <BarChart color={palette.warn} format={(n) => money(n, plat.paid?.currency ?? cur)} data={plat.paid.daily.map((x) => ({ label: short(x.date), value: x.spend }))} />
                  </Card>
                )}
              </>
            )}
            {plat.rankings && (
              <Card title="Keyword rankings" subtitle={`${plat.rankings.tracked} keywords tracked`}>
                <Grid min={140}>
                  {plat.rankings.top3 !== undefined && <Kpi label="In the top 3" value={String(plat.rankings.top3)} accent={palette.good} />}
                  {plat.rankings.top10 !== undefined && <Kpi label="In the top 10" value={String(plat.rankings.top10)} accent={palette.teal2} />}
                </Grid>
                {plat.rankings.movers && plat.rankings.movers.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {plat.rankings.movers.slice(0, 6).map((m, idx, arr) => (
                      <Row key={m.keyword} last={idx === arr.length - 1}>
                        <span style={{ flex: 1 }}>{m.keyword}</span>
                        <span style={{ color: palette.muted }}>position {m.position}</span>
                        <Pill tone={m.change > 0 ? "good" : m.change < 0 ? "bad" : "neutral"}>{m.change > 0 ? `▲ ${m.change}` : m.change < 0 ? `▼ ${Math.abs(m.change)}` : "–"}</Pill>
                      </Row>
                    ))}
                  </div>
                )}
              </Card>
            )}
            {plat.updatedAt && <div style={{ color: palette.muted, fontSize: 12 }}>Updated {fmt(plat.updatedAt)}</div>}
          </div>
        )}
      </s-section>

      <s-section heading="SEO health">
        <Card>
          {d.seoScore ? (
            <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
              <Ring value={d.seoScore.score} label="On-page SEO score" sub={`${d.seoScore.audited - d.seoScore.withIssues} of ${d.seoScore.audited} pages pass every check`} />
              <div style={{ flex: 1, minWidth: 220, fontSize: 13, color: palette.muted }}>
                Last checked {fmt(d.seoScore.takenAt)}. Open the <s-link href="/app/seo">SEO tab</s-link> for what needs fixing, the
                score over time and search opportunities.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: palette.muted }}>
              Open the <s-link href="/app/seo">SEO tab</s-link> to run your first on-page SEO check.
            </div>
          )}
        </Card>
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
