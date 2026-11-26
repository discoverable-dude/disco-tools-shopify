import db from "./db.server";
import type { SeoAudit } from "./insights.server";

const MIN_GAP_MS = 20 * 60 * 60 * 1000; // at most one snapshot per ~day

/** Save today's audit result so progress can be charted. */
export async function recordSnapshot(shop: string, audit: SeoAudit) {
  const last = await db.seoSnapshot.findFirst({ where: { shop }, orderBy: { takenAt: "desc" } });
  if (last && Date.now() - last.takenAt.getTime() < MIN_GAP_MS) return;
  await db.seoSnapshot.create({
    data: {
      shop,
      score: audit.score,
      audited: audit.audited,
      withIssues: audit.withIssues,
      missingMetaTitle: audit.missingMetaTitle,
      missingMetaDescription: audit.missingMetaDescription,
      missingAlt: audit.missingAlt,
      duplicateTitles: audit.duplicateTitles,
    },
  });
}

export async function seoHistory(shop: string) {
  const rows = await db.seoSnapshot.findMany({ where: { shop }, orderBy: { takenAt: "desc" }, take: 60 });
  return rows.reverse().map((r) => ({ date: r.takenAt.toISOString(), score: r.score }));
}
