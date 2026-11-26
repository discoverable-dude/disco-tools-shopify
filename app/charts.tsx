import type { CSSProperties, ReactNode } from "react";

/** Lightweight SVG charts (no dependencies) styled with the Discoverable palette. */
export const palette = {
  teal: "#024141",
  teal2: "#0b6b66",
  teal3: "#5fb3ad",
  tint: "#e6f2f0",
  good: "#1a7f4b",
  warn: "#b7791f",
  bad: "#b3261e",
  text: "#1a1a1a",
  muted: "#6b7280",
  line: "#e5e7eb",
  surface: "#ffffff",
  soft: "#f5f7f7",
};

const font = "Poppins, Inter, system-ui, -apple-system, sans-serif";

export function Card(props: { title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: palette.surface,
        border: `1px solid ${palette.line}`,
        borderRadius: 14,
        padding: 18,
        fontFamily: font,
        color: palette.text,
        ...props.style,
      }}
    >
      {(props.title || props.right) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
          <div>
            {props.title && <div style={{ fontWeight: 600, fontSize: 14 }}>{props.title}</div>}
            {props.subtitle && <div style={{ color: palette.muted, fontSize: 12, marginTop: 2 }}>{props.subtitle}</div>}
          </div>
          {props.right}
        </div>
      )}
      {props.children}
    </div>
  );
}

