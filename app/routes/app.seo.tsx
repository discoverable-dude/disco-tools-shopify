import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { brand } from "../brand";
import { getSeoAudit } from "../insights.server";
import { safe } from "../tab-data.server";
import { recordSnapshot, seoHistory } from "../seo-history.server";
import { fetchDashboardInsights } from "../platform.server";
import { BrandHeader } from "../ui";
import { Card, DataTable, Delta, Grid, HBars, Kpi, LineChart, palette, Pill, Ring, Row } from "../charts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const [seo, platform] = await Promise.all([safe(() => getSeoAudit(admin)), fetchDashboardInsights(session.shop)]);
  if (seo.data) await recordSnapshot(session.shop, seo.data).catch((e) => console.error("seo snapshot failed", e));
  const history = await seoHistory(session.shop);
  return { seo, history, organic: platform?.organic ?? null, rankings: platform?.rankings ?? null, brand: { ...brand } };
};

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;

export default function Seo() {
  const d = useLoaderData<typeof loader>();
  const b = d.brand;
  const seo = d.seo.data;
  const o = d.organic;
  // Queries ranking just off page one with real demand are the cheapest wins.
  const striking = (o?.topQueries ?? []).filter((q) => q.position !== undefined && q.position > 3 && q.position <= 20).sort((a, c) => (c.impressions ?? 0) - (a.impressions ?? 0)).slice(0, 10);

  return (
    <s-page heading="SEO">
      <BrandHeader name={b.agency} tagline={b.tagline} accent={b.accent} accentText={b.accentText} logoUrl={b.logoUrl} title="Search visibility and on-page health" />

      {d.seo.error && (
        <div style={{ marginBottom: 16 }}>
          <s-banner tone="critical">Could not run the SEO check: {d.seo.error}</s-banner>
        </div>
      )}

      {o && (
        <s-section heading={`Search performance, from ${b.agency}`}>
          <Grid min={200}>
            <Kpi label="Organic clicks" value={o.clicks.toLocaleString("en-GB")} delta={o.previous && <Delta current={o.clicks} previous={o.previous.clicks} />} />
            <Kpi label="Impressions" value={o.impressions.toLocaleString("en-GB")} delta={o.previous && <Delta current={o.impressions} previous={o.previous.impressions} />} accent={palette.teal3} />
            {o.ctr !== undefined && <Kpi label="Click-through rate" value={pct(o.ctr)} />}
            {o.position !== undefined && <Kpi label="Average position" value={o.position.toFixed(1)} accent={palette.teal2} />}
          </Grid>
          {o.daily && o.daily.length > 1 && (
            <div style={{ marginTop: 14 }}>
              <Card title="Organic clicks per day">
                <LineChart data={o.daily.map((x) => ({ date: x.date, value: x.clicks }))} />
              </Card>
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <Grid min={320}>
              <Card title="Top search queries">
                <DataTable
                  rowKey={(r) => r.query}
                  rows={(o.topQueries ?? []).slice(0, 10)}
                  columns={[
                    { label: "Query", render: (r) => r.query },
                    { label: "Clicks", align: "right", render: (r) => r.clicks },
                    { label: "Position", align: "right", render: (r) => (r.position !== undefined ? r.position.toFixed(1) : "–") },
                  ]}
                />
              </Card>
              <Card title="Striking distance" subtitle="Positions 4-20 with the most impressions: improve these pages first">
                <DataTable
                  rowKey={(r) => r.query}
                  rows={striking}
                  empty="No queries sitting just off page one."
                  columns={[
                    { label: "Query", render: (r) => r.query },
                    { label: "Impressions", align: "right", render: (r) => (r.impressions ?? 0).toLocaleString("en-GB") },
                    { label: "Position", align: "right", render: (r) => r.position?.toFixed(1) ?? "–" },
                  ]}
                />
              </Card>
            </Grid>
          </div>
          {d.rankings && (
            <div style={{ marginTop: 14 }}>
              <Grid min={200}>
                <Kpi label="Keywords tracked" value={String(d.rankings.tracked)} />
                {d.rankings.top3 !== undefined && <Kpi label="In top 3" value={String(d.rankings.top3)} accent={palette.good} />}
                {d.rankings.top10 !== undefined && <Kpi label="In top 10" value={String(d.rankings.top10)} accent={palette.teal3} />}
              </Grid>
            </div>
          )}
        </s-section>
      )}

      {seo && (
        <s-section heading="On-page SEO health">
          <div style={{ display: "grid", gap: 14 }}>
            <Grid min={280}>
              <Card>
                <Ring value={seo.score} label="SEO health score" sub={`${seo.audited - seo.withIssues} of ${seo.audited} pages pass every check`} />
              </Card>
              <Card title="What needs attention" subtitle={`${seo.products} live products and ${seo.collections} collections checked`}>
                <HBars
                  color={palette.warn}
                  items={[
                    { label: "Missing meta titles", value: seo.missingMetaTitle },
                    { label: "Missing meta descriptions", value: seo.missingMetaDescription },
                    { label: "Meta description too long or short", value: seo.metaDescriptionTooLong + seo.metaDescriptionTooShort },
                    { label: "Meta titles over 60 characters", value: seo.metaTitleTooLong },
                    { label: "Duplicate titles", value: seo.duplicateTitles },
                    { label: "Main images without alt text", value: seo.missingAlt },
                  ]}
                />
              </Card>
            </Grid>
            <Card title="SEO score over time" subtitle="Updated each day this tab is opened">
              <LineChart data={d.history.map((h) => ({ date: h.date, value: h.score }))} />
            </Card>
            {seo.worst.length > 0 && (
              <Card title="Quick wins" subtitle="Pages with the most issues">
                {seo.worst.map((i, idx) => (
                  <Row key={i.id} last={idx === seo.worst.length - 1}>
                    <span style={{ flex: 1 }}>
                      <s-link href={`shopify:admin/${i.kind === "product" ? "products" : "collections"}/${i.id.split("/").pop()}`}>{i.title}</s-link>
                      <div style={{ color: palette.muted, fontSize: 12 }}>{i.problems.join(" · ")}</div>
                    </span>
                    <Pill tone="warn">{i.problems.length} issue{i.problems.length === 1 ? "" : "s"}</Pill>
                  </Row>
                ))}
              </Card>
            )}
            {seo.capped && <div style={{ color: palette.muted, fontSize: 12 }}>Large catalogue: the first 1,000 products and collections were checked.</div>}
          </div>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
