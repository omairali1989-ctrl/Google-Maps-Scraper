import pytest
from fastapi.testclient import TestClient
import sys
import os

# Add parent dir to path so we can import app
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../app')))

from app.main import app
import authstore


@pytest.fixture(scope="module")
def client():
    """A TestClient authenticated as an admin.

    Data endpoints now require a session cookie, so tests must log in. We ensure
    a known admin exists (idempotent) and log in with it.
    """
    authstore.ensure_tables()
    # Ensure a test admin with a known password exists.
    row = authstore.get_user_by_username("testadmin")
    if not row:
        authstore.create_user("testadmin", "testadminpw", role="admin")
    c = TestClient(app)
    resp = c.post(
        "/api/v2/auth/login",
        json={"username": "testadmin", "password": "testadminpw"},
    )
    assert resp.status_code == 200, resp.text
    return c


def test_scrape_endpoint_missing_query(client):
    response = client.post("/api/scrape", json={"query": "", "format": "excel"})
    assert response.status_code == 422


def test_scrape_endpoint_invalid_format(client):
    response = client.post("/api/scrape", json={"query": "test", "format": "xml"})
    assert response.status_code == 422


def test_status_endpoint(client):
    # Authenticated status call returns 200 (scoped to the user's jobs).
    response = client.get("/api/status")
    assert response.status_code == 200


def test_verify_key_endpoint_missing_params(client):
    response = client.post("/api/v2/keys/verify", json={"provider": "", "api_key": ""})
    assert response.status_code == 400
    assert response.json() == {"error": "Provider and API key required"}


def test_verify_key_endpoint_unsupported_provider(client):
    response = client.post(
        "/api/v2/keys/verify", json={"provider": "invalid_provider", "api_key": "test"}
    )
    assert response.status_code == 400
    assert "not supported" in response.json()["error"]


def test_auth_required_without_session():
    """Endpoints must reject unauthenticated requests."""
    anon = TestClient(app)
    assert anon.get("/api/v2/jobs").status_code == 401
    assert anon.get("/api/v2/analytics").status_code == 401


def test_rbac_admin_only_endpoints_denied_for_user():
    """A standard user cannot reach admin-only endpoints."""
    authstore.ensure_tables()
    if not authstore.get_user_by_username("testuser"):
        authstore.create_user("testuser", "testuserpw", role="user")
    c = TestClient(app)
    c.post("/api/v2/auth/login", json={"username": "testuser", "password": "testuserpw"})
    assert c.get("/api/v2/users").status_code == 403
    assert c.get("/api/v2/audit").status_code == 403


def test_keys_endpoints_workflow(client):
    # 1. Post to save a key
    resp_save = client.post(
        "/api/v2/keys",
        json={"provider": "claude", "api_key": "my-secret-claude-key"}
    )
    assert resp_save.status_code == 200
    assert resp_save.json() == {"success": True}

    # 2. Get keys list and verify it is listed (with masked display value)
    resp_get = client.get("/api/v2/keys")
    assert resp_get.status_code == 200
    keys_list = resp_get.json()
    assert len(keys_list) > 0
    
    claude_key = next((k for k in keys_list if k["provider"] == "claude"), None)
    assert claude_key is not None
    assert claude_key["api_key"] == "my-s...-key"
    assert claude_key["is_active"] is True

    # 3. Delete keys and verify it is inactive/omitted
    resp_del = client.delete("/api/v2/keys/claude")
    assert resp_del.status_code == 200

    resp_get_after = client.get("/api/v2/keys")
    assert resp_get_after.status_code == 200
    assert not any(k["provider"] == "claude" for k in resp_get_after.json())

