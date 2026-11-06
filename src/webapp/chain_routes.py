"""On-chain verdict endpoints for the dapp layer (SHARED SPEC v1).

Serves:
    /api/chain/deployment          VerdictOracle / GuardedGateway / ClearanceSBT addresses + ABIs,
                                   RPC, and the locally exported epoch this server can prove against
    /api/verdict/<addr>            one address's verdict fields and its sparse-Merkle proof
    /api/verdict/gateway-preview   the wallets the gateway policy comparison runs on

Data sources — nothing here computes a score:
    contracts/deployments/<network>.json   written by contracts/scripts/deploy-mst.ts
    outputs/mst/epoch_<N>.json             written by `python -m scripts.export_verdict_set --epoch N`
                                           (Member 1's src.mst exporter + a display-only context map)

The tree is a depth-256 sparse Merkle tree, so it proves NON-membership too: an address with
no leaf gets a valid proof of the empty leaf. Whether any proof verifies ON-CHAIN depends on
that epoch's root having been published to VerdictOracle; the browser checks that live and
this module never claims it.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import requests
from flask import Blueprint, Response, jsonify, request

from src.mst.leaf import address_key
from src.mst.smt import SparseMerkleTree

REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_DIR = REPO_ROOT / "contracts" / "deployments"
EXPORT_DIR = REPO_ROOT / "outputs" / "mst"
DEFAULT_RPC = "https://testnetrpc.mstblockchain.com"

# SHARED SPEC v1 enums, index = on-chain value.
BANDS = ["Unscored", "Low", "Medium", "High"]
INTENTS = ["None", "Ransomware-shaped", "Darknet-market-shaped", "Sanctions-evasion-shaped",
           "Pattern unclear", "Insufficient signal"]
FLAGS = [(1 << 0, "Geo-temporal mismatch"), (1 << 1, "Contested evidence"),
         (1 << 2, "Exonerated (received-only)"), (1 << 3, "Known label")]

_cache: dict = {}


def _cached(path: Path, build):
    """Read-through cache keyed on path + mtime."""
    if not path.exists():
        return None
    key = (str(path), path.stat().st_mtime)
    if key not in _cache:
        _cache[key] = build(path)
    return _cache[key]


def _rpc_url() -> str:
    return os.environ.get("CHAIN_RPC_URL", DEFAULT_RPC)


def _deployment():
    name = os.environ.get("CHAIN_NETWORK", "mst-testnet")
    return _cached(DEPLOY_DIR / f"{name}.json", lambda p: json.loads(p.read_text(encoding="utf-8")))


def _export_path() -> Path | None:
    wanted = os.environ.get("CHAIN_EPOCH")
    if wanted:
        return EXPORT_DIR / f"epoch_{int(wanted)}.json"
    files = [(int(m.group(1)), p) for p in EXPORT_DIR.glob("epoch_*.json") if (m := re.fullmatch(r"epoch_(\d+)\.json", p.name))]
    return max(files)[1] if files else None


def _load_export(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    by_addr = {e["address"]: e for e in data["entries"]}
    tree = SparseMerkleTree.from_leaves({bytes.fromhex(e["key"][2:]): bytes.fromhex(e["leaf"][2:]) for e in data["entries"]})
    if "0x" + tree.root.hex() != data["root"]:
        raise ValueError(f"{path.name}: rebuilt root does not match the exported root")
    return {"data": data, "by_addr": by_addr, "by_lower": {a.lower(): a for a in by_addr}, "tree": tree}


def _export():
    path = _export_path()
    return None if path is None else _cached(path, _load_export)


def _bare(address: str) -> str:
    address = address.strip()
    return address[len("wallet_"):] if address.startswith("wallet_") else address


def _flag_labels(bits: int) -> list[str]:
    return [label for bit, label in FLAGS if bits & bit]


def _proof_json(proof) -> dict:
    return {"bitmap": "0x" + proof.bitmap.to_bytes(32, "big").hex(), "siblings": ["0x" + s.hex() for s in proof.siblings]}


def _shape(entry: dict, context: dict | None) -> dict:
    fields = {k: entry[k] for k in ("band", "riskBps", "haircutBps", "cwtBps", "lowerBps", "intent", "flags")}
    return {
        "found": True,
        "address": entry["address"],
        "key": entry["key"],
        "epoch": entry["epoch"],
        # exactly the arguments VerdictOracle.verifyVerdict / screen and GuardedGateway.deposit take
        "fields": fields,
        "leaf": entry["leaf"],
        "proof": entry["proof"],
        "bandLabel": BANDS[entry["band"]] if entry["band"] < len(BANDS) else "Unknown",
        "intentLabel": INTENTS[entry["intent"]] if entry["intent"] < len(INTENTS) else "Unknown",
        "flags": _flag_labels(entry["flags"]),
        "interval": {"haircut": entry["haircutBps"] / 10000, "custodyWeighted": entry["cwtBps"] / 10000,
                     "fragileMergesRemoved": entry["lowerBps"] / 10000},
        "context": context or {},
    }


def register(app) -> None:
    bp = Blueprint("chain", __name__)

    @bp.get("/api/chain/deployment")
    def deployment():
        record = _deployment()
        if record is None:
            return jsonify({"available": False,
                            "error": "no deployment record in contracts/deployments — run contracts/scripts/deploy-mst.ts"}), 404
        exp = _export()
        return jsonify({
            **record,
            "available": True,
            # The browser reaches the chain through this server's /api/chain/rpc relay: same origin,
            # and it sidesteps flaky direct browser routes to the public RPC. The upstream RPC and
            # explorer come from env so one deployment file works across environments.
            "rpcUrl": request.host_url.rstrip("/") + "/api/chain/rpc",
            "upstreamRpcUrl": _rpc_url(),
            "explorerUrl": os.environ.get("CHAIN_EXPLORER_URL", ""),
            "chainName": os.environ.get("CHAIN_NAME", "MST Testnet"),
            "enums": {"bands": BANDS, "intents": INTENTS, "flags": [{"bit": b, "label": l} for b, l in FLAGS]},
            "localEpoch": None if exp is None else exp["data"]["manifest"],
        })

    @bp.post("/api/chain/rpc")
    def rpc_relay():
        # Read-and-forward only: the body goes upstream unchanged. Signed transactions come from
        # the user's wallet via its own RPC, never through here, and no key lives on this server.
        try:
            upstream = requests.post(_rpc_url(), data=request.get_data(), timeout=20,
                                     headers={"content-type": "application/json"})
        except requests.RequestException as err:
            return jsonify({"jsonrpc": "2.0", "id": None, "error": {"code": -32000, "message": f"RPC unreachable: {err}"}}), 502
        return Response(upstream.content, status=upstream.status_code, content_type="application/json")

    @bp.get("/api/verdict/gateway-preview")
    def gateway_preview():
        exp = _export()
        if exp is None:
            return jsonify({"error": "no verdict epoch exported — run python -m scripts.export_verdict_set --epoch N"}), 404
        # Every verdict in the epoch. Which policy holds or accepts each one is decided in the
        # browser by GuardedGateway.evaluate itself, so this list never pre-judges the outcome.
        ctx = exp["data"].get("context", {})
        rows = [_shape(e, ctx.get(e["address"])) for e in exp["data"]["entries"]]
        return jsonify({"rows": rows, "count": len(rows), "epoch": exp["data"]["manifest"]["epoch"]})

    @bp.get("/api/verdict/<path:addr>")
    def verdict(addr: str):
        exp = _export()
        if exp is None:
            return jsonify({"error": "no verdict epoch exported — run python -m scripts.export_verdict_set --epoch N"}), 404
        bare = _bare(addr)
        canonical = bare if bare in exp["by_addr"] else exp["by_lower"].get(bare.lower())
        if canonical is not None:
            return jsonify(_shape(exp["by_addr"][canonical], exp["data"].get("context", {}).get(canonical)))

        # Absent: the sparse tree proves the empty leaf at this key — a real non-membership proof.
        key = address_key(bare)
        return jsonify({
            "found": False,
            "address": bare,
            "key": "0x" + key.hex(),
            "epoch": exp["data"]["manifest"]["epoch"],
            "leaf": "0x" + "00" * 32,
            "proof": _proof_json(exp["tree"].prove(key)),
            "note": ("No verdict for this exact address string in this epoch. The proof shows the empty leaf at its "
                     "key; it is only meaningful on-chain once this epoch's root is published."),
        })

    app.register_blueprint(bp)
