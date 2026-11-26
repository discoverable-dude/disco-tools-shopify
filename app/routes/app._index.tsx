import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { brand } from "../brand";
import { getOrderInsights, getSeoAudit } from "../insights.server";
import { missingScopes } from "../scopes.server";
import { BrandHeader, Metric, fmt, money } from "../ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  // Each insight is isolated so a missing scope or schema change only blanks its own card.
  const safe = async <T,>(fn: () => Promise<T>): Promise<{ data: T | null; error: string | null }> => {
    try {
      return { data: await fn(), error: null };
    } catch (e) {
      return { data: null, error: (e as Error).message };
    }
  };

  const [link, shopRes, sales, seo] = await Promise.all([
    db.shopLink.findUnique({ where: { shop: session.shop } }),
    admin.graphql(`#graphql
      query ShopName { shop { name } }`),
    safe(() => getOrderInsights(admin)),
    safe(() => getSeoAudit(admin)),
  ]);
  const shopName: string = (await shopRes.json()).data?.shop?.name ?? session.shop;

  return {
    shopName,
    link,
    sales,
    seo,
    missing: missingScopes((session.scope ?? "").split(",").filter(Boolean)),
    brand: { ...brand },
  };
};

export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const linked = d.link?.status === "linked";
  const b = d.brand;
  const seo = d.seo.data;
  const sales = d.sales.data;

  return (
    <s-page heading={d.shopName}>
      <BrandHeader
        name={b.agency}
        tagline={b.tagline}
        accent={b.accent}
        accentText={b.accentText}
        logoUrl={b.logoUrl}
        subtitle={linked ? `Connected · data updated ${fmt(d.link?.lastSyncAt)}` : "Setup in progress"}
      />

      {d.missing.length > 0 && (
        <s-banner tone="warning" heading="Permissions need updating">
          This app needs additional access ({d.missing.join(", ")}). Your {b.agency} team will send an update to approve.
        </s-banner>
      )}
      {!linked && (
        <s-banner tone="info" heading="Almost there">
          Your {b.agency} team is finishing the connection to your reporting. Nothing else is needed from you.
        </s-banner>
      )}

      <s-section heading="On-page SEO health">
        {d.seo.error && <s-banner tone="critical">Could not run the SEO check: {d.seo.error}</s-banner>}
        {seo && (
          <s-stack gap="base">
            <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
              <Metric
                label="SEO health score"
                value={`${seo.score}/100`}
                bad={seo.score < 80}
                hint={`${seo.audited - seo.withIssues} of ${seo.audited} pages pass`}
              />
              <Metric label="Missing meta titles" value={String(seo.missingMetaTitle)} bad={seo.missingMetaTitle > 0} />
              <Metric label="Missing meta descriptions" value={String(seo.missingMetaDescription)} bad={seo.missingMetaDescription > 0} />
              <Metric label="Images without alt text" value={String(seo.missingAlt)} bad={seo.missingAlt > 0} />
            </s-grid>
            <s-text>
              Checked {seo.products} live products and {seo.collections} collections
              {seo.capped ? " (first 1,000 of each)" : ""}. Unpublished products are ignored.
            </s-text>
            {seo.worst.length > 0 && <s-heading>Quick wins</s-heading>}
            {seo.worst.map((i) => (
              <s-stack key={i.id} gap="small-500">
                <s-link href={`shopify:admin/${i.kind === "product" ? "products" : "collections"}/${i.id.split("/").pop()}`}>
                  {i.title}
                </s-link>
                <s-text>{i.problems.join(" · ")}</s-text>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading={`Sales - last ${sales?.days ?? 30} days`}>
        {d.sales.error && <s-banner tone="critical">Could not load sales: {d.sales.error}</s-banner>}
        {sales && (
          <s-stack gap="base">
            <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
              <Metric label="Revenue" value={money(sales.revenue, sales.currency)} />
              <Metric label="Orders" value={String(sales.orders)} />
              <Metric label="Average order value" value={money(sales.aov, sales.currency)} />
              <Metric label="Refunded" value={money(sales.refunded, sales.currency)} />
            </s-grid>
            {sales.orders === 0 && <s-text>No orders in this period.</s-text>}
            {sales.topProducts.length > 0 && <s-heading>Best sellers</s-heading>}
            {sales.topProducts.map((p) => (
              <s-text key={p.title}>{p.title} · {p.units} sold · {money(p.revenue, sales.currency)}</s-text>
            ))}
            {sales.channels.length > 0 && <s-heading>Where orders come from</s-heading>}
            {sales.channels.map((c) => (
              <s-text key={c.name}>{c.name} · {c.orders} orders · {money(c.revenue, sales.currency)}</s-text>
            ))}
            {sales.capped && <s-text>Based on the most recent 400 orders.</s-text>}
          </s-stack>
        )}
      </s-section>

      <s-section heading={`Your ${b.agency} team`}>
        <s-stack gap="base">
          <s-text>
            Traffic, rankings and ad performance for {d.shopName} are reported by {b.agency}. SEO fixes
            above are applied by your team with a preview and the ability to undo any change.
          </s-text>
          <s-stack direction="inline" gap="small">
            {b.bookingUrl && <s-button href={b.bookingUrl} target="_blank" variant="primary">Book a call</s-button>}
            {b.contactEmail && <s-button href={`mailto:${b.contactEmail}`}>Email us</s-button>}
            <s-button href={b.website} target="_blank">{b.website.replace("https://", "")}</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
