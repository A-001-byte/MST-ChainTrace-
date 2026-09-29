// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SMTVerifier} from "../libraries/SMTVerifier.sol";
import {VerdictLeaf} from "../libraries/VerdictLeaf.sol";

/// @dev Test-only wrapper so the internal library can be called and gas-measured from Hardhat.
contract SMTVerifierHarness {
    function computeRoot(bytes32 key, bytes32 leafHash, uint256 bitmap, bytes32[] calldata siblings)
        external
        pure
        returns (bytes32)
    {
        return SMTVerifier.computeRoot(key, leafHash, bitmap, siblings);
    }

    function verify(bytes32 root, bytes32 key, bytes32 leafHash, uint256 bitmap, bytes32[] calldata siblings)
        external
        pure
        returns (bool)
    {
        return SMTVerifier.verify(root, key, leafHash, bitmap, siblings);
    }

    /// @dev Non-view so the transaction's real gasUsed can be read from the receipt.
    event Verified(bool ok);

    function verifyTx(bytes32 root, bytes32 key, bytes32 leafHash, uint256 bitmap, bytes32[] calldata siblings)
        external
        returns (bool ok)
    {
        ok = SMTVerifier.verify(root, key, leafHash, bitmap, siblings);
        emit Verified(ok);
    }

    /// @dev Gas consumed by the verification alone (gasleft delta), excluding tx/calldata overhead.
    function verifyGas(bytes32 root, bytes32 key, bytes32 leafHash, uint256 bitmap, bytes32[] calldata siblings)
        external
        view
        returns (bool ok, uint256 gasUsed)
    {
        uint256 g = gasleft();
        ok = SMTVerifier.verify(root, key, leafHash, bitmap, siblings);
        gasUsed = g - gasleft();
    }

    function verdictLeaf(
        bytes32 key,
        uint32 epoch,
        uint8 band,
        uint16 riskBps,
        uint16 haircutBps,
        uint16 cwtBps,
        uint16 lowerBps,
        uint8 intent,
        uint8 flags
    ) external pure returns (bytes32) {
        return VerdictLeaf.hash(key, epoch, band, riskBps, haircutBps, cwtBps, lowerBps, intent, flags);
    }
}
