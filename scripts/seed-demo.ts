/**
 * Génère un compte de démonstration avec ~14 mois d'historique réaliste, sous forme de fichier SQL.
 *   npm run seed:demo                              → écrit data/seed-demo.sql
 *   npx wrangler d1 execute pointeuse --local --file data/seed-demo.sql    (base locale de `wrangler dev`)
 *   npx wrangler d1 execute pointeuse --remote --file data/seed-demo.sql   (production — à éviter sur une base réelle)
 * Compte : demo@pointeuse.local / demo-pointeuse  (PASSWORD_PEPPER doit être le même que celui du Worker).
 */
import fs from "node:fs";
import { DateTime } from "luxon";
import { hashPassword, uuid } from "../server/auth/crypto";
import { DEFAULT_RULES } from "../shared/pay/rules";
import { holidaysFor } from "../shared/holidays";

const EMAIL = "demo@pointeuse.local";
const PASSWORD = "demo-pointeuse";
const zone = "Europe/Luxembourg";
const pepper = process.env.PASSWORD_PEPPER ?? "";

const q = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
const sql: string[] = [`DELETE FROM users WHERE email = ${q(EMAIL)};`];
const insert = (table: string, row: Record<string, string | number | null>) =>
  sql.push(`INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(q).join(", ")});`);

const userId = uuid();
const now = DateTime.now().setZone(zone);
const createdAt = now.minus({ months: 14 }).startOf("month");
insert("users", {
  id: userId,
  email: EMAIL,
  password_hash: await hashPassword(PASSWORD, pepper),
  first_name: "Thomas",
  timezone: zone,
  holiday_country: "LU",
  prefs: JSON.stringify({ weeklyGoalHours: 40 }),
  onboarded_at: Date.now(),
  created_at: createdAt.toMillis(),
  updated_at: Date.now(),
});

const rules = {
  ...DEFAULT_RULES,
  hourlyRate: 16.5,
  weekdayPercents: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 25, "7": 50 },
  bonuses: [
    { id: "repas", name: "Prime de repas", amount: 8.5, unit: "per_day" as const, mode: "auto" as const, minHours: 6 },
    { id: "chantier", name: "Prime de chantier", amount: 20, unit: "per_day" as const, mode: "manual" as const, minHours: 0 },
  ],
};
insert("pay_rule_versions", { id: uuid(), user_id: userId, effective_from: "1970-01-01", rules: JSON.stringify({ ...rules, hourlyRate: 15.8 }), created_at: Date.now() });
insert("pay_rule_versions", { id: uuid(), user_id: userId, effective_from: now.minus({ months: 5 }).startOf("month").toISODate()!, rules: JSON.stringify(rules), created_at: Date.now() });

for (const y of [createdAt.year, now.year, now.year + 1]) for (const h of holidaysFor("LU", y)) insert("holidays", { id: uuid(), user_id: userId, date: h.date, name: h.name });

// Générateur pseudo-aléatoire déterministe.
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

for (let d = createdAt; d < now.startOf("day"); d = d.plus({ days: 1 })) {
  const wd = d.weekday;
  if (rand() < 0.04 && wd <= 5) {
    insert("absences", { id: uuid(), user_id: userId, date: d.toISODate()!, kind: "conge", paid: 1, hours: 8, created_at: Date.now() });
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
  const e = Math.round(s + hours * 3_600_000);
  insert("shifts", { id, user_id: userId, start_at: s, end_at: e, source: "clock", bonus_ids: JSON.stringify(rand() < 0.15 ? ["chantier"] : []), created_at: s, updated_at: s });
  if (hours > 6) {
    const bs = Math.round(s + (4 + rand()) * 3_600_000);
    insert("breaks", { id: uuid(), shift_id: id, start_at: bs, end_at: Math.round(bs + (30 + rand() * 30) * 60_000) });
  }
}
// Journée en cours aujourd'hui.
const s = now.set({ hour: 7, minute: 58 });
if (s < now) {
  const id = uuid();
  insert("shifts", { id, user_id: userId, start_at: s.toMillis(), end_at: null, source: "clock", bonus_ids: "[]", created_at: s.toMillis(), updated_at: s.toMillis() });
  const bs = s.plus({ hours: 4, minutes: 2 });
  if (bs.plus({ minutes: 35 }) < now) insert("breaks", { id: uuid(), shift_id: id, start_at: bs.toMillis(), end_at: bs.plus({ minutes: 35 }).toMillis() });
}

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/seed-demo.sql", sql.join("\n") + "\n");
console.log(`data/seed-demo.sql écrit (${sql.length} instructions). Compte : ${EMAIL} / ${PASSWORD}`);
