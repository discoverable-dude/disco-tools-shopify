import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { brand } from "../brand";
import { getStockProducts } from "../insights.server";
import { ordersReport, safe } from "../tab-data.server";
import { forecastStock, type StockStatus } from "../forecast";
import { BrandHeader, fmt } from "../ui";
import { Card, DataTable, Grid, Kpi, Note, palette, Pill } from "../charts";

const DEFAULT_LEAD = 21;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const lead = Math.min(120, Math.max(1, Number(new URL(request.url).searchParams.get("lead")) || DEFAULT_LEAD));
  const [orders, stock] = await Promise.all([ordersReport(admin, session.shop), safe(() => getStockProducts(admin))]);
  const rows = orders.data && stock.data ? forecastStock(orders.data, stock.data, lead) : [];
  return {
    lead,
    rows,
    haveSales: Boolean(orders.data?.products?.length),
    building: orders.building,
    failed: orders.failed,
    error: stock.error ?? orders.error,
    updatedAt: orders.updatedAt,
    brand: { ...brand },
  };
};

const LABEL: Record<StockStatus, { text: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  "sold-out": { text: "Sold out", tone: "bad" },
  critical: { text: "Reorder now", tone: "bad" },
  low: { text: "Reorder soon", tone: "warn" },
  healthy: { text: "Healthy", tone: "good" },
  plenty: { text: "Plenty", tone: "neutral" },
  "no-sales": { text: "No recent sales", tone: "neutral" },
};

const dayStr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "–");

export default function Products() {
  const d = useLoaderData<typeof loader>();
  const b = d.brand;
  const urgent = d.rows.filter((r) => r.status === "sold-out" || r.status === "critical" || r.status === "low").sort((a, c) => (a.daysLeft ?? 0) - (c.daysLeft ?? 0));
  const dead = d.rows.filter((r) => r.status === "no-sales" && r.inventory > 0).sort((a, c) => c.inventory - a.inventory);
  const count = (s: StockStatus) => d.rows.filter((r) => r.status === s).length;

  return (
    <s-page heading="Products">
      <BrandHeader name={b.agency} tagline={b.tagline} accent={b.accent} accentText={b.accentText} logoUrl={b.logoUrl} title="Stock forecast: how long will it last?" />

      {d.error && (
        <div style={{ marginBottom: 16 }}>
          <s-banner tone="critical">Could not load stock: {d.error}</s-banner>
        </div>
      )}
      {!d.haveSales && (
        <div style={{ marginBottom: 16 }}>
          <s-banner tone="info" heading={d.failed ? "Sales history unavailable" : "Building your sales history"}>
            {d.failed ? "The orders export failed, so a forecast can't be made yet." : "The forecast needs your recent orders. Refresh in a few minutes."}
          </s-banner>
        </div>
      )}

      {d.haveSales && (
        <>
          <s-section heading="Stock position">
            <Grid min={190}>
              <Kpi label="Sold out but selling" value={String(count("sold-out"))} accent={palette.bad} />
              <Kpi label="Reorder now" value={String(count("critical"))} accent={palette.bad} />
              <Kpi label="Reorder soon" value={String(count("low"))} accent={palette.warn} />
              <Kpi label="Healthy" value={String(count("healthy") + count("plenty"))} accent={palette.good} />
              <Kpi label="Stock with no sales" value={String(dead.length)} accent={palette.muted} />
            </Grid>
            <div style={{ marginTop: 12 }}>
              <Note>
                Based on sales over the last 30 days, weighted towards the last 14. Assumes a <b>{d.lead}-day</b> supplier lead time; change it with{" "}
                <s-link href="/app/products?lead=14">14</s-link>, <s-link href="/app/products?lead=21">21</s-link>, <s-link href="/app/products?lead=30">30</s-link> or{" "}
                <s-link href="/app/products?lead=45">45</s-link> days. Only products with inventory tracking turned on are included.
              </Note>
            </div>
          </s-section>

          <s-section heading="Needs attention">
            <Card>
              <DataTable
                rowKey={(r) => r.id}
                rows={urgent.slice(0, 25)}
                empty="Nothing is close to running out. Nice."
                columns={[
                  { label: "Product", render: (r) => r.title },
                  { label: "In stock", align: "right", render: (r) => r.inventory },
                  { label: "Selling / day", align: "right", render: (r) => r.perDay.toFixed(1) },
                  { label: "Days left", align: "right", render: (r) => (r.daysLeft === null ? "–" : r.inventory <= 0 ? "0" : Math.floor(r.daysLeft)) },
                  { label: "Runs out", align: "right", render: (r) => dayStr(r.runOut) },
                  { label: "Order by", align: "right", render: (r) => (r.reorderBy && new Date(r.reorderBy).getTime() < Date.now() ? "Now" : dayStr(r.reorderBy)) },
                  { label: "Status", render: (r) => <Pill tone={LABEL[r.status].tone}>{LABEL[r.status].text}</Pill> },
                ]}
              />
            </Card>
          </s-section>

          <s-section heading="All tracked products by days of cover">
            <Card>
              <DataTable
                rowKey={(r) => r.id}
                rows={[...d.rows].filter((r) => r.daysLeft !== null).sort((a, c) => (a.daysLeft ?? 0) - (c.daysLeft ?? 0)).slice(0, 40)}
                columns={[
                  { label: "Product", render: (r) => r.title },
                  { label: "In stock", align: "right", render: (r) => r.inventory },
                  { label: "Sold (30d)", align: "right", render: (r) => r.u30 },
                  { label: "Days left", align: "right", render: (r) => (r.daysLeft === null ? "–" : Math.floor(r.daysLeft)) },
                  { label: "Status", render: (r) => <Pill tone={LABEL[r.status].tone}>{LABEL[r.status].text}</Pill> },
                ]}
              />
            </Card>
          </s-section>

          {dead.length > 0 && (
            <s-section heading="Dead stock: units on the shelf, no sales in 30 days">
              <Card>
                <DataTable
                  rowKey={(r) => r.id}
                  rows={dead.slice(0, 15)}
                  columns={[
                    { label: "Product", render: (r) => r.title },
                    { label: "Units in stock", align: "right", render: (r) => r.inventory },
                  ]}
                />
              </Card>
            </s-section>
          )}
          <div style={{ color: palette.muted, fontSize: 12 }}>Sales data updated {fmt(d.updatedAt)}.</div>
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
