import { useQuery } from "@tanstack/react-query";
import { Coffee, LogIn, LogOut, Pencil } from "lucide-react";
import { useState } from "react";
import { formatDuration } from "@shared/format";
import { api } from "@/lib/api";
import { useDashboard, useUser } from "@/lib/hooks";
import type { DaysResponse, Shift } from "@/lib/types";
import { hhmm } from "@/lib/dates";
import { Card, EmptyState, Spinner } from "@/components/ui";
import { ClockActions, StatusPill, StatusSentence, isIntervention, useLive } from "@/components/Clock";
import { ProgressRing } from "@/components/ProgressRing";
import { DayTimeline } from "@/components/DayTimeline";
import { DaySheet } from "@/components/DaySheet";

/** Écran de pointage plein écran : un chrono, un bouton. */
export function ClockPage() {
  const user = useUser();
  const { data: d, isLoading } = useDashboard();
  const live = useLive(d);
  const [edit, setEdit] = useState(false);
  const days = useQuery({
    queryKey: ["days", d?.today, d?.today, d?.status],
    queryFn: () => api.get<DaysResponse>(`/days?from=${d!.today}&to=${d!.today}`),
    enabled: !!d,
  });

  if (isLoading || !d || !live) return <Spinner />;
  const zone = user.timezone;
  const goal = d.todaySummary.dailyHours * 3_600_000;
  const shifts: Shift[] = days.data?.days[0]?.shifts ?? (d.openShift ? [d.openShift as Shift] : []);
  const events = shifts.flatMap((s) => [
    { t: s.startAt, label: "Début de journée", icon: LogIn },
    ...s.breaks.flatMap((b) => [{ t: b.startAt, label: "Début de pause", icon: Coffee }, ...(b.endAt ? [{ t: b.endAt, label: "Reprise", icon: LogIn }] : [])]),
    ...(s.endAt ? [{ t: s.endAt, label: "Fin de journée", icon: LogOut }] : []),
  ]);

  return (
    <div className="animate-in mx-auto flex max-w-md flex-col items-center">
      <StatusPill status={d.status} intervention={isIntervention(d)} size="lg" />
      <p className="mt-3 text-[15px] text-ink-3">
        <StatusSentence d={d} live={live} zone={zone} />
      </p>

      <div className="my-8">
        <ProgressRing value={goal ? live.today / goal : 0} size={264} stroke={14}>
          <div className="text-center">
            <p className="tabular text-[44px] font-bold leading-none tracking-tight">{formatDuration(live.today)}</p>
            <p className="tabular mt-1 text-lg text-ink-3">{String(Math.floor((live.today / 1000) % 60)).padStart(2, "0")} s</p>
            <p className="mt-3 text-sm text-ink-3">sur {d.todaySummary.dailyHours} h prévues</p>
          </div>
        </ProgressRing>
      </div>

      <div className="w-full">
        <ClockActions d={d} size="xl" />
      </div>

      {d.status === "break" && (
        <p className="mt-4 text-center text-sm text-ink-3">
          Pause en cours : <b className="tabular text-ink">{formatDuration(live.breakElapsed, { seconds: true })}</b>
        </p>
      )}

      <Card className="mt-8 w-full">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-semibold">Aujourd'hui</p>
          {shifts.length > 0 && (
            <button onClick={() => setEdit(true)} className="flex items-center gap-1.5 text-sm font-medium text-accent">
              <Pencil className="size-3.5" /> Corriger
            </button>
          )}
        </div>
        {shifts.length === 0 ? (
          <EmptyState icon={<LogIn />} title="Aucun pointage aujourd'hui" text="Votre journée apparaîtra ici dès que vous l'aurez commencée." />
        ) : (
          <>
            <DayTimeline shifts={shifts} zone={zone} now={live.now} />
            <ul className="mt-5 space-y-3">
              {events.map((e, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-xl bg-surface-2 text-ink-2">
                    <e.icon className="size-4" />
                  </span>
                  <span className="flex-1 text-[15px]">{e.label}</span>
                  <span className="tabular font-semibold">{hhmm(e.t, zone)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-between border-t border-line pt-4 text-sm">
              <span className="text-ink-3">Temps de pause</span>
              <span className="tabular font-semibold">{formatDuration(live.todayBreak)}</span>
            </div>
          </>
        )}
      </Card>
      <DaySheet date={edit ? d.today : null} onClose={() => setEdit(false)} />
    </div>
  );
}
