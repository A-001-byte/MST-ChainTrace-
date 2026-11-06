"""Investigator sign-in, enforced on the server.

Every /api/* route except /api/auth/* requires a signed session cookie. Accounts live in
src/webapp/investigators.json as salted PBKDF2-SHA256 hashes (no database, no plaintext).

    python -m src.webapp.auth add NTRO-CYB-1234     # add or rotate an account (prompts for the passphrase)

Set CHAINTRACE_SECRET_KEY in the environment so sessions survive a server restart; without
it a random key is generated per process and everyone signs in again after a restart.
"""

from __future__ import annotations

import getpass
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sys
import time
from datetime import timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request, session

ACCOUNTS_PATH = Path(__file__).with_name("investigators.json")
ID_PATTERN = re.compile(r"^[A-Z]{3,5}-[A-Z]{2,4}-\d{4}$")
ITERATIONS = 120_000          # matches the hashes generated for the original browser-side gate
SESSION_HOURS = 8             # one shift
MAX_FAILS = 5
LOCK_SECONDS = 30
PUBLIC_API_PREFIX = "/api/auth/"

log = logging.getLogger(__name__)

# ponytail: in-process lockout table; move to a shared store if the app ever runs multi-process.
_failures: dict[str, tuple[int, float]] = {}


def _derive(passphrase: str, salt_hex: str) -> str:
    raw = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), bytes.fromhex(salt_hex.removeprefix("0x")), ITERATIONS, 32)
    return "0x" + raw.hex()


def _accounts() -> list[dict]:
    try:
        return json.loads(ACCOUNTS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []


def _public(acct: dict) -> dict:
    return {k: acct[k] for k in ("id", "name", "unit", "clearance")}


def _lock_remaining(who: str) -> int:
    _, until = _failures.get(who, (0, 0.0))
    return max(0, int(until - time.time() + 0.999))


def verify(raw_id: str, passphrase: str) -> dict | None:
    """The account for a valid ID/passphrase pair, else None. Unknown IDs cost the same
    PBKDF2 work as wrong passphrases, so timing does not reveal which IDs exist."""
    accounts = _accounts()
    ident = str(raw_id or "").strip().upper()
    acct = next((a for a in accounts if a["id"] == ident), None)
    salt = acct["salt"] if acct else (accounts[0]["salt"] if accounts else "00" * 16)
    derived = _derive(str(passphrase or ""), salt)
    if acct is None or not hmac.compare_digest(derived, acct["hash"]):
        return None
    return acct


def register(app) -> None:
    secret = os.environ.get("CHAINTRACE_SECRET_KEY")
    if not secret:
        log.warning("CHAINTRACE_SECRET_KEY not set; using a per-process key (sessions end on restart)")
        secret = secrets.token_hex(32)
    app.config.update(
        SECRET_KEY=secret,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=SESSION_HOURS),
        MAX_CONTENT_LENGTH=1 * 1024 * 1024,
    )

    @app.before_request
    def require_investigator():
        path = request.path
        if path.startswith("/api/") and not path.startswith(PUBLIC_API_PREFIX) and "investigator" not in session:
            return jsonify({"error": "Sign in required."}), 401
        return None

    bp = Blueprint("auth", __name__)

    @bp.post("/api/auth/login")
    def login():
        body = request.get_json(silent=True) or {}
        ident = str(body.get("id", "")).strip().upper()
        if not ID_PATTERN.match(ident):
            return jsonify({"error": "Investigator ID should look like NTRO-CYB-0000."}), 400
        if not body.get("passphrase"):
            return jsonify({"error": "Enter your passphrase."}), 400

        who = f"{ident}|{request.remote_addr}"
        if (wait := _lock_remaining(who)) > 0:
            return jsonify({"error": f"Too many attempts. Try again in {wait}s.", "retryAfter": wait}), 429

        acct = verify(ident, body["passphrase"])
        if acct is None:
            fails = _failures.get(who, (0, 0.0))[0] + 1
            if fails >= MAX_FAILS:
                _failures[who] = (0, time.time() + LOCK_SECONDS)
                return jsonify({"error": f"Access denied. Sign-in locked for {LOCK_SECONDS}s.", "retryAfter": LOCK_SECONDS}), 429
            _failures[who] = (fails, 0.0)
            return jsonify({"error": "Access denied — investigator ID or passphrase not recognised."}), 401

        _failures.pop(who, None)
        session.clear()
        session.permanent = True
        session["investigator"] = _public(acct)
        return jsonify({"investigator": session["investigator"]})

    @bp.post("/api/auth/logout")
    def logout():
        session.clear()
        return jsonify({"ok": True})

    @bp.get("/api/auth/me")
    def me():
        # "Who am I?" is a question, not a failure: signed-out is a normal 200 with null, so
        # the console's first load does not log an error in every browser.
        return jsonify({"investigator": session.get("investigator")})

    app.register_blueprint(bp)


def _add_account(ident: str) -> int:
    ident = ident.strip().upper()
    if not ID_PATTERN.match(ident):
        print("Investigator ID should look like NTRO-CYB-0000.")
        return 1
    passphrase = getpass.getpass(f"Passphrase for {ident}: ")
    if len(passphrase) < 10 or passphrase != getpass.getpass("Repeat: "):
        print("Passphrases must match and be at least 10 characters.")
        return 1
    existing = _accounts()
    old = next((a for a in existing if a["id"] == ident), {})
    salt = "0x" + secrets.token_hex(16)
    accounts = [a for a in existing if a["id"] != ident] + [{
        "id": ident,
        "name": input(f"Display name [{old.get('name', 'Investigator')}]: ").strip() or old.get("name", "Investigator"),
        "unit": input(f"Unit [{old.get('unit', 'Cyber Forensics Cell')}]: ").strip() or old.get("unit", "Cyber Forensics Cell"),
        "clearance": input(f"Clearance [{old.get('clearance', 'L1')}]: ").strip() or old.get("clearance", "L1"),
        "salt": salt,
        "hash": _derive(passphrase, salt),
    }]
    ACCOUNTS_PATH.write_text(json.dumps(accounts, indent=2) + "\n", encoding="utf-8")
    print(f"{'Updated' if old else 'Added'} {ident} in {ACCOUNTS_PATH.name}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "add":
        raise SystemExit(_add_account(sys.argv[2]))
    print("usage: python -m src.webapp.auth add NTRO-CYB-1234")
    raise SystemExit(2)
