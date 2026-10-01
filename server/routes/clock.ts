import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, requireUser } from "../app";
import { uuid } from "../auth/crypto";
import { prefsOf } from "../services/data";
import { dashboard, loadOpenShift } from "../services/overview";

/** Position optionnelle (prévue pour la vérification du lieu de travail, désactivée par défaut). */
const locationSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000) }).optional();
const bodySchema = z.object({ location: locationSchema }).default({});

export async function clockRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get("/dashboard", async (req) => dashboard(db, requireUser(req)));

  app.post("/clock/start", async (req) => {
    const user = requireUser(req);
    const { location } = bodySchema.parse(req.body ?? {});
    const loc = prefsOf(user).geolocation ? location : undefined;
    const now = Date.now();
    db.transaction(() => {
      if (loadOpenShift(db, user.id)) throw new HttpError(409, "Votre journée est déjà commencée.");
      db.prepare(
        "INSERT INTO shifts (id, user_id, start_at, source, start_lat, start_lng, start_accuracy, created_at, updated_at) VALUES (?, ?, ?, 'clock', ?, ?, ?, ?, ?)",
      ).run(uuid(), user.id, now, loc?.lat ?? null, loc?.lng ?? null, loc?.accuracy ?? null, now, now);
    })();
    return dashboard(db, user);
  });

  app.post("/clock/stop", async (req) => {
    const user = requireUser(req);
    const { location } = bodySchema.parse(req.body ?? {});
    const loc = prefsOf(user).geolocation ? location : undefined;
    const now = Date.now();
    db.transaction(() => {
      const open = loadOpenShift(db, user.id);
      if (!open) throw new HttpError(409, "Aucune journée en cours.");
      db.prepare("UPDATE breaks SET end_at = ? WHERE shift_id = ? AND end_at IS NULL").run(now, open.id);
      db.prepare("UPDATE shifts SET end_at = ?, end_lat = ?, end_lng = ?, end_accuracy = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
        now,
        loc?.lat ?? null,
        loc?.lng ?? null,
        loc?.accuracy ?? null,
        now,
        open.id,
        user.id,
      );
    })();
    return dashboard(db, user);
  });

  app.post("/clock/break/start", async (req) => {
    const user = requireUser(req);
    const now = Date.now();
    db.transaction(() => {
      const open = loadOpenShift(db, user.id);
      if (!open) throw new HttpError(409, "Commencez d'abord votre journée.");
      if (open.breaks.some((b) => b.endAt === null)) throw new HttpError(409, "Vous êtes déjà en pause.");
      db.prepare("INSERT INTO breaks (id, shift_id, start_at) VALUES (?, ?, ?)").run(uuid(), open.id, now);
    })();
    return dashboard(db, user);
  });

  app.post("/clock/break/end", async (req) => {
    const user = requireUser(req);
    const now = Date.now();
    db.transaction(() => {
      const open = loadOpenShift(db, user.id);
      const br = open?.breaks.find((b) => b.endAt === null);
      if (!open || !br) throw new HttpError(409, "Aucune pause en cours.");
      db.prepare("UPDATE breaks SET end_at = ? WHERE id = ?").run(now, br.id);
    })();
    return dashboard(db, user);
  });
}
