import { config } from "./config";
import { openDatabase } from "./db";
import { buildApp } from "./app";
import { startReminderJob } from "./jobs/reminders";

const db = openDatabase(config.dbPath);
const app = await buildApp(db, { logger: true, serveStatic: true });
const stopReminders = startReminderJob(db, (msg, err) => app.log.error({ err }, msg));

// Nettoyage périodique des sessions et jetons expirés.
const cleanup = setInterval(() => {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM password_resets WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").run(now);
}, 3_600_000);

const shutdown = async () => {
  clearInterval(cleanup);
  stopReminders();
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: config.host });
