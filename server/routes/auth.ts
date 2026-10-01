import { Hono } from "hono";
import { z } from "zod";
import { HttpError, body, rateLimit, requireUser, type AppEnv } from "../app";
import { burnPasswordTime, hashPassword, randomToken, sha256, uuid, verifyPassword } from "../auth/crypto";
import { createSession, destroySession } from "../auth/session";
import { getUser, publicUser, type UserRow } from "../services/data";
import { emailSchema, firstNameSchema, passwordSchema } from "../../shared/schemas";
import { layout, sendMail } from "../services/mail";
import { DEFAULT_RULES } from "../../shared/pay/rules";

export function authRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/auth/me", async (c) => c.json({ user: await publicUser(c.get("db"), requireUser(c)) }));

  r.post("/auth/register", async (c) => {
    await rateLimit(c, "register");
    const db = c.get("db");
    const b = z.object({ email: emailSchema, password: passwordSchema, firstName: firstNameSchema, timezone: z.string().max(64).optional() }).parse(await body(c));
    if (await db.first("SELECT 1 FROM users WHERE email = ?", b.email)) throw new HttpError(409, "Un compte existe déjà avec cette adresse e-mail.");
    const id = uuid();
    const now = Date.now();
    const tz = b.timezone && isValidZone(b.timezone) ? b.timezone : "Europe/Luxembourg";
    const passwordHash = await hashPassword(b.password, c.get("cfg").pepper);
    await db.batch([
      ["INSERT INTO users (id, email, password_hash, first_name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, b.email, passwordHash, b.firstName, tz, now, now]],
      ["INSERT INTO pay_rule_versions (id, user_id, effective_from, rules, created_at) VALUES (?, ?, '1970-01-01', ?, ?)", [uuid(), id, JSON.stringify(DEFAULT_RULES), now]],
    ]);
    await createSession(db, c, c.get("cfg"), id);
    return c.json({ user: await publicUser(db, await getUser(db, id)) });
  });

  r.post("/auth/login", async (c) => {
    await rateLimit(c, "login");
    const db = c.get("db");
    const cfg = c.get("cfg");
    const b = z.object({ email: emailSchema, password: z.string().max(200) }).parse(await body(c));
    const user = await db.first<UserRow>("SELECT * FROM users WHERE email = ?", b.email);
    if (!user) {
      await burnPasswordTime(b.password, cfg.pepper);
      throw new HttpError(401, "E-mail ou mot de passe incorrect.");
    }
    if (!(await verifyPassword(user.password_hash, b.password, cfg.pepper))) throw new HttpError(401, "E-mail ou mot de passe incorrect.");
    await createSession(db, c, cfg, user.id);
    return c.json({ user: await publicUser(db, user) });
  });

  r.post("/auth/logout", async (c) => {
    await destroySession(c.get("db"), c, c.get("cfg"));
    return c.json({ ok: true });
  });

  r.post("/auth/forgot", async (c) => {
    await rateLimit(c, "forgot");
    const db = c.get("db");
    const { email } = z.object({ email: emailSchema }).parse(await body(c));
    const user = await db.first<{ id: string; first_name: string }>("SELECT id, first_name FROM users WHERE email = ?", email);
    if (user) {
      const token = randomToken();
      await db.batch([
        ["DELETE FROM password_resets WHERE user_id = ?", [user.id]],
        ["INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [await sha256(token), user.id, Date.now() + 3_600_000]],
      ]);
      const url = `${c.get("cfg").appUrl}/reinitialiser?token=${token}`;
      c.executionCtx.waitUntil(
        sendMail(
          c.env,
          email,
          "Réinitialisation de votre mot de passe",
          `Bonjour ${user.first_name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
          layout("Nouveau mot de passe", `Bonjour ${escapeHtml(user.first_name)}, cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien est valable 1 heure.`, { label: "Choisir un mot de passe", url }),
        ).catch((e) => console.error("mail", e)),
      );
    }
    // Réponse identique que le compte existe ou non.
    return c.json({ ok: true });
  });

  r.post("/auth/reset", async (c) => {
    await rateLimit(c, "reset");
    const db = c.get("db");
    const cfg = c.get("cfg");
    const b = z.object({ token: z.string().min(10).max(100), password: passwordSchema }).parse(await body(c));
    const tokenHash = await sha256(b.token);
    const row = await db.first<{ user_id: string; expires_at: number; used_at: number | null }>("SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?", tokenHash);
    if (!row || row.used_at || row.expires_at < Date.now()) throw new HttpError(400, "Ce lien n'est plus valide. Faites une nouvelle demande.");
    const hash = await hashPassword(b.password, cfg.pepper);
    await db.batch([
      ["UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [hash, Date.now(), row.user_id]],
      ["UPDATE password_resets SET used_at = ? WHERE token_hash = ?", [Date.now(), tokenHash]],
      ["DELETE FROM sessions WHERE user_id = ?", [row.user_id]],
    ]);
    await createSession(db, c, cfg, row.user_id);
    return c.json({ ok: true });
  });

  return r;
}

export function isValidZone(tz: string) {
  try {
    new Intl.DateTimeFormat("fr", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
