/**
 * Accès à la base : une interface minimale au-dessus de D1 (production)
 * ou de better-sqlite3 (tests), pour que le reste du serveur ne dépende d'aucun des deux.
 */
import type { D1Database } from "@cloudflare/workers-types";

export type Row = Record<string, any>;
export type Param = string | number | null | Uint8Array;
export type Stmt = [sql: string, params?: Param[]];

export interface DB {
  first<T = Row>(sql: string, ...params: Param[]): Promise<T | null>;
  all<T = Row>(sql: string, ...params: Param[]): Promise<T[]>;
  run(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  /** Exécute plusieurs écritures de façon atomique. */
  batch(stmts: Stmt[]): Promise<void>;
}

export function d1(db: D1Database): DB {
  return {
    first: async (sql, ...params) => (await db.prepare(sql).bind(...params).first()) as any,
    all: async (sql, ...params) => ((await db.prepare(sql).bind(...params).all()).results ?? []) as any,
    run: async (sql, ...params) => {
      const r = await db.prepare(sql).bind(...params).run();
      return { changes: r.meta.changes ?? 0 };
    },
    batch: async (stmts) => {
      if (stmts.length === 0) return;
      await db.batch(stmts.map(([sql, params]) => db.prepare(sql).bind(...(params ?? []))));
    },
  };
}
