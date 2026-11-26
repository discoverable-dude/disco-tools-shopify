import type { SalesSummaryData } from "./sales-summary.server";
import type { StockProduct, VariantCost } from "./insights.server";

export type StockStatus = "sold-out" | "critical" | "low" | "healthy" | "plenty" | "no-sales";

export type StockRow = {
  id: string;
  title: string;
  inventory: number;
  perDay: number;
  u30: number;
  daysLeft: number | null; // null when nothing is selling
  runOut: string | null; // ISO date
  reorderBy: string | null; // ISO date (run-out minus lead time)
  status: StockStatus;
};

const DAY = 86_400_000;

/** Daily sales rate, weighting the last 14 days more heavily than the full 30 so trends show up. */
export const velocity = (u30: number, u14: number) => 0.6 * (u14 / 14) + 0.4 * (u30 / 30);

export function stockStatus(inventory: number, perDay: number, leadDays: number): StockStatus {
  if (perDay <= 0) return "no-sales";
  if (inventory <= 0) return "sold-out";
  const days = inventory / perDay;
  // Inside the supplier lead time: even ordering today the shelf runs empty first.
  if (days <= leadDays) return "critical";
  if (days <= leadDays + 14) return "low";
  if (days <= 90) return "healthy";
  return "plenty";
}

/** Joins sales velocity (last 30 days of orders) with current stock for tracked products. */
export function forecastStock(summary: SalesSummaryData, stock: StockProduct[], leadDays = 21, now = Date.now()): StockRow[] {
  const sales = new Map((summary.products ?? []).map((p) => [p.id, p]));
  const rows: StockRow[] = [];
  for (const s of stock) {
    if (!s.tracked) continue;
    const sold = sales.get(s.id);
    const u30 = sold?.u30 ?? 0;
    const perDay = velocity(u30, sold?.u14 ?? 0);
    const status = stockStatus(s.inventory, perDay, leadDays);
    const daysLeft = perDay > 0 ? Math.max(0, s.inventory / perDay) : null;
    rows.push({
      id: s.id,
      title: s.title,
      inventory: s.inventory,
      perDay,
      u30,
      daysLeft,
      runOut: daysLeft !== null && s.inventory > 0 ? new Date(now + daysLeft * DAY).toISOString() : null,
      reorderBy: daysLeft !== null && s.inventory > 0 ? new Date(now + (daysLeft - leadDays) * DAY).toISOString() : null,
      status,
    });
  }
  return rows;
}

export type ProfitRow = {
  productId: string;
  title: string;
  units: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number; // 0..1 on costed lines
};

export type Profitability = {
  costed: ProfitRow[];
  missingCost: { title: string; units: number; revenue: number }[];
  revenueCosted: number;
  revenueTotal: number;
  coverage: number; // share of analysed revenue with a unit cost
  profit: number; // gross profit on costed lines
  margin: number; // blended margin on costed lines
};

/** Product margin from Shopify unit costs. Lines without a cost are listed, not guessed. */
export function profitability(summary: SalesSummaryData, costs: Record<string, VariantCost>): Profitability {
  const byProduct = new Map<string, ProfitRow>();
  const missing = new Map<string, { title: string; units: number; revenue: number }>();
  let revenueTotal = 0;
  for (const v of summary.variants ?? []) {
    revenueTotal += v.revenue;
    const c = costs[v.id]?.cost;
    if (c === null || c === undefined) {
      const key = v.productId || v.title;
      const m = missing.get(key) ?? { title: v.title, units: 0, revenue: 0 };
      m.units += v.units;
      m.revenue += v.revenue;
      missing.set(key, m);
      continue;
    }
    const key = v.productId || v.title;
    const row = byProduct.get(key) ?? { productId: v.productId, title: v.title, units: 0, revenue: 0, cost: 0, profit: 0, margin: 0 };
    row.units += v.units;
    row.revenue += v.revenue;
    row.cost += c * v.units;
    byProduct.set(key, row);
  }
  const costed = [...byProduct.values()].map((r) => {
    const profit = r.revenue - r.cost;
    return { ...r, profit, margin: r.revenue > 0 ? profit / r.revenue : 0 };
  });
  const revenueCosted = costed.reduce((a, r) => a + r.revenue, 0);
  const profit = costed.reduce((a, r) => a + r.profit, 0);
  return {
    costed: costed.sort((a, b) => b.profit - a.profit),
    missingCost: [...missing.values()].sort((a, b) => b.revenue - a.revenue),
    revenueCosted,
    revenueTotal,
    coverage: revenueTotal > 0 ? revenueCosted / revenueTotal : 0,
    profit,
    margin: revenueCosted > 0 ? profit / revenueCosted : 0,
  };
}