export function Grid(props: { min?: number; gap?: number; children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${props.min ?? 220}px, 1fr))`,
        gap: props.gap ?? 14,
      }}
    >
      {props.children}
    </div>
  );
}

/** Change versus the previous period, e.g. "up 12%". `invert` for metrics where lower is better. */
export function Delta({ current, previous, invert }: { current: number; previous: number; invert?: boolean }) {
  if (!previous) return <span style={{ color: palette.muted, fontSize: 12 }}>no earlier data</span>;
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return <span style={{ color: palette.muted, fontSize: 12 }}>no change</span>;
  const up = pct > 0;
  const good = invert ? !up : up;
  return (
    <span style={{ color: good ? palette.good : palette.bad, fontSize: 12, fontWeight: 600 }}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% <span style={{ color: palette.muted, fontWeight: 400 }}>vs previous 30 days</span>
    </span>
  );
}

export function Kpi(props: { label: string; value: string; delta?: ReactNode; accent?: string }) {
  return (
    <div
      style={{
        background: palette.surface,
        border: `1px solid ${palette.line}`,
        borderTop: `3px solid ${props.accent ?? palette.teal}`,
        borderRadius: 14,
        padding: "14px 16px",
        fontFamily: font,
      }}
    >
      <div style={{ color: palette.muted, fontSize: 12 }}>{props.label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: "4px 0 2px", color: palette.text }}>{props.value}</div>
      <div style={{ minHeight: 18 }}>{props.delta}</div>
    </div>
  );
}

const short = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function BarChart(props: {
  data: { label: string; value: number; tip?: string }[];
  format?: (n: number) => string;
  color?: string;
  height?: number;
  allLabels?: boolean;
}) {
  const { data, format = (n) => String(Math.round(n)), color = palette.teal2, height = 170, allLabels = false } = props;
  const W = 640;
  const padL = 44;
  const padB = 22;
  const padT = 8;
  const max = Math.max(...data.map((d) => d.value), 1);
  const n = Math.max(data.length, 1);
  const slot = (W - padL) / n;
  const bw = Math.max(Math.min(slot * 0.68, 22), 2);
  const innerH = height - padB - padT;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const total = data.reduce((a, d) => a + d.value, 0);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="Bar chart" style={{ display: "block", fontFamily: font }}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={y(max * t)} y2={y(max * t)} stroke={palette.line} strokeWidth={1} />
          <text x={padL - 6} y={y(max * t) + 4} fontSize={10} textAnchor="end" fill={palette.muted}>
            {format(max * t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = padL + i * slot + (slot - bw) / 2;
        const h = (d.value / max) * innerH;
        return (
          <rect key={i} x={x} y={y(d.value)} width={bw} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={3} fill={color}>
            <title>{d.tip ?? `${d.label}: ${format(d.value)}`}</title>
          </rect>
        );
      })}
      {data.length > 0 &&
        (allLabels
          ? data.map((d, i) => (
              <text key={i} x={padL + i * slot + slot / 2} y={height - 6} fontSize={10} textAnchor="middle" fill={palette.muted}>
                {d.label}
              </text>
            ))
          : [0, Math.floor((data.length - 1) / 2), data.length - 1].map((i, k) => (
              <text key={k} x={padL + i * slot + slot / 2} y={height - 6} fontSize={10} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} fill={palette.muted}>
                {data[i].label}
              </text>
            )))}
      {total === 0 && (
        <text x={(W + padL) / 2} y={height / 2} textAnchor="middle" fontSize={12} fill={palette.muted}>
          No data in this period
        </text>
      )}
    </svg>
  );
}

export function LineChart(props: { data: { date: string; value: number }[]; color?: string; height?: number; min?: number; max?: number; empty?: string }) {
  const { data, color = palette.teal2, height = 150, min = 0, max = 100 } = props;
  const W = 640;
  const padL = 34;
  const padB = 22;
  const padT = 8;
  if (data.length < 2) {
    return (
      <div style={{ color: palette.muted, fontSize: 13, padding: "24px 0", textAlign: "center", fontFamily: font }}>
        {props.empty ?? "History builds up daily. Check back tomorrow to see your progress."}
      </div>
    );
  }
  const innerW = W - padL - 8;
  const innerH = height - padB - padT;
  const x = (i: number) => padL + (i / (data.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - ((v - min) / (max - min)) * innerH;
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(data.length - 1).toFixed(1)},${y(min)} L${x(0).toFixed(1)},${y(min)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="Line chart" style={{ display: "block", fontFamily: font }}>
      {[min, (min + max) / 2, max].map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke={palette.line} />
          <text x={padL - 6} y={y(t) + 4} fontSize={10} textAnchor="end" fill={palette.muted}>{Math.round(t)}</text>
        </g>
      ))}
      <path d={area} fill={color} opacity={0.1} />
      <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.value)} r={3.5} fill={palette.surface} stroke={color} strokeWidth={2}>
          <title>{`${short(d.date)}: ${d.value}`}</title>
        </circle>
      ))}
      <text x={padL} y={height - 6} fontSize={10} fill={palette.muted}>{short(data[0].date)}</text>
      <text x={W - 8} y={height - 6} fontSize={10} textAnchor="end" fill={palette.muted}>{short(data[data.length - 1].date)}</text>
    </svg>
  );
}

export function HBars(props: { items: { label: string; value: number; display?: string; color?: string }[]; color?: string; empty?: string }) {
  const { items, color = palette.teal2, empty = "Nothing to show yet." } = props;
  const max = Math.max(...items.map((i) => i.value), 1);
  if (!items.length) return <div style={{ color: palette.muted, fontSize: 13, fontFamily: font }}>{empty}</div>;
  return (
    <div style={{ display: "grid", gap: 9, fontFamily: font }}>
      {items.map((it) => (
        <div key={it.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, gap: 10 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
            <span style={{ color: palette.muted, whiteSpace: "nowrap" }}>{it.display ?? it.value}</span>
          </div>
          <div style={{ height: 8, background: palette.soft, borderRadius: 6, marginTop: 4 }}>
            <div style={{ width: `${Math.max((it.value / max) * 100, it.value > 0 ? 3 : 0)}%`, height: 8, background: it.color ?? color, borderRadius: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Ring({ value, label, sub }: { value: number; label?: string; sub?: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  const color = clamped >= 80 ? palette.good : clamped >= 60 ? palette.warn : palette.bad;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontFamily: font }}>
      <svg viewBox="0 0 140 140" width={150} height={150} role="img" aria-label={`${clamped} out of 100`}>
        <circle cx={70} cy={70} r={r} fill="none" stroke={palette.soft} strokeWidth={13} />
        <circle
          cx={70}
          cy={70}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={13}
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
          transform="rotate(-90 70 70)"
        />
        <text x={70} y={72} textAnchor="middle" fontSize={32} fontWeight={700} fill={palette.text}>{clamped}</text>
        <text x={70} y={92} textAnchor="middle" fontSize={11} fill={palette.muted}>out of 100</text>
      </svg>
      {label && <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{label}</div>}
      {sub && <div style={{ color: palette.muted, fontSize: 12, textAlign: "center" }}>{sub}</div>}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "warn" | "bad" | "neutral" }) {
  const map = {
    good: { bg: "#e4f4ea", fg: palette.good },
    warn: { bg: "#fbf0d9", fg: palette.warn },
    bad: { bg: "#fbe5e3", fg: palette.bad },
    neutral: { bg: palette.soft, fg: palette.muted },
  }[tone];
  return (
    <span style={{ background: map.bg, color: map.fg, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 600, fontFamily: font, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export function Row({ children, last }: { children: ReactNode; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: last ? "none" : `1px solid ${palette.line}`, fontSize: 13, fontFamily: font }}>
      {children}
    </div>
  );
}
