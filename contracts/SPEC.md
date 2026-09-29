# Verdict-layer contracts: spec status

The normative spec is **`docs/SHARED_SPEC_v1.md`** (Member 1, merged from `origin/feat/mst-anchor`), with golden
vectors in **`tests/vectors/smt_vectors.json`**. The contracts implement it exactly; every one of the 34 vector
cases, the 8 leaf vectors, the key vectors, the KATs and all 257 default hashes pass (`npx hardhat test`).

## Implemented per shared spec v1
| Item | Value |
|---|---|
| Hash | keccak256; `key = keccak256(utf8 address)` |
| Tree | depth 256, `default[0]=0`, `default[i]=H(default[i-1],default[i-1])`, node = `H(left‖right)`; node is the RIGHT child at level `i` iff bit `i` of `uint256(key)` is 1 |
| Proof | `(uint256 bitmap, bytes32[] siblings)`, siblings ordered from level 0; bit `i`=1 ⇒ next sibling, else `default[i]`; non-membership = proof of leaf `bytes32(0)` |
| Leaf | `keccak256(abi.encode(bytes32 key, uint32 epoch, uint8 band, uint16 riskBps, uint16 haircutBps, uint16 cwtBps, uint16 lowerBps, uint8 intent, uint8 flags))` |
| Flags | bit0 GEO_TEMPORAL_MISMATCH=1, bit1 CONTESTED_EVIDENCE=2, bit2 EXONERATED=4, bit3 KNOWN_LABEL=8 |
| Empty root | `0xa7ff9e28ffd3def443d324547688c2c4eb98edf7da757d6bfa22bff55b9ce24a` |
| Non-canonical proofs | a default sibling listed in the bitmap is accepted (spec: verifiers need not reject) |

## Decisions the spec left open (contract author's choices; confirm with the team)
* **Value is the native currency** (assumed to be tMSTC): `challenge` is `payable` per the brief. An ERC-20 tMSTC would need a code change.
* **Epochs:** stored root starts at `bytes32(0)`; first `publishEpoch` uses `prevRoot = 0x00…00`. `epoch` must be strictly greater than the last one (gaps allowed).
* **Upheld-challenge reward** = `min(slashReward, publisherBond)`; `slashReward` is owner-configurable (the brief did not size it).
* **Pull payments:** refunds, rewards and forfeited bonds are credited to `pendingPayout` and claimed with `withdrawPayout()`, so a reverting recipient cannot block `resolve`.
* **Arbiter is a single trusted address: a known centralization point in v1** (also stated in the `VerdictOracle` NatSpec).
* **Gateway:** an overturned verdict is accepted under BOTH policies (brief states it only under CUSTODY); under CUSTODY `CONTESTED_EVIDENCE` → REVIEW takes precedence over the CWT hold. HOLD and REVIEW both escrow. Accepted funds go to `treasury`. `depositUnflagged` added for keys with no verdict.
* **KEEP IN SYNC:** `HAIRCUT_HOLD_BPS = 5000` and `CUSTODY_HOLD_BPS = 5000` must equal Member 1's gateway-preview thresholds.
* **ClearanceSBT:** P2PKH (base58check, `0x00`/`0x6f`) and P2WPKH (bech32 v0, `bc`/`tb`), compressed pubkeys only. Canonical spellings only (exact leading-`1` count; lowercase bech32), because the key is the hash of the string and another spelling would map to an unflagged key. `ecrecover` returns an address, not a pubkey, so the caller supplies the 64-byte pubkey and the contract checks `keccak(pubkey)[12:] == ecrecover(...)` before hash160 (sha256 + ripemd160 precompiles). The signed message binds `key` and `msg.sender`.
* **Band/intent** are opaque to the contracts. Note Member 1's open question (README): dashboard band thresholds differ between `config.py` and the React frontend.

## Chain
RPC `https://testnetrpc.mstblockchain.com`. The deploy script reads the LIVE `eth_chainId` and compares it with `MST_CHAIN_ID` from `.env`; the shared spec says community sources report 91562037 (0x5752035), so verify it live.
