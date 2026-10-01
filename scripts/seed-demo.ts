/**
 * Crée un compte de démonstration avec ~14 mois d'historique réaliste.
 *   npm run seed:demo            → demo@pointeuse.local / demo-pointeuse
 * Ne jamais lancer en production sur une base réelle.
 */
import { DateTime } from "luxon";
import { config } from "../server/config";
import { openDatabase } from "../server/db";
import { hashPassword, uuid } from "../server/auth/crypto";
import { DEFAULT_RULES } from "../shared/pay/rules";
import { holidaysFor } from "../shared/holidays";

const EMAIL = "demo@pointeuse.local";
const PASSWORD = "demo-pointeuse";
const zone = "Europe/Luxembourg";

const db = openDatabase(config.dbPath);
db.prepare("DELETE FROM users WHERE email = ?").run(EMAIL);

const userId = uuid();
const now = DateTime.now().setZone(zone);
const createdAt = now.minus({ months: 14 }).startOf("month");
db.prepare("INSERT INTO users (id, email, password_hash, first_name, timezone, holiday_country, prefs, onboarded_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'LU', ?, ?, ?, ?)").run(
  userId,
  EMAIL,
  await hashPassword(PASSWORD),
  "Thomas",
  zone,
  JSON.stringify({ weeklyGoalHours: 40 }),
  Date.now(),
  createdAt.toMillis(),
  Date.now(),
);

const rules = {
  ...DEFAULT_RULES,
  hourlyRate: 16.5,
  weekdayPercents: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 25, "7": 50 },
  bonuses: [
    { id: "repas", name: "Prime de repas", amount: 8.5, unit: "per_day" as const, mode: "auto" as const, minHours: 6 },
    { id: "chantier", name: "Prime de chantier", amount: 20, unit: "per_day" as const, mode: "manual" as const, minHours: 0 },
  ],
};
db.prepare("INSERT INTO pay_rule_versions (id, user_id, effective_from, rules, created_at) VALUES (?, ?, '1970-01-01', ?, ?)").run(uuid(), userId, JSON.stringify({ ...rules, hourlyRate: 15.8 }), Date.now());
db.prepare("INSERT INTO pay_rule_versions (id, user_id, effective_from, rules, created_at) VALUES (?, ?, ?, ?, ?)").run(uuid(), userId, now.minus({ months: 5 }).startOf("month").toISODate(), JSON.stringify(rules), Date.now());

for (const y of [createdAt.year, now.year, now.year + 1]) for (const h of holidaysFor("LU", y)) db.prepare("INSERT OR IGNORE INTO holidays (id, user_id, date, name) VALUES (?, ?, ?, ?)").run(uuid(), userId, h.date, h.name);

// Générateur pseudo-aléatoire déterministe.
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const insShift = db.prepare("INSERT INTO shifts (id, user_id, start_at, end_at, source, bonus_ids, created_at, updated_at) VALUES (?, ?, ?, ?, 'clock', ?, ?, ?)");
const insBreak = db.prepare("INSERT INTO breaks (id, shift_id, start_at, end_at) VALUES (?, ?, ?, ?)");

db.transaction(() => {
  for (let d = createdAt; d < now.startOf("day"); d = d.plus({ days: 1 })) {
    const wd = d.weekday;
    if (rand() < 0.04 && wd <= 5) {
      db.prepare("INSERT INTO absences (id, user_id, date, kind, paid, hours, created_at) VALUES (?, ?, ?, 'conge', 1, 8, ?)").run(uuid(), userId, d.toISODate(), Date.now());
      continue;
    }
    let start: DateTime;
    let hours: number;
    if (wd <= 5) {
      if (rand() < 0.08) {
        start = d.set({ hour: 21, minute: Math.floor(rand() * 30) }); // nuit
        hours = 8 + rand();
      } else {
        start = d.set({ hour: 7, minute: Math.floor(30 + rand() * 45) });
        hours = 8.2 + rand() * 1.6;
      }
    } else if (rand() < 0.22) {
      start = d.set({ hour: 8, minute: Math.floor(rand() * 30) });
      hours = 4 + rand() * 3;
    } else continue;
    const id = uuid();
    const s = start.toMillis();
    const e = s + hours * 3_600_000;
    insShift.run(id, userId, s, Math.round(e), JSON.stringify(rand() < 0.15 ? ["chantier"] : []), s, s);
    if (hours > 6) {
      const bs = s + (4 + rand()) * 3_600_000;
      insBreak.run(uuid(), id, Math.round(bs), Math.round(bs + (30 + rand() * 30) * 60_000));
    }
  }
  // Journée en cours aujourd'hui.
  const s = now.set({ hour: 7, minute: 58 });
  if (s < now) {
    const id = uuid();
    insShift.run(id, userId, s.toMillis(), null, "[]", s.toMillis(), s.toMillis());
    const bs = s.plus({ hours: 4, minutes: 2 });
    if (bs.plus({ minutes: 35 }) < now) insBreak.run(uuid(), id, bs.toMillis(), bs.plus({ minutes: 35 }).toMillis());
  }
})();

console.log(`Compte de démonstration prêt : ${EMAIL} / ${PASSWORD}`);
