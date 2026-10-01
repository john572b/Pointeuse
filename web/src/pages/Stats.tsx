import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, BarChart3 } from "lucide-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { formatDuration, formatMoney, formatNumber } from "@shared/format";
import { api } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import type { StatsResponse } from "@/lib/types";
import { Card, EmptyState, Input, PageHeader, SectionTitle, Sheet, Spinner, cx } from "@/components/ui";
import { BarsChart, ChartCard, Legend, SplitBar } from "@/components/charts";
import { PayBreakdown } from "@/components/PayBreakdown";

type Preset = "today" | "week" | "month" | "3m" | "6m" | "year" | "lastyear" | "custom";
const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "today", label: "Aujourd'hui" },
  { value: "week", label: "Semaine" },
  { value: "month", label: "Mois" },
  { value: "3m", label: "3 mois" },
  { value: "6m", label: "6 mois" },
  { value: "year", label: "Cette année" },
  { value: "lastyear", label: "Année précédente" },
  { value: "custom", label: "Personnalisée" },
];

function rangeFor(p: Preset, zone: string, custom: { from: string; to: string }) {
  const now = DateTime.now().setZone(zone);
  const iso = (d: DateTime) => d.toISODate()!;
  switch (p) {
    case "today":
      return { from: iso(now), to: iso(now) };
    case "week":
      return { from: iso(now.startOf("week")), to: iso(now.endOf("week")) };
    case "month":
      return { from: iso(now.startOf("month")), to: iso(now.endOf("month")) };
    case "3m":
      return { from: iso(now.minus({ months: 2 }).startOf("month")), to: iso(now.endOf("month")) };
    case "6m":
      return { from: iso(now.minus({ months: 5 }).startOf("month")), to: iso(now.endOf("month")) };
    case "year":
      return { from: iso(now.startOf("year")), to: iso(now.endOf("year")) };
    case "lastyear":
      return { from: iso(now.minus({ years: 1 }).startOf("year")), to: iso(now.minus({ years: 1 }).endOf("year")) };
    case "custom":
      return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
  }
}

const h = (ms: number) => formatDuration(ms);
const hShort = (v: number) => `${formatNumber(v, 0)} h`;
const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function StatsPage() {
  const user = useUser();
  const zone = user.timezone;
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState(() => {
    const now = DateTime.now().setZone(zone);
    return { from: now.minus({ years: 1 }).toISODate()!, to: now.toISODate()! };
  });
  const [payOpen, setPayOpen] = useState(false);
  const range = rangeFor(preset, zone, custom);
  const q = useQuery({
    queryKey: ["stats", range.from, range.to],
    queryFn: () => api.get<StatsResponse>(`/stats?from=${range.from}&to=${range.to}`),
    placeholderData: keepPreviousData,
  });
  const money = (c: number) => formatMoney(c, user.currency);
  const moneyShort = (v: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: user.currency, maximumFractionDigits: 0, notation: v >= 10000 ? "compact" : "standard" }).format(v);

  const s = q.data?.summary;
  return (
    <div className="animate-in">
      <PageHeader title="Statistiques" subtitle="Analysez votre temps de travail et votre rémunération." />

      <div className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={cx("h-9 whitespace-nowrap rounded-full px-4 text-sm font-medium transition", preset === p.value ? "bg-ink text-bg" : "bg-surface text-ink-2 shadow-card hover:text-ink")}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {preset === "custom" && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <Input type="date" aria-label="Du" value={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
          <Input type="date" aria-label="Au" value={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
        </div>
      )}

      {q.isLoading || !q.data || !s ? (
        q.error ? <EmptyState icon={<BarChart3 />} title="Statistiques indisponibles" text={(q.error as Error).message} /> : <Spinner />
      ) : (
        <div className={cx("space-y-4 transition-opacity", q.isFetching && "opacity-60")}>
          <div className="grid grid-cols-2 gap-4">
            <Kpi label="Heures travaillées" value={h(s.workedMs)} delta={delta(s.workedMs, q.data.previous.workedMs)} big />
            <button className="text-left" onClick={() => setPayOpen(true)}>
              <Kpi label="Salaire estimé" value={money(s.amountCents)} delta={delta(s.amountCents, q.data.previous.amountCents)} big hint="Voir le calcul" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Moyenne / jour" value={h(q.data.averages.perWorkedDayMs)} />
            <Kpi label="Moyenne / semaine" value={h(q.data.averages.perWeekMs)} />
            <Kpi label="Heures sup." value={h(s.overtimeMs)} />
            <Kpi label="Temps de pause" value={h(s.breakMs)} />
            <Kpi label="Jours travaillés" value={String(s.daysWorked)} />
            <Kpi label="Jours de congé" value={String(s.leaveDays)} />
            {q.data.averages.amountPerMonthCents !== null ? <Kpi label="Salaire moyen / mois" value={money(q.data.averages.amountPerMonthCents)} /> : <Kpi label="Heures de nuit" value={h(s.nightMs)} />}
            <Kpi label="Gain moyen / heure" value={money(q.data.averages.amountPerHourCents)} />
          </div>

          {s.workedMs === 0 ? (
            <Card>
              <EmptyState icon={<BarChart3 />} title="Pas encore de données sur cette période" text="Vos graphiques apparaîtront dès vos premiers pointages." />
            </Card>
          ) : (
            <>
              {q.data.series.length > 1 && (
                <>
                  <ChartCard title="Heures travaillées" subtitle={granularityLabel(q.data.granularity)}>
                    <BarsChart
                      stacked
                      data={q.data.series.map((x) => ({ ...x, normalH: +(x.workedH - x.overtimeH).toFixed(2) }))}
                      series={[
                        { key: "normalH", name: "Normales", color: "var(--series-1)" },
                        { key: "overtimeH", name: "Supplémentaires", color: "var(--series-2)" },
                      ]}
                      format={hShort}
                    />
                    <Legend items={[{ label: "Heures normales", color: "var(--series-1)" }, { label: "Heures supplémentaires", color: "var(--series-2)" }]} />
                  </ChartCard>
                  <ChartCard title="Salaire estimé" subtitle={granularityLabel(q.data.granularity)}>
                    <BarsChart data={q.data.series} series={[{ key: "amount", name: "Salaire estimé", color: "var(--series-3)" }]} format={moneyShort} axisWidth={64} />
                  </ChartCard>
                </>
              )}

              <ChartCard title="Répartition">
                <div className="space-y-6">
                  <SplitBar title="Normales / supplémentaires" format={h} parts={[{ label: "Normales", value: s.normalMs, color: "var(--series-1)" }, { label: "Sup.", value: s.overtimeMs, color: "var(--series-2)" }]} />
                  <SplitBar title="Jour / nuit" format={h} parts={[{ label: "Jour", value: s.workedMs - s.nightMs, color: "var(--series-4)" }, { label: "Nuit", value: s.nightMs, color: "var(--series-7)" }]} />
                  <SplitBar title="Semaine / week-end" format={h} parts={[{ label: "Semaine", value: s.workedMs - s.weekendMs, color: "var(--series-1)" }, { label: "Week-end", value: s.weekendMs, color: "var(--series-5)" }]} />
                </div>
              </ChartCard>

              <ChartCard title="Par jour de la semaine" subtitle="Total des heures travaillées">
                <BarsChart height={180} data={DAYS.map((label, i) => ({ label, hours: +(s.byWeekday[i + 1] / 60).toFixed(2) }))} series={[{ key: "hours", name: "Heures", color: "var(--series-1)" }]} format={hShort} />
              </ChartCard>

              <MajorationsCard extra={s.extraByComponent} money={money} />
            </>
          )}
        </div>
      )}

      <Sheet open={payOpen} onClose={() => setPayOpen(false)} title="Détail du salaire estimé">
        {s && <PayBreakdown lines={s.lines} totalCents={s.amountCents} currency={user.currency} />}
      </Sheet>
    </div>
  );
}

