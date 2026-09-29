"""SMT tests: golden vectors, plus a naive independent root computation as a cross-check."""

from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

import pytest

from src.mst import DEFAULTS, EMPTY_LEAF, Proof, SparseMerkleTree, keccak256, verify_proof
from src.mst import vectors as vec

VECTORS = json.loads(Path(vec.VECTORS_PATH).read_text(encoding="utf-8"))


def b(h: str) -> bytes:
    return bytes.fromhex(h[2:])


def naive_root(leaves: dict[bytes, bytes]) -> bytes:
    """Independent reference: recurse top-down over the key bits, no stored nodes."""
    items = {int.from_bytes(k, "big"): v for k, v in leaves.items()}

    def rec(level: int, prefix: int, keys: list[int]) -> bytes:
        # node at `level` whose index (key >> level) == prefix
        if not keys:
            return DEFAULTS[level]
        if level == 0:
            return items[keys[0]]
        left = [k for k in keys if not (k >> (level - 1)) & 1]
        right = [k for k in keys if (k >> (level - 1)) & 1]
        return keccak256(rec(level - 1, prefix * 2, left) + rec(level - 1, prefix * 2 + 1, right))

    return rec(256, 0, list(items))


def test_keccak_is_not_nist_sha3():
    assert keccak256(b"") != hashlib.sha3_256(b"").digest()
    assert keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"


def test_default_ladder():
    assert DEFAULTS[0] == bytes(32)
    # known value: keccak256(bytes32(0) ++ bytes32(0)), the zero-hash used by many Merkle libs
    assert DEFAULTS[1].hex() == "ad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5"
    assert len(DEFAULTS) == 257
    for i in range(1, 257):
        assert DEFAULTS[i] == keccak256(DEFAULTS[i - 1] * 2)


def test_empty_tree_root_is_top_default():
    assert SparseMerkleTree().root == DEFAULTS[256]


def test_vector_file_is_current():
    assert vec.render() == Path(vec.VECTORS_PATH).read_bytes().decode("utf-8").replace("\r\n", "\n")


def test_vector_file_has_required_coverage():
    assert len(VECTORS["cases"]) >= 20
    keys = {c["key"] for c in VECTORS["cases"]}
    assert "0x" + "00" * 32 in keys
    assert "0x" + "ff" * 32 in keys
    assert VECTORS["cases"] and {c["kind"] for c in VECTORS["cases"]} == {"member", "non_member"}
    assert any(not c["valid"] for c in VECTORS["cases"])
    two = VECTORS["trees"]["two_leaves_differ_bit0"]["leaves"]
    assert int(two[0]["key"], 16) ^ int(two[1]["key"], 16) == 1


@pytest.mark.parametrize("tid", list(VECTORS["trees"]))
def test_tree_roots_match_vectors_and_naive(tid):
    t = VECTORS["trees"][tid]
    leaves = {b(x["key"]): b(x["leaf"]) for x in t["leaves"]}
    assert SparseMerkleTree.from_leaves(leaves).root == b(t["root"])
    if len(leaves) <= 8:
        assert naive_root(leaves) == b(t["root"])


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[c["name"] for c in VECTORS["cases"]])
def test_vector_cases(case):
    tree = VECTORS["trees"][case["tree"]]
    root = b(tree["root"])
    proof = Proof(int(case["proof"]["bitmap"], 16), tuple(b(s) for s in case["proof"]["siblings"]))
    assert verify_proof(root, b(case["key"]), b(case["leaf"]), proof) is case["valid"]
    if case["valid"]:
        # The reference tree must also *produce* exactly this canonical proof.
        t = SparseMerkleTree.from_leaves({b(x["key"]): b(x["leaf"]) for x in tree["leaves"]})
        assert t.prove(b(case["key"])) == proof


def test_mutation_vector():
    m = VECTORS["mutation"]
    t = SparseMerkleTree.from_leaves({b(x["key"]): b(x["leaf"]) for x in VECTORS["trees"][m["tree"]]["leaves"]})
    for step in m["steps"]:
        t.set(b(step["key"]), b(step["leaf"]))
        assert t.root == b(step["rootAfter"])


def test_random_trees_match_naive_and_prove_everything():
    rng = random.Random(1234)
    for _ in range(5):
        leaves = {rng.randbytes(32): keccak256(rng.randbytes(8)) for _ in range(rng.randint(1, 12))}
        t = SparseMerkleTree.from_leaves(leaves)
        assert t.root == naive_root(leaves)
        for k, v in leaves.items():
            assert verify_proof(t.root, k, v, t.prove(k))
        absent = rng.randbytes(32)
        assert verify_proof(t.root, absent, EMPTY_LEAF, t.prove(absent))
        assert not verify_proof(t.root, absent, keccak256(b"x"), t.prove(absent))


def test_incremental_updates_equal_fresh_build():
    rng = random.Random(7)
    keys = [rng.randbytes(32) for _ in range(10)]
    t = SparseMerkleTree()
    live: dict[bytes, bytes] = {}
    for step in range(60):
        k = rng.choice(keys)
        if live.get(k) and rng.random() < 0.4:
            t.set(k, EMPTY_LEAF)
            live.pop(k)
        else:
            v = keccak256(step.to_bytes(4, "big"))
            t.set(k, v)
            live[k] = v
        if step % 7 == 0:
            assert t.root == SparseMerkleTree.from_leaves(live).root
    assert t.root == naive_root(live)


def test_removing_all_leaves_restores_empty_root():
    t = SparseMerkleTree.from_leaves({bytes(32): keccak256(b"a"), b"\xff" * 32: keccak256(b"b")})
    t.set(bytes(32), EMPTY_LEAF)
    t.set(b"\xff" * 32, EMPTY_LEAF)
    assert t.root == DEFAULTS[256]
    assert len(t) == 0


def test_bit_order_is_lsb_first():
    """Key with only bit 0 set is the RIGHT child at level 0; only bit 255 set is right at the top."""
    leaf = keccak256(b"L")
    t = SparseMerkleTree.from_leaves({(1).to_bytes(32, "big"): leaf})
    node = keccak256(DEFAULTS[0] + leaf)  # level 0: right child => (sibling, node)
    for i in range(1, 256):
        node = keccak256(node + DEFAULTS[i])  # all higher bits are 0 => left child
    assert t.root == node


def test_bad_inputs_rejected():
    with pytest.raises(ValueError):
        SparseMerkleTree().set(b"\x00" * 31, keccak256(b"x"))
    root = SparseMerkleTree().root
    assert not verify_proof(root, bytes(32), EMPTY_LEAF, Proof(1 << 256, ()))
    assert not verify_proof(root, bytes(32), EMPTY_LEAF, Proof(1, ()))
