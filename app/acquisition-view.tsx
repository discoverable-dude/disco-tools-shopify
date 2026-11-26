import { useState, type CSSProperties } from "react";
import type { AcquisitionRow } from "./sales-summary.server";
import { byMonth, filterRows, matrix, monthsOf, newShare, totals, type Cell } from "./acquisition";
import { Card, DataTable, Grid, heat, Kpi, Note, palette, StackedBars } from "./charts";
import { money } from "./ui";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;

const field: CSSProperties = { border: `1px solid ${palette.line}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "#fff", color: palette.text, fontFamily: "inherit" };
const chip = (on: boolean): CSSProperties => ({ ...field, cursor: "pointer", background: on ? palette.tint : "#fff", borderColor: on ? palette.teal2 : palette.line });
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const orders = (c: Cell) => c.newOrders + c.returningOrders + c.unknownOrders;

/** New vs returning orders per traffic source, filterable by date range, channel and source. */
export function Acquisition({ rows, currency }: { rows: AcquisitionRow[]; currency: string }) {
  const dates = rows.map((r) => r.d).sort();
  const min = dates[0];
  const max = dates[dates.length - 1];
  const [from, setFrom] = useState(min);
  const [to, setTo] = useState(max);
  const [channel, setChannel] = useState("");
  const [source, setSource] = useState("");
  const [by, setBy] = useState<"channel" | "source">("source");

  const channels = [...new Set(rows.map((r) => r.c))].sort();
  const sources = [...new Set(rows.filter((r) => !channel || r.c === channel).map((r) => r.s))].sort();
  const inRange = filterRows(rows, { from, to, channel, source });
  const sum = totals(inRange);
  const months = monthsOf(inRange);
  const monthly = byMonth(inRange);
  const grid = matrix(inRange, by);
  const sourceTable = matrix(inRange, "source");
  const money0 = (n: number) => money(n, currency);
  const preset = (a: string, b: string) => { setFrom(a < min ? min : a); setTo(b); };
  const isAll = from === min && to === max;
  const last30 = to === max && from === (addDays(max, -29) < min ? min : addDays(max, -29));
  const shown = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <s-section heading="New vs returning customers by traffic source (Shopify attribution)">
      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label style={{ fontSize: 12, color: palette.muted }}>
            From<br />
            <input type="date" style={field} value={from} min={min} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label style={{ fontSize: 12, color: palette.muted }}>
            To<br />
            <input type="date" style={field} value={to} min={from} max={max} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
          <span style={{ display: "flex", gap: 6 }}>
            <button type="button" style={chip(isAll)} onClick={() => preset(min, max)}>All data</button>
            <button type="button" style={chip(last30)} onClick={() => preset(addDays(max, -29), max)}>Last 30 days</button>
            <button type="button" style={chip(false)} onClick={() => preset(`${max.slice(0, 7)}-01`, max)}>This month</button>
          </span>
          <label style={{ fontSize: 12, color: palette.muted }}>
            Channel<br />
            <select style={field} value={channel} onChange={(e) => { setChannel(e.target.value); setSource(""); }}>
              <option value="">All channels</option>
              {channels.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: palette.muted }}>
            Source<br />
            <select style={field} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All sources</option>
              {sources.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: palette.muted }}>
            Group table by<br />
            <select style={field} value={by} onChange={(e) => setBy(e.target.value as "channel" | "source")}>
              <option value="source">Source</option>
              <option value="channel">Channel</option>
            </select>
          </label>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: palette.muted }}>
          Data available {day(min)} to {day(max)}. A &quot;new&quot; order is a customer&apos;s first order; &quot;returning&quot; orders are repeat purchases.
        </div>
      </Card>

      <div style={{ marginTop: 14 }}>
        <Grid min={165}>
          <Kpi label="New customers (first orders)" value={sum.newOrders.toLocaleString("en-GB")} />
          <Kpi label="Returning orders" value={sum.returningOrders.toLocaleString("en-GB")} accent={palette.teal3} />
          <Kpi label="New share of orders" value={pct(newShare(sum))} accent={palette.teal2} />
          <Kpi label="Revenue from new customers" value={money0(sum.newRevenue)} />
          <Kpi label="Revenue from returning customers" value={money0(sum.returningRevenue)} accent={palette.teal3} />
        </Grid>
      </div>

      {inRange.length === 0 ? (
        <div style={{ marginTop: 14 }}><Note>No orders match these filters.</Note></div>
      ) : (
        <>
          <div style={{ marginTop: 14 }}>
            <Card title="By month" subtitle="Orders from new vs returning customers">
              <StackedBars
                names={["New customers", "Returning orders"]}
                format={(n) => String(Math.round(n))}
                data={monthly.map((m) => ({ label: shown(m.month), a: m.cell.newOrders, b: m.cell.returningOrders }))}
              />
              <div style={{ marginTop: 10 }}>
                <DataTable
                  rowKey={(r) => r.month}
                  rows={monthly}
                  columns={[
                    { label: "Month", render: (r) => shown(r.month) },
                    { label: "New", align: "right", render: (r) => r.cell.newOrders.toLocaleString("en-GB") },
                    { label: "Returning", align: "right", render: (r) => r.cell.returningOrders.toLocaleString("en-GB") },
                    { label: "New share", align: "right", render: (r) => pct(newShare(r.cell)) },
                    { label: "New revenue", align: "right", render: (r) => money0(r.cell.newRevenue) },
                    { label: "Returning revenue", align: "right", render: (r) => money0(r.cell.returningRevenue) },
                  ]}
                />
              </div>
            </Card>
          </div>

          <div style={{ marginTop: 14 }}>
            <Card title={`Monthly new vs returning, by ${by}`} subtitle="Each cell shows new / returning orders; darker means more of the orders came from new customers">
              <DataTable
                rowKey={(r) => r.key}
                rows={grid.slice(0, 25)}
                columns={[
                  { label: by === "source" ? "Source" : "Channel", render: (r) => <span>{r.label}{by === "source" && <span style={{ color: palette.muted }}> · {r.channel}</span>}</span> },
                  ...months.map((m) => ({
                    label: shown(m),
                    align: "right" as const,
                    render: (r: (typeof grid)[number]) => {
                      const c = r.months[m];
                      if (!c || !orders(c)) return <span style={{ color: palette.muted }}>–</span>;
                      const v = newShare(c);
                      return (
                        <span style={{ background: heat(v), color: v > 0.55 ? "#fff" : palette.text, borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>
                          {c.newOrders} / {c.returningOrders}
                        </span>
                      );
                    },
                  })),
                  { label: "Total", align: "right", render: (r) => <b>{r.total.newOrders} / {r.total.returningOrders}</b> },
                ]}
              />
            </Card>
          </div>

          <div style={{ marginTop: 14 }}>
            <Card title="Where your customers come from" subtitle="Source of each order in the selected range">
              <DataTable
                rowKey={(r) => r.key}
                rows={sourceTable.slice(0, 15)}
                columns={[
                  { label: "Source", render: (r) => <span>{r.label}<span style={{ color: palette.muted }}> · {r.channel}</span></span> },
                  { label: "New customers", align: "right", render: (r) => r.total.newOrders.toLocaleString("en-GB") },
                  { label: "Returning orders", align: "right", render: (r) => r.total.returningOrders.toLocaleString("en-GB") },
                  { label: "New share", align: "right", render: (r) => pct(newShare(r.total)) },
                  { label: "Revenue", align: "right", render: (r) => money0(r.total.newRevenue + r.total.returningRevenue + r.total.unknownRevenue) },
                  { label: "AOV (new)", align: "right", render: (r) => (r.total.newOrders ? money0(r.total.newRevenue / r.total.newOrders) : "–") },
                ]}
              />
            </Card>
          </div>
        </>
      )}
    </s-section>
  );
}

