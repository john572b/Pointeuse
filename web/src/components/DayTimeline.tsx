import { DateTime } from "luxon";
import type { Shift } from "@/lib/types";
import { hhmm } from "@/lib/dates";

/** Frise visuelle d'une journée : travail (plein) et pauses (hachuré). */
export function DayTimeline({ shifts, zone, now }: { shifts: Shift[]; zone: string; now: number }) {
  if (shifts.length === 0) return null;
  const start = Math.min(...shifts.map((s) => s.startAt));
  const end = Math.max(...shifts.map((s) => s.endAt ?? now));
  // Échelle : de l'heure pleine précédente à l'heure pleine suivante.
  const from = DateTime.fromMillis(start, { zone }).startOf("hour").toMillis();
  const to = Math.max(DateTime.fromMillis(end, { zone }).plus({ hours: 1 }).startOf("hour").toMillis(), from + 3_600_000);
  const pct = (t: number) => ((t - from) / (to - from)) * 100;
  return (
    <div>
      <div className="relative h-3 overflow-hidden rounded-full bg-surface-2">
        {shifts.map((s) => (
          <div key={s.id}>
            <div className="absolute inset-y-0 rounded-full bg-accent" style={{ left: `${pct(s.startAt)}%`, width: `${pct(s.endAt ?? now) - pct(s.startAt)}%` }} />
            {s.breaks.map((b) => (
              <div
                key={b.id}
                className="absolute inset-y-0 bg-warn"
                style={{ left: `${pct(b.startAt)}%`, width: `${Math.max(0.8, pct(b.endAt ?? now) - pct(b.startAt))}%`, backgroundImage: "repeating-linear-gradient(45deg, transparent 0 3px, rgb(255 255 255 / .35) 3px 6px)" }}
                title="Pause"
              />
            ))}
          </div>
        ))}
      </div>
      <div className="tabular mt-1.5 flex justify-between text-xs text-ink-3">
        <span>{hhmm(from, zone)}</span>
        <span>{hhmm(to, zone)}</span>
      </div>
    </div>
  );
}
