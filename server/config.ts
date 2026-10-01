import path from "node:path";

const env = process.env;
const isProd = env.NODE_ENV === "production";

const appUrl = env.APP_URL ?? (isProd ? "https://pointeuse.boi.lu" : "http://localhost:5173");
const url = new URL(appUrl);

export const config = {
  isProd,
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? "0.0.0.0",
  appUrl,
  /** Origines autorisées pour les requêtes mutantes (anti-CSRF). */
  allowedOrigins: new Set([url.origin, ...(env.EXTRA_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])]),
  rpId: env.WEBAUTHN_RP_ID ?? url.hostname,
  rpName: "Pointeuse",
  dbPath: env.DATABASE_PATH ?? path.resolve("data/pointeuse.db"),
  sessionDays: 30,
  cookieName: isProd ? "__Host-pointeuse_session" : "pointeuse_session",
  cookieSecure: isProd || url.protocol === "https:",
  trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === "true" : isProd,
  smtp: env.SMTP_URL ? { url: env.SMTP_URL, from: env.MAIL_FROM ?? "Pointeuse <no-reply@boi.lu>" } : null,
  vapid:
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? "mailto:admin@boi.lu" }
      : null,
  staticDir: env.STATIC_DIR ?? path.resolve("dist/web"),
};
