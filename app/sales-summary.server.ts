import db from "./db.server";

const DAY = 86_400_000;

export type Totals = { orders: number; revenue: number; refunded: number; discounts: number; units: number };

export type SalesSummaryData = {
  currency: string;
  from: string; // first day of the current period (YYYY-MM-DD, UTC)
  to: string; // last day (today)
  days: number;
  current: Totals;
  previous: Totals;
  daily: { date: string; revenue: number; orders: number }[];
  weekday: { day: number; orders: number; revenue: number }[]; // 0 = Monday
  channels: { name: string; orders: number; revenue: number }[];
  topProducts: { title: string; units: number; revenue: number }[];
};

type BulkOrder = {
  createdAt?: string;
  sourceName?: string | null;
  totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
  totalRefundedSet?: { shopMoney?: { amount?: string } };
  totalDiscountsSet?: { shopMoney?: { amount?: string } };
  lineItems?: { title?: string; quantity?: number; originalTotalSet?: { shopMoney?: { amount?: string } } }[];
};

const empty = (): Totals => ({ orders: 0, revenue: 0, refunded: 0, discounts: 0, units: 0 });
const num = (v: string | undefined) => (v ? Number(v) || 0 : 0);

/** Folds orders from the bulk export into the summary one at a time (constant memory). */
export class SalesAggregator {
  private current = empty();
  private previous = empty();
  private currency = "GBP";
  private byDay = new Map<string, { revenue: number; orders: number }>();
  private weekday = Array.from({ length: 7 }, (_, day) => ({ day, orders: 0, revenue: 0 }));
  private channels = new Map<string, { orders: number; revenue: number }>();
  private products = new Map<string, { units: number; revenue: number }>();
  private currentFrom: number;

  constructor(
    private days = 30,
    private now = Date.now(),
  ) {
    this.currentFrom = now - days * DAY;
    for (let i = days - 1; i >= 0; i--) {
      this.byDay.set(new Date(now - i * DAY).toISOString().slice(0, 10), { revenue: 0, orders: 0 });
    }
  }

  add(o: BulkOrder) {
    if (!o.createdAt) return;
    const t = Date.parse(o.createdAt);
    const total = num(o.totalPriceSet?.shopMoney?.amount);
    const refunded = num(o.totalRefundedSet?.shopMoney?.amount);
    const discounts = num(o.totalDiscountsSet?.shopMoney?.amount);
    if (o.totalPriceSet?.shopMoney?.currencyCode) this.currency = o.totalPriceSet.shopMoney.currencyCode;
    const units = (o.lineItems ?? []).reduce((a, li) => a + (li.quantity ?? 0), 0);

    if (t < this.currentFrom) {
      if (t >= this.currentFrom - this.days * DAY) {
        this.previous.orders++;
        this.previous.revenue += total;
        this.previous.refunded += refunded;
        this.previous.discounts += discounts;
        this.previous.units += units;
      }
      return;
    }
    this.current.orders++;
    this.current.revenue += total;
    this.current.refunded += refunded;
    this.current.discounts += discounts;
    this.current.units += units;

    const day = this.byDay.get(o.createdAt.slice(0, 10));
    if (day) {
      day.revenue += total;
      day.orders++;
    }
    const wd = this.weekday[(new Date(t).getUTCDay() + 6) % 7];
    wd.orders++;
    wd.revenue += total;

    const name = o.sourceName || "unknown";
    const ch = this.channels.get(name) ?? { orders: 0, revenue: 0 };
    ch.orders++;
    ch.revenue += total;
    this.channels.set(name, ch);

    for (const li of o.lineItems ?? []) {
      if (!li.title) continue;
      const p = this.products.get(li.title) ?? { units: 0, revenue: 0 };
      p.units += li.quantity ?? 0;
      p.revenue += num(li.originalTotalSet?.shopMoney?.amount);
      this.products.set(li.title, p);
    }
  }

  result(): SalesSummaryData {
    const dates = [...this.byDay.keys()];
    return {
      currency: this.currency,
      from: dates[0],
      to: dates[dates.length - 1],
      days: this.days,
      current: this.current,
      previous: this.previous,
      daily: [...this.byDay].map(([date, v]) => ({ date, ...v })),
      weekday: this.weekday,
      channels: [...this.channels].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue),
      topProducts: [...this.products]
        .map(([title, v]) => ({ title, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8),
    };
  }
}

export async function saveSummary(shop: string, data: SalesSummaryData) {
  const payload = JSON.stringify(data);
  await db.salesSummary.upsert({
    where: { shop },
    create: { shop, payload },
    update: { payload, computedAt: new Date() },
  });
}

export async function loadSummary(shop: string): Promise<{ data: SalesSummaryData; computedAt: Date } | null> {
  const row = await db.salesSummary.findUnique({ where: { shop } });
  return row ? { data: JSON.parse(row.payload) as SalesSummaryData, computedAt: row.computedAt } : null;
}
