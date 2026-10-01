import { DateTime } from "luxon";
import { type PayRules, effectiveHourlyRate, parseHHMM } from "./rules";

/**
 * Moteur de calcul du temps de travail et du salaire estimé.
 *
 * Principes :
 *  - les instants sont en millisecondes UTC, les règles calendaires dans le fuseau `zone` ;
 *  - une journée de travail est rattachée à la date locale de son début (une nuit
 *    22:00 → 06:00 compte pour la veille), mais les majorations « jour de la semaine »,
 *    « nuit » et « férié » s'appliquent à l'instant réellement travaillé ;
 *  - les heures supplémentaires sont attribuées chronologiquement (cumul jour / semaine ISO) ;
 *  - les montants sont arrondis au centime ligne par ligne, et le total est la somme des lignes
 *    (le détail affiché correspond donc toujours exactement au total).
 */

export interface BreakInput {
  startAt: number;
  endAt: number | null;
}
export interface ShiftInput {
  id: string;
  startAt: number;
  endAt: number | null;
  breaks: BreakInput[];
  bonusIds?: string[];
  /** intervention : appel d'urgence hors horaires — chaque minute compte en heures supplémentaires. */
  kind?: "normal" | "intervention";
}
export type AbsenceKind = "conge" | "maladie" | "recup" | "sans_solde" | "autre";
export interface AbsenceInput {
  date: string;
  kind: AbsenceKind;
  paid: boolean;
  hours: number;
}

export interface EngineContext {
  zone: string;
  now: number;
  /** date ISO locale → nom du jour férié */
  holidays: Map<string, string>;
  /** Règles applicables à une date ISO locale (versionnage). */
  rulesFor: (date: string) => PayRules;
  /** Date de création du compte (ISO), pour ne pas signaler d'anomalies avant. */
  since?: string;
}

export type ComponentKey = "weekday" | "night" | "holiday" | "overtime";
export interface PayComponent {
  key: ComponentKey;
  label: string;
  percent: number;
}

export interface PayLine {
  key: string;
  kind: "work" | "bonus" | "absence" | "base";
  label: string;
  minutes: number;
  /** Quantité pour les primes (jours, mois…) */
  quantity?: number;
  unitLabel?: string;
  rate: number;
  /** Multiplicateur appliqué au taux (1,25 pour +25 %, 0,25 pour un supplément sur salaire mensuel). */
  factor: number;
  percent: number;
  amountCents: number;
  note?: string;
}

export type AnomalyCode = "open_shift" | "open_break" | "long_break" | "missing_day" | "incomplete";
export interface Anomaly {
  code: AnomalyCode;
  date: string;
  message: string;
  shiftId?: string;
}

