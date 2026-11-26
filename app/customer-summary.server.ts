import db from "./db.server";

export type CohortRow = {
  month: string; // YYYY-MM
  customers: number;
  buyers: number; // customers with at least one order
  repeaters: number; // customers with two or more orders
  spent: number;
};

export type CustomerSummaryData = {
  currency: string;
  total: number;
  buyers: number;
  repeaters: number;
  spent: number;
  /** Average lifetime value per buying customer, and distribution points. */
  ltv: { average: number; median: number; p90: number };
  /** Share of all customer spend that comes from the top 10% of buyers. */
  topDecileShare: number;
  /** Customers by number of orders: 1, 2, 3, 4-5, 6+. */
  orderBands: { label: string; customers: number }[];
  /** Customers grouped by the month their account was created (last 13 months + earlier). */
  cohorts: CohortRow[];
};

type BulkCustomer = {
  createdAt?: string;
  numberOfOrders?: string | number | null;
  amountSpent?: { amount?: string; currencyCode?: string } | null;
};

const monthKey = (iso: string) => iso.slice(0, 7);

export class CustomerAggregator {
  private total = 0;
  private buyers = 0;
  private repeaters = 0;
  private spent = 0;
  private currency = "GBP";
  private spends: number[] = []; // spend of every buyer, for percentiles
  private bands = [0, 0, 0, 0, 0];
  private cohorts = new Map<string, CohortRow>();
  private cutoff: string;

  constructor(now = Date.now()) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - 12);
    this.cutoff = d.toISOString().slice(0, 7);
  }

  add(c: BulkCustomer) {
    this.total++;
    const orders = Number(c.numberOfOrders) || 0;
    const spent = Number(c.amountSpent?.amount) || 0;
    if (c.amountSpent?.currencyCode) this.currency = c.amountSpent.currencyCode;

    const month = c.createdAt ? monthKey(c.createdAt) : "unknown";
    const key = month < this.cutoff ? "earlier" : month;
    const row = this.cohorts.get(key) ?? { month: key, customers: 0, buyers: 0, repeaters: 0, spent: 0 };
    row.customers++;
    this.cohorts.set(key, row);

    if (orders < 1) return;
    this.buyers++;
    this.spent += spent;
    this.spends.push(spent);
    row.buyers++;
    row.spent += spent;
    if (orders >= 2) {
      this.repeaters++;
      row.repeaters++;
    }
    this.bands[orders === 1 ? 0 : orders === 2 ? 1 : orders === 3 ? 2 : orders <= 5 ? 3 : 4]++;
  }

  result(): CustomerSummaryData {
    const sorted = [...this.spends].sort((a, b) => a - b);
    const at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
    const topN = Math.max(1, Math.ceil(sorted.length * 0.1));
    const topSpend = sorted.slice(-topN).reduce((a, b) => a + b, 0);
    return {
      currency: this.currency,
      total: this.total,
      buyers: this.buyers,
      repeaters: this.repeaters,
      spent: this.spent,
      ltv: { average: this.buyers ? this.spent / this.buyers : 0, median: at(0.5), p90: at(0.9) },
      topDecileShare: this.spent ? topSpend / this.spent : 0,
      orderBands: ["1 order", "2 orders", "3 orders", "4-5 orders", "6+ orders"].map((label, i) => ({ label, customers: this.bands[i] })),
      cohorts: [...this.cohorts.values()]
        .filter((c) => c.month !== "unknown")
        .sort((a, b) => (a.month === "earlier" ? -1 : b.month === "earlier" ? 1 : a.month.localeCompare(b.month))),
    };
  }
}

export async function saveCustomerSummary(shop: string, data: CustomerSummaryData) {
  const payload = JSON.stringify(data);
  await db.customerSummary.upsert({
    where: { shop },
    create: { shop, payload },
    update: { payload, computedAt: new Date() },
  });
}

export async function loadCustomerSummary(shop: string): Promise<{ data: CustomerSummaryData; computedAt: Date } | null> {
  const row = await db.customerSummary.findUnique({ where: { shop } });
  return row ? { data: JSON.parse(row.payload) as CustomerSummaryData, computedAt: row.computedAt } : null;
}
