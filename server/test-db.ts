/** Implémentation de `DB` sur better-sqlite3, pour les tests (même SQL que D1). */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db";

export function testDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const dir = path.resolve(__dirname, "../migrations");
  for (const f of fs.readdirSync(dir).sort()) sqlite.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  const fix = (p: any) => (p instanceof Uint8Array ? Buffer.from(p) : p);
  return {
    first: async (sql, ...params) => (sqlite.prepare(sql).get(...params.map(fix)) as any) ?? null,
    all: async (sql, ...params) => sqlite.prepare(sql).all(...params.map(fix)) as any,
    run: async (sql, ...params) => ({ changes: sqlite.prepare(sql).run(...params.map(fix)).changes }),
    batch: async (stmts) => {
      sqlite.transaction(() => {
        for (const [sql, params] of stmts) sqlite.prepare(sql).run(...(params ?? []).map(fix));
      })();
    },
  };
}
