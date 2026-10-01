import { Hono } from "hono";
import { DateTime } from "luxon";
import { z } from "zod";
import { requireUser, type AppEnv } from "../app";
import { dayViews } from "../services/overview";
import { isoDate } from "../../shared/schemas";
import { ABSENCE_LABELS } from "../../shared/pay/engine";

const hours = (ms: number) => (ms / 3_600_000).toFixed(2).replace(".", ",");
const csvCell = (v: string) => {
  // Neutralise l'injection de formules dans les tableurs.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function exportRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/export/csv", async (c) => {
    const user = requireUser(c);
    const q = z.object({ from: isoDate, to: isoDate }).parse(c.req.query());
    const { days } = await dayViews(c.get("db"), user, q.from, q.to);
    const t = (ms: number | null) => (ms ? DateTime.fromMillis(ms, { zone: user.timezone }).toFormat("HH:mm") : "");
    const header = ["Date", "Début", "Fin", "Pauses", "Temps de pause (h)", "Travaillé (h)", "Normales (h)", "Supplémentaires (h)", "Nuit (h)", "Férié", "Absence", "Salaire estimé", "Anomalies", "Note"];
    const lines = [header.join(";")];
    for (const d of days) {
      const breaks = d.shifts.flatMap((s) => s.breaks.map((b) => `${t(b.startAt)}-${t(b.endAt)}`)).join(" ");
      lines.push(
        [
          d.date,
          t(d.firstStart),
          t(d.lastEnd),
          breaks,
          hours(d.breakMs),
          hours(d.workedMs),
          hours(d.normalMs),
          hours(d.overtimeMs),
          hours(d.nightMs),
          d.holidayName ?? "",
          d.absence ? ABSENCE_LABELS[d.absence.kind as keyof typeof ABSENCE_LABELS] : "",
          (d.amountCents / 100).toFixed(2).replace(".", ","),
          d.anomalies.map((a) => a.message).join(" | "),
          d.shifts.map((s) => s.note).filter(Boolean).join(" | "),
        ]
          .map((v) => csvCell(String(v)))
          .join(";"),
      );
    }
    return c.body("﻿" + lines.join("\r\n"), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pointeuse_${q.from}_${q.to}.csv"`,
    });
  });

  /** Export complet des données personnelles (RGPD). */
  r.get("/account/export", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const q = (sql: string) => db.all(sql, user.id);
    const [payRules, shifts, breaks, absences, holidays] = await Promise.all([
      q("SELECT effective_from, rules FROM pay_rule_versions WHERE user_id = ?"),
      q("SELECT id, start_at, end_at, note, source, bonus_ids, edited_at FROM shifts WHERE user_id = ? ORDER BY start_at"),
      q("SELECT b.shift_id, b.start_at, b.end_at FROM breaks b JOIN shifts s ON s.id = b.shift_id WHERE s.user_id = ? ORDER BY b.start_at"),
      q("SELECT date, kind, paid, hours, note FROM absences WHERE user_id = ? ORDER BY date"),
      q("SELECT date, name FROM holidays WHERE user_id = ? ORDER BY date"),
    ]);
    c.header("Content-Disposition", 'attachment; filename="pointeuse_mes_donnees.json"');
    return c.json({
      exportedAt: new Date().toISOString(),
      profile: { email: user.email, firstName: user.first_name, timezone: user.timezone, currency: user.currency, createdAt: new Date(user.created_at).toISOString() },
      payRules: payRules.map((x) => ({ effectiveFrom: x.effective_from, rules: JSON.parse(x.rules) })),
      shifts,
      breaks,
      absences,
      holidays,
    });
  });

  return r;
}
