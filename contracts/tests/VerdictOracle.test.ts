import { expect } from "chai";
import { ethers } from "hardhat";
import {
  CHALLENGE_WINDOW,
  KEY_A,
  KEY_UNFLAGGED,
  MIN_BOND,
  MIN_CHALLENGE_BOND,
  SLASH_REWARD,
  buildEpochTree,
  deployOracle,
  oracleWithEpoch,
  time,
} from "./helpers/fixtures";
import { Verdict, verdictArgs, verdictLeaf } from "./helpers/verdict";

const V: Verdict = { band: 2, riskBps: 7300, haircutBps: 6000, cwtBps: 5500, lowerBps: 4100, intent: 1, flags: 0 };
const REASON = "ipfs://reason";

describe("VerdictOracle - publishing", () => {
  it("publishes epoch 1 and emits EpochPublished", async () => {
    const { oracle, publisher } = await deployOracle();
    await oracle.connect(publisher).depositBond({ value: MIN_BOND });
    const root = ethers.id("root-1");
    const manifest = ethers.id("m1");
    const ts = (await time.latest()) + 10;
    await time.setNextBlockTimestamp(ts);
    await expect(oracle.connect(publisher).publishEpoch(1, root, ethers.ZeroHash, manifest))
      .to.emit(oracle, "EpochPublished")
      .withArgs(1, root, ethers.ZeroHash, manifest, ts);
    expect(await oracle.currentRoot()).to.equal(root);
    expect(await oracle.latestEpoch()).to.equal(1);
  });

  it("reverts when the publisher bond is below minBond", async () => {
    const { oracle, publisher } = await deployOracle();
    await oracle.connect(publisher).depositBond({ value: MIN_BOND - 1n });
    await expect(oracle.connect(publisher).publishEpoch(1, ethers.id("r"), ethers.ZeroHash, ethers.ZeroHash))
      .to.be.revertedWithCustomError(oracle, "BondTooLow")
      .withArgs(MIN_BOND - 1n, MIN_BOND);
  });

  it("only the publisher can publish", async () => {
    const { oracle, other } = await deployOracle();
    await expect(
      oracle.connect(other).publishEpoch(1, ethers.id("r"), ethers.ZeroHash, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(oracle, "NotPublisher");
  });

  it("epoch continuity: wrong prevRoot reverts (genesis and later)", async () => {
    const { oracle, publisher } = await deployOracle();
    await oracle.connect(publisher).depositBond({ value: MIN_BOND });
    const r1 = ethers.id("r1");
    await expect(oracle.connect(publisher).publishEpoch(1, r1, ethers.id("not-zero"), ethers.ZeroHash))
      .to.be.revertedWithCustomError(oracle, "PrevRootMismatch")
      .withArgs(ethers.id("not-zero"), ethers.ZeroHash);
    await oracle.connect(publisher).publishEpoch(1, r1, ethers.ZeroHash, ethers.ZeroHash);
    await expect(oracle.connect(publisher).publishEpoch(2, ethers.id("r2"), ethers.id("wrong"), ethers.ZeroHash))
      .to.be.revertedWithCustomError(oracle, "PrevRootMismatch")
      .withArgs(ethers.id("wrong"), r1);
    await oracle.connect(publisher).publishEpoch(2, ethers.id("r2"), r1, ethers.ZeroHash);
    expect(await oracle.latestEpoch()).to.equal(2);
  });

  it("duplicate or regressing epoch number reverts", async () => {
    const { oracle, publisher } = await deployOracle();
    await oracle.connect(publisher).depositBond({ value: MIN_BOND });
    const r1 = ethers.id("r1");
    await oracle.connect(publisher).publishEpoch(5, r1, ethers.ZeroHash, ethers.ZeroHash);
    await expect(oracle.connect(publisher).publishEpoch(5, ethers.id("r2"), r1, ethers.ZeroHash))
      .to.be.revertedWithCustomError(oracle, "EpochNotIncreasing")
      .withArgs(5, 5);
    await expect(oracle.connect(publisher).publishEpoch(4, ethers.id("r2"), r1, ethers.ZeroHash))
      .to.be.revertedWithCustomError(oracle, "EpochNotIncreasing")
      .withArgs(4, 5);
  });

  it("rejects a zero root", async () => {
    const { oracle, publisher } = await deployOracle();
    await oracle.connect(publisher).depositBond({ value: MIN_BOND });
    await expect(
      oracle.connect(publisher).publishEpoch(1, ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(oracle, "ZeroRoot");
  });
});

describe("VerdictOracle - verification", () => {
  it("verifyVerdict / verifyUnflagged / screen accept valid proofs", async () => {
    const { oracle, tree, epoch } = await oracleWithEpoch([[KEY_A, V]]);
    const p = tree.prove(KEY_A);
    expect(await oracle.verifyVerdict(KEY_A, epoch, ...verdictArgs(V), p.bitmap, p.siblings)).to.equal(true);
    const [band, flags, wasOverturned] = await oracle.screen(KEY_A, epoch, ...verdictArgs(V), p.bitmap, p.siblings);
    expect([band, flags, wasOverturned]).to.deep.equal([2n, 0n, false]);

    const u = tree.prove(KEY_UNFLAGGED);
    expect(await oracle.verifyUnflagged(KEY_UNFLAGGED, epoch, u.bitmap, u.siblings)).to.equal(true);
  });

  it("a tampered verdict field returns false (does not revert) for every field", async () => {
    const { oracle, tree, epoch } = await oracleWithEpoch([[KEY_A, V]]);
    const p = tree.prove(KEY_A);
    for (const field of Object.keys(V) as Array<keyof Verdict>) {
      const t = { ...V, [field]: V[field] + 1 };
      expect(await oracle.verifyVerdict(KEY_A, epoch, ...verdictArgs(t), p.bitmap, p.siblings), field).to.equal(false);
    }
  });

  it("tampered key, epoch, bitmap or sibling byte returns false", async () => {
    const { oracle, tree, epoch } = await oracleWithEpoch([[KEY_A, V]]);
    const p = tree.prove(KEY_A);
    const otherKey = ethers.toBeHex(BigInt(KEY_A) ^ 1n, 32);
    expect(await oracle.verifyVerdict(otherKey, epoch, ...verdictArgs(V), p.bitmap, p.siblings)).to.equal(false);
    expect(await oracle.verifyVerdict(KEY_A, epoch + 1, ...verdictArgs(V), p.bitmap, p.siblings)).to.equal(false);
    expect(await oracle.verifyVerdict(KEY_A, epoch, ...verdictArgs(V), p.bitmap ^ 1n, p.siblings)).to.equal(false);
    // the KEY_A leaf's sibling list is empty (single-leaf tree); an unrelated extra sibling must fail too
    expect(await oracle.verifyVerdict(KEY_A, epoch, ...verdictArgs(V), p.bitmap, [ethers.id("x"), ...p.siblings])).to.equal(false);
  });

  it("a flagged key's verdict cannot be passed off as unflagged, and vice versa", async () => {
    const { oracle, tree, epoch } = await oracleWithEpoch([[KEY_A, V]]);
    const p = tree.prove(KEY_A);
    expect(await oracle.verifyUnflagged(KEY_A, epoch, p.bitmap, p.siblings)).to.equal(false);
    const u = tree.prove(KEY_UNFLAGGED);
    expect(await oracle.verifyVerdict(KEY_UNFLAGGED, epoch, ...verdictArgs(V), u.bitmap, u.siblings)).to.equal(false);
  });

  it("unpublished epoch verifies false; screen reverts InvalidProof on a bad proof", async () => {
    const { oracle, tree, epoch } = await oracleWithEpoch([[KEY_A, V]]);
    const p = tree.prove(KEY_A);
    expect(await oracle.verifyVerdict(KEY_A, 99, ...verdictArgs(V), p.bitmap, p.siblings)).to.equal(false);
    expect(await oracle.verifyUnflagged(KEY_A, 99, 0, [])).to.equal(false);
    await expect(
      oracle.screen(KEY_A, epoch, ...verdictArgs({ ...V, riskBps: 1 }), p.bitmap, p.siblings)
    ).to.be.revertedWithCustomError(oracle, "InvalidProof");
  });

  it("leaf hash computed on-chain equals the TS encoding", async () => {
    const h = await (await ethers.getContractFactory("SMTVerifierHarness")).deploy();
    expect(await h.verdictLeaf(KEY_A, 1, ...verdictArgs(V))).to.equal(verdictLeaf(KEY_A, 1, V));
  });
});

describe("VerdictOracle - appeals", () => {
  const bond = ethers.parseEther("2.5");

  async function withChallenge() {
    const ctx = await oracleWithEpoch([[KEY_A, V]], ethers.parseEther("20"));
    const leaf = verdictLeaf(KEY_A, 1, V);
    await ctx.oracle.connect(ctx.challenger).challenge(1, KEY_A, leaf, REASON, { value: bond });
    return { ...ctx, leaf };
  }

  it("challenge emits ChallengeSubmitted and stores the bond", async () => {
    const { oracle, challenger } = await oracleWithEpoch([[KEY_A, V]]);
    const leaf = verdictLeaf(KEY_A, 1, V);
    await expect(oracle.connect(challenger).challenge(1, KEY_A, leaf, REASON, { value: bond }))
      .to.emit(oracle, "ChallengeSubmitted")
      .withArgs(1, 1, KEY_A, challenger.address, leaf, bond, REASON);
    expect(await ethers.provider.getBalance(await oracle.getAddress())).to.equal(MIN_BOND + bond);
  });

  it("challenge below minChallengeBond reverts", async () => {
    const { oracle, challenger } = await oracleWithEpoch([[KEY_A, V]]);
    await expect(
      oracle.connect(challenger).challenge(1, KEY_A, ethers.ZeroHash, REASON, { value: MIN_CHALLENGE_BOND - 1n })
    ).to.be.revertedWithCustomError(oracle, "ChallengeBondTooLow");
  });

  it("challenge outside the challenge window reverts; at the boundary it succeeds", async () => {
    const { oracle, challenger } = await oracleWithEpoch([[KEY_A, V]]);
    const publishedAt = (await oracle.epochData(1)).publishedAt;
    await time.setNextBlockTimestamp(Number(publishedAt) + CHALLENGE_WINDOW);
    await expect(oracle.connect(challenger).challenge(1, KEY_A, ethers.ZeroHash, REASON, { value: bond })).to.emit(
      oracle,
      "ChallengeSubmitted"
    );
    await time.setNextBlockTimestamp(Number(publishedAt) + CHALLENGE_WINDOW + 1);
    await expect(
      oracle.connect(challenger).challenge(1, KEY_A, ethers.ZeroHash, REASON, { value: bond })
    ).to.be.revertedWithCustomError(oracle, "ChallengeWindowClosed");
  });

  it("challenge on an unpublished epoch reverts", async () => {
    const { oracle, challenger } = await oracleWithEpoch([[KEY_A, V]]);
    await expect(
      oracle.connect(challenger).challenge(2, KEY_A, ethers.ZeroHash, REASON, { value: bond })
    ).to.be.revertedWithCustomError(oracle, "UnknownEpoch");
  });

  it("UPHELD: exact wei - bond refunded, reward slashed from publisher bond, verdict overturned", async () => {
    const { oracle, arbiter, challenger, tree } = await withChallenge();
    const oracleAddr = await oracle.getAddress();
    const publisherBefore = await oracle.publisherBond();
    expect(publisherBefore).to.equal(ethers.parseEther("20"));

    await expect(oracle.connect(arbiter).resolve(1, true))
      .to.emit(oracle, "ChallengeResolved").withArgs(1, 1, KEY_A, true)
      .and.to.emit(oracle, "VerdictOverturned").withArgs(1, KEY_A)
      .and.to.emit(oracle, "ChallengerBondRefunded").withArgs(1, challenger.address, bond)
      .and.to.emit(oracle, "PublisherSlashed").withArgs(1, challenger.address, SLASH_REWARD);

    expect(await oracle.overturned(1, KEY_A)).to.equal(true);
    expect(await oracle.publisherBond()).to.equal(publisherBefore - SLASH_REWARD); // 17 ether exactly
    expect(await oracle.pendingPayout(challenger.address)).to.equal(bond + SLASH_REWARD); // 5.5 ether exactly

    await expect(oracle.connect(challenger).withdrawPayout()).to.changeEtherBalances(
      [challenger, oracleAddr],
      [bond + SLASH_REWARD, -(bond + SLASH_REWARD)]
    );
    // contract now holds exactly the remaining publisher bond
    expect(await ethers.provider.getBalance(oracleAddr)).to.equal(ethers.parseEther("17"));
    expect(await oracle.pendingPayout(challenger.address)).to.equal(0);

    // screen reflects the overturn
    const p = tree.prove(KEY_A);
    const [, , wasOverturned] = await oracle.screen(KEY_A, 1, ...verdictArgs(V), p.bitmap, p.siblings);
    expect(wasOverturned).to.equal(true);
  });

  it("UPHELD: reward is capped at the remaining publisher bond (exact)", async () => {
    const ctx = await oracleWithEpoch([[KEY_A, V]], MIN_BOND);
    await ctx.oracle.connect(ctx.owner).setParams(MIN_BOND, MIN_CHALLENGE_BOND, CHALLENGE_WINDOW, MIN_BOND + 5n);
    await ctx.oracle.connect(ctx.challenger).challenge(1, KEY_A, ethers.ZeroHash, REASON, { value: bond });
    await ctx.oracle.connect(ctx.arbiter).resolve(1, true);
    expect(await ctx.oracle.publisherBond()).to.equal(0);
    expect(await ctx.oracle.pendingPayout(ctx.challenger.address)).to.equal(bond + MIN_BOND);
    // slashed below minBond: publishing is blocked until re-bonded
    await expect(
      ctx.oracle.connect(ctx.publisher).publishEpoch(2, ethers.id("r2"), ctx.tree.root, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(ctx.oracle, "BondTooLow");
  });

  it("REJECTED: exact wei - challenger's bond goes to the publisher, verdict stands", async () => {
    const { oracle, arbiter, publisher, challenger } = await withChallenge();
    await expect(oracle.connect(arbiter).resolve(1, false))
      .to.emit(oracle, "ChallengeResolved").withArgs(1, 1, KEY_A, false)
      .and.to.emit(oracle, "ChallengerBondForfeited").withArgs(1, publisher.address, bond);

    expect(await oracle.overturned(1, KEY_A)).to.equal(false);
    expect(await oracle.publisherBond()).to.equal(ethers.parseEther("20")); // untouched
    expect(await oracle.pendingPayout(challenger.address)).to.equal(0);
    expect(await oracle.pendingPayout(publisher.address)).to.equal(bond);

    await expect(oracle.connect(publisher).withdrawPayout()).to.changeEtherBalances(
      [publisher, await oracle.getAddress()],
      [bond, -bond]
    );
    await expect(oracle.connect(challenger).withdrawPayout()).to.be.revertedWithCustomError(oracle, "NothingToWithdraw");
  });

  it("resolve is arbiter-only, once-only, and rejects unknown ids", async () => {
    const { oracle, arbiter, publisher, challenger } = await withChallenge();
    await expect(oracle.connect(publisher).resolve(1, true)).to.be.revertedWithCustomError(oracle, "NotArbiter");
    await expect(oracle.connect(challenger).resolve(1, true)).to.be.revertedWithCustomError(oracle, "NotArbiter");
    await expect(oracle.connect(arbiter).resolve(7, true)).to.be.revertedWithCustomError(oracle, "UnknownChallenge");
    await oracle.connect(arbiter).resolve(1, false);
    await expect(oracle.connect(arbiter).resolve(1, true)).to.be.revertedWithCustomError(oracle, "AlreadyResolved");
  });

  it("withdrawBond is blocked while a challenge is open or the window is running, then allowed exactly", async () => {
    const { oracle, arbiter, publisher } = await withChallenge();
    await expect(oracle.connect(publisher).withdrawBond(1)).to.be.revertedWithCustomError(oracle, "WithdrawBlocked");
    await oracle.connect(arbiter).resolve(1, false);
    await expect(oracle.connect(publisher).withdrawBond(1)).to.be.revertedWithCustomError(oracle, "WithdrawBlocked"); // window still open
    await time.increase(CHALLENGE_WINDOW + 1);
    const amt = ethers.parseEther("4");
    await expect(oracle.connect(publisher).withdrawBond(amt)).to.changeEtherBalances(
      [publisher, await oracle.getAddress()],
      [amt, -amt]
    );
    expect(await oracle.publisherBond()).to.equal(ethers.parseEther("16"));
    await expect(oracle.connect(publisher).withdrawBond(ethers.parseEther("17"))).to.be.revertedWithCustomError(
      oracle,
      "InsufficientBond"
    );
  });

  it("owner can replace the (single, trusted) arbiter; others cannot", async () => {
    const { oracle, owner, other, arbiter } = await withChallenge();
    await expect(oracle.connect(other).setArbiter(other.address)).to.be.reverted;
    await expect(oracle.connect(owner).setArbiter(other.address)).to.emit(oracle, "ArbiterUpdated").withArgs(other.address);
    await expect(oracle.connect(arbiter).resolve(1, true)).to.be.revertedWithCustomError(oracle, "NotArbiter");
    await oracle.connect(other).resolve(1, false);
  });
});
