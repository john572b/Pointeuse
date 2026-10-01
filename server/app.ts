import { Hono, type Context } from "hono";
import { ZodError } from "zod";
import { d1, type DB } from "./db";
import { configFrom, type Config, type Env } from "./env";
import { resolveSession } from "./auth/session";
import type { UserRow } from "./services/data";
import { authRoutes } from "./routes/auth";
import { webauthnRoutes } from "./routes/webauthn";
import { accountRoutes } from "./routes/account";
import { clockRoutes } from "./routes/clock";
import { dataRoutes } from "./routes/data";
import { settingsRoutes } from "./routes/settings";
import { exportRoutes } from "./routes/export";
import { pushRoutes } from "./routes/push";

export interface Vars {
  db: DB;
  cfg: Config;
  user: UserRow | null;
  sessionId: string | null;
}
export type AppEnv = { Bindings: Env; Variables: Vars };
export type App = Hono<AppEnv>;
export type Ctx = Context<AppEnv>;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Renvoie l'utilisateur authentifié ou lève une 401. */
export function requireUser(c: Ctx): UserRow {
  const u = c.get("user");
  if (!u) throw new HttpError(401, "Veuillez vous connecter.");
  return u;
}

/** Limite les tentatives par IP via le binding de rate limiting ; sans binding (tests), pas de limite. */
export async function rateLimit(c: Ctx, key: string) {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const r = await c.env.AUTH_LIMIT?.limit({ key: `${key}:${ip}` });
  if (r && !r.success) throw new HttpError(429, "Trop de tentatives. Réessayez dans une minute.");
}

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** Lit le corps JSON (objet vide si absent ou invalide ; la validation zod fait le reste). */
export async function body(c: Ctx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

/** Application `/api/*`. Les fichiers statiques sont servis par Workers Assets. */
export function buildApp(opts: { db?: DB } = {}): App {
  const app: App = new Hono();

  app.use("/api/*", async (c, next) => {
    const cfg = configFrom(c.env);
    const db = opts.db ?? d1(c.env.DB);
    c.set("cfg", cfg);
    c.set("db", db);
    c.set("user", null);
    c.set("sessionId", null);
    // Anti-CSRF : toute requête mutante doit porter l'en-tête applicatif et venir de notre origine.
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      const sameSite = !origin || origin === cfg.origin || safeHost(origin) === c.req.header("host");
      if (c.req.header("x-requested-with") !== "pointeuse" || !sameSite) return c.json({ error: "Requête refusée." }, 403);
    }
    const s = await resolveSession(db, c, cfg);
    if (s) {
      c.set("user", s.user);
      c.set("sessionId", s.sessionId);
    }
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
  });

  app.onError((err: any, c) => {
    if (err instanceof ZodError) return c.json({ error: err.issues[0]?.message ?? "Données invalides.", issues: err.issues }, 400);
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: "Une erreur inattendue est survenue." }, 500);
  });

  const api = new Hono<AppEnv>();
  api.get("/health", (c) => c.json({ ok: true }));
  api.route("/", authRoutes());
  api.route("/", webauthnRoutes());
  api.route("/", accountRoutes());
  api.route("/", clockRoutes());
  api.route("/", dataRoutes());
  api.route("/", settingsRoutes());
  api.route("/", exportRoutes());
  api.route("/", pushRoutes());
  api.all("/*", (c) => c.json({ error: "Introuvable." }, 404));
  app.route("/api", api);

  return app;
}
