import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, requireUser } from "../app";
import { hashPassword, verifyPassword } from "../auth/crypto";
import { destroySession } from "../auth/session";
import { DEFAULT_PREFS, prefsOf, publicUser, type UserRow } from "../services/data";
import { emailSchema, firstNameSchema, passwordSchema } from "../../shared/schemas";
import { isValidZone } from "./auth";

const prefsSchema = z
  .object({
    remindersEnabled: z.boolean(),
    reminderLongShiftHours: z.number().min(1).max(24),
    reminderBreakMinutes: z.number().int().min(5).max(600),
    weeklyGoalHours: z.number().min(0).max(168).nullable(),
    geolocation: z.boolean(),
  })
  .partial();

export async function accountRoutes(app: FastifyInstance) {
  const db = app.db;
  const fresh = (id: string) => db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;

  app.patch("/account/profile", async (req) => {
    const user = requireUser(req);
    const body = z
      .object({
        firstName: firstNameSchema,
        timezone: z.string().max(64).refine(isValidZone, "Fuseau horaire inconnu."),
        currency: z.string().regex(/^[A-Z]{3}$/, "Devise invalide."),
        theme: z.enum(["system", "light", "dark"]),
        prefs: prefsSchema,
      })
      .partial()
      .parse(req.body);
    const prefs = body.prefs ? { ...DEFAULT_PREFS, ...prefsOf(user), ...body.prefs } : prefsOf(user);
    db.prepare("UPDATE users SET first_name = ?, timezone = ?, currency = ?, theme = ?, prefs = ?, updated_at = ? WHERE id = ?").run(
      body.firstName ?? user.first_name,
      body.timezone ?? user.timezone,
      body.currency ?? user.currency,
      body.theme ?? user.theme,
      JSON.stringify(prefs),
      Date.now(),
      user.id,
    );
    return { user: publicUser(db, fresh(user.id)) };
  });

  app.post("/account/onboarded", async (req) => {
    const user = requireUser(req);
    db.prepare("UPDATE users SET onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?").run(Date.now(), user.id);
    return { user: publicUser(db, fresh(user.id)) };
  });

  app.post("/account/password", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req) => {
    const user = requireUser(req);
    const body = z.object({ current: z.string().max(200), next: passwordSchema }).parse(req.body);
    if (!(await verifyPassword(user.password_hash, body.current))) throw new HttpError(400, "Mot de passe actuel incorrect.");
    const hash = await hashPassword(body.next);
    db.transaction(() => {
      db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, Date.now(), user.id);
      // Déconnecte tous les autres appareils.
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(user.id, req.sessionId);
    })();
    return { ok: true };
  });

  app.post("/account/email", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req) => {
    const user = requireUser(req);
    const body = z.object({ password: z.string().max(200), email: emailSchema }).parse(req.body);
    if (!(await verifyPassword(user.password_hash, body.password))) throw new HttpError(400, "Mot de passe incorrect.");
    if (db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(body.email, user.id)) throw new HttpError(409, "Cette adresse est déjà utilisée.");
    db.prepare("UPDATE users SET email = ?, updated_at = ? WHERE id = ?").run(body.email, Date.now(), user.id);
    return { user: publicUser(db, fresh(user.id)) };
  });

  app.post("/account/logout-others", async (req) => {
    const user = requireUser(req);
    const r = db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(user.id, req.sessionId);
    return { ok: true, count: r.changes };
  });

  app.post("/account/delete", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const user = requireUser(req);
    const body = z.object({ password: z.string().max(200) }).parse(req.body);
    if (!(await verifyPassword(user.password_hash, body.password))) throw new HttpError(400, "Mot de passe incorrect.");
    destroySession(db, req, reply);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id); // cascade sur toutes les données
    return { ok: true };
  });
}
