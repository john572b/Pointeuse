import type { FastifyInstance } from "fastify";
import { DateTime } from "luxon";
import { z } from "zod";
import { requireUser } from "../app";
import { uuid } from "../auth/crypto";
import { loadRuleVersions, makeRulesFor } from "../services/data";
import { payRulesSchema } from "../../shared/pay/rules";
import { isoDate } from "../../shared/schemas";

export async function settingsRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get("/settings/pay", async (req) => {
    const user = requireUser(req);
    const versions = loadRuleVersions(db, user.id);
    const today = DateTime.now().setZone(user.timezone).toISODate()!;
    return { rules: makeRulesFor(versions)(today), versions: versions.map((v) => ({ id: v.id, effectiveFrom: v.effectiveFrom })) };
  });

  /**
   * Enregistre de nouvelles règles.
   * - `effectiveFrom` : date à partir de laquelle elles s'appliquent (l'historique antérieur garde les anciennes) ;
   * - absent : elles s'appliquent à tout l'historique (les versions précédentes sont remplacées).
   */
  app.put("/settings/pay", async (req) => {
    const user = requireUser(req);
    const body = z.object({ rules: payRulesSchema, effectiveFrom: isoDate.nullable().default(null) }).parse(req.body);
    const json = JSON.stringify(body.rules);
    db.transaction(() => {
      if (body.effectiveFrom === null) {
        db.prepare("DELETE FROM pay_rule_versions WHERE user_id = ?").run(user.id);
        db.prepare("INSERT INTO pay_rule_versions (id, user_id, effective_from, rules, created_at) VALUES (?, ?, '1970-01-01', ?, ?)").run(uuid(), user.id, json, Date.now());
      } else {
        // Les versions postérieures sont remplacées par la nouvelle.
        db.prepare("DELETE FROM pay_rule_versions WHERE user_id = ? AND effective_from >= ?").run(user.id, body.effectiveFrom);
        db.prepare("INSERT INTO pay_rule_versions (id, user_id, effective_from, rules, created_at) VALUES (?, ?, ?, ?, ?)").run(uuid(), user.id, body.effectiveFrom, json, Date.now());
      }
    })();
    return { ok: true };
  });
}
