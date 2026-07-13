import pytest
import sqlite3
import tempfile
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../app')))

from app.db import get_connection, connection, execute_with_retry

def test_get_connection_pragmas():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    try:
        conn = get_connection(db_path=db_path)
        assert isinstance(conn, sqlite3.Connection)
        
        # Verify WAL mode is enabled
        cursor = conn.execute("PRAGMA journal_mode;")
        mode = cursor.fetchone()[0]
        assert mode.lower() == "wal"

        # Verify foreign keys are enabled
        cursor = conn.execute("PRAGMA foreign_keys;")
        fk = cursor.fetchone()[0]
        assert fk == 1

        conn.close()
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

def test_connection_context_manager_commit():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    try:
        # Create a table
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE test_table (id INTEGER PRIMARY KEY, val TEXT);")
        conn.commit()
        conn.close()

        # Write inside context manager
        with connection(db_path=db_path) as conn:
            conn.execute("INSERT INTO test_table (val) VALUES ('hello');")

        # Verify it was committed
        conn = sqlite3.connect(db_path)
        cursor = conn.execute("SELECT val FROM test_table;")
        rows = cursor.fetchall()
        assert len(rows) == 1
        assert rows[0][0] == "hello"
        conn.close()
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

def test_connection_context_manager_rollback():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    try:
        # Create a table
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE test_table (id INTEGER PRIMARY KEY, val TEXT);")
        conn.commit()
        conn.close()

        # Attempt write but raise error inside context manager
        with pytest.raises(ValueError):
            with connection(db_path=db_path) as conn:
                conn.execute("INSERT INTO test_table (val) VALUES ('rollback-me');")
                raise ValueError("Force rollback")

        # Verify nothing was committed
        conn = sqlite3.connect(db_path)
        cursor = conn.execute("SELECT val FROM test_table;")
        rows = cursor.fetchall()
        assert len(rows) == 0
        conn.close()
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

def test_execute_with_retry_success():
    mock_fn = MagicMock(return_value="success")
    result = execute_with_retry(mock_fn)
    assert result == "success"
    assert mock_fn.call_count == 1

def test_execute_with_retry_eventual_success():
    call_count = 0

    def mock_fn():
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            raise sqlite3.OperationalError("database is locked")
        return "eventual-success"

    # Patch sleep to speed up test execution
    with patch("time.sleep"):
        result = execute_with_retry(mock_fn)
        assert result == "eventual-success"
        assert call_count == 3

def test_execute_with_retry_failure():
    mock_fn = MagicMock(side_effect=sqlite3.OperationalError("database is locked"))

    with patch("time.sleep"):
        with pytest.raises(sqlite3.OperationalError):
            execute_with_retry(mock_fn, retries=3)
        assert mock_fn.call_count == 3
