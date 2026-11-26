import { test } from "node:test";
import assert from "node:assert/strict";
import { SalesAggregator } from "../app/sales-summary.server";
import { CustomerAggregator } from "../app/customer-summary.server";
import { tableRows } from "../app/analytics.server";
import { byMonth, filterRows, matrix, monthsOf, newShare, totals } from "../app/acquisition";
import { forecastStock, profitability, velocity } from "../app/forecast";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const money = (a: number) => ({ shopMoney: { amount: String(a), currencyCode: "GBP" } });
const line = (title: string, qty: number, amount: number, pid: string, vid: string) => ({
  title, quantity: qty, originalTotalSet: money(amount), discountedTotalSet: money(amount), product: { id: pid }, variant: { id: vid },
});

function sample() {
  const a = new SalesAggregator(30, NOW);
  a.add({ createdAt: day(1), totalPriceSet: money(100), customerJourneySummary: { customerOrderIndex: 1, lastVisit: { source: "google", sourceType: "organic" } }, lineItems: [line("Socks", 2, 100, "p1", "v1")] });
  a.add({ createdAt: day(2), totalPriceSet: money(60), customerJourneySummary: { customerOrderIndex: "3", lastVisit: { source: "newsletter", sourceType: "email" } }, lineItems: [line("Socks", 1, 50, "p1", "v1"), line("Hat", 1, 10, "p2", "v2")] });
  a.add({ createdAt: day(20), totalPriceSet: money(40), customerJourneySummary: { customerOrderIndex: 1, firstVisit: { source: "facebook", sourceType: "social" } }, lineItems: [line("Hat", 4, 40, "p2", "v2")] });
  a.add({ createdAt: day(40), totalPriceSet: money(30), customerJourneySummary: { customerOrderIndex: 2 }, lineItems: [] });
  return a.result();
}

test("new vs returning segments, current and previous period", () => {
  const r = sample();
  assert.equal(r.extended, true);
  assert.equal(r.segments!.new.orders, 2);
  assert.equal(r.segments!.new.revenue, 140);
  assert.equal(r.segments!.returning.revenue, 60);
  assert.equal(r.previousSegments!.returning.orders, 1);
  const d = r.dailySegments!.find((x) => x.date === day(2).slice(0, 10))!;
  assert.equal(d.returningRevenue, 60);
});

test("traffic attribution uses last visit, falls back to first", () => {
  const r = sample();
  const ch = Object.fromEntries(r.traffic!.map((t) => [t.name, t]));
  assert.equal(ch["Organic"].revenue, 100);
  assert.equal(ch["Email"].returningOrders, 1);
  assert.equal(ch["Social"].newOrders, 1);
});

test("product and variant units over 30 and 14 days", () => {
  const r = sample();
  const socks = r.products!.find((p) => p.id === "p1")!;
  assert.equal(socks.u30, 3);
  assert.equal(socks.u14, 3);
  const hat = r.products!.find((p) => p.id === "p2")!;
  assert.equal(hat.u30, 5);
  assert.equal(hat.u14, 1);
  assert.equal(r.variants!.find((v) => v.id === "v1")!.revenue, 150);
});

test("basic export (no journey data) is flagged not extended", () => {
  const a = new SalesAggregator(30, NOW);
  a.add({ createdAt: day(1), totalPriceSet: money(10), lineItems: [] });
  const r = a.result();
  assert.equal(r.extended, false);
  assert.equal(r.segments!.unknown.orders, 1);
  assert.equal(r.traffic!.length, 0);
});

test("customer cohorts, repeat rate and LTV", () => {
  const c = new CustomerAggregator(NOW);
  const add = (createdAt: string, n: string | number, amt: string) => c.add({ createdAt, numberOfOrders: n, amountSpent: { amount: amt, currencyCode: "GBP" } });
  add("2026-10-05T00:00:00Z", "1", "50");
  add("2026-10-20T00:00:00Z", 3, "150");
  add("2026-10-21T00:00:00Z", 0, "0");
  add("2019-01-01T00:00:00Z", 2, "100");
  const r = c.result();
  assert.equal(r.total, 4);
  assert.equal(r.buyers, 3);
  assert.equal(r.repeaters, 2);
  assert.equal(r.ltv.average, 100);
  assert.equal(r.topDecileShare, 0.5);
  const oct = r.cohorts.find((x) => x.month === "2026-10")!;
  assert.deepEqual([oct.customers, oct.buyers, oct.repeaters], [3, 2, 1]);
  assert.equal(r.cohorts[0].month, "earlier");
  assert.deepEqual(r.orderBands.map((b) => b.customers), [1, 1, 1, 0, 0]);
});

