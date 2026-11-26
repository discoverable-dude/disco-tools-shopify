import db from "./db.server";

const DAY = 86_400_000;

export type Totals = { orders: number; revenue: number; refunded: number; discounts: number; units: number };
export type Segment = { orders: number; revenue: number };

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

  // Added later; optional so older saved reports still load.
  /** True when the export included customer and visit data (new vs returning, traffic source). */
  extended?: boolean;
  segments?: { new: Segment; returning: Segment; unknown: Segment };
  previousSegments?: { new: Segment; returning: Segment; unknown: Segment };
  dailySegments?: { date: string; newRevenue: number; returningRevenue: number }[];
  /** Traffic attribution by marketing channel (last visit before the order), 30 days. */
  traffic?: { name: string; orders: number; revenue: number; newOrders: number; returningOrders: number }[];
  /** Same, by the specific source (google, facebook, ...). */
  sources?: { name: string; channel: string; orders: number; revenue: number; newOrders: number }[];
  /** Units sold per product, for stock forecasting. */
  products?: { id: string; title: string; u30: number; u14: number; revenue: number }[];
  /** Units and discounted revenue per variant, for margin. */
  variants?: { id: string; productId: string; title: string; units: number; revenue: number }[];
};

type Visit = { source?: string | null; sourceType?: string | null } | null | undefined;

type BulkOrder = {
  createdAt?: string;
  sourceName?: string | null;
  totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
  totalRefundedSet?: { shopMoney?: { amount?: string } };
  totalDiscountsSet?: { shopMoney?: { amount?: string } };
  customer?: { id?: string } | null;
  customerJourneySummary?: { customerOrderIndex?: number | string | null; firstVisit?: Visit; lastVisit?: Visit } | null;
  lineItems?: {
    title?: string;
    quantity?: number;
    originalTotalSet?: { shopMoney?: { amount?: string } };
    discountedTotalSet?: { shopMoney?: { amount?: string } };
    variant?: { id?: string } | null;
    product?: { id?: string } | null;
  }[];
};

const empty = (): Totals => ({ orders: 0, revenue: 0, refunded: 0, discounts: 0, units: 0 });
const seg = (): Segment => ({ orders: 0, revenue: 0 });
const segs = () => ({ new: seg(), returning: seg(), unknown: seg() });
const num = (v: string | undefined) => (v ? Number(v) || 0 : 0);

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Where an order came from, using the last visit before purchase and falling back to the first. */
export function attribution(o: BulkOrder): { channel: string; source: string } {
  const visit = o.customerJourneySummary?.lastVisit ?? o.customerJourneySummary?.firstVisit;
  const source = visit?.source?.toString().trim().toLowerCase();
  const type = visit?.sourceType?.toString().trim().toLowerCase();
  if (source || type) {
    return { channel: titleCase(type || (source === "direct" ? "direct" : "other")), source: source || type || "other" };
  }
  if (o.sourceName && !["web", "online_store", "shopify_draft_order"].includes(o.sourceName)) {
    return { channel: "Other sales channel", source: o.sourceName };
  }
  return { channel: "Direct or unknown", source: "direct / unknown" };
}

/** Folds orders from the bulk export into the summary one at a time (constant memory). */
export class SalesAggregator {
  private current = empty();
  private previous = empty();
  private currency = "GBP";
  private byDay = new Map<string, { revenue: number; orders: number; newRevenue: number; returningRevenue: number }>();
  private weekday = Array.from({ length: 7 }, (_, day) => ({ day, orders: 0, revenue: 0 }));
  private channels = new Map<string, { orders: number; revenue: number }>();
  private products = new Map<string, { units: number; revenue: number }>();
  private segCur = segs();
  private segPrev = segs();
  private traffic = new Map<string, { orders: number; revenue: number; newOrders: number; returningOrders: number }>();
  private sources = new Map<string, { channel: string; orders: number; revenue: number; newOrders: number }>();
  private productUnits = new Map<string, { title: string; u30: number; u14: number; revenue: number }>();
  private variantUnits = new Map<string, { productId: string; title: string; units: number; revenue: number }>();
  private currentFrom: number;
  private recentFrom: number;
  private sawJourney = false;

