import { DateTime } from "luxon";
import type { DB } from "../db";
import { computeDays, missingDays, summarize, type Anomaly, type DayResult, type PeriodSummary } from "../../shared/pay/engine";
import { buildContext, dateRangeMs, loadAbsences, loadShifts, prefsOf, toEngineShift, type ShiftDTO, type UserRow } from "./data";

/** Calcule les journées sur [from, to] en chargeant depuis le lundi de la semaine de `from` (heures sup. hebdo exactes). */
export function computeRange(db: DB, user: UserRow, from: string, to: string, now = Date.now()) {
  const ctx = buildContext(db, user, now);
  const loadFrom = DateTime.fromISO(from, { zone: user.timezone }).startOf("week").toISODate()!;
  const [a, b] = dateRangeMs(loadFrom, to, user.timezone);
  const shifts = loadShifts(db, user.id, a, b);
  const absences = loadAbsences(db, user.id, loadFrom, to);
  const days = computeDays(shifts.map(toEngineShift), absences, ctx);
  return { ctx, days, shifts, absences };
}

export interface DayView extends Omit<DayResult, "absence"> {
  absence?: { id: string; kind: string; paid: boolean; hours: number; note: string };
  shifts: ShiftDTO[];
}

export function dayViews(db: DB, user: UserRow, from: string, to: string): { days: DayView[]; missing: Anomaly[] } {
  const { ctx, days, shifts, absences } = computeRange(db, user, from, to);
  const out: DayView[] = [];
  for (const d of [...days.values()].sort((x, y) => x.date.localeCompare(y.date))) {
    if (d.date < from || d.date > to) continue;
    const abs = absences.find((a) => a.date === d.date);
    out.push({
      ...d,
      absence: abs ? { id: abs.id, kind: abs.kind, paid: abs.paid, hours: abs.hours, note: abs.note } : undefined,
      shifts: shifts.filter((s) => d.shiftIds.includes(s.id)),
    });
  }
  return { days: out, missing: missingDays(days, from, to, ctx) };
}

function brief(s: PeriodSummary) {
  return {
    workedMs: s.workedMs,
    breakMs: s.breakMs,
    overtimeMs: s.overtimeMs,
    amountCents: s.amountCents,
    daysWorked: s.daysWorked,
  };
}

export function dashboard(db: DB, user: UserRow, now = Date.now()) {
  const zone = user.timezone;
  const today = DateTime.fromMillis(now, { zone });
  const todayIso = today.toISODate()!;
  const weekStart = today.startOf("week").toISODate()!;
  const weekEnd = today.endOf("week").toISODate()!;
  const monthStart = today.startOf("month").toISODate()!;
  const monthEnd = today.endOf("month").toISODate()!;
  const lookback = today.minus({ days: 14 }).toISODate()!;
  const from = [weekStart, monthStart, lookback].sort()[0];
  const to = [weekEnd, monthEnd].sort()[1];

  const { ctx, days, shifts } = computeRange(db, user, from, to, now);
  const todaySum = summarize(days, todayIso, todayIso, ctx);
  const week = summarize(days, weekStart, weekEnd, ctx);
  const month = summarize(days, monthStart, monthEnd, ctx);

  const rules = ctx.rulesFor(todayIso);
  const prefs = prefsOf(user);
  const goalHours = prefs.weeklyGoalHours ?? rules.weeklyHours;

  const open = shifts.find((s) => s.endAt === null) ?? (db.prepare("SELECT id FROM shifts WHERE user_id = ? AND end_at IS NULL").get(user.id) ? loadOpenShift(db, user.id) : null);
  const openBreak = open?.breaks.find((b) => b.endAt === null) ?? null;
  const status = !open ? "off" : openBreak ? "break" : "working";

  const anomalies: Anomaly[] = [];
  for (const d of days.values()) if (d.date >= lookback && d.date <= todayIso) anomalies.push(...d.anomalies.filter((a) => a.code !== "incomplete"));
  anomalies.push(...missingDays(days, lookback, todayIso, ctx));
  anomalies.sort((a, b) => b.date.localeCompare(a.date));

  const recent = [...days.values()]
    .filter((d) => d.shiftIds.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map((d) => ({ date: d.date, firstStart: d.firstStart, lastEnd: d.lastEnd, workedMs: d.workedMs, open: d.open, status: d.status, amountCents: d.amountCents }));

  // Semaine jour par jour (mini graphique).
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const iso = today.startOf("week").plus({ days: i }).toISODate()!;
    const d = days.get(iso);
    return { date: iso, workedMs: d?.workedMs ?? 0 };
  });

  const todayDay = days.get(todayIso);
  return {
    now,
    today: todayIso,
    status,
    openShift: open,
    currentBreakStart: openBreak?.startAt ?? null,
    todayStart: todayDay?.firstStart ?? open?.startAt ?? null,
    todaySummary: { ...brief(todaySum), dailyHours: rules.dailyHours, lines: todaySum.lines },
    week: { ...brief(week), goalHours, days: weekDays },
    month: { ...brief(month), lines: month.lines },
    salaryType: rules.salaryType,
    hourlyRate: rules.hourlyRate,
    anomalies: anomalies.slice(0, 5),
    recent,
  };
}

