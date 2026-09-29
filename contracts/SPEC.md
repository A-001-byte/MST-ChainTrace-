# Verdict-layer contracts: working spec and ASSUMPTIONS

No written spec existed in this repo when the contracts were built, and the requester did not have one.
Everything marked **ASSUMED** below was chosen by the contract author and MUST be confirmed by Member 1
(off-chain SMT / vectors) and Member 3 before anything is treated as final. If any assumption is wrong,
change it here, in `SMTDefaults.sol` (regenerate with `scripts/gen-smt-defaults.ts`) and in the tests.

## Sparse Merkle Tree (SMTVerifier)
| Item | Value |
|---|---|
| Hash | keccak256 (**ASSUMED**) |
| Depth | 256 levels; `key` is a 32-byte path (**ASSUMED**) |
| Node | `keccak256(left ‖ right)`, no domain prefix (**ASSUMED**) |
| Empty leaf | `0x00…00`; `default[i+1] = H(default[i], default[i])` (**ASSUMED**) |
| Empty tree root | `0xa7ff9e28ffd3def443d324547688c2c4eb98edf7da757d6bfa22bff55b9ce24a` |
| Path | at level `l` (0 = leaf's sibling, 255 = child of root), bit `l` of `key` (LSB = level 0); bit 0 ⇒ running node is the left child (**ASSUMED**) |
| Compressed proof | `bitmap` (uint256): bit `l` = 1 ⇒ non-default sibling supplied; consumed from `siblings[0]` = lowest level first. bit = 0 ⇒ `default[l]` (**ASSUMED**) |
| Exclusion proof | same proof shape with `leafHash = 0x00…00` |
| Malformed proof | `verify` returns `false`; `computeRoot` reverts `MalformedProof` |

## Verdict leaf (VerdictLeaf)
`leafHash = keccak256(abi.encodePacked(uint8(0x01), key, uint32 epoch, uint8 band, uint16 riskBps, uint16 haircutBps, uint16 cwtBps, uint16 lowerBps, uint8 intent, uint16 flags))` (**ASSUMED**)

Flags (**ASSUMED**): bit0 `EXONERATED` = 1, bit1 `CONTESTED_EVIDENCE` = 2. `band` / `intent` are opaque to the contracts.
Unflagged keys are proven by an exclusion proof (empty leaf).

## Golden vectors: expected `tests/vectors/smt_vectors.json` shape (**ASSUMED**)
```json
{ "vectors": [ {
  "name": "member-1", "type": "member" | "exclusion",
  "key": "0x…32 bytes", "leafHash": "0x…32 bytes (0x00…00 for exclusion)",
  "bitmap": "0x… or decimal string", "siblings": ["0x…"], "root": "0x…",
  "expected": true,
  "epoch": 1, "verdict": { "band":0,"riskBps":0,"haircutBps":0,"cwtBps":0,"lowerBps":0,"intent":0,"flags":0 }
} ] }
```
`expected` (default true), `epoch` and `verdict` are optional; if `verdict` is present the leaf preimage is cross-checked. A bare top-level array is also accepted.

## VerdictOracle
* Value is the **native currency** (assumed to be tMSTC): `challenge` is `payable` per the brief; bonds are held in native units (**ASSUMED**, an ERC-20 tMSTC would need a code change).
* Genesis: stored root starts at `bytes32(0)`; first `publishEpoch` must pass `prevRoot = 0x00…00`. `epoch` must be strictly greater than the last published epoch (gaps allowed, duplicates/regressions revert) (**ASSUMED**).
* Reward for an upheld challenge = `min(slashReward, publisherBond)`, `slashReward` owner-configurable (**ASSUMED**: the brief does not say how the reward is sized).
* Payouts (refund / reward / forfeited bond) are credited to a pull-payment ledger and claimed with `withdrawPayout()`, so a reverting recipient cannot block `resolve`.
* **The arbiter is a single trusted address. This is a known centralization point in v1.**

## GuardedGateway
* `HAIRCUT`: hold iff `haircutBps >= 5000`.
* `CUSTODY`: `overturned` ⇒ accept; else `CONTESTED_EVIDENCE` ⇒ REVIEW; else `cwtBps >= 5000 && !EXONERATED` ⇒ hold; else accept.
* **ASSUMED:** an overturned verdict is also accepted under HAIRCUT (the brief lists overturn only under CUSTODY).
* **ASSUMED:** `CONTESTED_EVIDENCE` takes precedence over the CWT hold in CUSTODY.
* Both HOLD and REVIEW put funds in escrow (`release` / `refund`). Accepted funds are forwarded to `treasury`.
* **KEEP IN SYNC:** thresholds `5000` / `5000` are `HAIRCUT_HOLD_BPS` / `CUSTODY_HOLD_BPS`; Member 1's gateway-preview must use the same numbers.

## ClearanceSBT
* `key = keccak256(bytes(bitcoinAddressString))` (**ASSUMED**), P2PKH (base58check, version 0x00 / 0x6f) and P2WPKH (bech32 `bc`/`tb`, witness v0, 20 bytes).
* Ownership: Bitcoin signed-message (`\x18Bitcoin Signed Message:\n` + varint + message, double-sha256). The message binds `key` and `msg.sender`, so a proof cannot be replayed for another wallet.
* `ecrecover` returns an Ethereum address, not a public key, so the caller supplies the 64-byte uncompressed pubkey; the contract checks `ecrecover(...) == address(keccak256(pubkey))`, then derives `hash160(compressed pubkey)` with the sha256 / ripemd160 precompiles and compares to the claimed address. Only compressed-key addresses can be proven.
