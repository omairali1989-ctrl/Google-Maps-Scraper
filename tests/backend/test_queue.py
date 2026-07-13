"""
Tests for the durable queue / concurrency behavior of JobManager and the
observability endpoints (analytics, alerts, logs, retries).
"""

import os
import sys
import time
import sqlite3
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../app")))


def _make_temp_db():
    path = tempfile.mktemp(suffix=".db")
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE scrape_jobs (
            id INTEGER PRIMARY KEY, query TEXT, status TEXT, format TEXT,
            headless INT, started_at TEXT DEFAULT (datetime('now')), completed_at TEXT,
            record_count INT DEFAULT 0, current_step TEXT, total_items INT DEFAULT 0,
            processed_items INT DEFAULT 0, success_count INT DEFAULT 0,
            failure_count INT DEFAULT 0, current_query TEXT, queued_at TEXT,
            priority INT DEFAULT 0, attempts INT DEFAULT 0,
            enable_enrichment INT DEFAULT 0, enrichment_model TEXT
        );
        """
    )
    conn.commit()
    conn.close()
    return path


# Module-level so multiprocessing 'spawn' (macOS default) can pickle it.
def _fast_dummy_process(query, fmt, headless, q, stop_event,
                        job_id=None, ee=False, em=None):
    import time as _t
    _t.sleep(0.8)
    if q is not None:
        q.put(("end", None))


def _reload_backend_with_db(db_path):
    """Import backend modules pointed at a temp DB, fresh each test."""
    for mod in ["app.web_bridge", "web_bridge", "db", "app.db", "jobstore",
                "app.jobstore", "settings", "app.settings"]:
        sys.modules.pop(mod, None)
    import settings
    settings.DB_PATH = db_path
    import db as dbmod
    dbmod.DB_PATH = db_path
    import jobstore  # noqa: F401
    import web_bridge
    web_bridge.run_scraper_process = _fast_dummy_process
    return web_bridge


def test_jobs_queue_when_over_concurrency():
    db = _make_temp_db()
    wb = _reload_backend_with_db(db)
    jm = wb.JobManager()
    jm.max_concurrent_jobs = 2

    # Seed rows so status updates have something to update.
    conn = sqlite3.connect(db)
    for i in range(1, 6):
        conn.execute(
            "INSERT INTO scrape_jobs (id, query, status, format, headless) "
            "VALUES (?, ?, 'running', 'excel', 1)",
            (i, f"q{i}"),
        )
    conn.commit()
    conn.close()

    for i in range(1, 6):
        ok, _ = jm.start_job(f"q{i}", "excel", True, job_id=str(i))
        assert ok

    # Exactly max_concurrent run; the rest queue.
    assert jm.get_running_count() == 2
    assert jm.get_queued_count() == 3

    # Queue drains as slots free.
    deadline = time.time() + 25
    while time.time() < deadline:
        if jm.get_running_count() == 0 and jm.get_queued_count() == 0:
            break
        time.sleep(0.3)
    assert jm.get_queued_count() == 0


def test_stop_cancels_queued_job():
    db = _make_temp_db()
    wb = _reload_backend_with_db(db)
    jm = wb.JobManager()
    jm.max_concurrent_jobs = 1

    conn = sqlite3.connect(db)
    for i in range(1, 4):
        conn.execute(
            "INSERT INTO scrape_jobs (id, query, status, format, headless) "
            "VALUES (?, ?, 'running', 'excel', 1)",
            (i, f"q{i}"),
        )
    conn.commit()
    conn.close()

    for i in range(1, 4):
        jm.start_job(f"q{i}", "excel", True, job_id=str(i))

    assert jm.get_queued_count() == 2
    # Cancel a queued job (id 3).
    assert jm.stop_job("3") is True
    assert jm.get_queued_count() == 1

    # Drain the rest so spawned child processes exit before teardown.
    deadline = time.time() + 25
    while time.time() < deadline:
        if jm.get_running_count() == 0 and jm.get_queued_count() == 0:
            break
        time.sleep(0.3)


def test_concurrency_ceiling_clamped(monkeypatch):
    db = _make_temp_db()
    monkeypatch.setenv("CHROME_MAX_CONCURRENT", "9999")
    wb = _reload_backend_with_db(db)
    jm = wb.JobManager()
    assert jm.max_concurrent_jobs <= wb.JobManager.MAX_CONCURRENCY_CEILING