export interface DayResult {
  date: string;
  shiftIds: string[];
  firstStart: number | null;
  lastEnd: number | null;
  open: boolean;
  onBreak: boolean;
  workedMs: number;
  breakMs: number;
  normalMs: number;
  overtimeMs: number;
  nightMs: number;
  weekendMs: number;
  holidayMs: number;
  holidayName?: string;
  lines: PayLine[];
  amountCents: number;
  extraByComponent: Partial<Record<ComponentKey, number>>;
  anomalies: Anomaly[];
  absence?: AbsenceInput;
  status: "complete" | "incomplete" | "anomaly" | "absence" | "empty" | "ongoing";
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY_NAMES = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export function localDate(ms: number, zone: string): string {
  return DateTime.fromMillis(ms, { zone }).toISODate()!;
}

export function weekKeyOf(date: string, zone: string): string {
  const d = DateTime.fromISO(date, { zone });
  return `${d.weekYear}-W${String(d.weekNumber).padStart(2, "0")}`;
}

/** Intervalles travaillés d'une journée = [début, fin] − pauses (fins ouvertes bornées à `now`). */
export function workIntervals(shift: ShiftInput, now: number): Array<[number, number]> {
  const end = shift.endAt ?? Math.max(now, shift.startAt);
  const breaks = shift.breaks
    .map((b) => [Math.max(b.startAt, shift.startAt), Math.min(b.endAt ?? end, end)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  let cursor = shift.startAt;
  for (const [bs, be] of breaks) {
    if (bs > cursor) out.push([cursor, bs]);
    cursor = Math.max(cursor, be);
  }
  if (end > cursor) out.push([cursor, end]);
  return out;
}

export function breakDuration(shift: ShiftInput, now: number): number {
  const end = shift.endAt ?? Math.max(now, shift.startAt);
  let total = 0;
  for (const b of shift.breaks) {
    const s = Math.max(b.startAt, shift.startAt);
    const e = Math.min(b.endAt ?? end, end);
    if (e > s) total += e - s;
  }
  return total;
}

/** Une minute du jour (0..1439) est-elle dans la plage de nuit ? Gère les plages qui traversent minuit. */
export function isNightMinute(minuteOfDay: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return minuteOfDay >= start && minuteOfDay < end;
  return minuteOfDay >= start || minuteOfDay < end;
}

interface Segment {
  start: number;
  end: number;
  weekday: number;
  night: boolean;
  holiday: boolean;
  calendarDate: string;
}

/** Découpe un intervalle aux frontières de minuit et de nuit. */
function segmentize(a: number, b: number, rules: PayRules, ctx: EngineContext): Segment[] {
  const cuts = new Set<number>([a, b]);
  const nStart = parseHHMM(rules.night.start);
  const nEnd = parseHHMM(rules.night.end);
  let day = DateTime.fromMillis(a, { zone: ctx.zone }).startOf("day");
  const last = DateTime.fromMillis(b, { zone: ctx.zone }).startOf("day");
  while (day <= last) {
    const candidates = [day.toMillis()];
    if (rules.night.enabled) {
      candidates.push(
        day.set({ hour: Math.floor(nStart / 60), minute: nStart % 60 }).toMillis(),
        day.set({ hour: Math.floor(nEnd / 60), minute: nEnd % 60 }).toMillis(),
      );
    }
    for (const c of candidates) if (c > a && c < b) cuts.add(c);
    day = day.plus({ days: 1 }).startOf("day");
  }
  const sorted = [...cuts].sort((x, y) => x - y);
  const segs: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i];
    const e = sorted[i + 1];
    if (e <= s) continue;
    const mid = DateTime.fromMillis(s + (e - s) / 2, { zone: ctx.zone });
    const date = mid.toISODate()!;
    segs.push({
      start: s,
      end: e,
      weekday: mid.weekday,
      night: rules.night.enabled && isNightMinute(mid.hour * 60 + mid.minute, nStart, nEnd),
      holiday: ctx.holidays.has(date),
      calendarDate: date,
    });
  }
  return segs;
}

function componentsFor(seg: Segment, overtime: boolean, rules: PayRules, ctx: EngineContext, intervention = false): PayComponent[] {
  const comps: PayComponent[] = [];
  if (seg.holiday) {
    comps.push({ key: "holiday", label: ctx.holidays.get(seg.calendarDate) ?? "Jour férié", percent: rules.holidayPercent });
  } else {
    const p = rules.weekdayPercents[String(seg.weekday) as keyof PayRules["weekdayPercents"]] ?? 0;
    if (p !== 0) comps.push({ key: "weekday", label: DAY_NAMES[seg.weekday], percent: p });
  }
  if (seg.night && rules.night.percent !== 0) comps.push({ key: "night", label: "Nuit", percent: rules.night.percent });
  if (intervention) comps.push({ key: "overtime", label: "Intervention", percent: rules.overtime.percent });
  else if (overtime) comps.push({ key: "overtime", label: "Heures sup.", percent: rules.overtime.percent });
  return comps;
}

function totalPercent(comps: PayComponent[], stacking: PayRules["stacking"]): number {
  if (comps.length === 0) return 0;
  if (stacking === "add") return comps.reduce((s, c) => s + c.percent, 0);
  return Math.max(0, ...comps.map((c) => c.percent));
}

const toCents = (v: number) => Math.round(v * 100);

interface Piece {
  ms: number;
  comps: PayComponent[];
  overtime: boolean;
  rules: PayRules;
}

function piecesToLines(pieces: Piece[]): { lines: PayLine[]; extra: Partial<Record<ComponentKey, number>> } {
  const groups = new Map<string, { ms: number; comps: PayComponent[]; overtime: boolean; rules: PayRules; rate: number; pct: number }>();
  const extra: Partial<Record<ComponentKey, number>> = {};
  for (const p of pieces) {
    const rate = effectiveHourlyRate(p.rules);
    const pct = totalPercent(p.comps, p.rules.stacking);
    const key = `${p.rules.salaryType}|${rate}|${pct}|${p.comps.map((c) => `${c.key}:${c.label}:${c.percent}`).join(",")}`;
    const g = groups.get(key);
    if (g) g.ms += p.ms;
    else groups.set(key, { ms: p.ms, comps: p.comps, overtime: p.overtime, rules: p.rules, rate, pct });

    // Répartition des suppléments par composante (pour les statistiques).
    const hours = p.ms / HOUR;
    if (p.rules.stacking === "add") {
      for (const c of p.comps) extra[c.key] = (extra[c.key] ?? 0) + hours * rate * (c.percent / 100) * 100;
    } else if (p.comps.length) {
      const top = p.comps.reduce((m, c) => (c.percent > m.percent ? c : m));
      extra[top.key] = (extra[top.key] ?? 0) + hours * rate * (Math.max(0, top.percent) / 100) * 100;
    }
  }
  const lines: PayLine[] = [];
  for (const [key, g] of groups) {
    const minutes = Math.round(g.ms / MIN);
    const monthly = g.rules.salaryType === "monthly";
    // En mensuel, les heures normales sont couvertes par le fixe : on ne paie que le supplément
    // de majoration, sauf pour les heures sup. qui s'ajoutent entièrement.
    const factor = monthly && !g.overtime ? g.pct / 100 : 1 + g.pct / 100;
    const label = g.comps.length === 0 ? "Heures normales" : g.comps.map((c) => c.label).join(" · ");
    lines.push({
      key: `work|${key}`,
      kind: "work",
      label,
      minutes,
      rate: g.rate,
      factor,
      percent: g.pct,
      amountCents: toCents((g.ms / HOUR) * g.rate * factor),
      note: monthly && !g.overtime ? (g.pct === 0 ? "Inclus dans le salaire mensuel" : "Supplément sur salaire mensuel") : undefined,
    });
  }
  for (const k of Object.keys(extra) as ComponentKey[]) extra[k] = Math.round(extra[k]!);
  return { lines, extra };
}

function emptyDay(date: string): DayResult {
  return {
    date,
    shiftIds: [],
    firstStart: null,
    lastEnd: null,
    open: false,
    onBreak: false,
    workedMs: 0,
    breakMs: 0,
    normalMs: 0,
    overtimeMs: 0,
    nightMs: 0,
    weekendMs: 0,
    holidayMs: 0,
    lines: [],
    amountCents: 0,
    extraByComponent: {},
    anomalies: [],
    status: "empty",
  };
}

/**
 * Calcule le détail de chaque journée.
 * Les journées de travail doivent idéalement inclure tout le début de la semaine ISO de la
 * première date analysée pour que les heures sup. hebdomadaires soient exactes.
 */
export function computeDays(shifts: ShiftInput[], absences: AbsenceInput[], ctx: EngineContext): Map<string, DayResult> {
  const days = new Map<string, DayResult>();
  const getDay = (d: string) => {
    let r = days.get(d);
    if (!r) {
      r = emptyDay(d);
      days.set(d, r);
    }
    return r;
  };
  const sorted = [...shifts].sort((a, b) => a.startAt - b.startAt);
  const dayWorked = new Map<string, number>();
  const weekWorked = new Map<string, number>();
  const piecesByDay = new Map<string, Piece[]>();

  for (const shift of sorted) {
    const date = localDate(shift.startAt, ctx.zone);
    const rules = ctx.rulesFor(date);
    const day = getDay(date);
    const wk = weekKeyOf(date, ctx.zone);
    day.shiftIds.push(shift.id);
    day.firstStart = day.firstStart === null ? shift.startAt : Math.min(day.firstStart, shift.startAt);
    if (shift.endAt === null) {
      day.open = true;
      day.onBreak = shift.breaks.some((b) => b.endAt === null);
    } else day.lastEnd = Math.max(day.lastEnd ?? 0, shift.endAt);
    day.breakMs += breakDuration(shift, ctx.now);

    const dailyCap = rules.dailyHours * HOUR;
    const weeklyCap = rules.weeklyHours * HOUR;
    const pieces = piecesByDay.get(date) ?? [];
    piecesByDay.set(date, pieces);
    const intervention = shift.kind === "intervention";

    for (const [a, b] of workIntervals(shift, ctx.now)) {
      for (const seg of segmentize(a, b, rules, ctx)) {
        let remaining = seg.end - seg.start;
        while (remaining > 0) {
          const dw = dayWorked.get(date) ?? 0;
          const ww = weekWorked.get(wk) ?? 0;
          let cap = Infinity;
          const mode = rules.overtime.mode;
          if (mode === "daily" || mode === "both") cap = Math.min(cap, dailyCap - dw);
          if (mode === "weekly" || mode === "both") cap = Math.min(cap, weeklyCap - ww);
          // Une intervention est entièrement en heures sup. et ne consomme pas les heures normales.
          const normalPart = intervention ? 0 : Math.max(0, Math.min(remaining, cap));
          const part = normalPart > 0 ? normalPart : remaining;
          const overtime = normalPart <= 0;
          pieces.push({ ms: part, comps: componentsFor(seg, overtime, rules, ctx, intervention), overtime, rules });
          if (!intervention) {
            dayWorked.set(date, dw + part);
            weekWorked.set(wk, ww + part);
          }
          day.workedMs += part;
          if (overtime) day.overtimeMs += part;
          else day.normalMs += part;
          if (seg.night) day.nightMs += part;
          if (seg.weekday >= 6) day.weekendMs += part;
          if (seg.holiday) day.holidayMs += part;
          remaining -= part;
        }
      }
    }
  }

  // Lignes de paie, primes journalières et anomalies.
  for (const [date, pieces] of piecesByDay) {
    const day = getDay(date);
    const rules = ctx.rulesFor(date);
    const { lines, extra } = piecesToLines(pieces);
    day.lines = lines;
    day.extraByComponent = extra;
    const dayShifts = sorted.filter((s) => day.shiftIds.includes(s.id));
    const manual = new Set(dayShifts.flatMap((s) => s.bonusIds ?? []));
    for (const bonus of rules.bonuses) {
      if (bonus.unit === "per_month") continue;
      const eligible = bonus.mode === "manual" ? manual.has(bonus.id) : day.workedMs > 0 && day.workedMs >= bonus.minHours * HOUR;
      if (!eligible) continue;
      if (bonus.unit === "per_day") {
        day.lines.push({ key: `bonus|${bonus.id}|${bonus.amount}`, kind: "bonus", label: bonus.name, minutes: 0, quantity: 1, unitLabel: "jour", rate: bonus.amount, factor: 1, percent: 0, amountCents: toCents(bonus.amount) });
      } else {
        const ms = bonus.mode === "manual" ? dayShifts.filter((s) => s.bonusIds?.includes(bonus.id)).reduce((t, s) => t + workIntervals(s, ctx.now).reduce((x, [a, b]) => x + b - a, 0), 0) : day.workedMs;
        day.lines.push({ key: `bonus|${bonus.id}|${bonus.amount}`, kind: "bonus", label: bonus.name, minutes: Math.round(ms / MIN), unitLabel: "h", rate: bonus.amount, factor: 1, percent: 0, amountCents: toCents((ms / HOUR) * bonus.amount) });
      }
    }
    day.amountCents = day.lines.reduce((s, l) => s + l.amountCents, 0);

    for (const s of dayShifts) {
      if (s.endAt === null && ctx.now - s.startAt > rules.longShiftHours * HOUR) {
        day.anomalies.push({ code: "open_shift", date, shiftId: s.id, message: "Journée toujours ouverte : avez-vous oublié de pointer votre sortie ?" });
      }
      for (const b of s.breaks) {
        if (b.endAt === null && s.endAt !== null) {
          day.anomalies.push({ code: "open_break", date, shiftId: s.id, message: "Une pause n'a jamais été terminée." });
        } else {
          const len = (b.endAt ?? ctx.now) - b.startAt;
          if (len > rules.breakAlertMinutes * MIN) {
            day.anomalies.push({ code: "long_break", date, shiftId: s.id, message: `Pause anormalement longue (${Math.round(len / MIN)} min).` });
          }
        }
      }
    }
    const hasNormalShift = dayShifts.some((s) => s.kind !== "intervention");
    if (hasNormalShift && !day.open && day.workedMs > 0 && rules.dailyHours > 0 && rules.workdays.includes(DateTime.fromISO(date).weekday) && day.workedMs < rules.dailyHours * HOUR * 0.5) {
      day.anomalies.push({ code: "incomplete", date, message: "Journée incomplète (moins de la moitié des heures prévues)." });
    }
  }

  for (const a of absences) {
    const day = getDay(a.date);
    day.absence = a;
    const rules = ctx.rulesFor(a.date);
    if (a.paid && a.hours > 0) {
      const rate = effectiveHourlyRate(rules);
      const monthly = rules.salaryType === "monthly";
      day.lines.push({
        key: `absence|${a.kind}|${rate}|${monthly}`,
        kind: "absence",
        label: ABSENCE_LABELS[a.kind] + " (payé)",
        minutes: Math.round(a.hours * 60),
        rate,
        factor: monthly ? 0 : 1,
        percent: 0,
        amountCents: monthly ? 0 : toCents(a.hours * rate),
        note: monthly ? "Inclus dans le salaire mensuel" : undefined,
      });
      day.amountCents = day.lines.reduce((s, l) => s + l.amountCents, 0);
    }
  }

  for (const day of days.values()) {
    const name = ctx.holidays.get(day.date);
    if (name) day.holidayName = name;
    const severe = day.anomalies.some((x) => x.code !== "incomplete");
    if (day.open && !severe) day.status = "ongoing";
    else if (severe) day.status = "anomaly";
    else if (day.workedMs > 0) day.status = day.anomalies.length ? "incomplete" : "complete";
    else if (day.absence) day.status = "absence";
  }
  return days;
}

export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  conge: "Congé",
  maladie: "Maladie",
  recup: "Récupération",
  sans_solde: "Congé sans solde",
  autre: "Absence",
};

