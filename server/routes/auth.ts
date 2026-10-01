import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config";
import { HttpError, requireUser } from "../app";
import { burnPasswordTime, hashPassword, randomToken, sha256, uuid, verifyPassword } from "../auth/crypto";
import { createSession, destroySession } from "../auth/session";
import { publicUser, type UserRow } from "../services/data";
import { emailSchema, firstNameSchema, passwordSchema } from "../../shared/schemas";
import { layout, sendMail } from "../services/mail";
import { DEFAULT_RULES } from "../../shared/pay/rules";

const authLimit = { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } };

export async function authRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get("/auth/me", async (req) => {
    const user = requireUser(req);
    return { user: publicUser(db, user) };
  });

  app.post("/auth/register", authLimit, async (req, reply) => {
    const body = z
      .object({ email: emailSchema, password: passwordSchema, firstName: firstNameSchema, timezone: z.string().max(64).optional() })
      .parse(req.body);
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(body.email)) {
      throw new HttpError(409, "Un compte existe déjà avec cette adresse e-mail.");
    }
    const id = uuid();
    const now = Date.now();
    const tz = body.timezone && isValidZone(body.timezone) ? body.timezone : "Europe/Luxembourg";
    const passwordHash = await hashPassword(body.password);
    db.transaction(() => {
      db.prepare("INSERT INTO users (id, email, password_hash, first_name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        body.email,
        passwordHash,
        body.firstName,
        tz,
        now,
        now,
      );
      db.prepare("INSERT INTO pay_rule_versions (id, user_id, effective_from, rules, created_at) VALUES (?, ?, ?, ?, ?)").run(
        uuid(),
        id,
        "1970-01-01",
        JSON.stringify(DEFAULT_RULES),
        now,
      );
    })();
    createSession(db, reply, req, id);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
    return { user: publicUser(db, user) };
  });

  app.post("/auth/login", authLimit, async (req, reply) => {
    const body = z.object({ email: emailSchema, password: z.string().max(200) }).parse(req.body);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(body.email) as UserRow | undefined;
    if (!user) {
      await burnPasswordTime(body.password);
      throw new HttpError(401, "E-mail ou mot de passe incorrect.");
    }
    if (!(await verifyPassword(user.password_hash, body.password))) throw new HttpError(401, "E-mail ou mot de passe incorrect.");
    createSession(db, reply, req, user.id);
    return { user: publicUser(db, user) };
  });

  app.post("/auth/logout", async (req, reply) => {
    destroySession(db, req, reply);
    return { ok: true };
  });

  app.post("/auth/forgot", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req) => {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const user = db.prepare("SELECT id, first_name FROM users WHERE email = ?").get(email) as { id: string; first_name: string } | undefined;
    if (user) {
      const token = randomToken();
      db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id);
      db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), user.id, Date.now() + 3_600_000);
      const url = `${config.appUrl}/reinitialiser?token=${token}`;
      await sendMail(
        email,
        "Réinitialisation de votre mot de passe",
        `Bonjour ${user.first_name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
        layout("Nouveau mot de passe", `Bonjour ${escapeHtml(user.first_name)}, cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien est valable 1 heure.`, { label: "Choisir un mot de passe", url }),
      ).catch((e) => req.log.error(e));
    }
    // Réponse identique que le compte existe ou non.
    return { ok: true };
  });

  app.post("/auth/reset", authLimit, async (req, reply) => {
    const body = z.object({ token: z.string().min(10).max(100), password: passwordSchema }).parse(req.body);
    const row = db.prepare("SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?").get(sha256(body.token)) as
      | { user_id: string; expires_at: number; used_at: number | null }
      | undefined;
    if (!row || row.used_at || row.expires_at < Date.now()) throw new HttpError(400, "Ce lien n'est plus valide. Faites une nouvelle demande.");
    const hash = await hashPassword(body.password);
    db.transaction(() => {
      db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, Date.now(), row.user_id);
      db.prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ?").run(Date.now(), sha256(body.token));
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
    })();
    createSession(db, reply, req, row.user_id);
    return { ok: true };
  });
}

export function isValidZone(tz: string) {
  try {
    new Intl.DateTimeFormat("fr", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
