import type { ReactNode } from "react";

export const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

export const fmt = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Never";

export const tone = (s: string) =>
  ["completed", "applied", "delivered", "linked", "done"].includes(s)
    ? "success"
    : ["failed"].includes(s)
      ? "critical"
      : "caution";

export function Metric({ label, value, bad, hint }: { label: string; value: string; bad?: boolean; hint?: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background={bad ? "subdued" : "base"}>
      <s-stack gap="small-500">
        <s-text>{label}</s-text>
        <s-heading>{value}</s-heading>
        {hint && <s-text>{hint}</s-text>}
      </s-stack>
    </s-box>
  );
}

export function BrandHeader(props: {
  name: string;
  tagline: string;
  accent: string;
  accentText: string;
  logoUrl: string;
  subtitle?: ReactNode;
}) {
  const { name, tagline, accent, accentText, logoUrl, subtitle } = props;
  return (
    <div
      style={{
        background: accent,
        color: accentText,
        borderRadius: 12,
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      {logoUrl ? (
        <img src={logoUrl} alt={name} style={{ height: 32, width: "auto" }} />
      ) : (
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{name}</span>
      )}
      <span style={{ opacity: 0.85, fontSize: 14 }}>{tagline}</span>
      {subtitle && <span style={{ marginLeft: "auto", fontSize: 13, opacity: 0.9 }}>{subtitle}</span>}
    </div>
  );
}
