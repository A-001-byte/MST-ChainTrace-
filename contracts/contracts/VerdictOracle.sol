// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SMTVerifier} from "./libraries/SMTVerifier.sol";
import {VerdictLeaf} from "./libraries/VerdictLeaf.sol";

/// @title VerdictOracle
/// @notice Anchors per-epoch SMT roots of address verdicts, lets anyone verify a verdict (or its absence)
///         against a root, and runs a bonded appeals flow. All value is the chain's native currency
///         (assumed to be tMSTC; see contracts/SPEC.md).
///
/// @dev ARBITER CENTRALIZATION (read this): in v1 the `arbiter` is ONE trusted committee address. It alone
///      decides every challenge via `resolve`. It can uphold a bogus challenge (slashing the publisher's bond
///      and overturning a verdict) or reject a valid one (handing the challenger's bond to the publisher).
///      Nothing on-chain checks or constrains its decision, and the `owner` can replace it at will.
///      This is a KNOWN centralization point, not a decentralized dispute mechanism; users must trust
///      the arbiter committee. The publisher is likewise a single address.
contract VerdictOracle is Ownable {
    // ---------------------------------------------------------------- types
    struct EpochData {
        bytes32 root;
        bytes32 prevRoot;
        bytes32 manifestHash;
        uint64 publishedAt;
    }

    struct Challenge {
        address challenger;
        uint32 epoch;
        bool resolved;
        bytes32 key;
        bytes32 leafHash;
        uint256 bond;
        string reasonURI;
    }

    // ---------------------------------------------------------------- state
    address public publisher;
    /// @notice Single trusted committee address that resolves challenges. KNOWN CENTRALIZATION POINT (see contract NatSpec).
    address public arbiter;

    uint256 public publisherBond;
    uint256 public minBond;
    uint256 public minChallengeBond;
    /// @notice Seconds after an epoch's publish time during which it can be challenged (~10 min on testnet).
    uint256 public challengeWindow;
    /// @notice Fixed reward slashed from the publisher bond for an upheld challenge (capped at the remaining bond).
    uint256 public slashReward;

    uint32 public latestEpoch;
    /// @notice Root of the latest published epoch; bytes32(0) before the first publish.
    bytes32 public currentRoot;
    mapping(uint32 => EpochData) private _epochs;

    uint256 public challengeCount;
    uint256 public openChallenges;
    mapping(uint256 => Challenge) private _challenges;
    /// @notice epoch => key => verdict overturned by an upheld challenge.
    mapping(uint32 => mapping(bytes32 => bool)) public overturned;

    /// @notice Pull-payment ledger (refunds, rewards, forfeited bonds).
    mapping(address => uint256) public pendingPayout;

    // --------------------------------------------------------------- events
    event BondDeposited(address indexed from, uint256 amount, uint256 newBond);
    event BondWithdrawn(address indexed to, uint256 amount, uint256 newBond);
    event EpochPublished(
        uint32 indexed epoch, bytes32 root, bytes32 prevRoot, bytes32 manifestHash, uint256 publishedAt
    );
    event ChallengeSubmitted(
        uint256 indexed challengeId,
        uint32 indexed epoch,
        bytes32 indexed key,
        address challenger,
        bytes32 leafHash,
        uint256 bond,
        string reasonURI
    );
    event ChallengeResolved(uint256 indexed challengeId, uint32 indexed epoch, bytes32 indexed key, bool upheld);
    event VerdictOverturned(uint32 indexed epoch, bytes32 indexed key);
    /// @dev Challenger's bond credited back (upheld).
    event ChallengerBondRefunded(uint256 indexed challengeId, address indexed challenger, uint256 amount);
    /// @dev Reward slashed from the publisher bond and credited to the challenger (upheld).
    event PublisherSlashed(uint256 indexed challengeId, address indexed challenger, uint256 amount);
    /// @dev Challenger's bond credited to the publisher (rejected).
    event ChallengerBondForfeited(uint256 indexed challengeId, address indexed publisher, uint256 amount);
    event PayoutWithdrawn(address indexed to, uint256 amount);
    event PublisherUpdated(address indexed publisher);
    event ArbiterUpdated(address indexed arbiter);
    event ParamsUpdated(uint256 minBond, uint256 minChallengeBond, uint256 challengeWindow, uint256 slashReward);

    // --------------------------------------------------------------- errors
    error NotPublisher();
    error NotArbiter();
    error BondTooLow(uint256 have, uint256 need);
    error EpochNotIncreasing(uint32 epoch, uint32 latest);
    error PrevRootMismatch(bytes32 given, bytes32 expected);
    error UnknownEpoch(uint32 epoch);
    error ChallengeBondTooLow();
    error ChallengeWindowClosed();
    error UnknownChallenge(uint256 id);
    error AlreadyResolved(uint256 id);
    error InvalidProof();
    error WithdrawBlocked();
    error InsufficientBond();
    error NothingToWithdraw();
    error TransferFailed();
    error ZeroAddress();
    error ZeroRoot();

    modifier onlyPublisher() {
        if (msg.sender != publisher) revert NotPublisher();
        _;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter();
        _;
    }

    constructor(
        address owner_,
        address publisher_,
        address arbiter_,
        uint256 minBond_,
        uint256 minChallengeBond_,
        uint256 challengeWindow_,
        uint256 slashReward_
    ) Ownable(owner_) {
        if (publisher_ == address(0) || arbiter_ == address(0)) revert ZeroAddress();
        publisher = publisher_;
        arbiter = arbiter_;
        minBond = minBond_;
        minChallengeBond = minChallengeBond_;
        challengeWindow = challengeWindow_;
        slashReward = slashReward_;
    }

    // ------------------------------------------------------------ admin
    function setPublisher(address p) external onlyOwner {
        if (p == address(0)) revert ZeroAddress();
        publisher = p;
        emit PublisherUpdated(p);
    }

    /// @notice Replace the single arbiter. See the centralization note on the contract.
    function setArbiter(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        arbiter = a;
        emit ArbiterUpdated(a);
    }

    function setParams(uint256 minBond_, uint256 minChallengeBond_, uint256 challengeWindow_, uint256 slashReward_)
        external
        onlyOwner
    {
        minBond = minBond_;
        minChallengeBond = minChallengeBond_;
        challengeWindow = challengeWindow_;
        slashReward = slashReward_;
        emit ParamsUpdated(minBond_, minChallengeBond_, challengeWindow_, slashReward_);
    }

    // -------------------------------------------------------- publisher bond
    /// @notice Anyone may top up the publisher bond (the publisher must reach `minBond` before publishing).
    function depositBond() external payable {
        publisherBond += msg.value;
        emit BondDeposited(msg.sender, msg.value, publisherBond);
    }

    /// @notice Publisher withdraws bond only when no challenge is open and the latest epoch's window has closed.
    function withdrawBond(uint256 amount) external onlyPublisher {
        if (openChallenges != 0 || block.timestamp <= _epochs[latestEpoch].publishedAt + challengeWindow) {
            revert WithdrawBlocked();
        }
        if (amount > publisherBond) revert InsufficientBond();
        publisherBond -= amount;
        _send(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount, publisherBond);
    }

    // ---------------------------------------------------------- publishing
    function publishEpoch(uint32 epoch, bytes32 root, bytes32 prevRoot, bytes32 manifestHash) external onlyPublisher {
        if (publisherBond < minBond) revert BondTooLow(publisherBond, minBond);
        if (root == bytes32(0)) revert ZeroRoot();
        if (epoch <= latestEpoch) revert EpochNotIncreasing(epoch, latestEpoch);
        if (prevRoot != currentRoot) revert PrevRootMismatch(prevRoot, currentRoot);

        _epochs[epoch] = EpochData(root, prevRoot, manifestHash, uint64(block.timestamp));
        latestEpoch = epoch;
        currentRoot = root;
        emit EpochPublished(epoch, root, prevRoot, manifestHash, block.timestamp);
    }

    function epochData(uint32 epoch) external view returns (EpochData memory) {
        return _epochs[epoch];
    }

    // -------------------------------------------------------- verification
    /// @notice Recompute the leaf from the verdict fields and check it against `epoch`'s root.
    ///         Returns false (never reverts) for an unpublished epoch, a tampered field or a bad proof.
    function verifyVerdict(
        bytes32 key,
        uint32 epoch,
        uint8 band,
        uint16 riskBps,
        uint16 haircutBps,
        uint16 cwtBps,
        uint16 lowerBps,
        uint8 intent,
        uint16 flags,
        uint256 bitmap,
        bytes32[] calldata siblings
    ) public view returns (bool) {
        bytes32 root = _epochs[epoch].root;
        if (root == bytes32(0)) return false;
        bytes32 leaf = VerdictLeaf.hash(key, epoch, band, riskBps, haircutBps, cwtBps, lowerBps, intent, flags);
        return SMTVerifier.verify(root, key, leaf, bitmap, siblings);
    }

    /// @notice Exclusion proof: `key` has no verdict (empty leaf) in `epoch`.
    function verifyUnflagged(bytes32 key, uint32 epoch, uint256 bitmap, bytes32[] calldata siblings)
        public
        view
        returns (bool)
    {
        bytes32 root = _epochs[epoch].root;
        if (root == bytes32(0)) return false;
        return SMTVerifier.verify(root, key, bytes32(0), bitmap, siblings);
    }

    /// @notice Verify the verdict proof, then return the resolved state. Reverts InvalidProof if the proof
    ///         does not check out. `wasOverturned` is true if an upheld challenge overturned this verdict;
    ///         consumers should then disregard `band`/`flags`.
    function screen(
        bytes32 key,
        uint32 epoch,
        uint8 band,
        uint16 riskBps,
        uint16 haircutBps,
        uint16 cwtBps,
        uint16 lowerBps,
        uint8 intent,
        uint16 flags,
        uint256 bitmap,
        bytes32[] calldata siblings
    ) external view returns (uint8, uint16, bool wasOverturned) {
        if (!verifyVerdict(key, epoch, band, riskBps, haircutBps, cwtBps, lowerBps, intent, flags, bitmap, siblings)) {
            revert InvalidProof();
        }
        return (band, flags, overturned[epoch][key]);
    }

    // -------------------------------------------------------------- appeals
    /// @notice Contest the verdict of `key` in `epoch`. The leaf is not proven on-chain here; the arbiter judges
    ///         it off-chain using `leafHash` and `reasonURI`.
    function challenge(uint32 epoch, bytes32 key, bytes32 leafHash, string calldata reasonURI)
        external
        payable
        returns (uint256 challengeId)
    {
        if (msg.value < minChallengeBond) revert ChallengeBondTooLow();
        EpochData storage e = _epochs[epoch];
        if (e.root == bytes32(0)) revert UnknownEpoch(epoch);
        if (block.timestamp > uint256(e.publishedAt) + challengeWindow) {
            revert ChallengeWindowClosed();
        }

        challengeId = ++challengeCount;
        ++openChallenges;
        _challenges[challengeId] = Challenge(msg.sender, epoch, false, key, leafHash, msg.value, reasonURI);
        emit ChallengeSubmitted(challengeId, epoch, key, msg.sender, leafHash, msg.value, reasonURI);
    }

    function getChallenge(uint256 id) external view returns (Challenge memory) {
        return _challenges[id];
    }

    /// @notice Arbiter decision. Upheld: overturn verdict, refund challenger's bond, reward
    ///         min(slashReward, publisherBond) slashed from the publisher. Rejected: challenger's bond goes
    ///         to the publisher. Payouts are credited to `pendingPayout` and claimed with `withdrawPayout`.
    function resolve(uint256 challengeId, bool upheld) external onlyArbiter {
        Challenge storage c = _challenges[challengeId];
        if (c.challenger == address(0)) revert UnknownChallenge(challengeId);
        if (c.resolved) revert AlreadyResolved(challengeId);
        c.resolved = true;
        --openChallenges;

        emit ChallengeResolved(challengeId, c.epoch, c.key, upheld);

        if (upheld) {
            overturned[c.epoch][c.key] = true;
            emit VerdictOverturned(c.epoch, c.key);

            pendingPayout[c.challenger] += c.bond;
            emit ChallengerBondRefunded(challengeId, c.challenger, c.bond);

            uint256 reward = slashReward < publisherBond ? slashReward : publisherBond;
            if (reward != 0) {
                publisherBond -= reward;
                pendingPayout[c.challenger] += reward;
            }
            emit PublisherSlashed(challengeId, c.challenger, reward);
        } else {
            pendingPayout[publisher] += c.bond;
            emit ChallengerBondForfeited(challengeId, publisher, c.bond);
        }
    }

    function withdrawPayout() external {
        uint256 amount = pendingPayout[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingPayout[msg.sender] = 0;
        _send(msg.sender, amount);
        emit PayoutWithdrawn(msg.sender, amount);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
