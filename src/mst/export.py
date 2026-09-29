"""Turn ChainTrace pipeline outputs into SMT leaves, a root and per-address proofs.

    python -m src.mst.export --epoch 1
    python -m src.mst.export --epoch 1 --alerts outputs/alerts/ranked_alerts.csv \\
        --taint data/processed/adversarial_provenance/taint_scores.parquet \\
        --agency data/processed/adversarial_provenance/agency.parquet --out outputs/mst

Field sources (SHARED SPEC v1):
    riskBps     ranked_alerts.csv  risk_score
    haircutBps  taint_scores       risk_baseline   (APL baseline, alpha = 1)
    cwtBps      taint_scores       risk_cwt        (APL Module A)
    lowerBps    taint_scores       risk_cwt_ablated (APL Module B, fragile merges removed)
    intent      ranked_alerts.csv  intent_label
    flags       geo_temporal_flag -> bit 0; taint_scores.queue == CONTESTED_EVIDENCE -> bit 1;
                agency.alpha == 0 (received-only) -> bit 2; is_known_label -> bit 3

Only wallet rows are exported (tx nodes have no Bitcoin address). APL values that are
missing for an address are encoded as 0 and counted in the manifest; a missing risk_score
gives band UNSCORED.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd

from .keccak import keccak256
from .leaf import Band, Flag, Intent, LeafFields, address_key, band_for_score, bps, leaf_hash
from .smt import SparseMerkleTree

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ALERTS = REPO_ROOT / "outputs" / "alerts" / "ranked_alerts.csv"
DEFAULT_TAINT = REPO_ROOT / "data" / "processed" / "adversarial_provenance" / "taint_scores.parquet"
DEFAULT_AGENCY = REPO_ROOT / "data" / "processed" / "adversarial_provenance" / "agency.parquet"
DEFAULT_OUT = REPO_ROOT / "outputs" / "mst"

# intent_label strings produced by src/graph_ml/intent_classifier.py -> spec enum.
INTENT_BY_LABEL = {
    "Ransomware-shaped": Intent.RANSOMWARE,
    "Darknet-market-shaped": Intent.DARKNET_MARKET,
    "Sanctions-evasion-shaped": Intent.SANCTIONS_EVASION,
    "Pattern unclear": Intent.PATTERN_UNCLEAR,
    "Insufficient signal": Intent.INSUFFICIENT_SIGNAL,
}


def wallet_address(node_id) -> str:
    """graph_ml names wallet nodes 'wallet_<btc address>'; the SMT key is the bare address."""
    node_id = str(node_id)
    return node_id[len("wallet_"):] if node_id.startswith("wallet_") else node_id


def _missing(v) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v)) or v is pd.NA or v is pd.NaT


def _truthy(v) -> bool:
    return not _missing(v) and bool(v)


def build_fields(row: dict, taint: dict | None, agency: dict | None, epoch: int) -> tuple[LeafFields, list[str]]:
    """LeafFields for one alert row plus the list of inputs that were missing (encoded as 0)."""
    missing: list[str] = []
    risk = row.get("risk_score")
    if _missing(risk):
        risk = None

    def apl(col: str) -> int:
        v = None if taint is None else taint.get(col)
        if _missing(v):
            missing.append(col)
            return 0
        return bps(float(v))

    label = row.get("intent_label")
    intent = Intent.NONE if _missing(label) else INTENT_BY_LABEL.get(str(label), Intent.NONE)

    flags = Flag(0)
    if _truthy(row.get("geo_temporal_flag")):
        flags |= Flag.GEO_TEMPORAL_MISMATCH
    if taint is not None and taint.get("queue") == "CONTESTED_EVIDENCE":
        flags |= Flag.CONTESTED_EVIDENCE
    if agency is not None and not _missing(agency.get("alpha")) and float(agency["alpha"]) == 0.0:
        flags |= Flag.EXONERATED
    if _truthy(row.get("is_known_label")):
        flags |= Flag.KNOWN_LABEL

    address = wallet_address(row["node_id"])
    return LeafFields(
        key=address_key(address), epoch=epoch, band=int(band_for_score(risk)),
        risk_bps=0 if risk is None else bps(float(risk)),
        haircut_bps=apl("risk_baseline"), cwt_bps=apl("risk_cwt"), lower_bps=apl("risk_cwt_ablated"),
        intent=int(intent), flags=int(flags),
    ), missing


def _records(df: pd.DataFrame | None) -> dict[str, dict]:
    if df is None:
        return {}
    if "address" in df.columns:
        df = df.set_index("address")
    return df.to_dict(orient="index")


def build_export(alerts: pd.DataFrame, taint: pd.DataFrame | None, agency: pd.DataFrame | None, epoch: int) -> dict:
    """Pure function: DataFrames in, {'root', 'entries', 'manifest'} out (all JSON-safe)."""
    if "node_type" in alerts.columns:
        alerts = alerts[alerts["node_type"] == "wallet"]
    alerts = alerts.drop_duplicates(subset="node_id")
    taint_by_addr, agency_by_addr = _records(taint), _records(agency)

    tree = SparseMerkleTree()
    rows, fields_by_addr, missing_counts = [], {}, {}
    for row in alerts.to_dict(orient="records"):
        addr = wallet_address(row["node_id"])
        fields, missing = build_fields(row, taint_by_addr.get(addr), agency_by_addr.get(addr), epoch)
        for col in missing:
            missing_counts[col] = missing_counts.get(col, 0) + 1
        fields_by_addr[addr] = fields
        tree.set(fields.key, leaf_hash(fields))
        rows.append(addr)

    entries = []
    for addr in rows:
        f = fields_by_addr[addr]
        proof = tree.prove(f.key)
        entries.append({
            "address": addr,
            "key": "0x" + f.key.hex(),
            "epoch": f.epoch, "band": f.band,
            "riskBps": f.risk_bps, "haircutBps": f.haircut_bps, "cwtBps": f.cwt_bps,
            "lowerBps": f.lower_bps, "intent": f.intent, "flags": f.flags,
            "leaf": "0x" + leaf_hash(f).hex(),
            "proof": {"bitmap": "0x" + proof.bitmap.to_bytes(32, "big").hex(),
                      "siblings": ["0x" + s.hex() for s in proof.siblings]},
        })
    root = "0x" + tree.root.hex()
    return {
        "root": root,
        "entries": entries,
        "manifest": {
            "spec": "SHARED_SPEC_v1", "epoch": epoch, "root": root, "leafCount": len(entries),
            "apl_columns_missing": missing_counts,
            "taint_loaded": taint is not None, "agency_loaded": agency is not None,
        },
    }


def _read(path: Path, kind: str) -> pd.DataFrame | None:
    if not path.exists():
        print(f"note: {kind} not found at {path}; its fields will be 0")
        return None
    return pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--epoch", type=int, required=True)
    ap.add_argument("--alerts", type=Path, default=DEFAULT_ALERTS)
    ap.add_argument("--taint", type=Path, default=DEFAULT_TAINT)
    ap.add_argument("--agency", type=Path, default=DEFAULT_AGENCY)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)

    if not args.alerts.exists():
        ap.error(f"{args.alerts} not found; run the graph_ml pipeline first (python -m src.graph_ml.run_phase2)")
    result = build_export(pd.read_csv(args.alerts), _read(args.taint, "taint_scores"),
                          _read(args.agency, "agency"), args.epoch)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / f"epoch_{args.epoch}.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    (args.out / "latest_root.json").write_text(json.dumps(result["manifest"], indent=2) + "\n", encoding="utf-8")
    print(f"epoch {args.epoch}: {len(result['entries'])} leaves, root {result['root']} -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
