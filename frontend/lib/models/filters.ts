import { db } from "../db";

export interface SavedFilter {
  id: number;
  name: string;
  filter_json: string; // Serialized filter criteria
  created_at: string;
  updated_at: string;
}

export function saveFilter(name: string, filterJson: string): SavedFilter {
  const stmt = db.prepare(`
    INSERT INTO saved_filters (name, filter_json, created_at, updated_at)
    VALUES (@name, @filterJson, datetime('now'), datetime('now'))
    RETURNING *
  `);

  return stmt.get({ name, filterJson }) as SavedFilter;
}

export function listSavedFilters(): SavedFilter[] {
  return db.prepare("SELECT * FROM saved_filters ORDER BY created_at DESC").all() as SavedFilter[];
}

export function deleteSavedFilter(id: number): boolean {
  const info = db.prepare("DELETE FROM saved_filters WHERE id = ?").run(id);
  return info.changes > 0;
}
