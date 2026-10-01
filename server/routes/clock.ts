import { Hono } from "hono";
import { z } from "zod";
import { HttpError, body, requireUser, type AppEnv } from "../app";
import { uuid } from "../auth/crypto";
import { prefsOf } from "../services/data";
import { dashboard, loadOpenShift } from "../services/overview";

/** Position optionnelle (prévue pour la vérification du lieu de travail, désactivée par défaut). */
const locationSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000) }).optional();
const bodySchema = z.object({ location: locationSchema }).default({});

export function clockRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/dashboard", async (c) => c.json(await dashboard(c.get("db"), requireUser(c))));

  r.post("/clock/start", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const { location } = bodySchema.parse(await body(c));
    const loc = prefsOf(user).geolocation ? location : undefined;
    const now = Date.now();
    // L'index unique « une seule journée ouverte » protège aussi contre deux appuis simultanés.
    if (await loadOpenShift(db, user.id)) throw new HttpError(409, "Votre journée est déjà commencée.");
    try {
      await db.run(
        "INSERT INTO shifts (id, user_id, start_at, source, start_lat, start_lng, start_accuracy, created_at, updated_at) VALUES (?, ?, ?, 'clock', ?, ?, ?, ?, ?)",
        uuid(),
        user.id,
        now,
        loc?.lat ?? null,
        loc?.lng ?? null,
        loc?.accuracy ?? null,
        now,
        now,
      );
    } catch {
      throw new HttpError(409, "Votre journée est déjà commencée.");
    }
    return c.json(await dashboard(db, user));
  });

  r.post("/clock/stop", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const { location } = bodySchema.parse(await body(c));
    const loc = prefsOf(user).geolocation ? location : undefined;
    const now = Date.now();
    const open = await loadOpenShift(db, user.id);
    if (!open) throw new HttpError(409, "Aucune journée en cours.");
    await db.batch([
      ["UPDATE breaks SET end_at = ? WHERE shift_id = ? AND end_at IS NULL", [now, open.id]],
      ["UPDATE shifts SET end_at = ?, end_lat = ?, end_lng = ?, end_accuracy = ?, updated_at = ? WHERE id = ? AND user_id = ? AND end_at IS NULL", [now, loc?.lat ?? null, loc?.lng ?? null, loc?.accuracy ?? null, now, open.id, user.id]],
    ]);
    return c.json(await dashboard(db, user));
  });

  r.post("/clock/break/start", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const open = await loadOpenShift(db, user.id);
    if (!open) throw new HttpError(409, "Commencez d'abord votre journée.");
    if (open.breaks.some((b) => b.endAt === null)) throw new HttpError(409, "Vous êtes déjà en pause.");
    await db.run("INSERT INTO breaks (id, shift_id, start_at) VALUES (?, ?, ?)", uuid(), open.id, Date.now());
    return c.json(await dashboard(db, user));
  });

  r.post("/clock/break/end", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const open = await loadOpenShift(db, user.id);
    const br = open?.breaks.find((b) => b.endAt === null);
    if (!open || !br) throw new HttpError(409, "Aucune pause en cours.");
    await db.run("UPDATE breaks SET end_at = ? WHERE id = ? AND end_at IS NULL", Date.now(), br.id);
    return c.json(await dashboard(db, user));
  });

  return r;
}
