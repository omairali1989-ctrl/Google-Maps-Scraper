"""
Persistence helpers for job logs, retry history, alerts, and queue state.

The frontend (frontend/lib/schema.ts) owns table creation, but the backend may
run before the frontend has ever started, so this module also ensures the tables
it needs exist. All access goes through app.db for WAL/busy-timeout safety.
"""

import json

from db import get_connection, execute_with_retry


def ensure_tables():
    """Create logging/alerts tables if the frontend hasn't yet. Idempotent."""
    def _create():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS job_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT,
                level TEXT DEFAULT 'info',
                message TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id)"
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS job_retries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT,
                url TEXT,
                attempt INTEGER DEFAULT 1,
                reason TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_job_retries_job_id ON job_retries(job_id)"
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT,
                severity TEXT DEFAULT 'error',
                title TEXT NOT NULL,
                detail TEXT,
                is_read INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_alerts_is_read ON alerts(is_read)"
        )
        # Queue/analytics columns on scrape_jobs (best-effort ALTERs).
        for col, decl in [
            ("queued_at", "TEXT"),
            ("priority", "INTEGER DEFAULT 0"),
            ("attempts", "INTEGER DEFAULT 0"),
            ("enable_enrichment", "INTEGER DEFAULT 0"),
            ("enrichment_model", "TEXT"),
        ]:
            try:
                cur.execute(f"ALTER TABLE scrape_jobs ADD COLUMN {col} {decl}")
            except Exception:
                pass  # column already exists
        conn.commit()
        conn.close()

    try:
        execute_with_retry(_create)
    except Exception:
        pass


def add_log(job_id, message, level="info"):
    """Persist a single timestamped log line for a job."""
    def _write():
        conn = get_connection()
        conn.execute(
            "INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)",
            (str(job_id) if job_id is not None else None, level, message),
        )
        conn.commit()
        conn.close()

    try:
        execute_with_retry(_write)
    except Exception:
        pass


def record_retry(job_id, url, attempt, reason):
    def _write():
        conn = get_connection()
        conn.execute(
            "INSERT INTO job_retries (job_id, url, attempt, reason) VALUES (?, ?, ?, ?)",
            (str(job_id) if job_id is not None else None, url, attempt, reason),
        )
        conn.commit()
        conn.close()

    try:
        execute_with_retry(_write)
    except Exception:
        pass


def add_alert(title, detail=None, severity="error", job_id=None):
    def _write():
        conn = get_connection()
        conn.execute(
            "INSERT INTO alerts (job_id, severity, title, detail) VALUES (?, ?, ?, ?)",
            (
                str(job_id) if job_id is not None else None,
                severity,
                title,
                detail if isinstance(detail, str) or detail is None else json.dumps(detail),
            ),
        )
        conn.commit()
        conn.close()

    try:
        execute_with_retry(_write)
    except Exception:
        pass


def set_job_status(job_id, status, current_step=None):
    """Update scrape_jobs status (used for queue transitions)."""
    def _write():
        conn = get_connection()
        cur = conn.cursor()
        if current_step is not None:
            cur.execute(
                "UPDATE scrape_jobs SET status = ?, current_step = ? WHERE id = ?",
                (status, current_step, job_id),
            )
        else:
            cur.execute(
                "UPDATE scrape_jobs SET status = ? WHERE id = ?", (status, job_id)
            )
        conn.commit()
        conn.close()

    try:
        execute_with_retry(_write)
    except Exception:
        pass
