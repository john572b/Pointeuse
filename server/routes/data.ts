import type { FastifyInstance } from "fastify";
import { DateTime } from "luxon";
import { z } from "zod";
import { HttpError, requireUser } from "../app";
import { uuid } from "../auth/crypto";
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

export async function dataRoutes(app: FastifyInstance) {
  const db = app.db;

  // ---------- Journées calculées (calendrier, historique) ----------
  app.get("/days", async (req) => {
    const user = requireUser(req);
    const q = rangeQuery.parse(req.query);
    if (DateTime.fromISO(q.to).diff(DateTime.fromISO(q.from), "days").days > 800) throw new HttpError(400, "Période trop longue.");
    return dayViews(db, user, q.from, q.to);
  });

  app.get("/stats", async (req) => {
    const user = requireUser(req);
    const q = rangeQuery.parse(req.query);
    if (DateTime.fromISO(q.to).diff(DateTime.fromISO(q.from), "days").days > 366 * 10) throw new HttpError(400, "Période trop longue.");
    return stats(db, user, q.from, q.to);
  });

  /** Première date pointée (pour les filtres « depuis le début »). */
  app.get("/history/bounds", async (req) => {
    const user = requireUser(req);
    const r = db.prepare("SELECT MIN(start_at) AS first FROM shifts WHERE user_id = ?").get(user.id) as { first: number | null };
    return { first: r.first ? DateTime.fromMillis(r.first, { zone: user.timezone }).toISODate() : null };
  });

  // ---------- Journées (création / correction manuelle) ----------
  const ensureNoOverlap = (userId: string, startAt: number, endAt: number | null, excludeId?: string) => {
    const end = endAt ?? Number.MAX_SAFE_INTEGER;
    const clash = db
      .prepare("SELECT id FROM shifts WHERE user_id = ? AND id != ? AND start_at < ? AND COALESCE(end_at, ?) > ? LIMIT 1")
      .get(userId, excludeId ?? "", end, Number.MAX_SAFE_INTEGER, startAt);
    if (clash) throw new HttpError(409, "Ces horaires chevauchent une autre journée pointée.");
    if (endAt === null) {
      const open = db.prepare("SELECT id FROM shifts WHERE user_id = ? AND end_at IS NULL AND id != ?").get(userId, excludeId ?? "");
      if (open) throw new HttpError(409, "Une autre journée est déjà en cours.");
    }
  };
  const writeBreaks = (shiftId: string, breaks: Array<{ startAt: number; endAt: number | null }>) => {
    db.prepare("DELETE FROM breaks WHERE shift_id = ?").run(shiftId);
    const ins = db.prepare("INSERT INTO breaks (id, shift_id, start_at, end_at) VALUES (?, ?, ?, ?)");
    for (const b of breaks) ins.run(uuid(), shiftId, b.startAt, b.endAt);
  };
  const getShift = (userId: string, id: string) => {
    const row = db.prepare("SELECT id, start_at, end_at, note, source, bonus_ids, edited_at FROM shifts WHERE id = ? AND user_id = ?").get(id, userId) as ShiftRow | undefined;
    if (!row) throw new HttpError(404, "Journée introuvable.");
    return attachBreaks(db, [row])[0];
  };

  app.post("/shifts", async (req) => {
    const user = requireUser(req);
    const body = shiftBody.parse(req.body);
    const id = uuid();
    const now = Date.now();
    db.transaction(() => {
      ensureNoOverlap(user.id, body.startAt, body.endAt);
      db.prepare("INSERT INTO shifts (id, user_id, start_at, end_at, note, source, bonus_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)").run(
        id,
        user.id,
        body.startAt,
        body.endAt,
        body.note,
        JSON.stringify(body.bonusIds),
        now,
        now,
      );
      writeBreaks(id, body.breaks);
    })();
    return { shift: getShift(user.id, id) };
  });

  app.put<{ Params: { id: string } }>("/shifts/:id", async (req) => {
    const user = requireUser(req);
    const body = shiftBody.parse(req.body);
    getShift(user.id, req.params.id);
    const now = Date.now();
    db.transaction(() => {
      ensureNoOverlap(user.id, body.startAt, body.endAt, req.params.id);
      db.prepare("UPDATE shifts SET start_at = ?, end_at = ?, note = ?, bonus_ids = ?, edited_at = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
        body.startAt,
        body.endAt,
        body.note,
        JSON.stringify(body.bonusIds),
        now,
        now,
        req.params.id,
        user.id,
      );
      writeBreaks(req.params.id, body.breaks);
    })();
    return { shift: getShift(user.id, req.params.id) };
  });

  app.delete<{ Params: { id: string } }>("/shifts/:id", async (req) => {
    const user = requireUser(req);
    const r = db.prepare("DELETE FROM shifts WHERE id = ? AND user_id = ?").run(req.params.id, user.id);
    if (r.changes === 0) throw new HttpError(404, "Journée introuvable.");
    return { ok: true };
  });

  // ---------- Absences ----------
  app.put<{ Params: { date: string } }>("/absences/:date", async (req) => {
    const user = requireUser(req);
    const date = isoDate.parse(req.params.date);
    const body = z
      .object({ kind: z.enum(absenceKinds), paid: z.boolean(), hours: z.number().min(0).max(24), note: z.string().trim().max(300).default("") })
      .parse(req.body);
    db.prepare(
      `INSERT INTO absences (id, user_id, date, kind, paid, hours, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET kind = excluded.kind, paid = excluded.paid, hours = excluded.hours, note = excluded.note`,
    ).run(uuid(), user.id, date, body.kind, body.paid ? 1 : 0, body.hours, body.note, Date.now());
    return { ok: true };
  });

  app.delete<{ Params: { date: string } }>("/absences/:date", async (req) => {
    const user = requireUser(req);
    db.prepare("DELETE FROM absences WHERE user_id = ? AND date = ?").run(user.id, isoDate.parse(req.params.date));
    return { ok: true };
  });

  // ---------- Jours fériés ----------
  app.get("/holidays", async (req) => {
    const user = requireUser(req);
    const { year } = z.object({ year: z.coerce.number().int().min(1970).max(2200) }).parse(req.query);
    const rows = db.prepare("SELECT id, date, name FROM holidays WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date").all(user.id, `${year}-01-01`, `${year}-12-31`);
    return {
      holidays: rows,
      country: user.holiday_country,
      countries: Object.entries(COUNTRIES).map(([code, c]) => ({ code, name: c.name, flag: c.flag })),
    };
  });

  app.post("/holidays", async (req) => {
    const user = requireUser(req);
    const body = z.object({ date: isoDate, name: z.string().trim().min(1).max(80) }).parse(req.body);
    db.prepare("INSERT INTO holidays (id, user_id, date, name) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET name = excluded.name").run(
      uuid(),
      user.id,
      body.date,
      body.name,
    );
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/holidays/:id", async (req) => {
    const user = requireUser(req);
    db.prepare("DELETE FROM holidays WHERE id = ? AND user_id = ?").run(req.params.id, user.id);
    return { ok: true };
  });

  /** Importe les jours fériés d'un pays pour plusieurs années (les jours déjà présents sont conservés). */
  app.post("/holidays/import", async (req) => {
    const user = requireUser(req);
    const body = z.object({ country: z.string().refine((c) => c in COUNTRIES, "Pays non pris en charge."), years: z.array(z.number().int().min(1970).max(2200)).min(1).max(15) }).parse(req.body);
    const ins = db.prepare("INSERT OR IGNORE INTO holidays (id, user_id, date, name) VALUES (?, ?, ?, ?)");
    let added = 0;
    db.transaction(() => {
      for (const y of body.years) for (const h of holidaysFor(body.country, y)) added += ins.run(uuid(), user.id, h.date, h.name).changes;
      db.prepare("UPDATE users SET holiday_country = ? WHERE id = ?").run(body.country, user.id);
    })();
    return { added };
  });
}
