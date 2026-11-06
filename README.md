# ChainTrace

Bitcoin forensic intelligence. ChainTrace fuses Bitcoin's **network layer** (IP, port, timing,
GeoIP/ASN) with its **ledger** (wallets, transactions, amounts) into one entity graph, ranks the
wallets worth an investigator's time, and attaches the evidence for every lead. Verdicts can be
committed to a blockchain so anyone can check they were not altered after the fact.

It runs offline: no external APIs, CDNs or map tiles at runtime. Every flag is a
confidence-weighted investigative signal, never a claim about a real-world identity.

## What it does

| Stage | What happens | Code |
|---|---|---|
| 1. Ingest | Elliptic + Elliptic++ transactions and wallets, enriched with synthetic-but-realistic network metadata drawn from real GeoLite2 ASN blocks | `scripts/data_pipeline.py`, `src/data_pipeline/` |
| 2. Detect | Entity graph, co-spend clustering (Louvain), Random Forest + Isolation Forest, explainable risk score per entity | `src/graph_ml/` |
| 3. Geo-temporal | Flags wallets whose activity hours fit a different timezone from the country their IP claims (the VPN tell) | `src/graph_ml/geo_temporal.py` |
| 4. Intent | Rule-based structural pattern match against known money-movement shapes (ransomware-, darknet-market-, sanctions-evasion-shaped) | `src/graph_ml/intent_classifier.py` |
| 5. Provenance | Did a flagged wallet ever *spend* what it received, or only receive it? Custody-weighted taint, cluster fragility, and an evidence interval per wallet | `src/adversarial_provenance/` |
| 6. Verdicts on-chain | Verdicts become leaves of a depth-256 sparse Merkle tree; the root is published to `VerdictOracle` on MST testnet, which proves membership *and* absence | `src/mst/`, `contracts/` |
| 7. Console | Investigator web app: alerts, 3D forensic graph, geo-temporal globe, disruption analysis, provenance, and the on-chain verdict pages | `src/webapp/` |

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Put the raw datasets in `data/raw/{elliptic,elliptic_pp,geolite2}/` (see [Data sources](#data-sources);
they are gitignored), then run the pipeline:

```bash
./run_all.sh 5      # or run_all.bat 5 — first 5 time steps, quick
./run_all.sh        # full dataset (~20–30 min)
```

`run_all` runs ingestion → detection → provenance and then starts the console. To start the console on
its own once outputs exist:

```bash
python -m src.webapp.server                 # http://127.0.0.1:5000/app/
PORT=5050 python -m src.webapp.server       # if 5000 is taken
```

### Signing in

The console requires an investigator session, enforced by the server: every `/api/*` route except
`/api/auth/*` returns 401 without one. Accounts live in `src/webapp/investigators.json` as salted
PBKDF2-SHA256 hashes. Demo accounts are listed in `src/webapp/frontend/README.md`.

```bash
python -m src.webapp.auth add NTRO-CYB-1234     # add or rotate an account
```

Set `CHAINTRACE_SECRET_KEY` so sessions survive a restart (otherwise a per-process key is used).

## On-chain verdict layer

`contracts/` holds three Solidity contracts, deployed on MST testnet (addresses in
`contracts/deployments/mst-testnet.json`):

- **VerdictOracle**: stores each epoch's sparse-Merkle root; verifies a verdict or an absence; takes
  bonded challenges, resolved by an arbiter.
- **GuardedGateway**: a deposit gate that accepts, holds in escrow or sends to review, under a
  HAIRCUT (naive taint) or CUSTODY (custody-weighted) policy.
- **ClearanceSBT**: a non-transferable clearance token a wallet owner can mint with a proof of
  absence or exoneration.

Publishing a new epoch:

```bash
python -m scripts.export_verdict_set --epoch N      # leaves + proofs -> outputs/mst/epoch_N.json
cd contracts
npx hardhat run scripts/publish-real-epoch.ts --network mst   # publishes the newest exported epoch
```

Publishing needs the publisher key in `contracts/.env` (`DEPLOYER_PRIVATE_KEY`, never committed).
Challenges are accepted for `challengeWindow` seconds (10 min on the testnet deployment) after
publishing. For an offline demo, `npx hardhat node` plus `scripts/local-demo.ts` deploys the same
contracts locally; point the console at it with `CHAIN_NETWORK=localhost CHAIN_RPC_URL=http://127.0.0.1:8545`.

The leaf format, tree and proof encoding are fixed by [`docs/SHARED_SPEC_v1.md`](docs/SHARED_SPEC_v1.md);
the Python exporter, the Solidity verifier and the browser verifier are all checked against the same
golden vectors in `tests/vectors/smt_vectors.json`.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `PORT` | `5000` | console server |
| `CHAINTRACE_SECRET_KEY` | random per process | session signing |
| `CHAIN_NETWORK` | `mst-testnet` | which `contracts/deployments/*.json` the console reads |
| `CHAIN_RPC_URL` | `https://testnetrpc.mstblockchain.com` | chain reads (relayed through the server) |
| `CHAIN_EXPLORER_URL` | — | explorer links on tx hashes |
| `CHAIN_EPOCH` | newest `outputs/mst/epoch_*.json` | which exported epoch is served |

See `.env.example`.

## Tests

```bash
python -m pytest                                  # pipeline, provenance, MST, server + auth
cd contracts && npx hardhat test                  # contracts, against the shared golden vectors
cd src/webapp/frontend && npm test                # browser SMT verifier, golden vectors
cd src/webapp/frontend && node scripts/smoke.mjs  # end-to-end: sign in, open every page (server must be running)
```

## Layout

```
contracts/                   Solidity verdict layer (Hardhat), deployments, publish scripts
data/raw, data/processed     datasets in / unified dataset out (gitignored)
docs/                        blueprint, build plan, shared on-chain spec
outputs/                     ranked alerts, MST epochs, models (gitignored)
scripts/                     data pipeline entry, verdict export
src/data_pipeline/           ingestion and network-layer enrichment
src/graph_ml/                graph, clustering, models, geo-temporal, intent, risk
src/adversarial_provenance/  custody agency, taint, cluster fragility
src/mst/                     SHARED_SPEC_v1 leaves, sparse Merkle tree, exporter
src/webapp/                  Flask API, auth, chain routes; frontend/ is the React console
src/dashboard/               the earlier Streamlit dashboard (still runs: streamlit run app.py)
tests/                       pytest suites and the golden vectors
```

## Limits worth knowing

- Network metadata is synthetic (drawn from real ASN ranges), since public datasets carry no IPs.
- Intent labels are pattern similarity, not a trained crime-type classifier: no ground truth exists.
- The verdict arbiter is a single trusted address in v1.
- The Streamlit dashboard (`app.py`) predates the console and has no sign-in.

## Data sources

- Elliptic Data Set: https://www.kaggle.com/datasets/ellipticco/elliptic-data-set
- Elliptic++: https://github.com/git-disl/EllipticPlusPlus
- MaxMind GeoLite2: https://www.maxmind.com/en/geolite2/signup
