import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { migrations } from "./migrations";

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((r: any) => r.version as number));
  for (const [i, sql] of migrations.entries()) {
    const version = i + 1;
    if (done.has(version)) continue;
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, Date.now());
    })();
  }
}
