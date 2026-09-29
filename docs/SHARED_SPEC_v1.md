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
