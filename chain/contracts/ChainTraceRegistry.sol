// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SmtVerifier} from "./SmtVerifier.sol";

/// @notice Anchors one ChainTrace score-tree root per epoch and verifies per-address
/// score proofs against it (SHARED SPEC v1).
contract ChainTraceRegistry {
    // band
    uint8 public constant BAND_UNSCORED = 0;
    uint8 public constant BAND_LOW = 1;
    uint8 public constant BAND_MEDIUM = 2;
    uint8 public constant BAND_HIGH = 3;
    // intent
    uint8 public constant INTENT_NONE = 0;
    uint8 public constant INTENT_RANSOMWARE = 1;
    uint8 public constant INTENT_DARKNET_MARKET = 2;
    uint8 public constant INTENT_SANCTIONS_EVASION = 3;
    uint8 public constant INTENT_PATTERN_UNCLEAR = 4;
    uint8 public constant INTENT_INSUFFICIENT_SIGNAL = 5;
    // flags
    uint8 public constant FLAG_GEO_TEMPORAL_MISMATCH = 1 << 0;
    uint8 public constant FLAG_CONTESTED_EVIDENCE = 1 << 1;
    uint8 public constant FLAG_EXONERATED = 1 << 2;
    uint8 public constant FLAG_KNOWN_LABEL = 1 << 3;

    struct Score {
        uint32 epoch;
        uint8 band;
        uint16 riskBps;
        uint16 haircutBps;
        uint16 cwtBps;
        uint16 lowerBps;
        uint8 intent;
        uint8 flags;
    }

    address public owner;
    uint32 public latestEpoch;
    mapping(uint32 => bytes32) public rootOf;

    event RootPublished(uint32 indexed epoch, bytes32 root);
    event OwnershipTransferred(address indexed from, address indexed to);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address to) external onlyOwner {
        require(to != address(0), "zero owner");
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    /// @notice Publish the root for a new epoch. Epochs are strictly increasing and a
    /// published root is immutable.
    function publishRoot(uint32 epoch, bytes32 root) external onlyOwner {
        require(epoch > latestEpoch, "epoch not increasing");
        require(root != bytes32(0), "empty root");
        rootOf[epoch] = root;
        latestEpoch = epoch;
        emit RootPublished(epoch, root);
    }

    /// @notice key = keccak256(UTF-8 bytes of the address string).
    function keyOf(string memory btcAddress) public pure returns (bytes32) {
        return keccak256(bytes(btcAddress));
    }

    function leafOf(bytes32 key, Score memory s) public pure returns (bytes32) {
        return keccak256(
            abi.encode(key, s.epoch, s.band, s.riskBps, s.haircutBps, s.cwtBps, s.lowerBps, s.intent, s.flags)
        );
    }

    /// @notice True iff `s` is the score committed for `btcAddress` in epoch `s.epoch`.
    function verifyScore(string calldata btcAddress, Score calldata s, uint256 bitmap, bytes32[] calldata siblings)
        external
        view
        returns (bool)
    {
        bytes32 root = rootOf[s.epoch];
        if (root == bytes32(0)) return false;
        bytes32 key = keyOf(btcAddress);
        return SmtVerifier.verify(root, key, leafOf(key, s), bitmap, siblings);
    }

    /// @notice True iff `btcAddress` has no score in `epoch` (non-membership proof).
    function verifyAbsent(string calldata btcAddress, uint32 epoch, uint256 bitmap, bytes32[] calldata siblings)
        external
        view
        returns (bool)
    {
        bytes32 root = rootOf[epoch];
        if (root == bytes32(0)) return false;
        return SmtVerifier.verify(root, keyOf(btcAddress), bytes32(0), bitmap, siblings);
    }

    /// @notice Raw proof check against an arbitrary root; used for the golden vectors.
    function verifyRaw(bytes32 root, bytes32 key, bytes32 leaf, uint256 bitmap, bytes32[] calldata siblings)
        external
        pure
        returns (bool)
    {
        return SmtVerifier.verify(root, key, leaf, bitmap, siblings);
    }
}
