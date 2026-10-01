import { Hono } from "hono";
import { z } from "zod";
import { body, requireUser, type AppEnv } from "../app";
import { uuid } from "../auth/crypto";

export function pushRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/push/key", (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY ?? null }));

  r.post("/push/subscribe", async (c) => {
    const user = requireUser(c);
    const b = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).parse(await body(c));
    await c.get("db").run(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      uuid(),
      user.id,
      b.endpoint,
      b.keys.p256dh,
      b.keys.auth,
      Date.now(),
    );
    return c.json({ ok: true });
  });

  r.post("/push/unsubscribe", async (c) => {
    const user = requireUser(c);
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(await body(c));
    await c.get("db").run("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", endpoint, user.id);
    return c.json({ ok: true });
  });

  return r;
}
