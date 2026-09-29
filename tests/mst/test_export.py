"""Exporter tests on a synthetic ranked_alerts / taint / agency fixture."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from src.mst import Band, Flag, Intent, Proof, address_key, verify_proof
from src.mst import export


def _frames():
    alerts = pd.DataFrame([
        {"node_id": "addrA", "node_type": "wallet", "label": "illicit", "is_known_label": True,
         "risk_score": 0.91, "intent_label": "Ransomware-shaped", "geo_temporal_flag": True},
        {"node_id": "addrB", "node_type": "wallet", "label": "unknown", "is_known_label": False,
         "risk_score": 0.65, "intent_label": "Pattern unclear", "geo_temporal_flag": False},
        {"node_id": "addrC", "node_type": "wallet", "label": "unknown", "is_known_label": False,
         "risk_score": 0.1, "intent_label": np.nan, "geo_temporal_flag": np.nan},
        {"node_id": "tx123", "node_type": "tx", "label": "unknown", "is_known_label": False,
         "risk_score": 0.99, "intent_label": None, "geo_temporal_flag": False},
        {"node_id": "addrA", "node_type": "wallet", "label": "illicit", "is_known_label": True,
         "risk_score": 0.5, "intent_label": None, "geo_temporal_flag": False},  # duplicate: first wins
    ])
    taint = pd.DataFrame([
        {"address": "addrA", "risk_baseline": 0.9, "risk_cwt": 0.8, "risk_cwt_ablated": 0.4, "queue": "CONTESTED_EVIDENCE"},
        {"address": "addrB", "risk_baseline": 0.7, "risk_cwt": 0.0, "risk_cwt_ablated": np.nan, "queue": None},
    ])
    agency = pd.DataFrame([
        {"address": "addrA", "alpha": 0.5},
        {"address": "addrB", "alpha": 0.0},
    ])
    return alerts, taint, agency


def test_fields_bands_intents_and_flags():
    result = export.build_export(*_frames(), epoch=3)
    by = {e["address"]: e for e in result["entries"]}
    assert set(by) == {"addrA", "addrB", "addrC"}  # tx row dropped, duplicate collapsed

    a, b, c = by["addrA"], by["addrB"], by["addrC"]
    assert (a["riskBps"], a["haircutBps"], a["cwtBps"], a["lowerBps"]) == (9100, 9000, 8000, 4000)
    assert a["band"] == Band.HIGH and a["intent"] == Intent.RANSOMWARE
    assert a["flags"] == Flag.GEO_TEMPORAL_MISMATCH | Flag.CONTESTED_EVIDENCE | Flag.KNOWN_LABEL

    assert b["band"] == Band.MEDIUM and b["intent"] == Intent.PATTERN_UNCLEAR
    assert b["flags"] == Flag.EXONERATED  # alpha == 0
    assert b["lowerBps"] == 0  # NaN in taint_scores -> 0

    assert c["band"] == Band.LOW and c["intent"] == Intent.NONE and c["flags"] == 0
    assert (c["haircutBps"], c["cwtBps"], c["lowerBps"]) == (0, 0, 0)  # no APL row at all
    assert result["manifest"]["apl_columns_missing"] == {"risk_cwt_ablated": 2, "risk_baseline": 1, "risk_cwt": 1}
    assert all(e["epoch"] == 3 for e in result["entries"])


def test_every_exported_proof_verifies_against_root():
    result = export.build_export(*_frames(), epoch=1)
    root = bytes.fromhex(result["root"][2:])
    for e in result["entries"]:
        proof = Proof(int(e["proof"]["bitmap"], 16), tuple(bytes.fromhex(s[2:]) for s in e["proof"]["siblings"]))
        assert verify_proof(root, bytes.fromhex(e["key"][2:]), bytes.fromhex(e["leaf"][2:]), proof)
        assert e["key"] == "0x" + address_key(e["address"]).hex()
    # A stranger is provably absent.
    from src.mst import SparseMerkleTree, EMPTY_LEAF
    # rebuild to get a non-membership proof for an unknown address
    t = SparseMerkleTree.from_leaves({bytes.fromhex(e["key"][2:]): bytes.fromhex(e["leaf"][2:]) for e in result["entries"]})
    stranger = address_key("nobody")
    assert t.root == root and verify_proof(root, stranger, EMPTY_LEAF, t.prove(stranger))


def test_export_is_deterministic_and_row_order_independent():
    alerts, taint, agency = _frames()
    r1 = export.build_export(alerts, taint, agency, epoch=1)
    r2 = export.build_export(alerts.iloc[::-1].reset_index(drop=True), taint, agency, epoch=1)
    # duplicate addrA row order flips which duplicate wins, so compare on a de-duplicated input
    alerts = alerts.drop_duplicates("node_id")
    assert export.build_export(alerts, taint, agency, 1)["root"] == export.build_export(
        alerts.iloc[::-1], taint, agency, 1)["root"]
    assert r1["root"].startswith("0x") and len(r2["root"]) == 66


def test_epoch_changes_root():
    a, t, g = _frames()
    assert export.build_export(a, t, g, 1)["root"] != export.build_export(a, t, g, 2)["root"]


def test_cli_writes_files(tmp_path):
    a, t, g = _frames()
    a.to_csv(tmp_path / "alerts.csv", index=False)
    t.to_parquet(tmp_path / "taint.parquet")
    g.to_parquet(tmp_path / "agency.parquet")
    rc = export.main(["--epoch", "7", "--alerts", str(tmp_path / "alerts.csv"), "--taint", str(tmp_path / "taint.parquet"),
                      "--agency", str(tmp_path / "agency.parquet"), "--out", str(tmp_path / "out")])
    assert rc == 0
    data = json.loads((tmp_path / "out" / "epoch_7.json").read_text(encoding="utf-8"))
    assert data["manifest"]["epoch"] == 7 and len(data["entries"]) == 3
    assert json.loads((tmp_path / "out" / "latest_root.json").read_text(encoding="utf-8"))["root"] == data["root"]


def test_wallet_prefix_is_stripped_from_node_id():
    from src.mst.export import wallet_address
    from src.mst.leaf import address_key

    assert wallet_address("wallet_1ABC") == "1ABC"
    assert wallet_address("1ABC") == "1ABC"
    alerts = pd.DataFrame([{"node_id": "wallet_1ABC", "node_type": "wallet", "risk_score": 0.9}])
    out = export.build_export(alerts, None, None, 1)
    assert out["entries"][0]["address"] == "1ABC"
    assert out["entries"][0]["key"] == "0x" + address_key("1ABC").hex()
