import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { initSchema } from "./schema";

declare global {
   
  var _sqliteDb: Database.Database | undefined;
}

const dbDir = path.join(process.cwd(), "..", "data");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, "extractrx.db");

// Tune the connection for concurrent access shared with the Python backend:
// WAL lets readers + the Python writer proceed without blocking, and a busy
// timeout makes better-sqlite3 wait for a lock instead of throwing SQLITE_BUSY.
function openDb(): Database.Database {
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("busy_timeout = 15000");
  database.pragma("foreign_keys = ON");
  initSchema(database);
  return database;
}

let db: Database.Database;

if (process.env.NODE_ENV === "production") {
  db = openDb();
} else {
  if (!global._sqliteDb) {
    global._sqliteDb = openDb();
  }
  db = global._sqliteDb;
}

export { db };
