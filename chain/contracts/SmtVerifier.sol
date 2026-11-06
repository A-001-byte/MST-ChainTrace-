// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Sparse Merkle tree proof verification, SHARED SPEC v1.
/// keccak256 everywhere; depth 256; level 0 is the leaf level; at level i the current
/// node is the RIGHT child iff bit i of uint256(key) is 1. Proof = (bitmap, siblings):
/// bit i of `bitmap` set => the level-i sibling is the next element of `siblings`,
/// clear => it is the default (empty-subtree) hash for level i.
library SmtVerifier {
    uint256 internal constant DEPTH = 256;

    /// @return root the root implied by folding `leaf` up the path of `key`.
    /// Reverts if `siblings.length` does not equal the popcount of `bitmap`.
    function computeRoot(bytes32 key, bytes32 leaf, uint256 bitmap, bytes32[] memory siblings)
        internal
        pure
        returns (bytes32 root)
    {
        uint256 k = uint256(key);
        bytes32 node = leaf;
        bytes32 def = bytes32(0); // default[level], advanced each iteration
        uint256 used = 0;
        for (uint256 i = 0; i < DEPTH; ++i) {
            bytes32 sibling;
            if ((bitmap >> i) & 1 == 1) {
                require(used < siblings.length, "SMT: too few siblings");
                sibling = siblings[used++];
            } else {
                sibling = def;
            }
            node = ((k >> i) & 1 == 1)
                ? keccak256(abi.encodePacked(sibling, node))
                : keccak256(abi.encodePacked(node, sibling));
            def = keccak256(abi.encodePacked(def, def)); // default[i + 1]
        }
        require(used == siblings.length, "SMT: too many siblings");
        return node;
    }

    /// @dev Non-membership is verify(root, key, bytes32(0), ...).
    function verify(bytes32 root, bytes32 key, bytes32 leaf, uint256 bitmap, bytes32[] memory siblings)
        internal
        pure
        returns (bool)
    {
        return computeRoot(key, leaf, bitmap, siblings) == root;
    }
}
