"""Sparse Merkle tree, depth 256, keccak256 (SHARED SPEC v1).

Level 0 is the leaf level, level 255 is just below the root. At level i the current
node is the RIGHT child iff bit i of uint256(key) is 1. Proofs are
(bitmap, siblings): bitmap bit i set => level-i sibling is non-default and is the next
element of `siblings` (ordered from level 0 upward); clear => use DEFAULTS[i].
Non-membership is a valid proof for leaf value bytes32(0).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .keccak import keccak256

DEPTH = 256
EMPTY_LEAF = bytes(32)


def _build_defaults() -> list[bytes]:
    d = [EMPTY_LEAF]
    for _ in range(DEPTH):
        d.append(keccak256(d[-1] + d[-1]))
    return d


# DEFAULTS[i] = root of an empty subtree of height i; DEFAULTS[256] is the empty-tree root.
DEFAULTS: list[bytes] = _build_defaults()


@dataclass(frozen=True)
class Proof:
    bitmap: int
    siblings: tuple[bytes, ...]


def _check_key(key: bytes) -> int:
    if not isinstance(key, (bytes, bytearray)) or len(key) != 32:
        raise ValueError("key must be 32 bytes")
    return int.from_bytes(key, "big")


def compute_root_from_proof(key: bytes, leaf: bytes, proof: Proof) -> bytes:
    """Fold a leaf up the path; raises ValueError on a malformed proof."""
    k = _check_key(key)
    if len(leaf) != 32:
        raise ValueError("leaf must be 32 bytes")
    if not 0 <= proof.bitmap < (1 << DEPTH):
        raise ValueError("bitmap out of range")
    if bin(proof.bitmap).count("1") != len(proof.siblings):
        raise ValueError("sibling count does not match bitmap popcount")
    node = bytes(leaf)
    used = 0
    for i in range(DEPTH):
        if (proof.bitmap >> i) & 1:
            sib = proof.siblings[used]
            used += 1
            if len(sib) != 32:
                raise ValueError("sibling must be 32 bytes")
        else:
            sib = DEFAULTS[i]
        node = keccak256(sib + node) if (k >> i) & 1 else keccak256(node + sib)
    return node


def verify_proof(root: bytes, key: bytes, leaf: bytes, proof: Proof) -> bool:
    """True iff `proof` shows `leaf` is at `key` under `root` (leaf=bytes32(0) => non-membership)."""
    try:
        return compute_root_from_proof(key, leaf, proof) == root
    except ValueError:
        return False


@dataclass
class SparseMerkleTree:
    """In-memory SMT. Stores every non-default node (~256 per distinct leaf path)."""

    _levels: list[dict[int, bytes]] = field(
        default_factory=lambda: [dict() for _ in range(DEPTH + 1)]
    )
    _dirty: set[int] = field(default_factory=set)

    @classmethod
    def from_leaves(cls, leaves: dict[bytes, bytes]) -> "SparseMerkleTree":
        t = cls()
        for k, v in leaves.items():
            t.set(k, v)
        return t

    def set(self, key: bytes, leaf: bytes) -> None:
        """Set the leaf at `key`. Setting bytes32(0) removes it."""
        k = _check_key(key)
        if len(leaf) != 32:
            raise ValueError("leaf must be 32 bytes")
        if leaf == EMPTY_LEAF:
            self._levels[0].pop(k, None)
        else:
            self._levels[0][k] = bytes(leaf)
        self._dirty.add(k)

    def get(self, key: bytes) -> bytes:
        return self._levels[0].get(_check_key(key), EMPTY_LEAF)

    def __len__(self) -> int:
        return len(self._levels[0])

    def _node(self, level: int, idx: int) -> bytes:
        return self._levels[level].get(idx, DEFAULTS[level])

    def _flush(self) -> None:
        """Recompute the ancestors of every changed leaf, level by level."""
        dirty = self._dirty
        self._dirty = set()
        for level in range(DEPTH):
            parents = {i >> 1 for i in dirty}
            for p in parents:
                left, right = self._node(level, 2 * p), self._node(level, 2 * p + 1)
                if left == DEFAULTS[level] and right == DEFAULTS[level]:
                    self._levels[level + 1].pop(p, None)
                else:
                    self._levels[level + 1][p] = keccak256(left + right)
            dirty = parents

    @property
    def root(self) -> bytes:
        if self._dirty:
            self._flush()
        return self._node(DEPTH, 0)

    def prove(self, key: bytes) -> Proof:
        """Membership proof if `key` is set, otherwise a non-membership proof (for bytes32(0))."""
        k = _check_key(key)
        if self._dirty:
            self._flush()
        bitmap = 0
        siblings: list[bytes] = []
        idx = k
        for level in range(DEPTH):
            sib = self._levels[level].get(idx ^ 1)
            if sib is not None and sib != DEFAULTS[level]:
                bitmap |= 1 << level
                siblings.append(sib)
            idx >>= 1
        return Proof(bitmap, tuple(siblings))
