"""MST anchoring: keccak256 sparse Merkle tree + score-leaf encoding (SHARED SPEC v1).

Reference implementation and golden-vector generator. See docs/SHARED_SPEC_v1.md.
"""

from .keccak import keccak256
from .leaf import (
    Band,
    Flag,
    Intent,
    LeafFields,
    address_key,
    band_for_score,
    bps,
    encode_leaf,
    leaf_hash,
)
from .smt import (
    DEFAULTS,
    DEPTH,
    EMPTY_LEAF,
    Proof,
    SparseMerkleTree,
    compute_root_from_proof,
    verify_proof,
)

__all__ = [
    "keccak256",
    "Band", "Flag", "Intent", "LeafFields",
    "address_key", "band_for_score", "bps", "encode_leaf", "leaf_hash",
    "DEFAULTS", "DEPTH", "EMPTY_LEAF", "Proof", "SparseMerkleTree",
    "compute_root_from_proof", "verify_proof",
]