/** Jours habituellement travaillés, passés, sans aucun pointage ni absence ni férié. */
export function missingDays(days: Map<string, DayResult>, from: string, to: string, ctx: EngineContext): Anomaly[] {
  const out: Anomaly[] = [];
  const today = localDate(ctx.now, ctx.zone);
  let d = DateTime.fromISO(from, { zone: ctx.zone });
  const end = DateTime.fromISO(to < today ? to : today, { zone: ctx.zone });
  while (d < end) {
    const iso = d.toISODate()!;
    if (!ctx.since || iso >= ctx.since) {
      const rules = ctx.rulesFor(iso);
      const r = days.get(iso);
      if (rules.workdays.includes(d.weekday) && !ctx.holidays.has(iso) && (!r || (r.shiftIds.length === 0 && !r.absence))) {
        out.push({ code: "missing_day", date: iso, message: "Aucun pointage ce jour habituellement travaillé." });
      }
    }
    d = d.plus({ days: 1 });
  }
  return out;
}

export interface PeriodSummary {
  from: string;
  to: string;
  workedMs: number;
  breakMs: number;
  normalMs: number;
  overtimeMs: number;
  nightMs: number;
  weekendMs: number;
  holidayMs: number;
  daysWorked: number;
  absenceDays: number;
  leaveDays: number;
  amountCents: number;
  lines: PayLine[];
  extraByComponent: Partial<Record<ComponentKey, number>>;
  /** Minutes travaillées par jour ISO de la semaine (1..7). */
  byWeekday: number[];
}

