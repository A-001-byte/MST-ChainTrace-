"""Export an epoch of on-chain verdicts, in SHARED SPEC v1 form, for the dapp pages.

A thin wrapper over Member 1's reference exporter (src/mst/export.py::build_export) — the
leaf encoding, sparse Merkle tree and proofs all come from there, unchanged, so every proof
this writes verifies against VerdictOracle once the root is published.

It adds two things the dapp needs and the reference exporter deliberately does not do:

  1. Gateway demo wallets. Every ranked alert carries full taint under all three measures,
     so among alerts the two gateway policies only split on the EXONERATED flag. This adds up
     to N_GATEWAY_DEMO wallets from the provenance layer that show the other split: haircut
     taint at/above the hold line, custody-weighted taint below it, not contested. They are
     exported with no risk score (band UNSCORED) because they are not ranked alerts — the
     leaf says so honestly.
  2. A `context` sidecar per address (node id, detector reason, intent text, source). It is
     display-only and NOT part of any leaf; the chain never sees it.

Usage:  python -m scripts.export_verdict_set --epoch 2
Writes outputs/mst/epoch_<N>.json (same layout as src.mst.export, plus `context`) and
outputs/mst/latest_root.json. Publishing the root on-chain is a separate, keyed step.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd

from src.mst.export import DEFAULT_AGENCY, DEFAULT_ALERTS, DEFAULT_OUT, DEFAULT_TAINT, build_export, wallet_address

# Must equal GuardedGateway.HAIRCUT_HOLD_BPS / CUSTODY_HOLD_BPS (5000 bps) — contracts/SPEC.md.
HOLD_LINE = 0.5
N_GATEWAY_DEMO = 12


def _text(v) -> str | None:
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else str(v)


def _num(v) -> float | None:
    return None if v is None or pd.isna(v) else float(v)


def gateway_demo_rows(taint: pd.DataFrame, exclude: set[str], n: int = N_GATEWAY_DEMO) -> pd.DataFrame:
    """Wallets the two policies judge differently, widest haircut-vs-custody gap first."""
    t = taint.reset_index() if "address" not in taint.columns else taint
    contested = t["queue"] == "CONTESTED_EVIDENCE" if "queue" in t.columns else False
    split = t[(t["risk_baseline"] >= HOLD_LINE) & (t["risk_cwt"] < HOLD_LINE) & ~contested & ~t["address"].isin(exclude)]
    split = split.assign(_gap=split["risk_baseline"] - split["risk_cwt"]).nlargest(n, "_gap")
    return pd.DataFrame({"node_id": "wallet_" + split["address"], "node_type": "wallet", "risk_score": float("nan")})


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--epoch", type=int, required=True)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)

    for path in (DEFAULT_ALERTS, DEFAULT_TAINT, DEFAULT_AGENCY):
        if not path.exists():
            ap.error(f"{path} not found — run the graph_ml and adversarial_provenance pipelines first")

    alerts = pd.read_csv(DEFAULT_ALERTS)
    alerts = alerts[alerts["node_type"] == "wallet"] if "node_type" in alerts.columns else alerts
    taint, agency = pd.read_parquet(DEFAULT_TAINT), pd.read_parquet(DEFAULT_AGENCY)

    alert_addrs = {wallet_address(n) for n in alerts["node_id"]}
    demo = gateway_demo_rows(taint, alert_addrs)
    result = build_export(pd.concat([alerts, demo], ignore_index=True), taint, agency, args.epoch)

    context = {}
    for row in alerts.to_dict(orient="records"):
        context[wallet_address(row["node_id"])] = {
            "nodeId": row["node_id"], "source": "alert", "riskScore": _num(row.get("risk_score")),
            "intentLabel": _text(row.get("intent_label")), "intentConfidence": _num(row.get("intent_confidence")),
            "reason": _text(row.get("reason")), "geoTemporalReason": _text(row.get("geo_temporal_reason")),
        }
    for node_id in demo["node_id"]:
        context[wallet_address(node_id)] = {
            "nodeId": node_id, "source": "gateway", "riskScore": None, "intentLabel": None, "intentConfidence": None,
            "reason": "Not a ranked alert: haircut taint trips the hold line while custody-weighted taint clears it.",
            "geoTemporalReason": None,
        }
    result["context"] = context
    result["manifest"]["gatewayDemo"] = len(demo)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / f"epoch_{args.epoch}.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    (args.out / "latest_root.json").write_text(json.dumps(result["manifest"], indent=2) + "\n", encoding="utf-8")
    print(f"epoch {args.epoch}: {len(result['entries'])} leaves ({len(alert_addrs)} alerts + {len(demo)} gateway demo), "
          f"root {result['root']} -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
