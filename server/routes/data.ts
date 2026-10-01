import { Hono } from "hono";
import { DateTime } from "luxon";
import { z } from "zod";
import { HttpError, body, requireUser, type AppEnv } from "../app";
import { uuid } from "../auth/crypto";
import type { DB, Stmt } from "../db";
import { attachBreaks, type ShiftRow } from "../services/data";
import { dayViews, stats } from "../services/overview";
import { absenceKinds, isoDate } from "../../shared/schemas";
import { COUNTRIES, holidaysFor } from "../../shared/holidays";

const HOUR = 3_600_000;
const rangeQuery = z.object({ from: isoDate, to: isoDate }).refine((q) => q.from <= q.to, "Période invalide.");

const shiftBody = z
  .object({
    startAt: z.number().int().positive(),
    endAt: z.number().int().positive().nullable(),
    breaks: z.array(z.object({ startAt: z.number().int().positive(), endAt: z.number().int().positive().nullable() })).max(20).default([]),
    note: z.string().trim().max(500).default(""),
    bonusIds: z.array(z.string().max(40)).max(30).default([]),
  })
  .superRefine((s, ctx) => {
    const end = s.endAt ?? Date.now();
    if (s.endAt !== null && s.endAt <= s.startAt) ctx.addIssue({ code: "custom", message: "L'heure de fin doit être après l'heure de début." });
    if (end - s.startAt > 24 * HOUR) ctx.addIssue({ code: "custom", message: "Une journée ne peut pas dépasser 24 heures." });
    if (s.startAt > Date.now() + 60_000) ctx.addIssue({ code: "custom", message: "Impossible de pointer dans le futur." });
    if (s.endAt !== null && s.endAt > Date.now() + 60_000) ctx.addIssue({ code: "custom", message: "Impossible de pointer dans le futur." });
    const sorted = [...s.breaks].sort((a, b) => a.startAt - b.startAt);
    let prevEnd = s.startAt;
    for (const [i, b] of sorted.entries()) {
      if (b.endAt === null && (s.endAt !== null || i !== sorted.length - 1)) ctx.addIssue({ code: "custom", message: "Chaque pause doit avoir une heure de fin." });
      if (b.startAt < prevEnd || (b.endAt !== null && (b.endAt <= b.startAt || b.endAt > end))) {
        ctx.addIssue({ code: "custom", message: "Les pauses doivent être comprises dans la journée et ne pas se chevaucher." });
        break;
      }
      prevEnd = b.endAt ?? end;
    }
  });

async function ensureNoOverlap(db: DB, userId: string, startAt: number, endAt: number | null, excludeId = "") {
  const end = endAt ?? Number.MAX_SAFE_INTEGER;
  const clash = await db.first("SELECT id FROM shifts WHERE user_id = ? AND id != ? AND start_at < ? AND COALESCE(end_at, ?) > ? LIMIT 1", userId, excludeId, end, Number.MAX_SAFE_INTEGER, startAt);
  if (clash) throw new HttpError(409, "Ces horaires chevauchent une autre journée pointée.");
  if (endAt === null && (await db.first("SELECT id FROM shifts WHERE user_id = ? AND end_at IS NULL AND id != ?", userId, excludeId))) {
    throw new HttpError(409, "Une autre journée est déjà en cours.");
  }
}

const breakStmts = (shiftId: string, breaks: Array<{ startAt: number; endAt: number | null }>): Stmt[] => [
  ["DELETE FROM breaks WHERE shift_id = ?", [shiftId]],
  ...breaks.map((b): Stmt => ["INSERT INTO breaks (id, shift_id, start_at, end_at) VALUES (?, ?, ?, ?)", [uuid(), shiftId, b.startAt, b.endAt]]),
];

async function getShift(db: DB, userId: string, id: string) {
  const row = await db.first<ShiftRow>("SELECT id, start_at, end_at, note, source, bonus_ids, edited_at FROM shifts WHERE id = ? AND user_id = ?", id, userId);
  if (!row) throw new HttpError(404, "Journée introuvable.");
  return (await attachBreaks(db, [row]))[0];
}

