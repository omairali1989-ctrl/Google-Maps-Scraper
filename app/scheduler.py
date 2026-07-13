"""
Job scheduling: one-time and recurring scrape schedules.

A schedule row describes a scrape to run at a future time (``run_at``) and,
optionally, to repeat every ``interval_minutes``. The JobManager runs a
scheduler thread that polls for due schedules, creates a real scrape_jobs row,
enqueues it through the normal queue, and advances the schedule's next run.
"""

import json

from db import get_connection


def ensure_tables():
    def _create():
        conn = get_connection()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scheduled_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT NOT NULL,
                format TEXT DEFAULT 'excel',
                headless INTEGER DEFAULT 1,
                enable_enrichment INTEGER DEFAULT 0,
                enrichment_model TEXT,
                run_at TEXT NOT NULL,               -- next scheduled run (UTC)
                interval_minutes INTEGER DEFAULT 0, -- 0 => one-time
                is_active INTEGER DEFAULT 1,
                last_run_at TEXT,
                run_count INTEGER DEFAULT 0,
                user_id INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_scheduled_active ON scheduled_jobs(is_active, run_at)"
        )
        # Backfill column for tables created before user_id existed.
        try:
            conn.execute("ALTER TABLE scheduled_jobs ADD COLUMN user_id INTEGER")
        except Exception:
            pass
        conn.commit()
        conn.close()

    try:
        _create()
    except Exception:
        pass


def list_schedules():
    conn = get_connection(row_factory=True)
    rows = conn.execute(
        "SELECT * FROM scheduled_jobs ORDER BY is_active DESC, run_at ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_schedule(
    query,
    run_at,
    interval_minutes=0,
    format_value="excel",
    headless=True,
    enable_enrichment=False,
    enrichment_model=None,
    user_id=None,
):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO scheduled_jobs
            (query, format, headless, enable_enrichment, enrichment_model,
             run_at, interval_minutes, is_active, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        """,
        (
            query,
            format_value,
            1 if headless else 0,
            1 if enable_enrichment else 0,
            enrichment_model,
            run_at,
            int(interval_minutes or 0),
            user_id,
        ),
    )
    conn.commit()
    sched_id = cur.lastrowid
    conn.close()
    return sched_id


def schedule_owner(sched_id):
    conn = get_connection()
    row = conn.execute(
        "SELECT user_id FROM scheduled_jobs WHERE id = ?", (sched_id,)
    ).fetchone()
    conn.close()
    return row[0] if row else None


def delete_schedule(sched_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM scheduled_jobs WHERE id = ?", (sched_id,))
    conn.commit()
    changed = cur.rowcount
    conn.close()
    return changed > 0


def set_active(sched_id, active):
    conn = get_connection()
    conn.execute(
        "UPDATE scheduled_jobs SET is_active = ? WHERE id = ?",
        (1 if active else 0, sched_id),
    )
    conn.commit()
    conn.close()


def due_schedules():
    """Return active schedules whose run_at is now or in the past (UTC)."""
    conn = get_connection(row_factory=True)
    rows = conn.execute(
        "SELECT * FROM scheduled_jobs "
        "WHERE is_active = 1 AND run_at <= datetime('now')"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def advance_schedule(sched):
    """After firing, move a recurring schedule forward or deactivate a one-off."""
    conn = get_connection()
    cur = conn.cursor()
    interval = int(sched.get("interval_minutes") or 0)
    if interval > 0:
        cur.execute(
            """
            UPDATE scheduled_jobs
            SET last_run_at = datetime('now'),
                run_count = run_count + 1,
                run_at = datetime('now', ? )
            WHERE id = ?
            """,
            (f"+{interval} minutes", sched["id"]),
        )
    else:
        cur.execute(
            """
            UPDATE scheduled_jobs
            SET last_run_at = datetime('now'),
                run_count = run_count + 1,
                is_active = 0
            WHERE id = ?
            """,
            (sched["id"],),
        )
    conn.commit()
    conn.close()


def create_job_row(sched):
    """Create a scrape_jobs row for a fired schedule; return its integer id."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO scrape_jobs
            (query, format, headless, status, started_at, current_step,
             enable_enrichment, enrichment_model, user_id)
        VALUES (?, ?, ?, 'running', datetime('now'), 'idle', ?, ?, ?)
        """,
        (
            sched["query"],
            sched.get("format", "excel"),
            sched.get("headless", 1),
            sched.get("enable_enrichment", 0),
            sched.get("enrichment_model"),
            sched.get("user_id"),
        ),
    )
    conn.commit()
    job_id = cur.lastrowid
    conn.close()
    return str(job_id)
