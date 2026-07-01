import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SCHEMA_SQL } from "./schema.js";

export type Sqlite = Database.Database;

/** Where the SQLite file lives. Override with DAYLIGHT_DB_PATH (e.g. /data/daylight.db
 *  on the Fly volume). Defaults to ./data/daylight.db under the current working dir. */
export function resolveDbPath(): string {
  const raw = process.env.DAYLIGHT_DB_PATH?.trim();
  if (raw && raw.length > 0) return raw;
  return resolve(process.cwd(), "data", "daylight.db");
}

/** Open a connection, ensure the parent dir exists, apply pragmas + schema. */
export function openConnection(path: string): Sqlite {
  if (path !== ":memory:" && !path.startsWith("file::memory:")) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL"); // web reads while the worker writes
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  return db;
}
