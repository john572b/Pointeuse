import { Hono } from "hono";
import { z } from "zod";
import { HttpError, body, rateLimit, requireUser, type AppEnv } from "../app";
import { hashPassword, verifyPassword } from "../auth/crypto";
import { destroySession } from "../auth/session";
import { DEFAULT_PREFS, getUser, prefsOf, publicUser } from "../services/data";
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

export function accountRoutes() {
  const r = new Hono<AppEnv>();

  r.patch("/account/profile", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const b = z
      .object({
        firstName: firstNameSchema,
        timezone: z.string().max(64).refine(isValidZone, "Fuseau horaire inconnu."),
        currency: z.string().regex(/^[A-Z]{3}$/, "Devise invalide."),
        theme: z.enum(["system", "light", "dark"]),
        prefs: prefsSchema,
      })
      .partial()
      .parse(await body(c));
    const prefs = b.prefs ? { ...DEFAULT_PREFS, ...prefsOf(user), ...b.prefs } : prefsOf(user);
    await db.run(
      "UPDATE users SET first_name = ?, timezone = ?, currency = ?, theme = ?, prefs = ?, updated_at = ? WHERE id = ?",
      b.firstName ?? user.first_name,
      b.timezone ?? user.timezone,
      b.currency ?? user.currency,
      b.theme ?? user.theme,
      JSON.stringify(prefs),
      Date.now(),
      user.id,
    );
    return c.json({ user: await publicUser(db, await getUser(db, user.id)) });
  });

  r.post("/account/onboarded", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    await db.run("UPDATE users SET onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?", Date.now(), user.id);
    return c.json({ user: await publicUser(db, await getUser(db, user.id)) });
  });

  r.post("/account/password", async (c) => {
    await rateLimit(c, "password");
    const user = requireUser(c);
    const db = c.get("db");
    const pepper = c.get("cfg").pepper;
    const b = z.object({ current: z.string().max(200), next: passwordSchema }).parse(await body(c));
    if (!(await verifyPassword(user.password_hash, b.current, pepper))) throw new HttpError(400, "Mot de passe actuel incorrect.");
    const hash = await hashPassword(b.next, pepper);
    await db.batch([
      ["UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [hash, Date.now(), user.id]],
      // Déconnecte tous les autres appareils.
      ["DELETE FROM sessions WHERE user_id = ? AND id != ?", [user.id, c.get("sessionId")]],
    ]);
    return c.json({ ok: true });
  });

  r.post("/account/email", async (c) => {
    await rateLimit(c, "email");
    const user = requireUser(c);
    const db = c.get("db");
    const b = z.object({ password: z.string().max(200), email: emailSchema }).parse(await body(c));
    if (!(await verifyPassword(user.password_hash, b.password, c.get("cfg").pepper))) throw new HttpError(400, "Mot de passe incorrect.");
    if (await db.first("SELECT 1 FROM users WHERE email = ? AND id != ?", b.email, user.id)) throw new HttpError(409, "Cette adresse est déjà utilisée.");
    await db.run("UPDATE users SET email = ?, updated_at = ? WHERE id = ?", b.email, Date.now(), user.id);
    return c.json({ user: await publicUser(db, await getUser(db, user.id)) });
  });

  r.post("/account/logout-others", async (c) => {
    const user = requireUser(c);
    const res = await c.get("db").run("DELETE FROM sessions WHERE user_id = ? AND id != ?", user.id, c.get("sessionId"));
    return c.json({ ok: true, count: res.changes });
  });

  r.post("/account/delete", async (c) => {
    await rateLimit(c, "delete");
    const user = requireUser(c);
    const db = c.get("db");
    const b = z.object({ password: z.string().max(200) }).parse(await body(c));
    if (!(await verifyPassword(user.password_hash, b.password, c.get("cfg").pepper))) throw new HttpError(400, "Mot de passe incorrect.");
    await destroySession(db, c, c.get("cfg"));
    await db.run("DELETE FROM users WHERE id = ?", user.id); // cascade sur toutes les données
    return c.json({ ok: true });
  });

  return r;
}
