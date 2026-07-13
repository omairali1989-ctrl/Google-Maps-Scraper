"""
Network policy helpers: user-agent rotation, proxy rotation, and rate limiting.

Config lives in the ``app_config`` key/value table and the ``proxies`` table,
both managed from the dashboard Settings page. Everything degrades gracefully:
if no proxies are configured, requests go direct; if rate limiting is off, no
delay is applied.
"""

import random
import threading
import time

from db import get_connection

# A small, realistic desktop UA pool. Rotated per request / per job so repeated
# hits to the same site don't share a fingerprint.
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
]

_DEFAULT_UA = USER_AGENTS[0]

# Per-domain last-request timestamps for rate limiting (process-local).
_last_request = {}
_rl_lock = threading.Lock()


def ensure_tables():
    """Create config + proxy tables if the frontend hasn't. Idempotent."""
    def _create():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS proxies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                last_used_at TEXT,
                fail_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(url)
            )
            """
        )
        conn.commit()
        conn.close()

    try:
        _create()
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Config accessors
# --------------------------------------------------------------------------- #
def get_config(key, default=None):
    try:
        conn = get_connection()
        row = conn.execute(
            "SELECT value FROM app_config WHERE key = ?", (key,)
        ).fetchone()
        conn.close()
        if row is None:
            return default
        return row[0]
    except Exception:
        return default


def set_config(key, value):
    try:
        conn = get_connection()
        conn.execute(
            "INSERT INTO app_config (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def _config_bool(key, default=False):
    val = get_config(key, None)
    if val is None:
        return default
    return str(val).lower() in ("1", "true", "yes", "on")


def _config_float(key, default=0.0):
    try:
        val = get_config(key, None)
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- #
# User-agent rotation
# --------------------------------------------------------------------------- #
def rotation_enabled():
    # UA rotation defaults ON; it's safe and free.
    return _config_bool("ua_rotation_enabled", default=True)


def random_user_agent():
    if not rotation_enabled():
        return _DEFAULT_UA
    return random.choice(USER_AGENTS)


def headers(extra=None):
    """Return request headers with a (possibly rotated) User-Agent."""
    h = {"User-Agent": random_user_agent()}
    if extra:
        h.update(extra)
    return h


# --------------------------------------------------------------------------- #
# Proxy rotation
# --------------------------------------------------------------------------- #
def list_active_proxies():
    try:
        conn = get_connection()
        rows = conn.execute(
            "SELECT url FROM proxies WHERE is_active = 1 ORDER BY COALESCE(last_used_at, '') ASC"
        ).fetchall()
        conn.close()
        return [r[0] for r in rows]
    except Exception:
        return []


def next_proxy():
    """Pick the least-recently-used active proxy, or None if none configured."""
    proxies = list_active_proxies()
    if not proxies:
        return None
    url = proxies[0]
    try:
        conn = get_connection()
        conn.execute(
            "UPDATE proxies SET last_used_at = datetime('now') WHERE url = ?", (url,)
        )
        conn.commit()
        conn.close()
    except Exception:
        pass
    return url


def proxies_dict(proxy_url=None):
    """Return a requests-style proxies dict, or None to go direct."""
    url = proxy_url or next_proxy()
    if not url:
        return None
    return {"http": url, "https": url}


def mark_proxy_failure(proxy_url):
    if not proxy_url:
        return
    try:
        conn = get_connection()
        conn.execute(
            "UPDATE proxies SET fail_count = fail_count + 1 WHERE url = ?", (proxy_url,)
        )
        # Auto-disable a proxy after repeated failures.
        conn.execute(
            "UPDATE proxies SET is_active = 0 WHERE url = ? AND fail_count >= 5",
            (proxy_url,),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Rate limiting
# --------------------------------------------------------------------------- #
def rate_limit_delay():
    """Configured minimum seconds between requests to the same domain (0 = off)."""
    return _config_float("rate_limit_seconds", default=0.0)


def _domain(url):
    try:
        from urllib.parse import urlparse

        return urlparse(url).netloc or "_"
    except Exception:
        return "_"


def throttle(url):
    """Block until the per-domain rate limit has elapsed. No-op if disabled."""
    delay = rate_limit_delay()
    if delay <= 0:
        return
    domain = _domain(url)
    with _rl_lock:
        last = _last_request.get(domain)
        now = time.time()
        if last is not None:
            wait = delay - (now - last)
            if wait > 0:
                time.sleep(wait)
        _last_request[domain] = time.time()


# --------------------------------------------------------------------------- #
# Convenience: a rate-limited, UA-rotated, proxy-aware requests.get
# --------------------------------------------------------------------------- #
def get(url, timeout=10, extra_headers=None, allow_redirects=True, use_proxy=True):
    """Drop-in wrapper around requests.get applying UA + proxy + rate limiting."""
    import requests

    throttle(url)
    proxy = proxies_dict() if use_proxy else None
    proxy_url = proxy["http"] if proxy else None
    try:
        return requests.get(
            url,
            headers=headers(extra_headers),
            timeout=timeout,
            allow_redirects=allow_redirects,
            proxies=proxy,
        )
    except Exception:
        if proxy_url:
            mark_proxy_failure(proxy_url)
        raise
