"""
Authentication + multi-tenancy core: password hashing, users, sessions,
account lockout, first-run admin bootstrap, and audit logging.

Password hashing uses stdlib pbkdf2_hmac(sha256) with a per-user random salt and
a high iteration count. Format: ``pbkdf2$<iterations>$<salt_hex>$<hash_hex>``.
This avoids adding a native bcrypt/argon2 dependency to the offline setup while
remaining a sound, widely-used KDF. Sessions are opaque random tokens stored
server-side and referenced by an HttpOnly cookie.
"""

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

from db import get_connection

PBKDF2_ITERATIONS = 200_000
SESSION_TTL_DAYS = 7
REMEMBER_TTL_DAYS = 30
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

ROLE_ADMIN = "admin"
ROLE_USER = "user"


# --------------------------------------------------------------------------- #
# Password hashing
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt_hex, hash_hex = stored.split("$")
        if scheme != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iterations),
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# Schema + bootstrap
# --------------------------------------------------------------------------- #
def ensure_tables():
    def _create():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
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
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL,
                ip TEXT,
                user_agent TEXT
            )
            """
        )
        cur.execute(
            """
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
            )
            """
        )
        conn.commit()
        conn.close()

    try:
        _create()
    except Exception:
        pass


# Tables that carry per-user ownership; used for the first-run backfill.
_OWNED_TABLES = [
    "scrape_jobs",
    "records",
    "saved_filters",
    "export_history",
    "api_keys",
    "scheduled_jobs",
    "job_logs",
    "alerts",
    "enrichment_usage",
]


def bootstrap_admin():
    """Create a default admin on first run and backfill ownerless data to it.

    Returns the admin's id (existing or newly created). The default password is
    read from ADMIN_DEFAULT_PASSWORD (env) or falls back to 'admin'; the UI
    should prompt to change it on first login.
    """
    ensure_tables()
    conn = get_connection()
    cur = conn.cursor()
    row = cur.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    if row:
        conn.close()
        return row[0]

    default_pw = os.environ.get("ADMIN_DEFAULT_PASSWORD", "admin")
    pw_hash = hash_password(default_pw)
    cur.execute(
        "INSERT OR IGNORE INTO users (username, email, password_hash, role, is_active) "
        "VALUES ('admin', 'admin@localhost', ?, 'admin', 1)",
        (pw_hash,),
    )
    conn.commit()
    admin_id = cur.execute(
        "SELECT id FROM users WHERE username = 'admin'"
    ).fetchone()[0]

    # Backfill any pre-existing ownerless rows to the admin.
    for t in _OWNED_TABLES:
        try:
            cur.execute(f"UPDATE {t} SET user_id = ? WHERE user_id IS NULL", (admin_id,))
        except Exception:
            pass
    conn.commit()
    conn.close()
    return admin_id


# --------------------------------------------------------------------------- #
# User management
# --------------------------------------------------------------------------- #
def _row_to_user(row):
    return {
        "id": row[0],
        "username": row[1],
        "email": row[2],
        "role": row[3],
        "is_active": bool(row[4]),
        "created_at": row[5],
    }


def get_user_by_username(username):
    conn = get_connection()
    row = conn.execute(
        "SELECT id, username, email, password_hash, role, is_active, "
        "failed_attempts, locked_until FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    conn.close()
    return row


def get_user(user_id):
    conn = get_connection()
    row = conn.execute(
        "SELECT id, username, email, role, is_active, created_at FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    conn.close()
    return _row_to_user(row) if row else None


def list_users():
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, username, email, role, is_active, created_at FROM users ORDER BY id"
    ).fetchall()
    conn.close()
    return [_row_to_user(r) for r in rows]


def create_user(username, password, role=ROLE_USER, email=None):
    if role not in (ROLE_ADMIN, ROLE_USER):
        role = ROLE_USER
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO users (username, email, password_hash, role, is_active) "
            "VALUES (?, ?, ?, ?, 1)",
            (username, email, hash_password(password), role),
        )
        conn.commit()
        uid = cur.lastrowid
    except Exception as e:
        conn.close()
        raise e
    conn.close()
    return uid


def delete_user(user_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM users WHERE id = ?", (user_id,))
    cur.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.commit()
    changed = cur.rowcount
    conn.close()
    return changed >= 0


def set_password(user_id, new_password):
    conn = get_connection()
    conn.execute(
        "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
        (hash_password(new_password), user_id),
    )
    conn.commit()
    conn.close()


def set_active(user_id, active):
    conn = get_connection()
    conn.execute(
        "UPDATE users SET is_active = ? WHERE id = ?", (1 if active else 0, user_id)
    )
    conn.commit()
    conn.close()


def set_role(user_id, role):
    if role not in (ROLE_ADMIN, ROLE_USER):
        return
    conn = get_connection()
    conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
    conn.commit()
    conn.close()


# --------------------------------------------------------------------------- #
# Login / lockout
# --------------------------------------------------------------------------- #
def _now():
    return datetime.now(timezone.utc)


def _parse_ts(ts):
    if not ts:
        return None
    try:
        return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except Exception:
        return None


def authenticate(username, password):
    """Return (user_dict, error). error is None on success.

    Enforces account lockout after repeated failed attempts.
    """
    row = get_user_by_username(username)
    if not row:
        return None, "invalid_credentials"

    (uid, uname, email, pw_hash, role, is_active, failed, locked_until) = row

    if not is_active:
        return None, "account_disabled"

    locked = _parse_ts(locked_until)
    if locked and locked > _now():
        return None, "account_locked"

    if not verify_password(password, pw_hash):
        _register_failed_attempt(uid, failed)
        return None, "invalid_credentials"

    # Success: reset failure counter.
    conn = get_connection()
    conn.execute(
        "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?", (uid,)
    )
    conn.commit()
    conn.close()
    return {
        "id": uid,
        "username": uname,
        "email": email,
        "role": role,
        "is_active": bool(is_active),
    }, None


def _register_failed_attempt(user_id, current_failed):
    new_failed = (current_failed or 0) + 1
    conn = get_connection()
    if new_failed >= MAX_FAILED_ATTEMPTS:
        locked_until = (_now() + timedelta(minutes=LOCKOUT_MINUTES)).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        conn.execute(
            "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
            (new_failed, locked_until, user_id),
        )
    else:
        conn.execute(
            "UPDATE users SET failed_attempts = ? WHERE id = ?", (new_failed, user_id)
        )
    conn.commit()
    conn.close()


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #
def create_session(user_id, ip=None, user_agent=None, remember=False):
    token = secrets.token_urlsafe(32)
    ttl_days = REMEMBER_TTL_DAYS if remember else SESSION_TTL_DAYS
    expires = (_now() + timedelta(days=ttl_days)).strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at, ip, user_agent) "
        "VALUES (?, ?, ?, ?, ?)",
        (token, user_id, expires, ip, user_agent),
    )
    conn.commit()
    conn.close()
    return token


def get_session_user(token):
    """Return the user dict for a valid, unexpired session token, else None."""
    if not token:
        return None
    conn = get_connection()
    row = conn.execute(
        "SELECT u.id, u.username, u.email, u.role, u.is_active "
        "FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = ? AND s.expires_at > datetime('now')",
        (token,),
    ).fetchone()
    conn.close()
    if not row or not row[4]:
        return None
    return {
        "id": row[0],
        "username": row[1],
        "email": row[2],
        "role": row[3],
        "is_active": bool(row[4]),
    }


def destroy_session(token):
    if not token:
        return
    conn = get_connection()
    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def cleanup_expired_sessions():
    try:
        conn = get_connection()
        conn.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')")
        conn.commit()
        conn.close()
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Audit log
# --------------------------------------------------------------------------- #
def audit(action, user=None, ip=None, resource=None, previous=None, new=None):
    try:
        conn = get_connection()
        conn.execute(
            "INSERT INTO audit_logs (user_id, username, ip, action, resource, "
            "previous_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                (user or {}).get("id") if isinstance(user, dict) else None,
                (user or {}).get("username") if isinstance(user, dict) else None,
                ip,
                action,
                resource,
                previous,
                new,
            ),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def list_audit(limit=100):
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, user_id, username, ip, action, resource, previous_value, "
        "new_value, created_at FROM audit_logs ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    return [
        {
            "id": r[0],
            "user_id": r[1],
            "username": r[2],
            "ip": r[3],
            "action": r[4],
            "resource": r[5],
            "previous_value": r[6],
            "new_value": r[7],
            "created_at": r[8],
        }
        for r in rows
    ]
