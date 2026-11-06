"""Server-side investigator sign-in (src/webapp/auth.py)."""

from __future__ import annotations

import pytest

from src.webapp import auth

DEMO_ID, DEMO_PASS = "NTRO-CYB-4471", "Tr4ce-the-Chain!"  # demo account, documented in the frontend README


@pytest.fixture(autouse=True)
def _clear_lockouts():
    auth._failures.clear()
    yield
    auth._failures.clear()


def test_api_is_closed_without_a_session(anon_client):
    r = anon_client.get("/api/stats")
    assert r.status_code == 401
    assert r.get_json()["error"] == "Sign in required."


def test_auth_routes_stay_reachable_signed_out(anon_client):
    r = anon_client.get("/api/auth/me")
    assert r.status_code == 200 and r.get_json()["investigator"] is None


def test_login_opens_the_api_and_logout_closes_it(anon_client):
    r = anon_client.post("/api/auth/login", json={"id": DEMO_ID.lower(), "passphrase": DEMO_PASS})
    assert r.status_code == 200
    assert r.get_json()["investigator"]["id"] == DEMO_ID
    assert anon_client.get("/api/auth/me").get_json()["investigator"]["clearance"] == "L3"
    assert anon_client.get("/api/stats").status_code != 401

    anon_client.post("/api/auth/logout")
    assert anon_client.get("/api/stats").status_code == 401


def test_wrong_passphrase_and_unknown_id_get_the_same_answer(anon_client):
    a = anon_client.post("/api/auth/login", json={"id": DEMO_ID, "passphrase": "wrong"})
    b = anon_client.post("/api/auth/login", json={"id": "NTRO-CYB-9999", "passphrase": DEMO_PASS})
    assert a.status_code == b.status_code == 401
    assert a.get_json() == b.get_json()


def test_malformed_input_is_rejected_before_hashing(anon_client):
    assert anon_client.post("/api/auth/login", json={"id": "admin", "passphrase": "x"}).status_code == 400
    assert anon_client.post("/api/auth/login", json={"id": DEMO_ID}).status_code == 400
    assert anon_client.post("/api/auth/login", data="not json").status_code == 400


def test_repeated_failures_lock_the_id(anon_client):
    for _ in range(auth.MAX_FAILS - 1):
        assert anon_client.post("/api/auth/login", json={"id": DEMO_ID, "passphrase": "wrong"}).status_code == 401
    assert anon_client.post("/api/auth/login", json={"id": DEMO_ID, "passphrase": "wrong"}).status_code == 429
    # even the right passphrase waits out the lock
    r = anon_client.post("/api/auth/login", json={"id": DEMO_ID, "passphrase": DEMO_PASS})
    assert r.status_code == 429 and r.get_json()["retryAfter"] > 0
