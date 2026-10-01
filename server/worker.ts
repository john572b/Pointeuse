import type { ExecutionContext, ScheduledEvent } from "@cloudflare/workers-types";
import { buildApp } from "./app";
import { d1 } from "./db";
import type { Env } from "./env";
import { runReminders } from "./jobs/reminders";

const app = buildApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx as any),

  /** Cron (wrangler.toml) : rappels push + nettoyage des sessions et jetons expirés. */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const db = d1(env.DB);
    const now = Date.now();
    ctx.waitUntil(
      (async () => {
        await db.batch([
          ["DELETE FROM sessions WHERE expires_at < ?", [now]],
          ["DELETE FROM password_resets WHERE expires_at < ?", [now]],
          ["DELETE FROM auth_challenges WHERE expires_at < ?", [now]],
        ]);
        await runReminders(db, env);
      })(),
    );
  },
};