test("stock forecast: days left, status, reorder date, dead stock", () => {
  const s = sample();
  const rows = forecastStock(s, [
    { id: "p1", title: "Socks", inventory: 3, tracked: true },
    { id: "p2", title: "Hat", inventory: 0, tracked: true },
    { id: "p3", title: "Scarf", inventory: 9, tracked: true },
    { id: "p4", title: "Untracked", inventory: 1, tracked: false },
  ], 21, NOW);
  assert.equal(rows.length, 3);
  const socks = rows.find((r) => r.id === "p1")!;
  assert.ok(Math.abs(socks.perDay - velocity(3, 3)) < 1e-9);
  assert.equal(socks.status, "critical");
  assert.ok(socks.reorderBy && Date.parse(socks.reorderBy) < NOW);
  assert.equal(rows.find((r) => r.id === "p2")!.status, "sold-out");
  const scarf = rows.find((r) => r.id === "p3")!;
  assert.equal(scarf.status, "no-sales");
  assert.equal(scarf.daysLeft, null);
});

test("profitability: costed vs missing, coverage and margin", () => {
  const s = sample();
  const p = profitability(s, { v1: { price: 50, cost: 20 }, v2: { price: 10, cost: null } });
  assert.equal(p.costed.length, 1);
  assert.equal(p.costed[0].profit, 150 - 60); // 3 units * 20 cost
  assert.equal(p.missingCost[0].title, "Hat");
  assert.ok(Math.abs(p.coverage - 150 / 200) < 1e-9);
  assert.ok(Math.abs(p.margin - 0.6) < 1e-9);
});

test("acquisition rows: per day, channel and source, split new / returning", () => {
  const r = sample();
  const acq = r.acquisition!;
  const g = acq.find((x) => x.s === "google")!;
  assert.deepEqual([g.c, g.n, g.r, g.nv], ["Organic", 1, 0, 100]);
  const nl = acq.find((x) => x.s === "newsletter")!;
  assert.deepEqual([nl.n, nl.r, nl.rv], [0, 1, 60]);
  // orders older than the 30 day window are still counted (the export covers 60 days)
  assert.equal(totals(acq).returningOrders, 2);
});

test("acquisition filters, monthly split and matrix", () => {
  const rows = [
    { d: "2026-10-30", c: "Organic", s: "google", n: 2, r: 1, u: 0, nv: 100, rv: 40, uv: 0 },
    { d: "2026-11-02", c: "Organic", s: "google", n: 1, r: 3, u: 0, nv: 50, rv: 150, uv: 0 },
    { d: "2026-11-03", c: "Email", s: "newsletter", n: 0, r: 4, u: 0, nv: 0, rv: 200, uv: 0 },
  ];
  assert.deepEqual(monthsOf(rows), ["2026-10", "2026-11"]);
  assert.equal(filterRows(rows, { from: "2026-11-01" }).length, 2);
  assert.equal(filterRows(rows, { channel: "Organic", to: "2026-10-31" }).length, 1);
  assert.equal(filterRows(rows, { source: "newsletter" })[0].c, "Email");
  const m = byMonth(rows);
  assert.deepEqual(m.map((x) => [x.month, x.cell.newOrders, x.cell.returningOrders]), [["2026-10", 2, 1], ["2026-11", 1, 7]]);
  const byChannel = matrix(rows, "channel");
  assert.deepEqual(byChannel.map((x) => x.key), ["Organic", "Email"]); // Organic has 340 revenue, Email 200
  assert.equal(byChannel[0].months["2026-11"].returningOrders, 3);
  assert.equal(byChannel[0].months["2026-10"].newOrders, 2);
  assert.equal(newShare(byChannel[1].total), 0);
  assert.ok(Math.abs(newShare(byChannel[0].total) - 3 / 7) < 1e-9);
});

test("ShopifyQL table rows work as objects or arrays", () => {
  const cols = [{ name: "referrer_source" }, { name: "sessions" }];
  assert.deepEqual(tableRows({ columns: cols, rows: [["search", 10]] }), [{ referrer_source: "search", sessions: 10 }]);
  assert.deepEqual(tableRows({ columns: cols, rows: [{ referrer_source: "direct", sessions: "4" }] }), [{ referrer_source: "direct", sessions: "4" }]);
  assert.deepEqual(tableRows(null), []);
});
