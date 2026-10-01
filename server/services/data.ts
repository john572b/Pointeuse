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

export async function publicUser(db: DB, u: UserRow) {
  const credentials = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?", u.id);
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
    hasBiometrics: (credentials?.n ?? 0) > 0,
    createdAt: u.created_at,
  };
}

export const getUser = (db: DB, id: string) => db.first<UserRow>("SELECT * FROM users WHERE id = ?", id) as Promise<UserRow>;

export interface RuleVersion {
  id: string;
  effectiveFrom: string;
  rules: PayRules;
}

export async function loadRuleVersions(db: DB, userId: string): Promise<RuleVersion[]> {
  const rows = await db.all("SELECT id, effective_from, rules FROM pay_rule_versions WHERE user_id = ? ORDER BY effective_from", userId);
  return rows.map((r) => {
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

export async function buildContext(db: DB, user: UserRow, now = Date.now()): Promise<EngineContext> {
  const [holidayRows, versions] = await Promise.all([db.all("SELECT date, name FROM holidays WHERE user_id = ?", user.id), loadRuleVersions(db, user.id)]);
  return {
    zone: user.timezone,
    now,
    holidays: new Map(holidayRows.map((h) => [h.date, h.name])),
    rulesFor: makeRulesFor(versions),
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
export async function loadShifts(db: DB, userId: string, fromMs: number, toMs: number): Promise<ShiftDTO[]> {
  const rows = await db.all<ShiftRow>(
    "SELECT id, start_at, end_at, note, source, bonus_ids, edited_at FROM shifts WHERE user_id = ? AND start_at >= ? AND start_at < ? ORDER BY start_at",
    userId,
    fromMs,
    toMs,
  );
  return attachBreaks(db, rows);
}

export async function attachBreaks(db: DB, rows: ShiftRow[]): Promise<ShiftDTO[]> {
  if (rows.length === 0) return [];
  const byShift = new Map<string, ShiftDTO["breaks"]>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const breaks = await db.all(`SELECT id, shift_id, start_at, end_at FROM breaks WHERE shift_id IN (${chunk.map(() => "?").join(",")}) ORDER BY start_at`, ...chunk);
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

export async function loadAbsences(db: DB, userId: string, from: string, to: string): Promise<Array<AbsenceInput & { id: string; note: string }>> {
  const rows = await db.all("SELECT id, date, kind, paid, hours, note FROM absences WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date", userId, from, to);
  return rows.map((a) => ({ id: a.id, date: a.date, kind: a.kind, paid: !!a.paid, hours: a.hours, note: a.note }));
}

export const toEngineShift = (s: ShiftDTO): ShiftInput => ({ id: s.id, startAt: s.startAt, endAt: s.endAt, breaks: s.breaks, bonusIds: s.bonusIds });

/** Bornes en ms d'une plage de dates locales [from, to] (to inclus). */
export function dateRangeMs(from: string, to: string, zone: string): [number, number] {
  return [DateTime.fromISO(from, { zone }).startOf("day").toMillis(), DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf("day").toMillis()];
}
