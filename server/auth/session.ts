import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { DB } from "../db";
import type { Config } from "../env";
import type { UserRow } from "../services/data";
import { randomToken, sha256 } from "./crypto";

const DAY = 86_400_000;

export async function createSession(db: DB, c: Context, cfg: Config, userId: string) {
  const token = randomToken();
  const now = Date.now();
  await db.run(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
    await sha256(token),
    userId,
    now,
    now + cfg.sessionDays * DAY,
    now,
    (c.req.header("user-agent") ?? "").slice(0, 300),
    c.req.header("cf-connecting-ip") ?? null,
  );
  setCookie(c, cfg.cookieName, token, { path: "/", httpOnly: true, secure: cfg.secure, sameSite: "Lax", maxAge: cfg.sessionDays * 86400 });
}

export async function destroySession(db: DB, c: Context, cfg: Config) {
  const token = getCookie(c, cfg.cookieName);
  if (token) await db.run("DELETE FROM sessions WHERE id = ?", await sha256(token));
  deleteCookie(c, cfg.cookieName, { path: "/", secure: cfg.secure });
}

/** Résout l'utilisateur de la requête (expiration glissante, prolongée au plus une fois par heure). */
export async function resolveSession(db: DB, c: Context, cfg: Config): Promise<{ user: UserRow; sessionId: string } | null> {
  const token = getCookie(c, cfg.cookieName);
  if (!token || token.length > 100) return null;
  const id = await sha256(token);
  const row = await db.first<{ user_id: string; expires_at: number; last_seen_at: number }>("SELECT user_id, expires_at, last_seen_at FROM sessions WHERE id = ?", id);
  const now = Date.now();
  if (!row) return null;
  if (row.expires_at < now) {
    await db.run("DELETE FROM sessions WHERE id = ?", id);
    return null;
  }
  if (now - row.last_seen_at > 3_600_000) {
    await db.run("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", now, now + cfg.sessionDays * DAY, id);
  }
  const user = await db.first<UserRow>("SELECT * FROM users WHERE id = ?", row.user_id);
  return user ? { user, sessionId: id } : null;
}
