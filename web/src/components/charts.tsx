import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReactNode } from "react";
import { cx } from "./ui";

/** Infobulle commune : texte en encre neutre, pastille de couleur pour l'identité. */
function ChartTooltip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-ink-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name} : <span className="tabular font-semibold text-ink">{format(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

const axis = { stroke: "var(--ink-3)", fontSize: 11, tickLine: false, axisLine: false } as const;

export interface BarSeries {
  key: string;
  name: string;
  color: string;
}

export function BarsChart({ data, series, format, height = 220, stacked, axisWidth = 44 }: { data: any[]; series: BarSeries[]; format: (v: number) => string; height?: number; stacked?: boolean; axisWidth?: number }) {
  return (
    <div style={{ height }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap="22%" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...axis} width={axisWidth} tickFormatter={(v) => format(v)} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip format={format} />} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={s.color}
              stackId={stacked ? "a" : undefined}
              radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
              stroke="var(--surface)"
              strokeWidth={stacked ? 1 : 0}
              maxBarSize={36}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} /> {i.label}
        </span>
      ))}
    </div>
  );
}

/** Répartition en barre 100 % (deux parts ou plus), avec libellés directs. */
export function SplitBar({ title, parts, format }: { title: string; parts: Array<{ label: string; value: number; color: string }>; format: (v: number) => string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-ink-2">{title}</p>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-surface-2">
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="first:rounded-l-full last:rounded-r-full" />)}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5 text-ink-2">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.label}
            <span className="tabular font-semibold text-ink">{format(p.value)}</span>
            <span className="tabular text-ink-3">{total > 0 ? `${Math.round((p.value / total) * 100)} %` : ""}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ChartCard({ title, subtitle, children, className }: { title: string; subtitle?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-3xl bg-surface p-5 shadow-card", className)}>
      <p className="font-semibold">{title}</p>
      {subtitle && <p className="text-sm text-ink-3">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}
