import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config";
import type { DB } from "../db";
import type { UserRow } from "../services/data";
import { randomToken, sha256 } from "./crypto";

const DAY = 86_400_000;

export function createSession(db: DB, reply: FastifyReply, req: FastifyRequest, userId: string) {
  const token = randomToken();
  const now = Date.now();
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    sha256(token),
    userId,
    now,
    now + config.sessionDays * DAY,
    now,
    (req.headers["user-agent"] ?? "").slice(0, 300),
    req.ip,
  );
  reply.setCookie(config.cookieName, token, {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    maxAge: config.sessionDays * 86400,
  });
}

export function destroySession(db: DB, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[config.cookieName];
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
  reply.clearCookie(config.cookieName, { path: "/", secure: config.cookieSecure, httpOnly: true, sameSite: "lax" });
}

/** Résout l'utilisateur de la requête (expiration glissante, mise à jour au plus une fois par heure). */
export function resolveSession(db: DB, req: FastifyRequest): { user: UserRow; sessionId: string } | null {
  const token = req.cookies[config.cookieName];
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const row = db.prepare("SELECT user_id, expires_at, last_seen_at FROM sessions WHERE id = ?").get(id) as
    | { user_id: string; expires_at: number; last_seen_at: number }
    | undefined;
  const now = Date.now();
  if (!row) return null;
  if (row.expires_at < now) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  if (now - row.last_seen_at > 3_600_000) {
    db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(now, now + config.sessionDays * DAY, id);
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id) as UserRow | undefined;
  return user ? { user, sessionId: id } : null;
}
