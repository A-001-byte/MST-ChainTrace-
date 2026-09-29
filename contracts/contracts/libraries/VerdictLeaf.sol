// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VerdictLeaf
/// @notice Canonical leaf encoding for a published verdict, plus flag bit positions.
/// @dev SHARED SPEC v1: leafHash = keccak256(abi.encode(bytes32 key, uint32 epoch, uint8 band, uint16 riskBps,
///      uint16 haircutBps, uint16 cwtBps, uint16 lowerBps, uint8 intent, uint8 flags)) - nine 32-byte words.
///      An unflagged key has the empty leaf bytes32(0).
library VerdictLeaf {
    /// @dev flags bits (shared spec v1): 0 GEO_TEMPORAL_MISMATCH, 1 CONTESTED_EVIDENCE, 2 EXONERATED, 3 KNOWN_LABEL.
    uint8 internal constant GEO_TEMPORAL_MISMATCH = 1 << 0;
    uint8 internal constant CONTESTED_EVIDENCE = 1 << 1;
    uint8 internal constant EXONERATED = 1 << 2;
    uint8 internal constant KNOWN_LABEL = 1 << 3;

    function hash(
        bytes32 key,
        uint32 epoch,
        uint8 band,
        uint16 riskBps,
        uint16 haircutBps,
        uint16 cwtBps,
        uint16 lowerBps,
        uint8 intent,
        uint8 flags
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(key, epoch, band, riskBps, haircutBps, cwtBps, lowerBps, intent, flags)
        );
    }
}
