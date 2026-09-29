// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SMTDefaults} from "./SMTDefaults.sol";

/// @title SMTVerifier
/// @notice Verifies compressed Sparse Merkle Tree proofs (256 levels, keccak256, node = H(left||right)).
/// @dev Path convention: the sibling at `level` (0 = the leaf's own sibling, 255 = child of the root)
///      is on the side selected by bit `level` of `key` (LSB = level 0). Bit = 0 means the running node
///      is the LEFT child.
///      Compressed proof: `bitmap` bit `level` == 1 means a non-default sibling for that level is
///      supplied, consumed in order from `siblings[0]` (leaf-adjacent first). Bit == 0 means the
///      sibling is the precomputed empty-subtree hash of height `level` (SMTDefaults, not recomputed).
///      A non-membership (exclusion) proof is the same proof with `leafHash == bytes32(0)`.
library SMTVerifier {
    /// @dev popcount(bitmap) != siblings.length
    error MalformedProof();

    bytes32 internal constant EMPTY_ROOT = SMTDefaults.EMPTY_ROOT;

    /// @notice Recompute the root implied by (key, leafHash, proof). Reverts with MalformedProof if the
    ///         sibling count does not match the bitmap. Use `verify` for a non-reverting check.
    function computeRoot(bytes32 key, bytes32 leafHash, uint256 bitmap, bytes32[] calldata siblings)
        internal
        pure
        returns (bytes32 root)
    {
        bool ok;
        (ok, root) = tryComputeRoot(key, leafHash, bitmap, siblings);
        if (!ok) revert MalformedProof();
    }

    /// @notice True iff the proof is well-formed and recomputes exactly `root`. Never reverts on bad input.
    function verify(bytes32 root, bytes32 key, bytes32 leafHash, uint256 bitmap, bytes32[] calldata siblings)
        internal
        pure
        returns (bool)
    {
        (bool ok, bytes32 computed) = tryComputeRoot(key, leafHash, bitmap, siblings);
        return ok && computed == root;
    }

    function tryComputeRoot(bytes32 key, bytes32 leafHash, uint256 bitmap, bytes32[] calldata siblings)
        internal
        pure
        returns (bool ok, bytes32 node)
    {
        bytes memory defaults = SMTDefaults.DEFAULTS;
        uint256 n = siblings.length;
        uint256 idx;
        node = leafHash;
        for (uint256 level; level < 256; ++level) {
            bytes32 sib;
            if ((bitmap >> level) & 1 == 1) {
                if (idx >= n) return (false, bytes32(0));
                sib = siblings[idx];
                unchecked {
                    ++idx;
                }
            } else {
                assembly ("memory-safe") {
                    sib := mload(add(add(defaults, 0x20), shl(5, level)))
                }
            }
            if ((uint256(key) >> level) & 1 == 0) {
                node = _hash(node, sib);
            } else {
                node = _hash(sib, node);
            }
        }
        if (idx != n) return (false, bytes32(0));
        ok = true;
    }

    function _hash(bytes32 a, bytes32 b) private pure returns (bytes32 h) {
        assembly ("memory-safe") {
            mstore(0x00, a)
            mstore(0x20, b)
            h := keccak256(0x00, 0x40)
        }
    }
}
