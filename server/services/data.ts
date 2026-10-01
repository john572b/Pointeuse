import { DateTime } from "luxon";
import type { DB } from "../db";
import { DEFAULT_RULES, payRulesSchema, type PayRules } from "../../shared/pay/rules";
import type { AbsenceInput, EngineContext, ShiftInput } from "../../shared/pay/engine";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  timezone: string;
  currency: string;
  theme: string;
  holiday_country: string | null;
  prefs: string;
  onboarded_at: number | null;
  created_at: number;
}

export interface Prefs {
  remindersEnabled: boolean;
  reminderLongShiftHours: number;
  reminderBreakMinutes: number;
  weeklyGoalHours: number | null;
  geolocation: boolean;
}
export const DEFAULT_PREFS: Prefs = {
  remindersEnabled: true,
  reminderLongShiftHours: 9,
  reminderBreakMinutes: 60,
  weeklyGoalHours: null,
  geolocation: false,
};

export function prefsOf(u: UserRow): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(u.prefs) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function publicUser(db: DB, u: UserRow) {
  const credentials = db.prepare("SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?").get(u.id) as { n: number };
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    timezone: u.timezone,
    currency: u.currency,
    theme: u.theme,
    holidayCountry: u.holiday_country,
    prefs: prefsOf(u),
    onboarded: u.onboarded_at !== null,
    hasBiometrics: credentials.n > 0,
    createdAt: u.created_at,
  };
}

export interface RuleVersion {
  id: string;
  effectiveFrom: string;
  rules: PayRules;
}

export function loadRuleVersions(db: DB, userId: string): RuleVersion[] {
  return (db.prepare("SELECT id, effective_from, rules FROM pay_rule_versions WHERE user_id = ? ORDER BY effective_from").all(userId) as any[]).map((r) => {
    const parsed = payRulesSchema.safeParse(JSON.parse(r.rules));
    return { id: r.id, effectiveFrom: r.effective_from, rules: parsed.success ? parsed.data : DEFAULT_RULES };
  });
}

/** Règles en vigueur à une date : dernière version dont la date d'effet est ≤ date (sinon la plus ancienne). */
export function makeRulesFor(versions: RuleVersion[]) {
  return (date: string): PayRules => {
    if (versions.length === 0) return DEFAULT_RULES;
    let current = versions[0].rules;
    for (const v of versions) {
      if (v.effectiveFrom <= date) current = v.rules;
      else break;
    }
    return current;
  };
}

export function buildContext(db: DB, user: UserRow, now = Date.now()): EngineContext {
  const holidays = new Map<string, string>(
    (db.prepare("SELECT date, name FROM holidays WHERE user_id = ?").all(user.id) as any[]).map((h) => [h.date, h.name]),
  );
  return {
    zone: user.timezone,
    now,
    holidays,
    rulesFor: makeRulesFor(loadRuleVersions(db, user.id)),
    since: DateTime.fromMillis(user.created_at, { zone: user.timezone }).toISODate()!,
  };
}

export interface ShiftRow {
  id: string;
  start_at: number;
  end_at: number | null;
  note: string;
  source: string;
  bonus_ids: string;
  edited_at: number | null;
}

export interface ShiftDTO {
  id: string;
  startAt: number;
  endAt: number | null;
  note: string;
  source: string;
  bonusIds: string[];
  editedAt: number | null;
  breaks: Array<{ id: string; startAt: number; endAt: number | null }>;
}

/** Charge les journées de l'utilisateur qui commencent dans [fromMs, toMs). */
export function loadShifts(db: DB, userId: string, fromMs: number, toMs: number): ShiftDTO[] {
  const rows = db
    .prepare("SELECT id, start_at, end_at, note, source, bonus_ids, edited_at FROM shifts WHERE user_id = ? AND start_at >= ? AND start_at < ? ORDER BY start_at")
    .all(userId, fromMs, toMs) as ShiftRow[];
  return attachBreaks(db, rows);
}

export function attachBreaks(db: DB, rows: ShiftRow[]): ShiftDTO[] {
  if (rows.length === 0) return [];
  const byShift = new Map<string, ShiftDTO["breaks"]>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const breaks = db
      .prepare(`SELECT id, shift_id, start_at, end_at FROM breaks WHERE shift_id IN (${chunk.map(() => "?").join(",")}) ORDER BY start_at`)
      .all(...chunk) as any[];
    for (const b of breaks) {
      const list = byShift.get(b.shift_id) ?? [];
      list.push({ id: b.id, startAt: b.start_at, endAt: b.end_at });
      byShift.set(b.shift_id, list);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    startAt: r.start_at,
    endAt: r.end_at,
    note: r.note,
    source: r.source,
    bonusIds: safeJsonArray(r.bonus_ids),
    editedAt: r.edited_at,
    breaks: byShift.get(r.id) ?? [],
  }));
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function loadAbsences(db: DB, userId: string, from: string, to: string): Array<AbsenceInput & { id: string; note: string }> {
  return (db.prepare("SELECT id, date, kind, paid, hours, note FROM absences WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date").all(userId, from, to) as any[]).map(
    (a) => ({ id: a.id, date: a.date, kind: a.kind, paid: !!a.paid, hours: a.hours, note: a.note }),
  );
}

export const toEngineShift = (s: ShiftDTO): ShiftInput => ({ id: s.id, startAt: s.startAt, endAt: s.endAt, breaks: s.breaks, bonusIds: s.bonusIds });

/** Bornes en ms d'une plage de dates locales [from, to] (to inclus). */
export function dateRangeMs(from: string, to: string, zone: string): [number, number] {
  return [DateTime.fromISO(from, { zone }).startOf("day").toMillis(), DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf("day").toMillis()];
}
