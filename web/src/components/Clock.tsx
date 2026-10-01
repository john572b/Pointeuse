import { Coffee, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { formatDuration } from "@shared/format";
import { api } from "@/lib/api";
import { useClock, useInvalidateData, useNow } from "@/lib/hooks";
import type { Dashboard } from "@/lib/types";
import { hhmm } from "@/lib/dates";
import { Button, cx } from "./ui";

/** Valeurs « en direct » à partir du dernier état serveur. */
export function useLive(d: Dashboard | undefined) {
  const now = useNow();
  if (!d) return null;
  const delta = Math.max(0, now - d.now);
  const working = d.status === "working" ? delta : 0;
  const onBreak = d.status === "break" ? delta : 0;
  return {
    now,
    today: d.todaySummary.workedMs + working,
    todayBreak: d.todaySummary.breakMs + onBreak,
    week: d.week.workedMs + working,
    month: d.month.workedMs + working,
    breakElapsed: d.currentBreakStart ? now - d.currentBreakStart : 0,
    // Si l'on est déjà en heures sup., chaque seconde travaillée en est une (recalcul exact à chaque rafraîchissement).
    overtime: d.todaySummary.overtimeMs + (d.todaySummary.overtimeMs > 0 ? working : 0),
  };
}

export function StatusPill({ status, size = "md" }: { status: Dashboard["status"]; size?: "md" | "lg" }) {
  const map = {
    working: { label: "En service", cls: "bg-ok-soft text-ok", dot: "bg-ok pulse-dot text-ok" },
    break: { label: "En pause", cls: "bg-warn-soft text-warn", dot: "bg-warn" },
    off: { label: "Hors service", cls: "bg-surface-2 text-ink-3", dot: "bg-ink-3" },
  }[status];
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-full font-semibold uppercase tracking-wide", map.cls, size === "lg" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs")}>
      <span className={cx("size-2 rounded-full", map.dot)} />
      {map.label}
    </span>
  );
}

const LABELS = {
  off: { text: "Commencer ma journée", icon: Play, action: "start" as const },
  working: { text: "Terminer ma journée", icon: Square, action: "stop" as const },
  break: { text: "Reprendre le travail", icon: Play, action: "break/end" as const },
};

/** Bouton principal + action secondaire (pause). Une seule action évidente à la fois. */
export function ClockActions({ d, size = "lg" }: { d: Dashboard; size?: "lg" | "xl" }) {
  const clock = useClock();
  const invalidate = useInvalidateData();
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const cfg = LABELS[d.status];
  const Icon = cfg.icon;

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 7000);
    return () => clearTimeout(t);
  }, [undo]);

  const main = () => {
    const openId = d.openShift?.id;
    clock.mutate(cfg.action, {
      onSuccess: () => {
        if (cfg.action === "stop" && openId) setUndo({ id: openId, label: "Journée terminée." });
      },
    });
  };

  const undoStop = async () => {
    if (!undo) return;
    const days = await api.get<{ days: Array<{ shifts: any[] }> }>(`/days?from=${DateTime.fromISO(d.today).minus({ days: 1 }).toISODate()}&to=${d.today}`).catch(() => null);
    const s = days?.days.flatMap((x) => x.shifts).find((x) => x.id === undo.id);
    setUndo(null);
    if (!s) return;
    await api.put(`/shifts/${s.id}`, { startAt: s.startAt, endAt: null, breaks: s.breaks, note: s.note, bonusIds: s.bonusIds });
    invalidate();
  };

  return (
    <div className="space-y-3">
      <button
        onClick={main}
        disabled={clock.isPending}
        className={cx(
          "group flex w-full items-center justify-center gap-3 rounded-[22px] font-semibold uppercase tracking-wide shadow-lg transition active:scale-[0.98] disabled:opacity-70",
          size === "xl" ? "h-20 text-lg" : "h-16 text-base",
          d.status === "off" && "bg-accent text-accent-ink shadow-accent/25",
          d.status === "working" && "bg-ink text-bg shadow-black/10",
          d.status === "break" && "bg-ok text-white shadow-ok/25 dark:text-black",
        )}
      >
        <Icon className={cx(size === "xl" ? "size-6" : "size-5", "fill-current")} />
        {cfg.text}
      </button>
      {d.status === "working" && (
        <Button variant="secondary" className="w-full" onClick={() => clock.mutate("break/start")} disabled={clock.isPending}>
          <Coffee className="size-4" /> Prendre une pause
        </Button>
      )}
      {clock.error && <p className="text-center text-sm text-bad">{(clock.error as Error).message}</p>}
      {undo && (
        <div className="animate-in fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-bg shadow-xl lg:bottom-8">
          <span>{undo.label}</span>
          <button onClick={undoStop} className="font-semibold text-accent">
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}

/** Phrase explicative de l'état courant. */
export function StatusSentence({ d, live, zone }: { d: Dashboard; live: NonNullable<ReturnType<typeof useLive>>; zone: string }) {
  if (d.status === "working" && d.openShift) return <>Depuis {hhmm(d.openShift.startAt, zone)}</>;
  if (d.status === "break") return <>En pause depuis {formatDuration(live.breakElapsed)}</>;
  if (d.todayStart) return <>Journée terminée</>;
  return <>Prêt à commencer ?</>;
}
