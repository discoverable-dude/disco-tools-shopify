import type { authenticate } from "./shopify.server";

type Admin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

export type VisitorTotals = { sessions: number; visitors: number; conversionRate: number; completedCheckouts: number };

export type VisitorAnalytics = {
  period: { from: string; to: string };
  current: VisitorTotals;
  previous: VisitorTotals;
  daily: { date: string; sessions: number; visitors: number; conversionRate: number }[];
  /** Traffic by Shopify's referrer source (search, direct, social, email, ...). conversionRate is a fraction. */
  sources: { source: string; sessions: number; visitors: number; conversionRate: number; completedCheckouts: number }[];
};

type Table = { columns: { name: string }[]; rows: unknown[] };

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Turns ShopifyQL tableData into plain objects keyed by column name (rows may be objects or arrays). */
export function tableRows(t: Table | null | undefined): Record<string, unknown>[] {
  if (!t) return [];
  return t.rows.map((row) => {
    if (Array.isArray(row)) return Object.fromEntries(t.columns.map((c, i) => [c.name, row[i]]));
    return row as Record<string, unknown>;
  });
}

const WHERE = "WHERE human_or_bot_session = 'human'";
const METRICS = "sessions, online_store_visitors, conversion_rate, sessions_that_completed_checkout";

async function run(admin: Admin, query: string) {
  const res = await admin.graphql(
    `#graphql
    query Q($q: String!) {
      shopifyqlQuery(query: $q) {
        parseErrors
        tableData { columns { name } rows }
      }
    }`,
    { variables: { q: query } },
  );
  const json = (await res.json()) as {
    data?: { shopifyqlQuery?: { parseErrors?: string[]; tableData?: Table | null } } | null;
    errors?: { message: string; extensions?: { code?: string } }[];
  };
  if (json.errors?.length) {
    const e = json.errors[0];
    throw new Error(e.extensions?.code === "ACCESS_DENIED" ? "Shopify visitor data is not switched on for this store (read_reports permission not granted yet)" : e.message);
  }
  const q = json.data?.shopifyqlQuery;
  if (q?.parseErrors?.length) throw new Error(`ShopifyQL error: ${q.parseErrors.join("; ")}`);
  return tableRows(q?.tableData);
}

const totals = (r: Record<string, unknown> | undefined): VisitorTotals => ({
  sessions: num(r?.sessions),
  visitors: num(r?.online_store_visitors),
  conversionRate: num(r?.conversion_rate),
  completedCheckouts: num(r?.sessions_that_completed_checkout),
});

/** Visits, conversion rate and traffic sources for a date range, with the previous period of the same length. */
export async function getVisitorAnalytics(admin: Admin, from: string, to: string): Promise<VisitorAnalytics> {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const prevTo = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(`${prevTo}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const range = (a: string, b: string) => `SINCE ${a} UNTIL ${b}`;

  const [cur, prev, daily, sources] = await Promise.all([
    run(admin, `FROM sessions SHOW ${METRICS} ${WHERE} ${range(from, to)}`),
    run(admin, `FROM sessions SHOW ${METRICS} ${WHERE} ${range(prevFrom, prevTo)}`),
    run(admin, `FROM sessions SHOW sessions, online_store_visitors, conversion_rate ${WHERE} TIMESERIES day ${range(from, to)} ORDER BY day ASC`),
    run(admin, `FROM sessions SHOW ${METRICS} ${WHERE} GROUP BY referrer_source ${range(from, to)} ORDER BY sessions DESC LIMIT 25`),
  ]);

  return {
    period: { from, to },
    current: totals(cur[0]),
    previous: totals(prev[0]),
    daily: daily.map((r) => ({
      date: String(r.day ?? "").slice(0, 10),
      sessions: num(r.sessions),
      visitors: num(r.online_store_visitors),
      conversionRate: num(r.conversion_rate),
    })),
    sources: sources.map((r) => ({
      source: String(r.referrer_source ?? "unknown") || "unknown",
      sessions: num(r.sessions),
      visitors: num(r.online_store_visitors),
      conversionRate: num(r.conversion_rate),
      completedCheckouts: num(r.sessions_that_completed_checkout),
    })),
  };
}
