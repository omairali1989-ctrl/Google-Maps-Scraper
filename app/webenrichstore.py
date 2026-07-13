"""
Schema + persistence helpers for the *website* (non-AI) lead-enrichment
pipeline. This is deliberately separate from `scraper/enricher.py` (the LLM
enrichment), which stays untouched.

It extends the EXISTING `records` table with new columns and adds one small
`web_enrichment_jobs` table for tracking enrichment runs. All migrations are
idempotent best-effort ALTERs, matching the pattern in jobstore.ensure_tables().
"""

from db import get_connection, execute_with_retry

# New columns added to the existing `records` table. Kept as plain TEXT/INTEGER
# so nothing in the existing read paths breaks; structured data is stored as
# JSON strings (same convention as the existing social_profiles/executives).
RECORD_COLUMNS = [
    ("web_emails", "TEXT"),            # JSON array of discovered emails
    ("web_phones", "TEXT"),           # JSON array of discovered phones (E.164)
    ("web_whatsapp", "TEXT"),         # JSON array of wa.me / whatsapp numbers
    ("web_socials", "TEXT"),          # JSON object {facebook, instagram, linkedin, ...}
    ("web_title", "TEXT"),            # <title> of the homepage
    ("web_description", "TEXT"),      # meta description
    ("web_tech", "TEXT"),             # JSON array of detected technologies (2nd pass)
    ("web_domain", "TEXT"),           # registrable domain of the website
    ("web_http_status", "INTEGER"),   # final HTTP status of the homepage
    ("web_pages_crawled", "INTEGER DEFAULT 0"),
    ("email_valid", "INTEGER"),       # 1/0/NULL -- primary email deliverable-format check
    ("phone_valid", "INTEGER"),       # 1/0/NULL -- primary phone parseable/valid
    ("lead_score", "INTEGER"),        # 0-100 rule-based score
    ("lead_grade", "TEXT"),           # A/B/C/D derived from lead_score
    ("duplicate_of", "INTEGER"),      # records.id this row is a duplicate of, or NULL
    ("web_enriched", "INTEGER DEFAULT 0"),   # 1 once website enrichment ran
    ("web_enriched_at", "TEXT"),
    ("web_enrich_error", "TEXT"),     # last error message if enrichment failed
]


def ensure_tables():
    """Idempotently add enrichment columns + the tracking table."""

    def _create():
        conn = get_connection()
        cur = conn.cursor()

        for col, decl in RECORD_COLUMNS:
            try:
                cur.execute(f"ALTER TABLE records ADD COLUMN {col} {decl}")
            except Exception:
                pass  # already exists

        cur.execute(
            """
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
            )
            """
        )

        # Helpful indexes for the dedup + filter paths (all best-effort).
        for stmt in [
            "CREATE INDEX IF NOT EXISTS idx_records_web_domain ON records(web_domain)",
            "CREATE INDEX IF NOT EXISTS idx_records_web_enriched ON records(web_enriched)",
            "CREATE INDEX IF NOT EXISTS idx_records_lead_score ON records(lead_score)",
            "CREATE INDEX IF NOT EXISTS idx_records_duplicate_of ON records(duplicate_of)",
            "CREATE INDEX IF NOT EXISTS idx_web_enrich_jobs_user ON web_enrichment_jobs(user_id)",
        ]:
            try:
                cur.execute(stmt)
            except Exception:
                pass

        conn.commit()
        conn.close()

    try:
        execute_with_retry(_create)
    except Exception:
        pass


def create_enrichment_job(user_id, filter_json, total):
    """Insert a new web_enrichment_jobs row; return its id."""
    def _write():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO web_enrichment_jobs (status, total, filter_json, user_id, started_at)
            VALUES ('running', ?, ?, ?, datetime('now'))
            """,
            (total, filter_json, user_id),
        )
        job_id = cur.lastrowid
        conn.commit()
        conn.close()
        return job_id

    return execute_with_retry(_write)


def update_enrichment_progress(job_id, processed=None, succeeded=None,
                               failed=None, skipped=None, status=None,
                               error_message=None):
    """Patch a subset of progress counters/status on an enrichment job."""
    sets = []
    params = []
    for col, val in [
        ("processed", processed),
        ("succeeded", succeeded),
        ("failed", failed),
        ("skipped", skipped),
        ("status", status),
        ("error_message", error_message),
    ]:
        if val is not None:
            sets.append(f"{col} = ?")
            params.append(val)
    if status in ("completed", "failed", "stopped"):
        sets.append("completed_at = datetime('now')")
    if not sets:
        return
    params.append(job_id)

    def _write():
        conn = get_connection()
        conn.execute(
            f"UPDATE web_enrichment_jobs SET {', '.join(sets)} WHERE id = ?",
            tuple(params),
        )
        conn.commit()
        conn.close()

    try:
        execute_with_retry(_write)
    except Exception:
        pass


def get_enrichment_job(job_id):
    """Return an enrichment job row as a dict, or None."""
    def _read():
        conn = get_connection(row_factory=True)
        row = conn.execute(
            "SELECT * FROM web_enrichment_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        conn.close()
        return dict(row) if row else None

    try:
        return execute_with_retry(_read)
    except Exception:
        return None
