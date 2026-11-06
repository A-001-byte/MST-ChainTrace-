#!/usr/bin/env bash
# ChainTrace — full pipeline runner (Linux/macOS/git-bash).
#
# Runs, in order: data pipeline -> graph+ML pipeline -> provenance layer -> the console.
# Stops with a clear message (and does NOT launch the dashboard) if either pipeline fails,
# instead of silently falling through to an empty/broken dashboard.
#
# Usage:
#   ./run_all.sh                # full dataset, all 49 time steps (slow but real)
#   ./run_all.sh 5               # subsample to the first 5 time steps (fast iteration/demo prep)
#
# Assumes your venv is already activated (see README.md Setup) and the raw datasets are in
# data/raw/{elliptic,elliptic_pp,geolite2}/ — run Phase 0 first if you haven't.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT" || exit 1

PYTHON="${PYTHON:-python}"
SAMPLE_TIMESTEPS="${1:-}"

MISSING_DATA_HELP="Expected raw data under: $REPO_ROOT/data/raw/
  elliptic/       elliptic_txs_features.csv, elliptic_txs_classes.csv, elliptic_txs_edgelist.csv
                  (Kaggle Elliptic dataset)
  elliptic_pp/    wallets_features.csv, wallets_classes.csv, AddrTx_edgelist.csv, TxAddr_edgelist.csv
                  (Elliptic++ — use the Google Drive link in its README, the GitHub zip only
                  ships Git-LFS pointer stubs; check these files are hundreds of MB, not ~130 bytes)
  geolite2/       GeoLite2-City-Blocks-IPv4.csv, GeoLite2-City-Locations-en.csv,
                  GeoLite2-ASN-Blocks-IPv4.csv (MaxMind GeoLite2 CSV download)
See README.md for download links and the full folder layout."

echo "=== ChainTrace: full pipeline run ==="
if [[ -n "$SAMPLE_TIMESTEPS" ]]; then
    echo "(subsampled to the first $SAMPLE_TIMESTEPS time steps)"
fi

echo ""
echo "[1/4] Data pipeline -> data/processed/unified_dataset.csv"
if [[ -n "$SAMPLE_TIMESTEPS" ]]; then
    "$PYTHON" -u -c "from src.data_pipeline.pipeline import main; main(sample_timesteps=$SAMPLE_TIMESTEPS)"
else
    "$PYTHON" -u scripts/data_pipeline.py
fi
STATUS=$?
if [[ $STATUS -ne 0 ]]; then
    echo ""
    echo "XXX Data pipeline failed (exit $STATUS). Stopping before the console starts."
    echo "$MISSING_DATA_HELP"
    exit 1
fi

echo ""
echo "[2/4] Graph+ML pipeline -> outputs/alerts/ranked_alerts.csv"
if [[ -n "$SAMPLE_TIMESTEPS" ]]; then
    "$PYTHON" -u -m src.graph_ml.run_phase2 --sample-timesteps "$SAMPLE_TIMESTEPS" --save
else
    "$PYTHON" -u -m src.graph_ml.run_phase2 --save
fi
STATUS=$?
if [[ $STATUS -ne 0 ]]; then
    echo ""
    echo "XXX Graph+ML pipeline failed (exit $STATUS). Stopping before the console starts."
    echo "$MISSING_DATA_HELP"
    exit 1
fi

echo ""
echo "[3/4] Provenance layer -> data/processed/adversarial_provenance/"
if ! "$PYTHON" -u -m src.adversarial_provenance.pipeline || ! "$PYTHON" -u -m src.adversarial_provenance.pipeline_b; then
    echo "!!! Provenance layer failed. The console still starts; its Provenance pages will say the layer is not built."
fi

echo ""
echo "[4/4] Starting the console -> http://127.0.0.1:${PORT:-5000}/app/"
exec "$PYTHON" -m src.webapp.server
