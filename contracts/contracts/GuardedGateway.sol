// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VerdictLeaf} from "./libraries/VerdictLeaf.sol";

interface IVerdictOracle {
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

    function overturned(uint32 epoch, bytes32 key) external view returns (bool);
}

/// @title GuardedGateway
/// @notice Demo consumer: a BTC-sourced deposit on-ramp that screens each deposit against the VerdictOracle
///         under an owner-selected policy and escrows anything it will not accept outright.
/// @dev KEEP IN SYNC: `HAIRCUT_HOLD_BPS` and `CUSTODY_HOLD_BPS` (both 5000) must equal the thresholds used by
///      Member 1's off-chain gateway-preview endpoint. If either number changes here, change it there too.
contract GuardedGateway is Ownable, ReentrancyGuard {
    enum Policy {
        HAIRCUT,
        CUSTODY
    }
    enum Outcome {
        ACCEPT,
        HOLD,
        REVIEW
    }
    enum EscrowStatus {
        NONE,
        HELD,
        IN_REVIEW,
        RELEASED,
        REFUNDED
    }

    struct Escrow {
        address depositor;
        EscrowStatus status;
        uint32 epoch;
        bytes32 key;
        uint256 amount;
    }

    /// @notice HAIRCUT policy: hold when haircutBps >= this. MUST match Member 1's preview logic.
    uint16 public constant HAIRCUT_HOLD_BPS = 5000;
    /// @notice CUSTODY policy: hold when cwtBps >= this (and not exonerated). MUST match Member 1's preview logic.
    uint16 public constant CUSTODY_HOLD_BPS = 5000;

    IVerdictOracle public immutable oracle;
    Policy public policy;
    /// @notice Recipient of accepted and released funds (the on-ramp's account).
    address public treasury;

    uint256 public escrowCount;
    mapping(uint256 => Escrow) private _escrows;

    event DepositAccepted(address indexed depositor, bytes32 indexed key, uint32 epoch, uint256 amount);
    event DepositHeld(uint256 indexed escrowId, address indexed depositor, bytes32 indexed key, uint32 epoch, uint256 amount);
    event DepositInReview(
        uint256 indexed escrowId, address indexed depositor, bytes32 indexed key, uint32 epoch, uint256 amount
    );
    event EscrowReleased(uint256 indexed escrowId, address indexed to, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, address indexed to, uint256 amount);
    event PolicyChanged(Policy policy);
    event TreasuryChanged(address treasury);

    error StaleEpoch(uint32 epoch, uint32 latest);
    error InvalidProof();
    error NoValue();
    error NotEscrowed();
    error NotAuthorized();
    error TransferFailed();
    error ZeroAddress();

    constructor(address oracle_, address owner_, address treasury_, Policy policy_) Ownable(owner_) {
        if (oracle_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        oracle = IVerdictOracle(oracle_);
        treasury = treasury_;
        policy = policy_;
    }

    // ---------------------------------------------------------------- admin
    function setPolicy(Policy p) external onlyOwner {
        policy = p;
        emit PolicyChanged(p);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasuryChanged(t);
    }

    // ------------------------------------------------------------- decision
    /// @notice Pure policy decision; also the reference for Member 1's off-chain preview.
    /// @dev An overturned verdict is accepted under BOTH policies (the brief states it under CUSTODY; applying it
    ///      to HAIRCUT too is an assumption, see contracts/SPEC.md). Under CUSTODY, CONTESTED_EVIDENCE routes to
    ///      REVIEW before the CWT hold is considered.
    function evaluate(Policy p, uint16 haircutBps, uint16 cwtBps, uint8 flags, bool wasOverturned)
        public
        pure
        returns (Outcome)
    {
        if (wasOverturned) return Outcome.ACCEPT;
        if (p == Policy.HAIRCUT) {
            return haircutBps >= HAIRCUT_HOLD_BPS ? Outcome.HOLD : Outcome.ACCEPT;
        }
        if (flags & VerdictLeaf.CONTESTED_EVIDENCE != 0) return Outcome.REVIEW;
        if (cwtBps >= CUSTODY_HOLD_BPS && flags & VerdictLeaf.EXONERATED == 0) return Outcome.HOLD;
        return Outcome.ACCEPT;
    }

    // -------------------------------------------------------------- deposits
    /// @notice Deposit against a flagged/scored key. The verdict is proven against the latest epoch's root.
    function deposit(
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
    ) external payable nonReentrant returns (Outcome outcome) {
        if (msg.value == 0) revert NoValue();
        _requireLatest(epoch);
        (, , bool wasOverturned) = _screen(key, epoch, band, riskBps, haircutBps, cwtBps, lowerBps, intent, flags, bitmap, siblings);
        outcome = evaluate(policy, haircutBps, cwtBps, flags, wasOverturned);
        _settle(outcome, key, epoch);
    }

    /// @notice Deposit against a key with NO verdict (exclusion proof against the latest epoch): always accepted.
    function depositUnflagged(bytes32 key, uint32 epoch, uint256 bitmap, bytes32[] calldata siblings)
        external
        payable
        nonReentrant
    {
        if (msg.value == 0) revert NoValue();
        _requireLatest(epoch);
        if (!oracle.verifyUnflagged(key, epoch, bitmap, siblings)) revert InvalidProof();
        _settle(Outcome.ACCEPT, key, epoch);
    }

    function _requireLatest(uint32 epoch) private view {
        uint32 latest = oracle.latestEpoch();
        if (epoch != latest) revert StaleEpoch(epoch, latest);
    }

    function _screen(
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
    ) private view returns (uint8, uint8, bool) {
        // screen() reverts on an invalid proof; surface that as this contract's InvalidProof
        try oracle.screen(key, epoch, band, riskBps, haircutBps, cwtBps, lowerBps, intent, flags, bitmap, siblings)
        returns (uint8 b, uint8 f, bool o) {
            return (b, f, o);
        } catch {
            revert InvalidProof();
        }
    }

    function _settle(Outcome outcome, bytes32 key, uint32 epoch) private {
        if (outcome == Outcome.ACCEPT) {
            _send(treasury, msg.value);
            emit DepositAccepted(msg.sender, key, epoch, msg.value);
            return;
        }
        uint256 id = ++escrowCount;
        bool review = outcome == Outcome.REVIEW;
        _escrows[id] = Escrow(msg.sender, review ? EscrowStatus.IN_REVIEW : EscrowStatus.HELD, epoch, key, msg.value);
        if (review) emit DepositInReview(id, msg.sender, key, epoch, msg.value);
        else emit DepositHeld(id, msg.sender, key, epoch, msg.value);
    }

    // --------------------------------------------------------------- escrow
    function getEscrow(uint256 id) external view returns (Escrow memory) {
        return _escrows[id];
    }

    /// @notice Release escrowed funds to the treasury. Owner (the reviewer) at any time; anyone once the oracle
    ///         has overturned the verdict that caused the hold.
    function release(uint256 id) external nonReentrant {
        Escrow storage e = _escrows[id];
        if (e.status != EscrowStatus.HELD && e.status != EscrowStatus.IN_REVIEW) revert NotEscrowed();
        if (msg.sender != owner() && !oracle.overturned(e.epoch, e.key)) revert NotAuthorized();
        e.status = EscrowStatus.RELEASED;
        _send(treasury, e.amount);
        emit EscrowReleased(id, treasury, e.amount);
    }

    /// @notice Refund escrowed funds to the original depositor (owner only).
    function refund(uint256 id) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[id];
        if (e.status != EscrowStatus.HELD && e.status != EscrowStatus.IN_REVIEW) revert NotEscrowed();
        e.status = EscrowStatus.REFUNDED;
        _send(e.depositor, e.amount);
        emit EscrowRefunded(id, e.depositor, e.amount);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
