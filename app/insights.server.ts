import type { authenticate } from "./shopify.server";

type Admin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

export type SeoIssue = { id: string; title: string; handle: string; kind: "product" | "collection"; problems: string[] };
export type SeoAudit = {
  scanned: number;
  products: number;
  collections: number;
  missingMetaTitle: number;
  missingMetaDescription: number;
  metaTitleTooLong: number;
  metaDescriptionTooLong: number;
  metaDescriptionTooShort: number;
  missingAlt: number;
  duplicateTitles: number;
  draftOrArchived: number;
  worst: SeoIssue[];
  capped: boolean;
};

type Page<T> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] };

const MAX_PAGES = 4; // 4 x 250 = 1000 per resource

async function pageAll<T>(admin: Admin, field: "products" | "collections", node: string) {
  const out: T[] = [];
  let after: string | null = null;
  let capped = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res: Response = await admin.graphql(
      `#graphql
      query Page($after: String) {
        ${field}(first: 250, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${node} }
        }
      }`,
      { variables: { after } },
    );
    const json = (await res.json()) as { data?: Record<string, Page<T>> };
    const data: Page<T> | undefined = json.data?.[field];
    out.push(...(data?.nodes ?? []));
    if (!data?.pageInfo?.hasNextPage) return { nodes: out, capped };
    after = data.pageInfo.endCursor;
    if (i === MAX_PAGES - 1) capped = true;
  }
  return { nodes: out, capped };
}

type SeoNode = {
  id: string;
  title: string;
  handle: string;
  status?: string;
  seo?: { title?: string | null; description?: string | null } | null;
  featuredMedia?: { alt?: string | null } | null;
  image?: { altText?: string | null } | null;
};

/** Lightweight on-page SEO audit of titles, meta data and image alt text. */
export async function getSeoAudit(admin: Admin): Promise<SeoAudit> {
  const [p, c] = await Promise.all([
    pageAll<SeoNode>(admin, "products", "id title handle status seo { title description } featuredMedia { ... on MediaImage { alt } }"),
    pageAll<SeoNode>(admin, "collections", "id title handle seo { title description } image { altText }"),
  ]);

  const audit: SeoAudit = {
    scanned: p.nodes.length + c.nodes.length,
    products: p.nodes.length,
    collections: c.nodes.length,
    missingMetaTitle: 0,
    missingMetaDescription: 0,
    metaTitleTooLong: 0,
    metaDescriptionTooLong: 0,
    metaDescriptionTooShort: 0,
    missingAlt: 0,
    duplicateTitles: 0,
    draftOrArchived: 0,
    worst: [],
    capped: p.capped || c.capped,
  };

  const titleCounts = new Map<string, number>();
  for (const n of [...p.nodes, ...c.nodes]) {
    const t = (n.seo?.title || n.title).trim().toLowerCase();
    titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
  }

  const issues: SeoIssue[] = [];
  const check = (n: SeoNode, kind: "product" | "collection") => {
    const problems: string[] = [];
    const mt = n.seo?.title?.trim() ?? "";
    const md = n.seo?.description?.trim() ?? "";
    if (kind === "product" && n.status && n.status !== "ACTIVE") {
      audit.draftOrArchived++;
      return; // don't audit unpublished products
    }
    if (!mt) { audit.missingMetaTitle++; problems.push("No meta title"); }
    else if (mt.length > 60) { audit.metaTitleTooLong++; problems.push(`Meta title ${mt.length} chars (max 60)`); }
    if (!md) { audit.missingMetaDescription++; problems.push("No meta description"); }
    else if (md.length > 160) { audit.metaDescriptionTooLong++; problems.push(`Meta description ${md.length} chars (max 160)`); }
    else if (md.length < 70) { audit.metaDescriptionTooShort++; problems.push(`Meta description only ${md.length} chars`); }
    const hasImage = kind === "product" ? n.featuredMedia !== null && n.featuredMedia !== undefined : n.image !== null && n.image !== undefined;
    const alt = kind === "product" ? n.featuredMedia?.alt : n.image?.altText;
    if (hasImage && !alt?.trim()) { audit.missingAlt++; problems.push("Main image has no alt text"); }
    if ((titleCounts.get((n.seo?.title || n.title).trim().toLowerCase()) ?? 0) > 1) {
      audit.duplicateTitles++;
      problems.push("Duplicate title");
    }
    if (problems.length) issues.push({ id: n.id, title: n.title, handle: n.handle, kind, problems });
  };
  p.nodes.forEach((n) => check(n, "product"));
  c.nodes.forEach((n) => check(n, "collection"));

  audit.worst = issues.sort((a, b) => b.problems.length - a.problems.length).slice(0, 10);
  return audit;
}

type OrderNode = {
  sourceName: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet: { shopMoney: { amount: string } };
  lineItems: { nodes: { title: string; quantity: number; originalTotalSet: { shopMoney: { amount: string } } }[] };
};

export type OrderInsights = {
  days: number;
  orders: number;
  revenue: number;
  refunded: number;
  aov: number;
  currency: string;
  channels: { name: string; orders: number; revenue: number }[];
  topProducts: { title: string; units: number; revenue: number }[];
  capped: boolean;
};

/** Sales summary for the last 30 days (Shopify exposes 60 days without read_all_orders). */
export async function getOrderInsights(admin: Admin, days = 30): Promise<OrderInsights> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const insights: OrderInsights = {
    days, orders: 0, revenue: 0, refunded: 0, aov: 0, currency: "GBP", channels: [], topProducts: [], capped: false,
  };
  const channels = new Map<string, { orders: number; revenue: number }>();
  const products = new Map<string, { units: number; revenue: number }>();
  let after: string | null = null;

  for (let page = 0; page < 4; page++) {
    const res: Response = await admin.graphql(
      `#graphql
      query Orders($q: String!, $after: String) {
        orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            sourceName
            totalPriceSet { shopMoney { amount currencyCode } }
            totalRefundedSet { shopMoney { amount } }
            lineItems(first: 20) { nodes { title quantity originalTotalSet { shopMoney { amount } } } }
          }
        }
      }`,
      { variables: { q: `created_at:>=${from}`, after } },
    );
    const json = (await res.json()) as { data?: { orders: Page<OrderNode> } };
    const data: Page<OrderNode> | undefined = json.data?.orders;
    for (const o of data?.nodes ?? []) {
      const total = Number(o.totalPriceSet.shopMoney.amount);
      insights.currency = o.totalPriceSet.shopMoney.currencyCode;
      insights.orders++;
      insights.revenue += total;
      insights.refunded += Number(o.totalRefundedSet.shopMoney.amount);
      const ch = channels.get(o.sourceName || "unknown") ?? { orders: 0, revenue: 0 };
      ch.orders++;
      ch.revenue += total;
      channels.set(o.sourceName || "unknown", ch);
      for (const li of o.lineItems.nodes) {
        const pr = products.get(li.title) ?? { units: 0, revenue: 0 };
        pr.units += li.quantity;
        pr.revenue += Number(li.originalTotalSet.shopMoney.amount);
        products.set(li.title, pr);
      }
    }
    if (!data?.pageInfo?.hasNextPage) break;
    after = data.pageInfo.endCursor;
    if (page === 3) insights.capped = true;
  }

  insights.aov = insights.orders ? insights.revenue / insights.orders : 0;
  insights.channels = [...channels].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue);
  insights.topProducts = [...products].map(([title, v]) => ({ title, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  return insights;
}
