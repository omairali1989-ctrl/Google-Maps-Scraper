"""
Centralized SQLite access for the scraper backend.

Every connection in the backend should be created through :func:`get_connection`
so that WAL mode, a busy timeout, and sane pragmas are applied consistently.
Without these, concurrent scraper processes writing to the same file routinely
hit ``sqlite3.OperationalError: database is locked``.
"""

import sqlite3
import time
from contextlib import contextmanager

from settings import DB_PATH

# How long (ms) SQLite waits for a lock to clear before raising "database is
# locked". With WAL + this timeout, concurrent jobs serialize writes cleanly.
BUSY_TIMEOUT_MS = 15000


def get_connection(db_path: str = None, row_factory: bool = False) -> sqlite3.Connection:
    """Return a SQLite connection tuned for concurrent multi-process access."""
    path = db_path or DB_PATH
    conn = sqlite3.connect(path, timeout=BUSY_TIMEOUT_MS / 1000)
    if row_factory:
        conn.row_factory = sqlite3.Row
    # WAL lets readers and a single writer proceed without blocking each other;
    # NORMAL sync is safe under WAL and much faster than FULL.
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS};")
        conn.execute("PRAGMA foreign_keys=ON;")
    except sqlite3.Error:
        # Pragmas are best-effort; a failure here should not break the caller.
        pass
    return conn


@contextmanager
def connection(db_path: str = None, row_factory: bool = False):
    """Context manager that commits on success, rolls back on error, always closes."""
    conn = get_connection(db_path, row_factory=row_factory)
    try:
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        raise
    finally:
        conn.close()


def execute_with_retry(fn, retries: int = 5, base_delay: float = 0.2):
    """Run ``fn`` (which does its own DB work) retrying on transient lock errors.

    Even with a busy timeout, a hard-contended write can surface as
    ``database is locked``; this adds bounded exponential backoff on top.
    """
    last_err = None
    for attempt in range(retries):
        try:
            return fn()
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() or "busy" in str(e).lower():
                last_err = e
                time.sleep(base_delay * (2 ** attempt))
                continue
            raise
    if last_err:
        raise last_err