/** Agrège un ensemble de journées sur [from, to] (dates ISO incluses), avec base mensuelle et primes mensuelles au prorata. */
export function summarize(days: Map<string, DayResult>, from: string, to: string, ctx: EngineContext): PeriodSummary {
  const s: PeriodSummary = {
    from,
    to,
    workedMs: 0,
    breakMs: 0,
    normalMs: 0,
    overtimeMs: 0,
    nightMs: 0,
    weekendMs: 0,
    holidayMs: 0,
    daysWorked: 0,
    absenceDays: 0,
    leaveDays: 0,
    amountCents: 0,
    lines: [],
    extraByComponent: {},
    byWeekday: [0, 0, 0, 0, 0, 0, 0, 0],
  };
  const merged = new Map<string, PayLine>();
  for (const day of days.values()) {
    if (day.date < from || day.date > to) continue;
    s.workedMs += day.workedMs;
    s.breakMs += day.breakMs;
    s.normalMs += day.normalMs;
    s.overtimeMs += day.overtimeMs;
    s.nightMs += day.nightMs;
    s.weekendMs += day.weekendMs;
    s.holidayMs += day.holidayMs;
    if (day.workedMs > 0) s.daysWorked++;
    if (day.absence) {
      s.absenceDays++;
      if (day.absence.kind === "conge" || day.absence.kind === "recup") s.leaveDays++;
    }
    s.byWeekday[DateTime.fromISO(day.date).weekday] += day.workedMs / MIN;
    for (const [k, v] of Object.entries(day.extraByComponent)) {
      s.extraByComponent[k as ComponentKey] = (s.extraByComponent[k as ComponentKey] ?? 0) + (v ?? 0);
    }
    for (const l of day.lines) {
      const m = merged.get(l.key);
      if (m) {
        m.minutes += l.minutes;
        m.quantity = (m.quantity ?? 0) + (l.quantity ?? 0) || undefined;
        m.amountCents += l.amountCents;
      } else merged.set(l.key, { ...l });
    }
  }

  // Salaire mensuel fixe et primes mensuelles : un mois entier compte pour 1, une partie au prorata.
  let m = DateTime.fromISO(from, { zone: ctx.zone }).startOf("month");
  const last = DateTime.fromISO(to, { zone: ctx.zone });
  while (m <= last) {
    const mStart = m.toISODate()!;
    const mEnd = m.endOf("month").toISODate()!;
    const a = from > mStart ? from : mStart;
    const b = to < mEnd ? to : mEnd;
    const covered = DateTime.fromISO(b).diff(DateTime.fromISO(a), "days").days + 1;
    const fraction = Math.min(1, covered / m.daysInMonth!);
    const rules = ctx.rulesFor(b);
    const monthLabel = m.setLocale("fr").toFormat("LLLL yyyy");
    if (rules.salaryType === "monthly" && rules.monthlySalary > 0) {
      const key = `base|${rules.monthlySalary}`;
      const cents = toCents(rules.monthlySalary * fraction);
      const prev = merged.get(key);
      if (prev) {
        prev.quantity = (prev.quantity ?? 0) + fraction;
        prev.amountCents += cents;
      } else merged.set(key, { key, kind: "base", label: "Salaire mensuel", minutes: 0, quantity: fraction, unitLabel: "mois", rate: rules.monthlySalary, factor: 1, percent: 0, amountCents: cents, note: fraction < 1 ? `Prorata ${monthLabel}` : undefined });
    }
    for (const bonus of rules.bonuses.filter((x) => x.unit === "per_month")) {
      const key = `bonus|${bonus.id}|${bonus.amount}`;
      const cents = toCents(bonus.amount * fraction);
      const prev = merged.get(key);
      if (prev) {
        prev.quantity = (prev.quantity ?? 0) + fraction;
        prev.amountCents += cents;
      } else merged.set(key, { key, kind: "bonus", label: bonus.name, minutes: 0, quantity: fraction, unitLabel: "mois", rate: bonus.amount, factor: 1, percent: 0, amountCents: cents });
    }
    m = m.plus({ months: 1 });
  }

  const order = { base: 0, work: 1, absence: 2, bonus: 3 } as const;
  s.lines = [...merged.values()].sort((x, y) => order[x.kind] - order[y.kind] || x.percent - y.percent || x.label.localeCompare(y.label));
  s.amountCents = s.lines.reduce((t, l) => t + l.amountCents, 0);
  return s;
}
