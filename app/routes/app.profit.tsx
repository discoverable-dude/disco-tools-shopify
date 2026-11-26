import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { brand } from "../brand";
import { getVariantCosts } from "../insights.server";
import { ordersReport, safe } from "../tab-data.server";
import { profitability } from "../forecast";
import { fetchDashboardInsights } from "../platform.server";
import { BrandHeader, money } from "../ui";
import { Card, DataTable, Grid, HBars, Kpi, Note, palette, Pill } from "../charts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const [orders, platform] = await Promise.all([ordersReport(admin, session.shop), fetchDashboardInsights(session.shop)]);
  const s = orders.data;
  const ids = (s?.variants ?? []).map((v) => v.id);
  const costs = ids.length ? await safe(() => getVariantCosts(admin, ids)) : { data: {}, error: null };
  const profit = s && costs.data ? profitability(s, costs.data) : null;
  return {
    currency: s?.currency ?? "GBP",
    revenue: s?.current.revenue ?? 0,
    refunded: s?.current.refunded ?? 0,
    profit,
    paid: platform?.paid ?? null,
    building: orders.building,
    failed: orders.failed,
    haveVariants: Boolean(s?.variants?.length),
    error: costs.error ?? orders.error,
    brand: { ...brand },
  };
};

const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;

export default function Profit() {
  const d = useLoaderData<typeof loader>();
  const b = d.brand;
  const cur = d.currency;
  const p = d.profit;
  const marginTone = (m: number) => (m >= 0.5 ? "good" : m >= 0.3 ? "neutral" : m >= 0.15 ? "warn" : "bad") as "good" | "neutral" | "warn" | "bad";

  // Scale margin on costed lines up to all revenue, then take off ad spend.
  const grossEst = p && p.revenueCosted > 0 ? p.margin * d.revenue : null;
  const spend = d.paid?.spend ?? null;
  const afterAds = grossEst !== null && spend !== null ? grossEst - spend : null;
  const breakEven = p && p.margin > 0 ? 1 / p.margin : null;

  return (
    <s-page heading="Profitability">
      <BrandHeader name={b.agency} tagline={b.tagline} accent={b.accent} accentText={b.accentText} logoUrl={b.logoUrl} title="Which products actually make money?" />

      {d.error && (
        <div style={{ marginBottom: 16 }}>
          <s-banner tone="critical">Could not load product costs: {d.error}</s-banner>
        </div>
      )}
      {!d.haveVariants && (
        <div style={{ marginBottom: 16 }}>
          <s-banner tone="info" heading={d.failed ? "Sales history unavailable" : "Building your sales history"}>
            {d.failed ? "The orders export failed, so margins can't be worked out yet." : "Margins need your recent orders. Refresh in a few minutes."}
          </s-banner>
        </div>
      )}

      {p && d.haveVariants && (
        <>
          <s-section heading="Margin (last 30 days)">
            {p.coverage < 0.6 && (
              <div style={{ marginBottom: 12 }}>
                <Note tone="warn">
                  Only {pct(p.coverage)} of your sales have a &quot;Cost per item&quot; in Shopify, so these figures cover that part of the catalogue only.
                  Add costs under each product&apos;s variant in Shopify admin to complete the picture.
                </Note>
              </div>
            )}
            <Grid min={200}>
              <Kpi label="Gross profit on costed products" value={money(p.profit, cur)} accent={palette.good} />
              <Kpi label="Blended product margin" value={pct(p.margin, 1)} accent={palette.teal2} />
              <Kpi label="Cost data coverage" value={pct(p.coverage)} accent={p.coverage >= 0.8 ? palette.good : palette.warn} />
              {breakEven && <Kpi label="Break-even ROAS" value={`${breakEven.toFixed(1)}x`} accent={palette.teal3} />}
            </Grid>
            {afterAds !== null && spend !== null && (
              <div style={{ marginTop: 14 }}>
                <Card title={`Estimated profit after ad spend, from ${b.agency}`} subtitle="Estimated gross profit across all sales minus paid media spend">
                  <Grid min={180}>
                    <Kpi label="Estimated gross profit" value={money(grossEst ?? 0, cur)} />
                    <Kpi label="Ad spend" value={money(spend, cur)} accent={palette.warn} />
                    <Kpi label="Profit after ads" value={money(afterAds, cur)} accent={afterAds >= 0 ? palette.good : palette.bad} />
                  </Grid>
                </Card>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <Note>
                Product margin before shipping, payment fees, returns handling and overheads. Revenue is after discounts, margin uses the unit cost
                set in Shopify for the variants sold.
              </Note>
            </div>
          </s-section>

          {p.costed.length > 0 && (
            <s-section heading="Product profitability">
              <Grid min={320}>
                <Card title="Most profit" subtitle="Gross profit, top products">
                  <HBars items={p.costed.slice(0, 8).map((r) => ({ label: r.title, value: r.profit, display: money(r.profit, cur) }))} />
                </Card>
                <Card title="Lowest margin" subtitle="Products with at least 5 units sold">
                  <DataTable
                    rowKey={(r) => r.productId || r.title}
                    rows={[...p.costed].filter((r) => r.units >= 5).sort((a, c) => a.margin - c.margin).slice(0, 8)}
                    columns={[
                      { label: "Product", render: (r) => r.title },
                      { label: "Units", align: "right", render: (r) => r.units },
                      { label: "Margin", align: "right", render: (r) => <Pill tone={marginTone(r.margin)}>{pct(r.margin)}</Pill> },
                    ]}
                  />
                </Card>
              </Grid>
              <div style={{ marginTop: 14 }}>
                <Card title="Top sellers by profit">
                  <DataTable
                    rowKey={(r) => r.productId || r.title}
                    rows={p.costed.slice(0, 20)}
                    columns={[
                      { label: "Product", render: (r) => r.title },
                      { label: "Units", align: "right", render: (r) => r.units },
                      { label: "Revenue", align: "right", render: (r) => money(r.revenue, cur) },
                      { label: "Profit", align: "right", render: (r) => money(r.profit, cur) },
                      { label: "Margin", align: "right", render: (r) => <Pill tone={marginTone(r.margin)}>{pct(r.margin)}</Pill> },
                    ]}
                  />
                </Card>
              </div>
            </s-section>
          )}

          {p.missingCost.length > 0 && (
            <s-section heading="Selling without a cost price">
              <Card subtitle="Add a cost per item in Shopify to include these, biggest sellers first">
                <DataTable
                  rowKey={(r) => r.title}
                  rows={p.missingCost.slice(0, 15)}
                  columns={[
                    { label: "Product", render: (r) => r.title },
                    { label: "Units", align: "right", render: (r) => r.units },
                    { label: "Revenue", align: "right", render: (r) => money(r.revenue, cur) },
                  ]}
                />
              </Card>
            </s-section>
          )}
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
