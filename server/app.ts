import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { config } from "./config";
import type { DB } from "./db";
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

declare module "fastify" {
  interface FastifyRequest {
    user: UserRow | null;
    sessionId: string | null;
  }
  interface FastifyInstance {
    db: DB;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Renvoie l'utilisateur authentifié ou lève une 401. */
export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw new HttpError(401, "Veuillez vous connecter.");
  return req.user;
}

export async function buildApp(db: DB, opts: { logger?: boolean; serveStatic?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, disableRequestLogging: true, trustProxy: config.trustProxy, bodyLimit: 256 * 1024 });
  app.decorate("db", db);
  app.decorateRequest("user", null);
  app.decorateRequest("sessionId", null);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { global: false });

  // Anti-CSRF : toute requête mutante doit porter l'en-tête applicatif et venir de notre origine.
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      if (req.headers["x-requested-with"] !== "pointeuse" || (origin && !config.allowedOrigins.has(origin))) {
        return reply.code(403).send({ error: "Requête refusée." });
      }
    }
    const s = resolveSession(db, req);
    if (s) {
      req.user = s.user;
      req.sessionId = s.sessionId;
    }
    reply.header("Cache-Control", "no-store");
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues[0]?.message ?? "Données invalides.", issues: err.issues });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err.statusCode === 429) return reply.code(429).send({ error: "Trop de tentatives. Réessayez dans quelques minutes." });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "Une erreur inattendue est survenue." });
  });

  await app.register(
    async (api) => {
      api.get("/health", async () => ({ ok: true }));
      await api.register(authRoutes);
      await api.register(webauthnRoutes);
      await api.register(accountRoutes);
      await api.register(clockRoutes);
      await api.register(dataRoutes);
      await api.register(settingsRoutes);
      await api.register(exportRoutes);
      await api.register(pushRoutes);
      api.all("/*", async (_req, reply) => reply.code(404).send({ error: "Introuvable." }));
    },
    { prefix: "/api" },
  );

  if (opts.serveStatic && fs.existsSync(config.staticDir)) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      wildcard: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.header("Cache-Control", "public, max-age=31536000, immutable");
        else res.header("Cache-Control", "no-cache");
      },
    });
    const index = fs.readFileSync(path.join(config.staticDir, "index.html"));
    // Fallback SPA : toute route inconnue renvoie l'application.
    app.setNotFoundHandler((req, reply) => {
      if ((req.method !== "GET" && req.method !== "HEAD") || req.url.startsWith("/api/")) return reply.code(404).send({ error: "Introuvable." });
      return reply.type("text/html").header("Cache-Control", "no-cache").send(index);
    });
  }
  return app;
}
