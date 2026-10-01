import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config";
import { requireUser } from "../app";
import { uuid } from "../auth/crypto";

export async function pushRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get("/push/key", async () => ({ publicKey: config.vapid?.publicKey ?? null }));

  app.post("/push/subscribe", async (req) => {
    const user = requireUser(req);
    const body = z
      .object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) })
      .parse(req.body);
    db.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    ).run(uuid(), user.id, body.endpoint, body.keys.p256dh, body.keys.auth, Date.now());
    return { ok: true };
  });

  app.post("/push/unsubscribe", async (req) => {
    const user = requireUser(req);
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, user.id);
    return { ok: true };
  });
}