function MajorationsCard({ extra, money }: { extra: Partial<Record<string, number>>; money: (c: number) => string }) {
  const items = [
    { key: "overtime", label: "Heures supplémentaires", color: "var(--series-2)" },
    { key: "weekday", label: "Jours (samedi, dimanche…)", color: "var(--series-5)" },
    { key: "night", label: "Nuit", color: "var(--series-7)" },
    { key: "holiday", label: "Jours fériés", color: "var(--series-3)" },
  ].map((i) => ({ ...i, value: extra[i.key] ?? 0 }));
  const max = Math.max(...items.map((i) => i.value), 1);
  if (items.every((i) => i.value === 0)) return null;
  return (
    <ChartCard title="Répartition des majorations" subtitle="Montant gagné grâce à chaque majoration">
      <ul className="space-y-3">
        {items
          .filter((i) => i.value > 0)
          .sort((a, b) => b.value - a.value)
          .map((i) => (
            <li key={i.key}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-ink-2">{i.label}</span>
                <span className="tabular font-semibold">{money(i.value)}</span>
              </div>
              <div className="h-2 rounded-full bg-surface-2">
                <div className="h-2 rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: i.color }} />
              </div>
            </li>
          ))}
      </ul>
    </ChartCard>
  );
}

function granularityLabel(g: string) {
  return g === "day" ? "Par jour" : g === "week" ? "Par semaine" : "Par mois";
}

function delta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return (cur - prev) / prev;
}

function Kpi({ label, value, delta, big, hint }: { label: string; value: string; delta?: number | null; big?: boolean; hint?: string }) {
  return (
    <Card className={cx("h-full", big ? "p-5" : "p-4")}>
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className={cx("tabular mt-1 font-bold tracking-tight", big ? "text-2xl" : "text-lg")}>{value}</p>
      {delta !== undefined && delta !== null && (
        <p className={cx("mt-1 flex items-center gap-0.5 text-xs font-medium", delta >= 0 ? "text-ok" : "text-ink-3")}>
          {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {delta >= 0 ? "+" : ""}
          {Math.round(delta * 100)} % vs période précédente
        </p>
      )}
      {hint && <p className="mt-1 text-xs font-medium text-accent">{hint}</p>}
    </Card>
  );
}
