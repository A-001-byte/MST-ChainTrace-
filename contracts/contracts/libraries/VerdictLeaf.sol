// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VerdictLeaf
/// @notice Canonical leaf encoding for a published verdict, plus flag bit positions.
/// @dev leafHash = keccak256(abi.encodePacked(uint8(0x01), key, epoch, band, riskBps, haircutBps,
///      cwtBps, lowerBps, intent, flags)) - fixed widths, 49 bytes. Off-chain (Member 1) must build the
///      identical preimage. An unflagged key has the empty leaf bytes32(0) (never a hash of this form).
library VerdictLeaf {
    uint8 internal constant LEAF_VERSION = 0x01;

    /// @dev flags bit 0: address was reviewed and cleared by the pipeline.
    uint16 internal constant EXONERATED = 1 << 0;
    /// @dev flags bit 1: evidence is fragile/contested; route to human review.
    uint16 internal constant CONTESTED_EVIDENCE = 1 << 1;

    function hash(
        bytes32 key,
        uint32 epoch,
        uint8 band,
        uint16 riskBps,
        uint16 haircutBps,
        uint16 cwtBps,
        uint16 lowerBps,
        uint8 intent,
        uint16 flags
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(LEAF_VERSION, key, epoch, band, riskBps, haircutBps, cwtBps, lowerBps, intent, flags)
        );
    }
}
