import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { brand } from "../brand";
import { ordersReport, customersReport } from "../tab-data.server";
import { fetchDashboardInsights } from "../platform.server";
import { BrandHeader, fmt, money } from "../ui";
import { Card, DataTable, Delta, Grid, HBars, heat, Kpi, Note, palette, StackedBars } from "../charts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const [orders, customers, platform] = await Promise.all([
    ordersReport(admin, session.shop),
    customersReport(admin, session.shop),
    fetchDashboardInsights(session.shop),
  ]);
  return { orders, customers, traffic: platform?.traffic ?? null, brand: { ...brand } };
};

const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const short = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const monthLabel = (m: string) => (m === "earlier" ? "Earlier" : new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }));

export default function Customers() {
  const d = useLoaderData<typeof loader>();
  const b = d.brand;
  const s = d.orders.data;
  const c = d.customers.data;
  const cur = s?.currency ?? c?.currency ?? "GBP";
  const seg = s?.segments;
  const prev = s?.previousSegments;
  const extended = Boolean(s?.extended && seg);
  const known = seg ? seg.new.orders + seg.returning.orders : 0;
  const returningShare = seg && known ? seg.returning.revenue / Math.max(seg.new.revenue + seg.returning.revenue, 1) : 0;
  const aov = (x?: { orders: number; revenue: number }) => (x && x.orders ? x.revenue / x.orders : 0);
  const t = d.traffic;

  const cohortMax = c ? Math.max(...c.cohorts.map((x) => (x.buyers ? x.repeaters / x.buyers : 0)), 0.01) : 1;

  return (
    <s-page heading="Customers">
      <BrandHeader name={b.agency} tagline={b.tagline} accent={b.accent} accentText={b.accentText} logoUrl={b.logoUrl} title="Customers, loyalty and where they come from" />

      {!s && !c && (
        <div style={{ marginBottom: 16 }}>
          <s-banner tone="info" heading={d.orders.failed || d.customers.failed ? "Customer reports unavailable" : "Building your customer reports"}>
            {d.orders.failed || d.customers.failed
              ? `Shopify could not export the data: ${d.orders.error ?? d.customers.error ?? "unknown error"}. Your ${b.agency} team has been notified.`
              : "Shopify is preparing your order and customer history. This usually takes a few minutes; refresh this page shortly."}
          </s-banner>
        </div>
      )}

      {s && !extended && (
        <div style={{ marginBottom: 16 }}>
          <Note tone="warn">
            New vs returning and traffic source data aren&apos;t available for this store yet. Shopify only shares them once the app is approved
            for customer data, so your {b.agency} team will request that. Customer base figures below are not affected.
          </Note>
        </div>
      )}

      {extended && seg && s && (
        <s-section heading="New vs returning customers (last 30 days)">
          <Grid min={200}>
            <Kpi label="Revenue from new customers" value={money(seg.new.revenue, cur)} delta={prev && <Delta current={seg.new.revenue} previous={prev.new.revenue} />} />
            <Kpi label="Revenue from returning customers" value={money(seg.returning.revenue, cur)} delta={prev && <Delta current={seg.returning.revenue} previous={prev.returning.revenue} />} accent={palette.teal3} />
            <Kpi label="Returning share of revenue" value={pct(returningShare)} />
            <Kpi label="AOV new / returning" value={`${money(aov(seg.new), cur)} / ${money(aov(seg.returning), cur)}`} />
          </Grid>
          <div style={{ marginTop: 14 }}>
            <Card title="Daily revenue by customer type">
              <StackedBars
                names={["New customers", "Returning customers"]}
                format={(n) => money(n, cur)}
                data={(s.dailySegments ?? []).map((x) => ({ label: short(x.date), a: x.newRevenue, b: x.returningRevenue }))}
              />
            </Card>
          </div>
        </s-section>
      )}

      {extended && s && (s.traffic?.length ?? 0) > 0 && (
        <s-section heading="Where orders come from (Shopify attribution)">
          <Grid min={320}>
            <Card title="Revenue by channel" subtitle="Last visit before the order, last 30 days">
              <HBars items={(s.traffic ?? []).slice(0, 8).map((x) => ({ label: x.name, value: x.revenue, display: money(x.revenue, cur) }))} />
            </Card>
            <Card title="Top sources" subtitle="New customers acquired per source">
              <DataTable
                rowKey={(r) => r.name}
                rows={(s.sources ?? []).slice(0, 8)}
                columns={[
                  { label: "Source", render: (r) => <span>{r.name}<span style={{ color: palette.muted }}> · {r.channel}</span></span> },
                  { label: "Orders", align: "right", render: (r) => r.orders },
                  { label: "New", align: "right", render: (r) => r.newOrders },
                  { label: "Revenue", align: "right", render: (r) => money(r.revenue, cur) },
                ]}
              />
            </Card>
          </Grid>
        </s-section>
      )}

      {t && (t.channels?.length ?? 0) > 0 && (
        <s-section heading={`Website traffic, from ${b.agency}`}>
          <Grid min={200}>
            {t.sessions !== undefined && <Kpi label="Sessions" value={t.sessions.toLocaleString("en-GB")} delta={t.previous && <Delta current={t.sessions} previous={t.previous.sessions} />} />}
            {t.newUsers !== undefined && t.returningUsers !== undefined && (
              <Kpi label="New vs returning visitors" value={`${pct(t.newUsers / Math.max(t.newUsers + t.returningUsers, 1))} new`} accent={palette.teal3} />
            )}
            {t.conversionRate !== undefined && <Kpi label="Conversion rate" value={pct(t.conversionRate, 2)} />}
          </Grid>
          <div style={{ marginTop: 14 }}>
            <Card title="Sessions by channel" subtitle="Google Analytics">
              <DataTable
                rowKey={(r) => r.channel}
                rows={t.channels ?? []}
                columns={[
                  { label: "Channel", render: (r) => r.channel },
                  { label: "Sessions", align: "right", render: (r) => r.sessions.toLocaleString("en-GB") },
                  { label: "New users", align: "right", render: (r) => (r.newUsers ?? "–").toLocaleString("en-GB") },
                  { label: "Returning", align: "right", render: (r) => (r.returningUsers ?? "–").toLocaleString("en-GB") },
                  { label: "Revenue", align: "right", render: (r) => (r.revenue !== undefined ? money(r.revenue, cur) : "–") },
                ]}
              />
            </Card>
          </div>
        </s-section>
      )}

      {c && (
        <s-section heading="Customer base and lifetime value">
          <Grid min={200}>
            <Kpi label="Customers" value={c.total.toLocaleString("en-GB")} />
            <Kpi label="Repeat purchase rate" value={pct(c.buyers ? c.repeaters / c.buyers : 0, 1)} accent={palette.teal3} />
            <Kpi label="Average lifetime value" value={money(c.ltv.average, cur)} />
            <Kpi label="Top 10% of buyers" value={`${pct(c.topDecileShare)} of revenue`} accent={palette.teal2} />
          </Grid>
          <div style={{ marginTop: 14 }}>
            <Grid min={320}>
              <Card title="Customers by number of orders">
                <HBars items={c.orderBands.map((x) => ({ label: x.label, value: x.customers, display: x.customers.toLocaleString("en-GB") }))} />
              </Card>
              <Card title="Lifetime value spread" subtitle="Total spend per buying customer">
                <HBars
                  items={[
                    { label: "Median", value: c.ltv.median, display: money(c.ltv.median, cur) },
                    { label: "Average", value: c.ltv.average, display: money(c.ltv.average, cur) },
                    { label: "Top 10% start at", value: c.ltv.p90, display: money(c.ltv.p90, cur) },
                  ]}
                />
              </Card>
            </Grid>
          </div>
          <div style={{ marginTop: 14 }}>
            <Card title="Cohorts by month of first account" subtitle="Shaded by repeat purchase rate, darker means customers come back more">
              <DataTable
                rowKey={(r) => r.month}
                rows={c.cohorts}
                columns={[
                  { label: "Cohort", render: (r) => monthLabel(r.month) },
                  { label: "Customers", align: "right", render: (r) => r.customers.toLocaleString("en-GB") },
                  { label: "Bought", align: "right", render: (r) => r.buyers.toLocaleString("en-GB") },
                  {
                    label: "Repeat rate",
                    align: "right",
                    render: (r) => {
                      const v = r.buyers ? r.repeaters / r.buyers : 0;
                      return (
                        <span style={{ background: heat(v / cohortMax), color: v / cohortMax > 0.5 ? "#fff" : palette.text, borderRadius: 6, padding: "2px 8px" }}>
                          {pct(v)}
                        </span>
                      );
                    },
                  },
                  { label: "Avg value", align: "right", render: (r) => (r.buyers ? money(r.spent / r.buyers, cur) : "–") },
                ]}
              />
            </Card>
          </div>
          <div style={{ marginTop: 10, color: palette.muted, fontSize: 12 }}>
            Updated {fmt(d.customers.updatedAt)}. Lifetime value is total spend to date; younger cohorts have had less time to come back.
          </div>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
