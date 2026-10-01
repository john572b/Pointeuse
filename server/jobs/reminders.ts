import webpush from "web-push";
import { DateTime } from "luxon";
import { config } from "../config";
import type { DB } from "../db";
import { prefsOf, type UserRow } from "../services/data";
import { dashboard } from "../services/overview";

/**
 * Rappels intelligents envoyés par Web Push.
 * Anti-spam : chaque rappel a une clé unique (par journée / pause / semaine) et n'est envoyé qu'une fois ;
 * aucun rappel la nuit (22 h – 7 h, heure de l'utilisateur) sauf si une journée est en cours.
 */
export interface Reminder {
  key: string;
  title: string;
  body: string;
}

export function remindersFor(db: DB, user: UserRow, now = Date.now()): Reminder[] {
  const prefs = prefsOf(user);
  if (!prefs.remindersEnabled) return [];
  const d = dashboard(db, user, now);
  const out: Reminder[] = [];
  const local = DateTime.fromMillis(now, { zone: user.timezone });

  if (d.openShift) {
    const elapsedH = (now - d.openShift.startAt) / 3_600_000;
    if (elapsedH >= prefs.reminderLongShiftHours) {
      out.push({ key: `long-shift:${d.openShift.id}`, title: "Toujours au travail ?", body: `Vous avez commencé votre journée il y a ${Math.floor(elapsedH)} heures.` });
    }
    if (elapsedH >= Math.max(prefs.reminderLongShiftHours + 3, 12)) {
      out.push({ key: `forgot-out:${d.openShift.id}`, title: "Oubli de pointage ?", body: "Vous avez peut-être oublié de pointer votre sortie." });
    }
    if (d.currentBreakStart) {
      const breakMin = (now - d.currentBreakStart) / 60_000;
      if (breakMin >= prefs.reminderBreakMinutes) {
        const label = breakMin >= 120 ? `${Math.floor(breakMin / 60)} heures` : breakMin >= 60 ? "1 heure" : `${Math.floor(breakMin)} minutes`;
        out.push({ key: `long-break:${d.currentBreakStart}`, title: "Pause en cours", body: `Votre pause dure depuis ${label}.` });
      }
    }
  }

  const goalMs = d.week.goalHours * 3_600_000;
  if (goalMs > 0 && d.week.workedMs >= goalMs) {
    out.push({ key: `goal:${local.weekYear}-${local.weekNumber}`, title: "Objectif atteint 🎉", body: "Vous avez atteint votre objectif hebdomadaire." });
  }

  const quiet = local.hour >= 22 || local.hour < 7;
  return quiet && !d.openShift ? [] : out;
}

export function startReminderJob(db: DB, log: (msg: string, err?: unknown) => void) {
  if (!config.vapid) return () => {};
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);

  const tick = async () => {
    const users = db.prepare("SELECT DISTINCT u.* FROM users u JOIN push_subscriptions p ON p.user_id = u.id").all() as UserRow[];
    for (const user of users) {
      let reminders: Reminder[];
      try {
        reminders = remindersFor(db, user);
      } catch (e) {
        log("reminders: compute failed", e);
        continue;
      }
      // Au plus un rappel par passage, pour rester discret.
      const next = reminders.find((r) => !db.prepare("SELECT 1 FROM notification_log WHERE user_id = ? AND key = ?").get(user.id, r.key));
      if (!next) continue;
      db.prepare("INSERT OR IGNORE INTO notification_log (user_id, key, sent_at) VALUES (?, ?, ?)").run(user.id, next.key, Date.now());
      const subs = db.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?").all(user.id) as any[];
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: next.title, body: next.body, url: "/" }), {
            TTL: 3600,
          });
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(s.id);
          else log("reminders: push failed", e);
        }
      }
    }
    db.prepare("DELETE FROM notification_log WHERE sent_at < ?").run(Date.now() - 60 * 86_400_000);
  };
  const timer = setInterval(() => void tick().catch((e) => log("reminders: tick failed", e)), 5 * 60_000);
  return () => clearInterval(timer);
}
