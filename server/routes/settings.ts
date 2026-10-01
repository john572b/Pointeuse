import { Hono } from "hono";
import { DateTime } from "luxon";
import { z } from "zod";
import { body, requireUser, type AppEnv } from "../app";
import { uuid } from "../auth/crypto";
import { loadRuleVersions, makeRulesFor } from "../services/data";
import { payRulesSchema } from "../../shared/pay/rules";
import { isoDate } from "../../shared/schemas";

export function settingsRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/settings/pay", async (c) => {
    const user = requireUser(c);
    const versions = await loadRuleVersions(c.get("db"), user.id);
    const today = DateTime.now().setZone(user.timezone).toISODate()!;
    return c.json({ rules: makeRulesFor(versions)(today), versions: versions.map((v) => ({ id: v.id, effectiveFrom: v.effectiveFrom })) });
  });

  /**
   * Enregistre de nouvelles règles.
   * - `effectiveFrom` : date à partir de laquelle elles s'appliquent (l'historique antérieur garde les anciennes) ;
   * - absent : elles s'appliquent à tout l'historique (les versions précédentes sont remplacées).
   */
  r.put("/settings/pay", async (c) => {
    const user = requireUser(c);
    const b = z.object({ rules: payRulesSchema, effectiveFrom: isoDate.nullable().default(null) }).parse(await body(c));
    const json = JSON.stringify(b.rules);
    const from = b.effectiveFrom ?? "1970-01-01";
    await c.get("db").batch([
      b.effectiveFrom === null
        ? ["DELETE FROM pay_rule_versions WHERE user_id = ?", [user.id]]
        : ["DELETE FROM pay_rule_versions WHERE user_id = ? AND effective_from >= ?", [user.id, from]],
      ["INSERT INTO pay_rule_versions (id, user_id, effective_from, rules, created_at) VALUES (?, ?, ?, ?, ?)", [uuid(), user.id, from, json, Date.now()]],
    ]);
    return c.json({ ok: true });
  });

  return r;
}
