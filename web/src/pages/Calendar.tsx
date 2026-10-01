import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DateTime } from "luxon";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDuration, formatMoney } from "@shared/format";
import { api } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import type { DaysResponse } from "@/lib/types";
import { capitalize, todayIso } from "@/lib/dates";
import { Card, PageHeader, Spinner, cx } from "@/components/ui";
import { DaySheet } from "@/components/DaySheet";

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  complete: { dot: "bg-ok", label: "Journée complète" },
  incomplete: { dot: "bg-warn", label: "Incomplète" },
  anomaly: { dot: "bg-bad", label: "Anomalie" },
  absence: { dot: "bg-info", label: "Congé / absence" },
  ongoing: { dot: "bg-accent", label: "En cours" },
};

export function CalendarPage() {
  const user = useUser();
  const zone = user.timezone;
  const [params, setParams] = useSearchParams();
  const today = todayIso(zone);
  const month = DateTime.fromISO((params.get("mois") ?? today.slice(0, 7)) + "-01", { zone });
  const selected = params.get("jour");
  const from = month.startOf("month").toISODate()!;
  const to = month.endOf("month").toISODate()!;

  const q = useQuery({ queryKey: ["days", from, to], queryFn: () => api.get<DaysResponse>(`/days?from=${from}&to=${to}`) });

  const byDate = useMemo(() => new Map(q.data?.days.map((d) => [d.date, d]) ?? []), [q.data]);
  const missing = useMemo(() => new Set(q.data?.missing.map((m) => m.date) ?? []), [q.data]);
  const totals = useMemo(() => {
    const days = q.data?.days ?? [];
    return { worked: days.reduce((s, d) => s + d.workedMs, 0), amount: days.reduce((s, d) => s + d.amountCents, 0), count: days.filter((d) => d.workedMs > 0).length };
  }, [q.data]);

  const go = (delta: number) => {
    const m = month.plus({ months: delta });
    setParams({ mois: m.toFormat("yyyy-LL") });
  };
  const open = (date: string | null) => {
    const p = new URLSearchParams(params);
    if (date) p.set("jour", date);
    else p.delete("jour");
    if (date) p.set("mois", date.slice(0, 7));
    setParams(p);
  };

  const lead = month.startOf("month").weekday - 1;
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: month.daysInMonth! }, (_, i) => month.set({ day: i + 1 }).toISODate()!)];

  return (
    <div className="animate-in">
      <PageHeader title="Calendrier" subtitle="Touchez un jour pour voir ou corriger le détail." />
      <Card className="p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={() => go(-1)} className="grid size-10 place-items-center rounded-full hover:bg-surface-2" aria-label="Mois précédent">
            <ChevronLeft className="size-5" />
          </button>
          <div className="text-center">
            <p className="text-lg font-semibold">{capitalize(month.setLocale("fr").toFormat("LLLL yyyy"))}</p>
            <p className="tabular text-sm text-ink-3">
              {formatDuration(totals.worked)} · {totals.count} j · {formatMoney(totals.amount, user.currency)}
            </p>
          </div>
          <button onClick={() => go(1)} className="grid size-10 place-items-center rounded-full hover:bg-surface-2" aria-label="Mois suivant">
            <ChevronRight className="size-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-ink-3">
          {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
            <div key={i} className="pb-2">
              {d}
            </div>
          ))}
        </div>
        {q.isLoading ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) => {
              if (!date) return <div key={`e${i}`} />;
              const d = byDate.get(date);
              const status = missing.has(date) ? "anomaly" : d && d.status !== "empty" ? d.status : null;
              const isToday = date === today;
              const future = date > today;
              return (
                <button
                  key={date}
                  onClick={() => open(date)}
                  className={cx(
                    "flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl transition hover:bg-surface-2 sm:aspect-[1/0.9]",
                    isToday && "ring-2 ring-accent",
                    selected === date && "bg-surface-2",
                    d?.holidayName && "bg-accent-soft/60",
                  )}
                >
                  <span className={cx("tabular text-[15px] font-semibold", future && "text-ink-3", isToday && "text-accent")}>{Number(date.slice(8))}</span>
                  {status ? <span className={cx("size-1.5 rounded-full", STATUS_STYLE[status].dot)} /> : <span className="size-1.5" />}
                  <span className="tabular hidden text-[11px] text-ink-3 sm:block">{d && d.workedMs > 0 ? formatDuration(d.workedMs).replace(" ", "") : " "}</span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 px-1 text-xs text-ink-3">
        {Object.entries(STATUS_STYLE)
          .filter(([k]) => k !== "ongoing")
          .map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={cx("size-2 rounded-full", v.dot)} /> {v.label}
            </span>
          ))}
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-line" /> Aucun pointage
        </span>
      </div>

      <DaySheet date={selected} onClose={() => open(null)} />
    </div>
  );
}
