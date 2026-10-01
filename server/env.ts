import type { D1Database, RateLimit } from "@cloudflare/workers-types";

/** Bindings et variables du Worker (voir wrangler.toml et `wrangler secret put`). */
export interface Env {
  DB: D1Database;
  /** Limitation des tentatives de connexion (binding « ratelimits »). */
  AUTH_LIMIT?: RateLimit;
  APP_URL: string;
  /** Secret : poivre des mots de passe. Obligatoire en production. */
  PASSWORD_PEPPER: string;
  /** Secrets facultatifs : e-mails (Resend) et notifications push (VAPID). */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface Config {
  appUrl: string;
  origin: string;
  rpId: string;
  rpName: string;
  secure: boolean;
  cookieName: string;
  sessionDays: number;
  pepper: string;
}

export function configFrom(env: Env): Config {
  const url = new URL(env.APP_URL);
  const secure = url.protocol === "https:";
  return {
    appUrl: url.origin,
    origin: url.origin,
    rpId: url.hostname,
    rpName: "Pointeuse",
    secure,
    cookieName: secure ? "__Host-pointeuse_session" : "pointeuse_session",
    sessionDays: 30,
    pepper: env.PASSWORD_PEPPER ?? "",
  };
}
