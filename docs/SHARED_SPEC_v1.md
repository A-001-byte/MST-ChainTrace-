# SHARED SPEC v1

Identical for all three members. Do not change any of this without telling the
other two; Member 1's golden vectors are the arbiter.

## CHAIN

MST Testnet, RPC https://testnetrpc.mstblockchain.com. Query `eth_chainId` live
and use what the node returns (community sources say 91562037 = 0x5752035; one
repo wrongly says 0x5752c35).

## HASH

keccak256 everywhere. Python: `eth_utils.keccak` / `eth_hash` / pycryptodome
keccak. JS: ethers `keccak256`. NEVER `hashlib.sha3_256` or Node crypto
`sha3-256` — those are NIST SHA3, a different function.

## KEY

`key = keccak256(UTF-8 bytes of the Bitcoin address string, exactly as in the dataset)`

## LEAF

```
LEAF = keccak256(abi.encode(
  bytes32 key, uint32 epoch, uint8 band,
  uint16 riskBps, uint16 haircutBps, uint16 cwtBps, uint16 lowerBps,
  uint8 intent, uint8 flags))
```

`bps = round-half-up(value * 10000)`, clamped to 0..10000

| field | source |
|---|---|
| riskBps | ChainTrace final `risk_score` |
| haircutBps | industry haircut taint (APL baseline) |
| cwtBps | custody-weighted taint (APL Module A) |
| lowerBps | fragile-merges-removed lower bound (APL Module B) |

- **band**: 0 UNSCORED, 1 LOW, 2 MEDIUM, 3 HIGH (thresholds taken from the
  existing dashboard's `risk.js` — read them, don't invent new ones)
- **intent**: 0 NONE, 1 RANSOMWARE, 2 DARKNET_MARKET, 3 SANCTIONS_EVASION,
  4 PATTERN_UNCLEAR, 5 INSUFFICIENT_SIGNAL
- **flags** bits: 0 GEO_TEMPORAL_MISMATCH, 1 CONTESTED_EVIDENCE,
  2 EXONERATED (alpha==0, received-only), 3 KNOWN_LABEL

## TREE

Sparse Merkle tree, depth 256.

- empty leaf = `bytes32(0)`
- `default[0] = bytes32(0)`; `default[i] = keccak256(abi.encodePacked(default[i-1], default[i-1]))`
- `parent = keccak256(abi.encodePacked(left, right))`
- Level i = 0 is the leaf level, 255 is just below the root. At level i the
  current node is the RIGHT child iff bit i of `uint256(key)` is 1.

## PROOF

`(uint256 bitmap, bytes32[] siblings)`. Siblings ordered from level 0 upward.
Bitmap bit i = 1 means the level-i sibling is non-default and is the next
element of `siblings`; bit i = 0 means use `default[i]`.
Non-membership = a valid proof for leaf value `bytes32(0)`.

## GOLDEN VECTORS

Member 1 publishes `tests/vectors/smt_vectors.json` (>=20 cases: members,
non-members, keys of all-zeros / all-ones / single bit, a two-leaf tree whose
keys differ only in bit 0). Members 2 and 3 must pass every vector
byte-for-byte before integrating.

---

## Reference implementation (Member 1)

- Code: `src/mst/` (`keccak.py`, `leaf.py`, `smt.py`, `vectors.py`)
- Golden vectors: `tests/vectors/smt_vectors.json` — regenerate with
  `python -m src.mst.vectors`; `--check` fails if the file is stale.
- Tests: `python -m pytest tests/mst`

Vector file layout: `keccak_kats`, `defaults` (all 257 levels), `keyVectors`,
`bpsVectors`, `bandVectors`, `leafVectors` (fields + ABI encoding + leaf hash),
`trees` (id -> leaves + root), `cases` (tree id, key, leaf, proof, expected
`valid`; includes non-membership and deliberately invalid proofs) and `mutation`
(set / delete steps with the root after each). Hex is `0x`-prefixed; the bitmap
is a 64-hex-digit uint256.

### Decisions the spec left open

- **Band thresholds:** the spec cites the dashboard's `risk.js`, which does not exist in
  this repo. `src/dashboard/config.py` / `src/webapp/server.py` use HIGH >= 0.80,
  MEDIUM >= 0.60, LOW below; that is what `band_for_score` uses (a test keeps the
  constants in sync with `config.py`). The React frontend
  (`src/webapp/frontend/src/lib/format.js`) uses different cut points (hi >= 0.6,
  lo < 0.4). **Confirm with the other two members which one is intended.**
- **UNSCORED:** a missing / NaN risk score.
- **Rounding:** `bps` uses `Decimal(repr(float))`, so 0.12345 -> 1235 rather than the
  float-noise result 1234.
- **Non-canonical proofs** (a default sibling listed in the bitmap) still hash to the root
  and are accepted; verifiers need not reject them.
- **Setting a leaf to `bytes32(0)`** deletes it.
