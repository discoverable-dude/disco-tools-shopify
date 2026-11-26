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
  title?: string;
  subtitle?: ReactNode;
}) {
  const { name, tagline, accent, accentText, logoUrl, title, subtitle } = props;
  return (
    <div
      style={{
        background: `radial-gradient(circle at 92% 0%, rgba(95,179,173,0.35) 0, rgba(95,179,173,0) 42%), linear-gradient(120deg, ${accent} 0%, #0b6b66 100%)`,
        color: accentText,
        borderRadius: 16,
        padding: "22px 26px",
        marginBottom: 16,
        fontFamily: "Poppins, Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {logoUrl ? (
          <img src={logoUrl} alt={name} style={{ height: 30, width: "auto" }} />
        ) : (
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{name}</span>
        )}
        <span style={{ opacity: 0.8, fontSize: 13 }}>{tagline}</span>
        {subtitle && (
          <span style={{ marginLeft: "auto", fontSize: 12.5, background: "rgba(255,255,255,0.14)", borderRadius: 999, padding: "4px 12px" }}>
            {subtitle}
          </span>
        )}
      </div>
      {title && (
        <div style={{ marginTop: 16, fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</div>
      )}
    </div>
  );
}
