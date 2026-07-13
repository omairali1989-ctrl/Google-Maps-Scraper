import { Database } from "better-sqlite3";

export function initSchema(db: Database) {
  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Create main records table
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      name TEXT NOT NULL,
      phone TEXT,
      google_maps_url TEXT,
      website TEXT,
      email TEXT,
      business_status TEXT,
      address TEXT,
      total_reviews TEXT,
      booking_links TEXT,
      rating TEXT,
      hours TEXT,
      latitude REAL,
      longitude REAL,
      country TEXT,
      city TEXT,
      region TEXT,
      source_query TEXT,
      scraped_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      tags TEXT DEFAULT '[]',
      is_favorite INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      dedup_hash TEXT,
      UNIQUE(dedup_hash)
    );
  `);

  // Create FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
      name, address, category, email, phone, website,
      content='records', content_rowid='id'
    );
  `);

  // Create triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
      INSERT INTO records_fts(rowid, name, address, category, email, phone, website)
      VALUES (new.id, new.name, new.address, new.category, new.email, new.phone, new.website);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
      INSERT INTO records_fts(records_fts, rowid, name, address, category, email, phone, website)
      VALUES ('delete', old.id, old.name, old.address, old.category, old.email, old.phone, old.website);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
      INSERT INTO records_fts(records_fts, rowid, name, address, category, email, phone, website)
      VALUES ('delete', old.id, old.name, old.address, old.category, old.email, old.phone, old.website);
      INSERT INTO records_fts(rowid, name, address, category, email, phone, website)
      VALUES (new.id, new.name, new.address, new.category, new.email, new.phone, new.website);
    END;
  `);

  // Create indexes for fast lookup and filtering
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_country ON records(country);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_city ON records(city);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_category ON records(category);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_source_query ON records(source_query);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_scraped_at ON records(scraped_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_dedup_hash ON records(dedup_hash);`);

  // Create scrape job history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scrape_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      format TEXT DEFAULT 'excel',
      headless INTEGER DEFAULT 1,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      record_count INTEGER DEFAULT 0,
      error_message TEXT,
      current_step TEXT DEFAULT 'idle',
      total_items INTEGER DEFAULT 0,
      processed_items INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      current_query TEXT
    );
  `);

  // Migration: Add columns to scrape_jobs if they don't exist
  const addColumn = (table: string, column: string, type: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
    } catch (e) {
      // column already exists
    }
  };
  addColumn("scrape_jobs", "current_step", "TEXT DEFAULT 'idle'");
  addColumn("scrape_jobs", "total_items", "INTEGER DEFAULT 0");
  addColumn("scrape_jobs", "processed_items", "INTEGER DEFAULT 0");
  addColumn("scrape_jobs", "success_count", "INTEGER DEFAULT 0");
  addColumn("scrape_jobs", "failure_count", "INTEGER DEFAULT 0");
  addColumn("scrape_jobs", "current_query", "TEXT");

  // Create scrape items table for queueing and status
  db.exec(`
    CREATE TABLE IF NOT EXISTS scrape_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      query TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      scraped_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(job_id) REFERENCES scrape_jobs(id) ON DELETE CASCADE,
      UNIQUE(job_id, url)
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_scrape_items_job_id ON scrape_items(job_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scrape_items_status ON scrape_items(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scrape_items_url ON scrape_items(url);`);

  // Create saved filters table
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      filter_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Create export history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS export_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      format TEXT NOT NULL,
      record_count INTEGER DEFAULT 0,
      filter_applied TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      file_size_bytes INTEGER DEFAULT 0
    );
  `);

  // Migration: Add enrichment columns to records table
  addColumn("records", "enriched_company_info", "TEXT");
  addColumn("records", "social_profiles", "TEXT");
  addColumn("records", "owner_name", "TEXT");
  addColumn("records", "ceo_name", "TEXT");
  addColumn("records", "coo_name", "TEXT");
  addColumn("records", "executives", "TEXT");
  addColumn("records", "linkedin_url", "TEXT");
  addColumn("records", "is_enriched", "INTEGER DEFAULT 0");

  // Migration: website (non-AI) enrichment columns. Mirrors the backend
  // migration in app/webenrichstore.py so both tiers agree on the schema.
  addColumn("records", "web_emails", "TEXT");
  addColumn("records", "web_phones", "TEXT");
  addColumn("records", "web_whatsapp", "TEXT");
  addColumn("records", "web_socials", "TEXT");
  addColumn("records", "web_title", "TEXT");
  addColumn("records", "web_description", "TEXT");
  addColumn("records", "web_tech", "TEXT");
  addColumn("records", "web_domain", "TEXT");
  addColumn("records", "web_http_status", "INTEGER");
  addColumn("records", "web_pages_crawled", "INTEGER DEFAULT 0");
  addColumn("records", "email_valid", "INTEGER");
  addColumn("records", "phone_valid", "INTEGER");
  addColumn("records", "lead_score", "INTEGER");
  addColumn("records", "lead_grade", "TEXT");
  addColumn("records", "duplicate_of", "INTEGER");
  addColumn("records", "web_enriched", "INTEGER DEFAULT 0");
  addColumn("records", "web_enriched_at", "TEXT");
  addColumn("records", "web_enrich_error", "TEXT");

  // Website enrichment job tracking (parallels backend web_enrichment_jobs).
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_enrichment_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'queued',
      total INTEGER DEFAULT 0,
      processed INTEGER DEFAULT 0,
      succeeded INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      filter_json TEXT,
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT
    );
  `);

  // Create API Keys table
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(provider)
    );
  `);

  // Create Enrichment Usage table
  db.exec(`
    CREATE TABLE IF NOT EXISTS enrichment_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0.0,
      record_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Queue / analytics columns on scrape_jobs
  addColumn("scrape_jobs", "queued_at", "TEXT");
  addColumn("scrape_jobs", "priority", "INTEGER DEFAULT 0");
  addColumn("scrape_jobs", "attempts", "INTEGER DEFAULT 0");
  addColumn("scrape_jobs", "enable_enrichment", "INTEGER DEFAULT 0");
  addColumn("scrape_jobs", "enrichment_model", "TEXT");

  // Persistent, timestamped per-job logs (survive backend restarts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      level TEXT DEFAULT 'info',
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_job_logs_created_at ON job_logs(created_at);`);

  // Retry history: one row per retry attempt of a scrape item
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_retries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      url TEXT,
      attempt INTEGER DEFAULT 1,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_job_retries_job_id ON job_retries(job_id);`);

  // In-dashboard alerts for failed jobs / critical errors
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      severity TEXT DEFAULT 'error',
      title TEXT NOT NULL,
      detail TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_is_read ON alerts(is_read);`);

  // ------------------------------------------------------------------ //
  // Auth / multi-tenancy
  // ------------------------------------------------------------------ //

  // Users. password_hash is pbkdf2_hmac(sha256) as "pbkdf2$iterations$salt$hash".
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER DEFAULT 1,
      failed_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      totp_secret TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(username)
    );
  `);

  // Server-side sessions. token is a random opaque id stored in an HttpOnly cookie.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);`);

  // Audit log (admin-only visibility, enforced in the API layer).
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      ip TEXT,
      action TEXT NOT NULL,
      resource TEXT,
      previous_value TEXT,
      new_value TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);`);

  // Formalize tables the Python backend created ad-hoc so the frontend sees them.
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_used_at TEXT,
      fail_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(url)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      format TEXT DEFAULT 'excel',
      headless INTEGER DEFAULT 1,
      enable_enrichment INTEGER DEFAULT 0,
      enrichment_model TEXT,
      run_at TEXT NOT NULL,
      interval_minutes INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      last_run_at TEXT,
      run_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Add user_id ownership to every tenant-scoped resource.
  addColumn("scrape_jobs", "user_id", "INTEGER");
  addColumn("records", "user_id", "INTEGER");
  addColumn("saved_filters", "user_id", "INTEGER");
  addColumn("export_history", "user_id", "INTEGER");
  addColumn("api_keys", "user_id", "INTEGER");
  addColumn("scheduled_jobs", "user_id", "INTEGER");
  addColumn("job_logs", "user_id", "INTEGER");
  addColumn("alerts", "user_id", "INTEGER");
  addColumn("enrichment_usage", "user_id", "INTEGER");
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_user ON scrape_jobs(user_id);`);
  // Composite index for cross-job dedup (records WHERE user_id AND google_maps_url)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_records_user_url ON records(user_id, google_maps_url);`
  );
  // Alerts are read via a join on job_id -> scrape_jobs; index the join key.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_job ON alerts(job_id);`);
  // Scheduled jobs are polled by (is_active, run_at) in the scheduler loop.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_scheduled_active_runat ON scheduled_jobs(is_active, run_at);`
  );

  // NOTE: the first admin user is created by the Python backend (app/authstore.py),
  // which is the single source of truth for password hashing and also backfills
  // ownerless rows to that admin. This keeps one canonical hashing implementation.
}
