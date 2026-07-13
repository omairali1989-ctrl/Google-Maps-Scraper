import { db } from "../db";

export interface ScrapeJobInput {
  query: string;
  format?: string;
  headless?: number; // 0 or 1
}

export interface ScrapeJob extends ScrapeJobInput {
  id: number;
  status: "running" | "completed" | "stopped" | "failed";
  started_at: string;
  completed_at?: string;
  record_count: number;
  error_message?: string;
  current_step?: "idle" | "scrolling" | "scraping" | "stopped" | "completed" | "failed";
  total_items?: number;
  processed_items?: number;
  success_count?: number;
  failure_count?: number;
  current_query?: string;
}

export function createJob(input: ScrapeJobInput): ScrapeJob {
  const format = input.format || "excel";
  const headless = input.headless ?? 1;

  const stmt = db.prepare(`
    INSERT INTO scrape_jobs (query, format, headless, status, started_at, current_step, total_items, processed_items, success_count, failure_count)
    VALUES (@query, @format, @headless, 'running', datetime('now'), 'idle', 0, 0, 0, 0)
    RETURNING *
  `);

  return stmt.get({ query: input.query, format, headless }) as ScrapeJob;
}

export function updateJobStatus(
  id: number,
  status: ScrapeJob["status"],
  recordCount?: number,
  errorMessage?: string
): ScrapeJob | undefined {
  const hasCompleted = ["completed", "stopped", "failed"].includes(status);
  
  let query = `
    UPDATE scrape_jobs
    SET status = @status
  `;

  if (recordCount !== undefined) {
    query += `, record_count = @recordCount`;
  }
  if (errorMessage !== undefined) {
    query += `, error_message = @errorMessage`;
  }
  if (hasCompleted) {
    query += `, completed_at = datetime('now')`;
  } else {
    query += `, completed_at = NULL`;
  }

  query += ` WHERE id = @id RETURNING *`;

  const stmt = db.prepare(query);
  return stmt.get({ id, status, recordCount, errorMessage }) as ScrapeJob | undefined;
}

export function resumeJobInDb(id: number): ScrapeJob | undefined {
  const stmt = db.prepare(`
    UPDATE scrape_jobs
    SET status = 'running',
        completed_at = NULL,
        error_message = NULL,
        current_step = 'idle'
    WHERE id = ?
    RETURNING *
  `);
  return stmt.get(id) as ScrapeJob | undefined;
}

export function getJobById(id: number): ScrapeJob | undefined {
  return db.prepare("SELECT * FROM scrape_jobs WHERE id = ?").get(id) as ScrapeJob | undefined;
}

export function listJobs(limit: number = 20, offset: number = 0): ScrapeJob[] {
  return db
    .prepare("SELECT * FROM scrape_jobs ORDER BY started_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as ScrapeJob[];
}

export function getLatestActiveJob(): ScrapeJob | undefined {
  return db
    .prepare("SELECT * FROM scrape_jobs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1")
    .get() as ScrapeJob | undefined;
}

export function listJobsFiltered(
  status?: string,
  limit: number = 50,
  offset: number = 0,
  search?: string,
  scope?: { userId: number; isAdmin: boolean }
): { jobs: ScrapeJob[]; total: number } {
  let whereClause = "WHERE 1=1";
  const params: Record<string, unknown> = { limit, offset };

  // Tenant isolation: non-admins only see their own jobs.
  if (scope && !scope.isAdmin) {
    whereClause += " AND user_id = @scopeUserId";
    params.scopeUserId = scope.userId;
  }
  if (status && status !== "all") {
    whereClause += " AND status = @status";
    params.status = status;
  }
  if (search) {
    whereClause += " AND (query LIKE @search OR current_query LIKE @search)";
    params.search = `%${search}%`;
  }

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM scrape_jobs ${whereClause}`);
  const { total } = countStmt.get(params) as { total: number };

  const dataStmt = db.prepare(
    `SELECT * FROM scrape_jobs ${whereClause} ORDER BY started_at DESC LIMIT @limit OFFSET @offset`
  );
  const jobs = dataStmt.all(params) as ScrapeJob[];

  return { jobs, total };
}

export function countJobsByStatus(
  scope?: { userId: number; isAdmin: boolean }
): Record<string, number> {
  let where = "";
  const params: Record<string, unknown> = {};
  if (scope && !scope.isAdmin) {
    where = "WHERE user_id = @scopeUserId";
    params.scopeUserId = scope.userId;
  }
  const rows = db
    .prepare(`SELECT status, COUNT(*) as count FROM scrape_jobs ${where} GROUP BY status`)
    .all(params) as { status: string; count: number }[];

  const result: Record<string, number> = { all: 0, running: 0, completed: 0, stopped: 0, failed: 0 };
  for (const row of rows) {
    result[row.status] = row.count;
    result.all += row.count;
  }
  return result;
}

export interface ScrapeItem {
  id: number;
  job_id: number;
  query: string;
  url: string;
  status: string;
  error_message?: string;
  scraped_at: string;
}

export function getJobItems(jobId: number): ScrapeItem[] {
  return db
    .prepare("SELECT * FROM scrape_items WHERE job_id = ? ORDER BY scraped_at ASC")
    .all(jobId) as ScrapeItem[];
}

export function deleteJob(id: number): boolean {
  const result = db.prepare("DELETE FROM scrape_jobs WHERE id = ?").run(id);
  return result.changes > 0;
}
