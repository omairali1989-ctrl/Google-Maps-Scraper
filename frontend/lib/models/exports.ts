import { db } from "../db";

export interface ExportHistoryItem {
  id: number;
  filename: string;
  format: string;
  record_count: number;
  filter_applied?: string;
  created_at: string;
  file_size_bytes: number;
}

export function logExport(input: {
  filename: string;
  format: string;
  record_count: number;
  filter_applied?: string;
  file_size_bytes?: number;
}): ExportHistoryItem {
  const stmt = db.prepare(`
    INSERT INTO export_history (filename, format, record_count, filter_applied, file_size_bytes, created_at)
    VALUES (@filename, @format, @record_count, @filter_applied, @file_size_bytes, datetime('now'))
    RETURNING *
  `);

  return stmt.get({
    filename: input.filename,
    format: input.format,
    record_count: input.record_count,
    filter_applied: input.filter_applied || null,
    file_size_bytes: input.file_size_bytes || 0,
  }) as ExportHistoryItem;
}

export function listExportHistory(): ExportHistoryItem[] {
  return db.prepare("SELECT * FROM export_history ORDER BY created_at DESC").all() as ExportHistoryItem[];
}

export function deleteExportFromHistory(id: number): boolean {
  const info = db.prepare("DELETE FROM export_history WHERE id = ?").run(id);
  return info.changes > 0;
}