export function loadOpenShift(db: DB, userId: string): ShiftDTO | null {
  const row = db.prepare("SELECT start_at FROM shifts WHERE user_id = ? AND end_at IS NULL").get(userId) as { start_at: number } | undefined;
  if (!row) return null;
  return loadShifts(db, userId, row.start_at, row.start_at + 1).find((s) => s.endAt === null) ?? null;
}

type Granularity = "day" | "week" | "month";

export function stats(db: DB, user: UserRow, from: string, to: string, now = Date.now()) {
  const zone = user.timezone;
  const todayIso = DateTime.fromMillis(now, { zone }).toISODate()!;
  const { ctx, days } = computeRange(db, user, from, to, now);
  const summary = summarize(days, from, to, ctx);

  const start = DateTime.fromISO(from, { zone });
  const end = DateTime.fromISO(to, { zone });
  const spanDays = Math.round(end.diff(start, "days").days) + 1;
  const granularity: Granularity = spanDays <= 31 ? "day" : spanDays <= 120 ? "week" : "month";

  const buckets: Array<{ key: string; label: string; from: string; to: string }> = [];
  let cur = granularity === "day" ? start : start.startOf(granularity);
  while (cur <= end) {
    const bEnd = granularity === "day" ? cur : cur.endOf(granularity);
    const bFrom = cur < start ? start : cur;
    const bTo = bEnd > end ? end : bEnd;
    buckets.push({
      key: cur.toISODate()!,
      label:
        granularity === "day"
          ? cur.setLocale("fr").toFormat("ccc d")
          : granularity === "week"
            ? `S${cur.weekNumber}`
            : cur.setLocale("fr").toFormat(spanDays > 400 ? "LLL yy" : "LLL"),
      from: bFrom.toISODate()!,
      to: bTo.toISODate()!,
    });
    cur = cur.plus({ [granularity + "s"]: 1 } as any).startOf(granularity);
  }
  const series = buckets.map((b) => {
    const s = summarize(days, b.from, b.to, ctx);
    return {
      key: b.key,
      label: b.label,
      workedH: +(s.workedMs / 3_600_000).toFixed(2),
      overtimeH: +(s.overtimeMs / 3_600_000).toFixed(2),
      breakH: +(s.breakMs / 3_600_000).toFixed(2),
      amount: s.amountCents / 100,
      daysWorked: s.daysWorked,
    };
  });

  // Période précédente de même durée pour comparaison.
  const prevTo = start.minus({ days: 1 });
  const prevFrom = prevTo.minus({ days: spanDays - 1 });
  const prev = computeRange(db, user, prevFrom.toISODate()!, prevTo.toISODate()!, now);
  const prevSummary = summarize(prev.days, prevFrom.toISODate()!, prevTo.toISODate()!, prev.ctx);

  // Moyennes : on ne compte que la partie écoulée de la période.
  const elapsedEnd = to < todayIso ? end : DateTime.fromISO(todayIso, { zone });
  const elapsedDays = Math.max(1, Math.round(elapsedEnd.diff(start, "days").days) + 1);
  const weeks = Math.max(1, elapsedDays / 7);
  const months = Math.max(1, elapsedDays / 30.44);

  return {
    from,
    to,
    granularity,
    summary,
    averages: {
      perWorkedDayMs: summary.daysWorked ? summary.workedMs / summary.daysWorked : 0,
      perWeekMs: summary.workedMs / weeks,
      amountPerMonthCents: spanDays >= 28 ? Math.round(summary.amountCents / months) : null,
      amountPerHourCents: summary.workedMs ? Math.round(summary.amountCents / (summary.workedMs / 3_600_000)) : 0,
    },
    previous: { from: prevFrom.toISODate(), to: prevTo.toISODate(), workedMs: prevSummary.workedMs, amountCents: prevSummary.amountCents, overtimeMs: prevSummary.overtimeMs },
    series,
  };
}