export function dataRoutes() {
  const r = new Hono<AppEnv>();

  // ---------- Journées calculées (calendrier, historique, statistiques) ----------
  r.get("/days", async (c) => {
    const user = requireUser(c);
    const q = rangeQuery.parse(c.req.query());
    if (DateTime.fromISO(q.to).diff(DateTime.fromISO(q.from), "days").days > 800) throw new HttpError(400, "Période trop longue.");
    return c.json(await dayViews(c.get("db"), user, q.from, q.to));
  });

  r.get("/stats", async (c) => {
    const user = requireUser(c);
    const q = rangeQuery.parse(c.req.query());
    if (DateTime.fromISO(q.to).diff(DateTime.fromISO(q.from), "days").days > 366 * 10) throw new HttpError(400, "Période trop longue.");
    return c.json(await stats(c.get("db"), user, q.from, q.to));
  });

  r.get("/history/bounds", async (c) => {
    const user = requireUser(c);
    const row = await c.get("db").first<{ first: number | null }>("SELECT MIN(start_at) AS first FROM shifts WHERE user_id = ?", user.id);
    return c.json({ first: row?.first ? DateTime.fromMillis(row.first, { zone: user.timezone }).toISODate() : null });
  });

  // ---------- Journées (création / correction manuelle) ----------
  r.post("/shifts", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const b = shiftBody.parse(await body(c));
    const id = uuid();
    const now = Date.now();
    await ensureNoOverlap(db, user.id, b.startAt, b.endAt);
    await db.batch([
      [
        "INSERT INTO shifts (id, user_id, start_at, end_at, note, source, bonus_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)",
        [id, user.id, b.startAt, b.endAt, b.note, JSON.stringify(b.bonusIds), now, now],
      ],
      ...breakStmts(id, b.breaks),
    ]);
    return c.json({ shift: await getShift(db, user.id, id) });
  });

  r.put("/shifts/:id", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const id = c.req.param("id");
    const b = shiftBody.parse(await body(c));
    await getShift(db, user.id, id);
    await ensureNoOverlap(db, user.id, b.startAt, b.endAt, id);
    const now = Date.now();
    await db.batch([
      ["UPDATE shifts SET start_at = ?, end_at = ?, note = ?, bonus_ids = ?, edited_at = ?, updated_at = ? WHERE id = ? AND user_id = ?", [b.startAt, b.endAt, b.note, JSON.stringify(b.bonusIds), now, now, id, user.id]],
      ...breakStmts(id, b.breaks),
    ]);
    return c.json({ shift: await getShift(db, user.id, id) });
  });

  r.delete("/shifts/:id", async (c) => {
    const user = requireUser(c);
    const res = await c.get("db").run("DELETE FROM shifts WHERE id = ? AND user_id = ?", c.req.param("id"), user.id);
    if (res.changes === 0) throw new HttpError(404, "Journée introuvable.");
    return c.json({ ok: true });
  });

  // ---------- Absences ----------
  r.put("/absences/:date", async (c) => {
    const user = requireUser(c);
    const date = isoDate.parse(c.req.param("date"));
    const b = z.object({ kind: z.enum(absenceKinds), paid: z.boolean(), hours: z.number().min(0).max(24), note: z.string().trim().max(300).default("") }).parse(await body(c));
    await c.get("db").run(
      `INSERT INTO absences (id, user_id, date, kind, paid, hours, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET kind = excluded.kind, paid = excluded.paid, hours = excluded.hours, note = excluded.note`,
      uuid(),
      user.id,
      date,
      b.kind,
      b.paid ? 1 : 0,
      b.hours,
      b.note,
      Date.now(),
    );
    return c.json({ ok: true });
  });

  r.delete("/absences/:date", async (c) => {
    const user = requireUser(c);
    await c.get("db").run("DELETE FROM absences WHERE user_id = ? AND date = ?", user.id, isoDate.parse(c.req.param("date")));
    return c.json({ ok: true });
  });

  // ---------- Jours fériés ----------
  r.get("/holidays", async (c) => {
    const user = requireUser(c);
    const { year } = z.object({ year: z.coerce.number().int().min(1970).max(2200) }).parse(c.req.query());
    const holidays = await c.get("db").all("SELECT id, date, name FROM holidays WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date", user.id, `${year}-01-01`, `${year}-12-31`);
    return c.json({ holidays, country: user.holiday_country, countries: Object.entries(COUNTRIES).map(([code, x]) => ({ code, name: x.name, flag: x.flag })) });
  });

  r.post("/holidays", async (c) => {
    const user = requireUser(c);
    const b = z.object({ date: isoDate, name: z.string().trim().min(1).max(80) }).parse(await body(c));
    await c.get("db").run("INSERT INTO holidays (id, user_id, date, name) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET name = excluded.name", uuid(), user.id, b.date, b.name);
    return c.json({ ok: true });
  });

  r.delete("/holidays/:id", async (c) => {
    const user = requireUser(c);
    await c.get("db").run("DELETE FROM holidays WHERE id = ? AND user_id = ?", c.req.param("id"), user.id);
    return c.json({ ok: true });
  });

  /** Importe les jours fériés d'un pays pour plusieurs années (les jours déjà présents sont conservés). */
  r.post("/holidays/import", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const b = z.object({ country: z.string().refine((x) => x in COUNTRIES, "Pays non pris en charge."), years: z.array(z.number().int().min(1970).max(2200)).min(1).max(15) }).parse(await body(c));
    const before = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM holidays WHERE user_id = ?", user.id))?.n ?? 0;
    const stmts: Stmt[] = b.years.flatMap((y) => holidaysFor(b.country, y).map((h): Stmt => ["INSERT OR IGNORE INTO holidays (id, user_id, date, name) VALUES (?, ?, ?, ?)", [uuid(), user.id, h.date, h.name]]));
    stmts.push(["UPDATE users SET holiday_country = ? WHERE id = ?", [b.country, user.id]]);
    await db.batch(stmts);
    const after = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM holidays WHERE user_id = ?", user.id))?.n ?? 0;
    return c.json({ added: after - before });
  });

  return r;
}