  constructor(
    private days = 30,
    private now = Date.now(),
  ) {
    this.currentFrom = now - days * DAY;
    this.recentFrom = now - 14 * DAY;
    for (let i = days - 1; i >= 0; i--) {
      this.byDay.set(new Date(now - i * DAY).toISOString().slice(0, 10), { revenue: 0, orders: 0, newRevenue: 0, returningRevenue: 0 });
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

    if ("customerJourneySummary" in o) this.sawJourney = true;
    const idx = Number(o.customerJourneySummary?.customerOrderIndex);
    const kind: "new" | "returning" | "unknown" = Number.isFinite(idx) && idx >= 1 ? (idx === 1 ? "new" : "returning") : "unknown";

    if (t < this.currentFrom) {
      if (t >= this.currentFrom - this.days * DAY) {
        this.previous.orders++;
        this.previous.revenue += total;
        this.previous.refunded += refunded;
        this.previous.discounts += discounts;
        this.previous.units += units;
        this.segPrev[kind].orders++;
        this.segPrev[kind].revenue += total;
      }
      return;
    }
    this.current.orders++;
    this.current.revenue += total;
    this.current.refunded += refunded;
    this.current.discounts += discounts;
    this.current.units += units;
    this.segCur[kind].orders++;
    this.segCur[kind].revenue += total;

    const day = this.byDay.get(o.createdAt.slice(0, 10));
    if (day) {
      day.revenue += total;
      day.orders++;
      if (kind === "new") day.newRevenue += total;
      else if (kind === "returning") day.returningRevenue += total;
    }
    const wd = this.weekday[(new Date(t).getUTCDay() + 6) % 7];
    wd.orders++;
    wd.revenue += total;

    const name = o.sourceName || "unknown";
    const ch = this.channels.get(name) ?? { orders: 0, revenue: 0 };
    ch.orders++;
    ch.revenue += total;
    this.channels.set(name, ch);

    if (this.sawJourney) {
      const a = attribution(o);
      const tr = this.traffic.get(a.channel) ?? { orders: 0, revenue: 0, newOrders: 0, returningOrders: 0 };
      tr.orders++;
      tr.revenue += total;
      if (kind === "new") tr.newOrders++;
      else if (kind === "returning") tr.returningOrders++;
      this.traffic.set(a.channel, tr);
      const sr = this.sources.get(a.source) ?? { channel: a.channel, orders: 0, revenue: 0, newOrders: 0 };
      sr.orders++;
      sr.revenue += total;
      if (kind === "new") sr.newOrders++;
      this.sources.set(a.source, sr);
    }

    const recent = t >= this.recentFrom;
    for (const li of o.lineItems ?? []) {
      if (!li.title) continue;
      const qty = li.quantity ?? 0;
      const lineRev = num(li.discountedTotalSet?.shopMoney?.amount) || num(li.originalTotalSet?.shopMoney?.amount);
      const p = this.products.get(li.title) ?? { units: 0, revenue: 0 };
      p.units += qty;
      p.revenue += num(li.originalTotalSet?.shopMoney?.amount);
      this.products.set(li.title, p);

      const pid = li.product?.id;
      if (pid) {
        const pu = this.productUnits.get(pid) ?? { title: li.title, u30: 0, u14: 0, revenue: 0 };
        pu.u30 += qty;
        if (recent) pu.u14 += qty;
        pu.revenue += lineRev;
        this.productUnits.set(pid, pu);
      }
      const vid = li.variant?.id;
      if (vid) {
        const vu = this.variantUnits.get(vid) ?? { productId: pid ?? "", title: li.title, units: 0, revenue: 0 };
        vu.units += qty;
        vu.revenue += lineRev;
        this.variantUnits.set(vid, vu);
      }
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
      daily: [...this.byDay].map(([date, v]) => ({ date, revenue: v.revenue, orders: v.orders })),
      weekday: this.weekday,
      channels: [...this.channels].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue),
      topProducts: [...this.products]
        .map(([title, v]) => ({ title, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8),
      extended: this.sawJourney,
      segments: this.segCur,
      previousSegments: this.segPrev,
      dailySegments: [...this.byDay].map(([date, v]) => ({ date, newRevenue: v.newRevenue, returningRevenue: v.returningRevenue })),
      traffic: [...this.traffic].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue),
      sources: [...this.sources]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 15),
      products: [...this.productUnits]
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.u30 - a.u30)
        .slice(0, 250),
      variants: [...this.variantUnits]
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 150),
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
