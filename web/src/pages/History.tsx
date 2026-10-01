import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileDown, FileText, History, Search } from "lucide-react";
import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDuration, formatMoney } from "@shared/format";
import { ABSENCE_LABELS } from "@shared/pay/engine";
import { api } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import type { DaysResponse } from "@/lib/types";
import { capitalize, hhmm, shortDate } from "@/lib/dates";
import { Card, EmptyState, Input, PageHeader, Segmented, Select, Spinner, cx } from "@/components/ui";
import { DaySheet } from "@/components/DaySheet";
import { DayDot } from "./Dashboard";

type Scope = "month" | "year";
type Filter = "all" | "anomalies" | "overtime" | "night" | "weekend" | "holiday" | "absence";
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Tous les jours" },
  { value: "anomalies", label: "Avec anomalie" },
  { value: "overtime", label: "Avec heures sup." },
  { value: "night", label: "Avec heures de nuit" },
  { value: "weekend", label: "Week-end" },
  { value: "holiday", label: "Jours fériés" },
  { value: "absence", label: "Congés / absences" },
];

export function HistoryPage() {
  const user = useUser();
  const zone = user.timezone;
  const [scope, setScope] = useState<Scope>("month");
  const [cursor, setCursor] = useState(() => DateTime.now().setZone(zone).startOf("month"));
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const start = cursor.startOf(scope);
  const from = start.toISODate()!;
  const to = start.endOf(scope).toISODate()!;
  const q = useQuery({ queryKey: ["days", from, to], queryFn: () => api.get<DaysResponse>(`/days?from=${from}&to=${to}`), placeholderData: keepPreviousData });

  const missing = useMemo(() => new Set(q.data?.missing.map((m) => m.date)), [q.data]);
  const rows = useMemo(() => {
    const days = (q.data?.days ?? []).filter((d) => d.shifts.length > 0 || d.absence || missing.has(d.date));
    const extra = (q.data?.missing ?? []).filter((m) => !days.some((d) => d.date === m.date)).map((m) => ({ date: m.date, missingOnly: true as const }));
    const all = [...days.map((d) => ({ ...d, missingOnly: false as const })), ...extra].sort((a, b) => b.date.localeCompare(a.date));
    const s = search.trim().toLowerCase();
    return all.filter((d) => {
      if (d.missingOnly) return (filter === "all" || filter === "anomalies") && !s;
      if (s && !d.shifts.some((x) => x.note.toLowerCase().includes(s)) && !(d.holidayName ?? "").toLowerCase().includes(s)) return false;
      switch (filter) {
        case "anomalies":
          return d.anomalies.length > 0 || missing.has(d.date);
        case "overtime":
          return d.overtimeMs > 0;
        case "night":
          return d.nightMs > 0;
        case "weekend":
          return d.weekendMs > 0;
        case "holiday":
          return !!d.holidayName;
        case "absence":
          return !!d.absence;
        default:
          return true;
      }
    });
  }, [q.data, filter, search, missing]);

  const totals = rows.reduce((t, d) => (d.missingOnly ? t : { worked: t.worked + d.workedMs, amount: t.amount + d.amountCents }), { worked: 0, amount: 0 });
  const label = scope === "month" ? capitalize(start.setLocale("fr").toFormat("LLLL yyyy")) : start.toFormat("yyyy");

  return (
    <div className="animate-in">
      <PageHeader title="Historique" subtitle="Tous vos pointages, filtrables et exportables." back="/" />

      <div className="space-y-3">
        <Segmented value={scope} onChange={(v) => { setScope(v); setCursor(cursor.startOf(v)); }} options={[{ value: "month", label: "Par mois" }, { value: "year", label: "Par année" }]} />
        <div className="flex items-center justify-between rounded-2xl bg-surface px-2 py-1.5 shadow-card">
          <button onClick={() => setCursor(cursor.minus({ [scope + "s"]: 1 } as any))} className="grid size-10 place-items-center rounded-full hover:bg-surface-2" aria-label="Précédent">
            <ChevronLeft className="size-5" />
          </button>
          <span className="font-semibold">{label}</span>
          <button onClick={() => setCursor(cursor.plus({ [scope + "s"]: 1 } as any))} className="grid size-10 place-items-center rounded-full hover:bg-surface-2" aria-label="Suivant">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Type de journée">
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input placeholder="Rechercher une note" className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between px-1">
        <p className="tabular text-sm text-ink-3">
          {formatDuration(totals.worked)} · {formatMoney(totals.amount, user.currency)}
        </p>
        <div className="flex gap-2">
          <a href={`/api/export/csv?from=${from}&to=${to}`} className="flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-sm font-medium shadow-card hover:bg-surface-2" download>
            <FileDown className="size-4" /> CSV
          </a>
          <Link to={`/rapport?from=${from}&to=${to}`} target="_blank" className="flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-sm font-medium shadow-card hover:bg-surface-2">
            <FileText className="size-4" /> PDF
          </Link>
        </div>
      </div>

      <Card className={cx("mt-3 p-0 transition-opacity", q.isFetching && "opacity-60")}>
        {q.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState icon={<History />} title="Aucun pointage" text="Rien ne correspond à ces critères sur cette période." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((d) =>
              d.missingOnly ? (
                <li key={d.date}>
                  <button onClick={() => setOpen(d.date)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-surface-2">
                    <DayDot status="anomaly" />
                    <div className="flex-1">
                      <p className="font-medium">{capitalize(shortDate(d.date))}</p>
                      <p className="text-sm text-bad">Aucun pointage</p>
                    </div>
                  </button>
                </li>
              ) : (
                <li key={d.date}>
                  <button onClick={() => setOpen(d.date)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-surface-2">
                    <DayDot status={missing.has(d.date) ? "anomaly" : d.status} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {capitalize(shortDate(d.date))}
                        {d.holidayName && <span className="ml-2 text-xs font-medium text-accent">{d.holidayName}</span>}
                      </p>
                      <p className="tabular truncate text-sm text-ink-3">
                        {d.shifts.length > 0
                          ? `${d.firstStart ? hhmm(d.firstStart, zone) : ""} → ${d.open ? "en cours" : d.lastEnd ? hhmm(d.lastEnd, zone) : ""} · pause ${formatDuration(d.breakMs)}`
                          : d.absence
                            ? ABSENCE_LABELS[d.absence.kind as keyof typeof ABSENCE_LABELS]
                            : ""}
                        {d.overtimeMs > 0 && ` · +${formatDuration(d.overtimeMs)} sup.`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular font-semibold">{formatDuration(d.workedMs)}</p>
                      <p className="tabular text-xs text-ink-3">{formatMoney(d.amountCents, user.currency)}</p>
                    </div>
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
      <DaySheet date={open} onClose={() => setOpen(null)} />
    </div>
  );
}
