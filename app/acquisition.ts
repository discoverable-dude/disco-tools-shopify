import type { AcquisitionRow } from "./sales-summary.server";

export type Filter = { from?: string; to?: string; channel?: string; source?: string };

export type Cell = { newOrders: number; returningOrders: number; unknownOrders: number; newRevenue: number; returningRevenue: number; unknownRevenue: number };

const zero = (): Cell => ({ newOrders: 0, returningOrders: 0, unknownOrders: 0, newRevenue: 0, returningRevenue: 0, unknownRevenue: 0 });

function add(c: Cell, r: AcquisitionRow) {
  c.newOrders += r.n;
  c.returningOrders += r.r;
  c.unknownOrders += r.u;
  c.newRevenue += r.nv;
  c.returningRevenue += r.rv;
  c.unknownRevenue += r.uv;
}

/** Rows inside the date range ("YYYY-MM-DD", inclusive) and matching the channel and source, if set. */
export function filterRows(rows: AcquisitionRow[], f: Filter): AcquisitionRow[] {
  return rows.filter((r) => (!f.from || r.d >= f.from) && (!f.to || r.d <= f.to) && (!f.channel || r.c === f.channel) && (!f.source || r.s === f.source));
}

export function totals(rows: AcquisitionRow[]): Cell {
  const c = zero();
  for (const r of rows) add(c, r);
  return c;
}

/** Calendar months present in the rows, oldest first ("YYYY-MM"). */
export function monthsOf(rows: AcquisitionRow[]): string[] {
  return [...new Set(rows.map((r) => r.d.slice(0, 7)))].sort();
}

export function byMonth(rows: AcquisitionRow[]): { month: string; cell: Cell }[] {
  const m = new Map<string, Cell>();
  for (const r of rows) {
    const k = r.d.slice(0, 7);
    const c = m.get(k) ?? zero();
    add(c, r);
    m.set(k, c);
  }
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([month, cell]) => ({ month, cell }));
}

export type MatrixRow = { key: string; label: string; channel: string; total: Cell; months: Record<string, Cell> };

/** One row per channel or per source, with a cell for every month, busiest first. */
export function matrix(rows: AcquisitionRow[], by: "channel" | "source"): MatrixRow[] {
  const out = new Map<string, MatrixRow>();
  for (const r of rows) {
    // Sources are kept apart per channel, so Google organic and Google paid are separate rows.
    const key = by === "channel" ? r.c : `${r.c}|${r.s}`;
    const row = out.get(key) ?? { key, label: by === "channel" ? r.c : r.s, channel: r.c, total: zero(), months: {} };
    add(row.total, r);
    const mk = r.d.slice(0, 7);
    add((row.months[mk] ??= zero()), r);
    out.set(key, row);
  }
  const rev = (c: Cell) => c.newRevenue + c.returningRevenue + c.unknownRevenue;
  return [...out.values()].sort((a, b) => rev(b.total) - rev(a.total));
}

/** Share of known-customer orders that came from new customers (0..1). */
export const newShare = (c: Cell) => (c.newOrders + c.returningOrders ? c.newOrders / (c.newOrders + c.returningOrders) : 0);
