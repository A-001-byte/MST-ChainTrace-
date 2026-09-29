"""Golden vector generator: writes tests/vectors/smt_vectors.json.

    python -m src.mst.vectors            # (re)write the file
    python -m src.mst.vectors --check    # exit 1 if the file on disk is stale

Members 2 and 3 must reproduce every value here byte-for-byte before integrating.
All bytes are 0x-prefixed lowercase hex; bitmaps are 0x-prefixed 64-hex-digit uint256.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .keccak import keccak256
from .leaf import Band, Flag, Intent, LeafFields, address_key, band_for_score, bps, encode_leaf, leaf_hash
from .smt import DEFAULTS, EMPTY_LEAF, Proof, SparseMerkleTree, verify_proof

VECTORS_PATH = Path(__file__).resolve().parents[2] / "tests" / "vectors" / "smt_vectors.json"


def hx(b: bytes) -> str:
    return "0x" + b.hex()


def hx_bitmap(n: int) -> str:
    return "0x" + n.to_bytes(32, "big").hex()


def key_from_int(n: int) -> bytes:
    return n.to_bytes(32, "big")


def proof_json(p: Proof) -> dict:
    return {"bitmap": hx_bitmap(p.bitmap), "siblings": [hx(s) for s in p.siblings]}


ADDRESSES = [
    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
    "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
    "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
    "12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX",
    "1dice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp",
    "3Cbq7aT1tY8kMxWLbNYo5rWAGCTdRC1XYS",
    "17SkEw2md5avVNyYgj6RiXuQKNwkXaxFyQ",
]

# (epoch, risk, haircut, cwt, lower, intent, flags) per address; risk chosen to hit each band.
SAMPLE_SCORES = [
    (1, 0.9123, 0.85, 0.7812, 0.4, Intent.RANSOMWARE, Flag.KNOWN_LABEL),
    (1, 0.80, 0.5, 0.45, 0.3, Intent.SANCTIONS_EVASION, Flag.GEO_TEMPORAL_MISMATCH),
    (1, 0.6, 0.31, 0.12345, 0.1, Intent.DARKNET_MARKET, Flag.CONTESTED_EVIDENCE),
    (1, 0.5999, 0.2, 0.05, 0.0, Intent.PATTERN_UNCLEAR, Flag(0)),
    (1, 0.0, 0.0, 0.0, 0.0, Intent.NONE, Flag.EXONERATED),
    (2, 0.42, 0.42, 0.42, 0.42, Intent.INSUFFICIENT_SIGNAL, Flag(0)),
    (2, 1.0, 1.0, 1.0, 1.0, Intent.RANSOMWARE, Flag.GEO_TEMPORAL_MISMATCH | Flag.CONTESTED_EVIDENCE),
    (2, None, 0.0, 0.0, 0.0, Intent.NONE, Flag(0)),
]


def sample_fields() -> list[tuple[str, LeafFields]]:
    out = []
    for addr, (epoch, risk, hc, cwt, low, intent, flags) in zip(ADDRESSES, SAMPLE_SCORES):
        out.append((addr, LeafFields(
            key=address_key(addr), epoch=epoch, band=int(band_for_score(risk)),
            risk_bps=bps(risk if risk is not None else 0), haircut_bps=bps(hc),
            cwt_bps=bps(cwt), lower_bps=bps(low), intent=int(intent), flags=int(flags),
        )))
    return out


def _leaf_vector(f: LeafFields, **extra) -> dict:
    return {
        **extra,
        "key": hx(f.key), "epoch": f.epoch, "band": f.band,
        "riskBps": f.risk_bps, "haircutBps": f.haircut_bps, "cwtBps": f.cwt_bps,
        "lowerBps": f.lower_bps, "intent": f.intent, "flags": f.flags,
        "encoded": hx(encode_leaf(f)), "leaf": hx(leaf_hash(f)),
    }


def _fake_leaf(n: int) -> bytes:
    """Arbitrary non-zero 32-byte leaf value for structural tree cases."""
    return keccak256(f"leaf-{n}".encode())


def build_vectors() -> dict:
    sample = sample_fields()
    sample_leaves = {f.key: leaf_hash(f) for _, f in sample}

    # ---- trees (id -> leaves) --------------------------------------------------------
    tree_defs: dict[str, dict[bytes, bytes]] = {
        "empty": {},
        "single_zero_key": {key_from_int(0): _fake_leaf(1)},
        "single_all_ones_key": {key_from_int((1 << 256) - 1): _fake_leaf(2)},
        "single_bit0": {key_from_int(1): _fake_leaf(3)},
        "single_bit1": {key_from_int(2): _fake_leaf(4)},
        "single_bit7": {key_from_int(1 << 7): _fake_leaf(5)},
        "single_bit128": {key_from_int(1 << 128): _fake_leaf(6)},
        "single_bit255": {key_from_int(1 << 255): _fake_leaf(7)},
        "two_leaves_differ_bit0": {key_from_int(0): _fake_leaf(8), key_from_int(1): _fake_leaf(9)},
        "two_leaves_differ_bit255": {key_from_int(0): _fake_leaf(10), key_from_int(1 << 255): _fake_leaf(11)},
        "zero_and_all_ones": {key_from_int(0): _fake_leaf(12), key_from_int((1 << 256) - 1): _fake_leaf(13)},
        "chaintrace_sample": sample_leaves,
    }
    trees, built = {}, {}
    for tid, leaves in tree_defs.items():
        t = SparseMerkleTree.from_leaves(leaves)
        built[tid] = t
        trees[tid] = {
            "leaves": [{"key": hx(k), "leaf": hx(v)} for k, v in leaves.items()],
            "root": hx(t.root),
        }

    # ---- proof cases -----------------------------------------------------------------
    cases: list[dict] = []

    def add(name: str, kind: str, tid: str, key: bytes, leaf: bytes, proof: Proof, valid: bool) -> None:
        t = built[tid]
        # Every case's expectation is re-derived here, so a generator bug can't ship silently.
        assert verify_proof(t.root, key, leaf, proof) == valid, name
        cases.append({
            "name": name, "kind": kind, "tree": tid,
            "key": hx(key), "leaf": hx(leaf), "proof": proof_json(proof), "valid": valid,
        })

    def member(name: str, tid: str, key: bytes) -> None:
        t = built[tid]
        add(name, "member", tid, key, t.get(key), t.prove(key), True)

    def nonmember(name: str, tid: str, key: bytes) -> None:
        t = built[tid]
        assert t.get(key) == EMPTY_LEAF
        add(name, "non_member", tid, key, EMPTY_LEAF, t.prove(key), True)

    ones = key_from_int((1 << 256) - 1)
    member("member: key all-zeros", "single_zero_key", key_from_int(0))
    member("member: key all-ones", "single_all_ones_key", ones)
    member("member: single bit 0", "single_bit0", key_from_int(1))
    member("member: single bit 1", "single_bit1", key_from_int(2))
    member("member: single bit 7", "single_bit7", key_from_int(1 << 7))
    member("member: single bit 128", "single_bit128", key_from_int(1 << 128))
    member("member: single bit 255", "single_bit255", key_from_int(1 << 255))
    member("member: two-leaf tree (bit-0 sibling) left", "two_leaves_differ_bit0", key_from_int(0))
    member("member: two-leaf tree (bit-0 sibling) right", "two_leaves_differ_bit0", key_from_int(1))
    member("member: two-leaf tree (bit-255 split) left", "two_leaves_differ_bit255", key_from_int(0))
    member("member: two-leaf tree (bit-255 split) right", "two_leaves_differ_bit255", key_from_int(1 << 255))
    member("member: zero and all-ones tree, all-ones", "zero_and_all_ones", ones)
    for addr, f in sample:
        member(f"member: sample address {addr[:10]}..", "chaintrace_sample", f.key)

    nonmember("non-member: empty tree, key zero", "empty", key_from_int(0))
    nonmember("non-member: empty tree, key all-ones", "empty", ones)
    nonmember("non-member: empty tree, real address", "empty", address_key(ADDRESSES[0]))
    nonmember("non-member: neighbour of single bit-0 key (key 0)", "single_bit0", key_from_int(0))
    nonmember("non-member: bit-0 sibling slot in single-leaf tree", "single_zero_key", key_from_int(1))
    nonmember("non-member: opposite-half key", "single_bit255", key_from_int(0))
    nonmember("non-member: between zero and all-ones", "zero_and_all_ones", key_from_int(1 << 255))
    nonmember("non-member: unknown address in sample tree", "chaintrace_sample",
              address_key("1UnknownAddressNotInTheDatasetXXXXXX"))

    # ---- negative cases: each of these MUST verify false ------------------------------
    t = built["chaintrace_sample"]
    k0 = sample[0][1].key
    p = t.prove(k0)
    add("invalid: wrong leaf value", "member", "chaintrace_sample", k0, _fake_leaf(99), p, False)
    tampered = Proof(p.bitmap, (bytes([p.siblings[0][0] ^ 1]) + p.siblings[0][1:],) + p.siblings[1:])
    add("invalid: tampered sibling", "member", "chaintrace_sample", k0, t.get(k0), tampered, False)
    add("invalid: bitmap bit flipped (count mismatch)", "member", "chaintrace_sample", k0, t.get(k0),
        Proof(p.bitmap ^ (1 << 200), p.siblings), False)
    add("invalid: proof for a different key", "member", "chaintrace_sample", sample[1][1].key, t.get(k0), p, False)
    add("invalid: membership proof claimed as non-membership", "non_member", "chaintrace_sample", k0,
        EMPTY_LEAF, p, False)
    add("invalid: extra sibling beyond popcount", "member", "chaintrace_sample", k0, t.get(k0),
        Proof(p.bitmap, p.siblings + (_fake_leaf(5),)), False)

    # ---- mutation: update and delete -------------------------------------------------
    mut = SparseMerkleTree.from_leaves(tree_defs["two_leaves_differ_bit0"])
    before = mut.root
    mut.set(key_from_int(1), _fake_leaf(50))
    updated = mut.root
    mut.set(key_from_int(1), EMPTY_LEAF)
    after_delete = mut.root
    assert before != updated
    only0 = SparseMerkleTree.from_leaves({key_from_int(0): _fake_leaf(8)})
    assert after_delete == only0.root
    mutation = {
        "description": "start from two_leaves_differ_bit0; overwrite key 1; then delete key 1 (set bytes32(0)).",
        "tree": "two_leaves_differ_bit0",
        "steps": [
            {"op": "set", "key": hx(key_from_int(1)), "leaf": hx(_fake_leaf(50)), "rootAfter": hx(updated)},
            {"op": "set", "key": hx(key_from_int(1)), "leaf": hx(EMPTY_LEAF), "rootAfter": hx(after_delete)},
        ],
    }

    return {
        "spec": "SHARED_SPEC_v1",
        "hash": "keccak256",
        "depth": 256,
        "notes": [
            "keccak256, NOT NIST sha3-256. keccak256('') = 0xc5d2...a470.",
            "Bitmap is a uint256; bit i set => level-i sibling is the next element of siblings.",
            "Level 0 = leaf level. At level i the node is the RIGHT child iff bit i of uint256(key) is 1.",
            "A proof that lists a default-valued sibling in the bitmap is non-canonical but still hashes to the root; the spec does not require verifiers to reject it, so there is no vector for it.",
            "`valid: false` cases must be rejected (return false / revert) by every verifier.",
        ],
        "keccak_kats": [
            {"inputHex": "0x" + x.hex(), "keccak256": hx(keccak256(x))}
            for x in (b"", b"abc", bytes(32), bytes(64), b"\xff" * 32)
        ],
        "defaults": [hx(d) for d in DEFAULTS],
        "keyVectors": [{"address": a, "key": hx(address_key(a))} for a in ADDRESSES],
        "bpsVectors": [
            {"value": v, "bps": bps(v)}
            for v in (0, 0.0, 1, 1.0, 0.5, 0.12345, 0.12344, 0.00005, 0.00004, 0.99995, 0.9999, 1.5, -0.2, 0.6)
        ],
        "bandVectors": [
            {"score": s, "band": int(band_for_score(s))}
            for s in (None, 0.0, 0.3, 0.5999, 0.6, 0.79, 0.7999, 0.8, 1.0)
        ],
        "leafVectors": [_leaf_vector(f, address=a) for a, f in sample],
        "trees": trees,
        "cases": cases,
        "mutation": mutation,
    }


def render() -> str:
    return json.dumps(build_vectors(), indent=2) + "\n"


def main(argv: list[str]) -> int:
    text = render()
    if "--check" in argv:
        current = VECTORS_PATH.read_text(encoding="utf-8") if VECTORS_PATH.exists() else ""
        if current.replace("\r\n", "\n") != text:
            print(f"{VECTORS_PATH} is stale; run python -m src.mst.vectors", file=sys.stderr)
            return 1
        print("vectors up to date")
        return 0
    VECTORS_PATH.parent.mkdir(parents=True, exist_ok=True)
    VECTORS_PATH.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {VECTORS_PATH} ({len(build_vectors()['cases'])} proof cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
