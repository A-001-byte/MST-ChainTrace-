// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {BitcoinAddress} from "./libraries/BitcoinAddress.sol";
import {VerdictLeaf} from "./libraries/VerdictLeaf.sol";

interface IClearanceOracle {
    function latestEpoch() external view returns (uint32);

    function screen(
        bytes32 key,
        uint32 epoch,
        uint8 band,
        uint16 riskBps,
        uint16 haircutBps,
        uint16 cwtBps,
        uint16 lowerBps,
        uint8 intent,
        uint8 flags,
        uint256 bitmap,
        bytes32[] calldata siblings
    ) external view returns (uint8, uint8, bool);

    function verifyUnflagged(bytes32 key, uint32 epoch, uint256 bitmap, bytes32[] calldata siblings)
        external
        view
        returns (bool);
}

/// @title ClearanceSBT
/// @notice Non-transferable (soulbound) ERC-721 attesting that a Bitcoin address was EXONERATED or unflagged in
///         the latest epoch, minted only to the caller and only with a Bitcoin signed-message proof that the
///         caller controls that address (P2PKH / P2WPKH, compressed pubkey).
/// @dev `key` is assumed to be keccak256(bytes(address string)) (see contracts/SPEC.md). The signed message binds
///      both `key` and `msg.sender`, so a proof cannot be replayed to mint for a different wallet.
///      DEMO NOTE: unless Member 1's checksum audit has confirmed the dataset addresses are real, checksummed
///      Bitcoin addresses, only a freshly generated "demo key" may be used here.
contract ClearanceSBT is ERC721 {
    struct BtcProof {
        string btcAddress; // claimed address string; key must equal keccak256(bytes(btcAddress))
        bytes32 pubX; // uncompressed secp256k1 pubkey, x
        bytes32 pubY; // uncompressed secp256k1 pubkey, y
        uint8 v; // 27 or 28
        bytes32 r;
        bytes32 s;
    }

    struct Clearance {
        bytes32 key;
        uint32 epoch;
    }

    IClearanceOracle public immutable oracle;
    uint256 public totalSupply;
    mapping(uint256 => Clearance) public clearanceOf;
    /// @notice tokenId + 1 for keys that already have a token (0 = none).
    mapping(bytes32 => uint256) private _tokenOfKeyPlusOne;

    event ClearanceMinted(uint256 indexed tokenId, address indexed to, bytes32 indexed key, uint32 epoch);

    error NonTransferable();
    error StaleEpoch(uint32 epoch, uint32 latest);
    error InvalidProof();
    error NotCleared();
    error KeyAddressMismatch();
    error OwnershipProofFailed();
    error AlreadyMinted();

    constructor(address oracle_) ERC721("MST Clearance", "MSTCLR") {
        oracle = IClearanceOracle(oracle_);
    }

    /// @notice Mint for a key whose verdict in the latest epoch is EXONERATED (or was overturned on appeal).
    function mintExonerated(
        bytes32 key,
        uint32 epoch,
        uint8 band,
        uint16 riskBps,
        uint16 haircutBps,
        uint16 cwtBps,
        uint16 lowerBps,
        uint8 intent,
        uint8 flags,
        uint256 bitmap,
        bytes32[] calldata siblings,
        BtcProof calldata btc
    ) external returns (uint256) {
        _requireLatest(epoch);
        bool wasOverturned;
        try oracle.screen(key, epoch, band, riskBps, haircutBps, cwtBps, lowerBps, intent, flags, bitmap, siblings)
        returns (uint8, uint8, bool o) {
            wasOverturned = o;
        } catch {
            revert InvalidProof();
        }
        if (flags & VerdictLeaf.EXONERATED == 0 && !wasOverturned) revert NotCleared();
        return _mintVerified(key, epoch, btc);
    }

    /// @notice Mint for a key with no verdict at all in the latest epoch (exclusion proof).
    function mintUnflagged(bytes32 key, uint32 epoch, uint256 bitmap, bytes32[] calldata siblings, BtcProof calldata btc)
        external
        returns (uint256)
    {
        _requireLatest(epoch);
        if (!oracle.verifyUnflagged(key, epoch, bitmap, siblings)) revert InvalidProof();
        return _mintVerified(key, epoch, btc);
    }

    /// @notice The exact message the address owner must sign with their Bitcoin key for (key, wallet).
    function ownershipMessage(bytes32 key, address wallet) public pure returns (bytes memory) {
        return abi.encodePacked("ChainTrace clearance key:", Strings.toHexString(uint256(key), 32), " to:", Strings.toHexString(wallet));
    }

    function tokenOfKey(bytes32 key) external view returns (uint256 tokenId, bool exists) {
        uint256 t = _tokenOfKeyPlusOne[key];
        return (t == 0 ? 0 : t - 1, t != 0);
    }

    // ------------------------------------------------------------------ internals
    function _requireLatest(uint32 epoch) private view {
        uint32 latest = oracle.latestEpoch();
        if (epoch != latest) revert StaleEpoch(epoch, latest);
    }

    function _mintVerified(bytes32 key, uint32 epoch, BtcProof calldata btc) private returns (uint256 tokenId) {
        if (keccak256(bytes(btc.btcAddress)) != key) revert KeyAddressMismatch();
        bytes20 h160 = BitcoinAddress.toHash160(btc.btcAddress);
        if (!BitcoinAddress.verifyOwnership(h160, ownershipMessage(key, msg.sender), btc.pubX, btc.pubY, btc.v, btc.r, btc.s)) {
            revert OwnershipProofFailed();
        }
        if (_tokenOfKeyPlusOne[key] != 0) revert AlreadyMinted();
        tokenId = totalSupply++;
        _tokenOfKeyPlusOne[key] = tokenId + 1;
        clearanceOf[tokenId] = Clearance(key, epoch);
        _mint(msg.sender, tokenId);
        emit ClearanceMinted(tokenId, msg.sender, key, epoch);
    }

    /// @dev Soulbound: tokens can be minted (from == 0) but never moved or burned.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert NonTransferable();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert NonTransferable();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert NonTransferable();
    }
}
