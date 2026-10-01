import { buildPushPayload } from "@block65/webcrypto-web-push";
import { DateTime } from "luxon";
import type { DB } from "../db";
import type { Env } from "../env";
import { prefsOf, type UserRow } from "../services/data";
import { dashboard } from "../services/overview";

/**
 * Rappels intelligents envoyés par Web Push (déclenchés par le cron du Worker toutes les 5 minutes).
 * Anti-spam : chaque rappel a une clé unique (par journée / pause / semaine) et n'est envoyé qu'une fois ;
 * aucun rappel la nuit (22 h – 7 h, heure de l'utilisateur) sauf si une journée est en cours.
 */
export interface Reminder {
  key: string;
  title: string;
  body: string;
}

export async function remindersFor(db: DB, user: UserRow, now = Date.now()): Promise<Reminder[]> {
  const prefs = prefsOf(user);
  if (!prefs.remindersEnabled) return [];
  const d = await dashboard(db, user, now);
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

export async function runReminders(db: DB, env: Env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const vapid = { subject: env.VAPID_SUBJECT ?? "mailto:admin@boi.lu", publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const users = await db.all<UserRow>("SELECT DISTINCT u.* FROM users u JOIN push_subscriptions p ON p.user_id = u.id");
  for (const user of users) {
    let reminders: Reminder[];
    try {
      reminders = await remindersFor(db, user);
    } catch (e) {
      console.error("reminders: compute failed", e);
      continue;
    }
    // Au plus un rappel par passage, pour rester discret.
    let next: Reminder | undefined;
    for (const rem of reminders) {
      if (!(await db.first("SELECT 1 FROM notification_log WHERE user_id = ? AND key = ?", user.id, rem.key))) {
        next = rem;
        break;
      }
    }
    if (!next) continue;
    await db.run("INSERT OR IGNORE INTO notification_log (user_id, key, sent_at) VALUES (?, ?, ?)", user.id, next.key, Date.now());
    const subs = await db.all<{ id: string; endpoint: string; p256dh: string; auth: string }>("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?", user.id);
    for (const s of subs) {
      try {
        const payload = await buildPushPayload(
          { data: JSON.stringify({ title: next.title, body: next.body, url: "/" }), options: { ttl: 3600 } },
          { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
          vapid,
        );
        const res = await fetch(s.endpoint, payload);
        if (res.status === 404 || res.status === 410) await db.run("DELETE FROM push_subscriptions WHERE id = ?", s.id);
        else if (!res.ok) console.error("reminders: push failed", res.status, await res.text());
      } catch (e) {
        console.error("reminders: push failed", e);
      }
    }
  }
  await db.run("DELETE FROM notification_log WHERE sent_at < ?", Date.now() - 60 * 86_400_000);
}
