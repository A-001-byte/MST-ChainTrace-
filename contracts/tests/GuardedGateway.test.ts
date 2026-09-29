import { expect } from "chai";
import { ethers } from "hardhat";
import { KEY_A, KEY_UNFLAGGED, buildEpochTree, oracleWithEpoch } from "./helpers/fixtures";
import { CONTESTED_EVIDENCE, EXONERATED, Verdict, verdictArgs, verdictLeaf } from "./helpers/verdict";

const HAIRCUT = 0;
const CUSTODY = 1;
const ACCEPT = 0;
const HOLD = 1;
const REVIEW = 2;
const AMOUNT = ethers.parseEther("1.234567890123456789");

const base: Verdict = { band: 2, riskBps: 7000, haircutBps: 0, cwtBps: 0, lowerBps: 3000, intent: 1, flags: 0 };
const v = (o: Partial<Verdict>): Verdict => ({ ...base, ...o });

async function setup(verdict: Verdict, policy: number) {
  const ctx = await oracleWithEpoch([[KEY_A, verdict]]);
  const Gw = await ethers.getContractFactory("GuardedGateway");
  const gw = await Gw.deploy(await ctx.oracle.getAddress(), ctx.owner.address, ctx.treasury.address, policy);
  const proof = ctx.tree.prove(KEY_A);
  const dep = (signer = ctx.user, value = AMOUNT, verdictArg = verdict) =>
    gw.connect(signer).deposit(KEY_A, ctx.epoch, ...verdictArgs(verdictArg), proof.bitmap, proof.siblings, { value });
  return { ...ctx, gw, proof, dep };
}

describe("GuardedGateway - thresholds are the documented 5000/5000", () => {
  it("exposes HAIRCUT_HOLD_BPS and CUSTODY_HOLD_BPS = 5000", async () => {
    const { gw } = await setup(base, HAIRCUT);
    expect(await gw.HAIRCUT_HOLD_BPS()).to.equal(5000);
    expect(await gw.CUSTODY_HOLD_BPS()).to.equal(5000);
  });

  it("evaluate() boundaries: 4999 accepts, 5000 holds (both policies)", async () => {
    const { gw } = await setup(base, HAIRCUT);
    expect(await gw.evaluate(HAIRCUT, 4999, 0, 0, false)).to.equal(ACCEPT);
    expect(await gw.evaluate(HAIRCUT, 5000, 0, 0, false)).to.equal(HOLD);
    expect(await gw.evaluate(CUSTODY, 0, 4999, 0, false)).to.equal(ACCEPT);
    expect(await gw.evaluate(CUSTODY, 0, 5000, 0, false)).to.equal(HOLD);
  });
});

describe("GuardedGateway - same verdict, different policy, different outcome", () => {
  it("high haircut / low CWT: HAIRCUT holds, CUSTODY accepts", async () => {
    const verdict = v({ haircutBps: 6000, cwtBps: 3000 });
    const h = await setup(verdict, HAIRCUT);
    await expect(h.dep()).to.emit(h.gw, "DepositHeld").withArgs(1, h.user.address, KEY_A, 1, AMOUNT);
    const c = await setup(verdict, CUSTODY);
    await expect(c.dep())
      .to.emit(c.gw, "DepositAccepted")
      .withArgs(c.user.address, KEY_A, 1, AMOUNT)
      .and.to.not.emit(c.gw, "DepositHeld");
  });

  it("low haircut / high CWT: HAIRCUT accepts, CUSTODY holds", async () => {
    const verdict = v({ haircutBps: 2000, cwtBps: 5500 });
    const h = await setup(verdict, HAIRCUT);
    await expect(h.dep()).to.emit(h.gw, "DepositAccepted");
    const c = await setup(verdict, CUSTODY);
    await expect(c.dep()).to.emit(c.gw, "DepositHeld").withArgs(1, c.user.address, KEY_A, 1, AMOUNT);
  });

  it("owner switching the policy flips the outcome for the identical verdict on the same deployment", async () => {
    const verdict = v({ haircutBps: 6000, cwtBps: 3000 });
    const s = await setup(verdict, HAIRCUT);
    await expect(s.dep()).to.emit(s.gw, "DepositHeld");
    await expect(s.gw.connect(s.owner).setPolicy(CUSTODY)).to.emit(s.gw, "PolicyChanged").withArgs(CUSTODY);
    await expect(s.dep()).to.emit(s.gw, "DepositAccepted");
    await expect(s.gw.connect(s.other).setPolicy(HAIRCUT)).to.be.reverted;
  });
});

describe("GuardedGateway - CUSTODY rules", () => {
  it("EXONERATED lifts the CWT hold", async () => {
    const s = await setup(v({ cwtBps: 9000, flags: EXONERATED }), CUSTODY);
    await expect(s.dep()).to.emit(s.gw, "DepositAccepted");
  });

  it("CONTESTED_EVIDENCE routes to REVIEW and emits DepositInReview", async () => {
    const s = await setup(v({ cwtBps: 9000, flags: CONTESTED_EVIDENCE }), CUSTODY);
    await expect(s.dep()).to.emit(s.gw, "DepositInReview").withArgs(1, s.user.address, KEY_A, 1, AMOUNT);
    expect((await s.gw.getEscrow(1)).status).to.equal(2); // IN_REVIEW
  });

  it("overturned wins regardless of the other conditions", async () => {
    const verdict = v({ cwtBps: 9000, haircutBps: 9000, flags: CONTESTED_EVIDENCE });
    for (const policy of [CUSTODY, HAIRCUT]) {
      const s = await setup(verdict, policy);
      await s.oracle.connect(s.challenger).challenge(1, KEY_A, verdictLeaf(KEY_A, 1, verdict), "r", { value: ethers.parseEther("1") });
      await s.oracle.connect(s.arbiter).resolve(1, true);
      await expect(s.dep()).to.emit(s.gw, "DepositAccepted");
    }
  });
});

describe("GuardedGateway - funds movement (exact)", () => {
  it("accepted deposit forwards exactly msg.value to the treasury", async () => {
    const s = await setup(v({}), CUSTODY);
    await expect(s.dep()).to.changeEtherBalances([s.user, s.treasury, s.gw], [-AMOUNT, AMOUNT, 0n]);
  });

  it("held deposit sits in escrow; release pays the treasury exactly", async () => {
    const s = await setup(v({ haircutBps: 6000 }), HAIRCUT);
    await expect(s.dep()).to.changeEtherBalances([s.user, s.gw], [-AMOUNT, AMOUNT]);
    const rel = s.gw.connect(s.owner).release(1);
    await expect(rel).to.emit(s.gw, "EscrowReleased").withArgs(1, s.treasury.address, AMOUNT);
    await expect(rel).to.changeEtherBalances([s.gw, s.treasury], [-AMOUNT, AMOUNT]);
    await expect(s.gw.connect(s.owner).release(1)).to.be.revertedWithCustomError(s.gw, "NotEscrowed");
    await expect(s.gw.connect(s.owner).refund(1)).to.be.revertedWithCustomError(s.gw, "NotEscrowed");
  });

  it("held deposit refund pays the depositor exactly", async () => {
    const s = await setup(v({ haircutBps: 6000 }), HAIRCUT);
    await s.dep();
    const ref = s.gw.connect(s.owner).refund(1);
    await expect(ref).to.emit(s.gw, "EscrowRefunded").withArgs(1, s.user.address, AMOUNT);
    await expect(ref).to.changeEtherBalances([s.gw, s.user], [-AMOUNT, AMOUNT]);
    await expect(s.gw.connect(s.owner).release(1)).to.be.revertedWithCustomError(s.gw, "NotEscrowed");
  });

  it("only the owner can refund; a stranger can release only after the oracle overturns the verdict", async () => {
    const verdict = v({ haircutBps: 6000 });
    const s = await setup(verdict, HAIRCUT);
    await s.dep();
    await expect(s.gw.connect(s.user).refund(1)).to.be.reverted;
    await expect(s.gw.connect(s.other).release(1)).to.be.revertedWithCustomError(s.gw, "NotAuthorized");
    await s.oracle.connect(s.challenger).challenge(1, KEY_A, verdictLeaf(KEY_A, 1, verdict), "r", { value: ethers.parseEther("1") });
    await s.oracle.connect(s.arbiter).resolve(1, true);
    await expect(s.gw.connect(s.other).release(1)).to.changeEtherBalances([s.gw, s.treasury], [-AMOUNT, AMOUNT]);
  });
});

describe("GuardedGateway - proof handling", () => {
  it("a tampered verdict field is rejected with InvalidProof", async () => {
    const s = await setup(v({ haircutBps: 6000 }), HAIRCUT);
    // the depositor lies about haircutBps to dodge the hold
    await expect(s.dep(s.user, AMOUNT, v({ haircutBps: 0 }))).to.be.revertedWithCustomError(s.gw, "InvalidProof");
  });

  it("stale epoch is rejected", async () => {
    const s = await setup(v({}), HAIRCUT);
    const t2 = buildEpochTree(2, [[KEY_A, v({})]]);
    await s.oracle.connect(s.publisher).publishEpoch(2, t2.root, s.tree.root, ethers.ZeroHash);
    await expect(s.dep()).to.be.revertedWithCustomError(s.gw, "StaleEpoch").withArgs(1, 2);
  });

  it("zero-value deposit reverts", async () => {
    const s = await setup(v({}), HAIRCUT);
    await expect(s.dep(s.user, 0n)).to.be.revertedWithCustomError(s.gw, "NoValue");
  });

  it("depositUnflagged accepts with a valid exclusion proof and rejects a flagged key", async () => {
    const s = await setup(v({ haircutBps: 9000 }), HAIRCUT);
    const u = s.tree.prove(KEY_UNFLAGGED);
    await expect(
      s.gw.connect(s.user).depositUnflagged(KEY_UNFLAGGED, 1, u.bitmap, u.siblings, { value: AMOUNT })
    ).to.emit(s.gw, "DepositAccepted");
    // KEY_A is flagged: its (non-exclusion) proof must not pass as unflagged
    await expect(
      s.gw.connect(s.user).depositUnflagged(KEY_A, 1, s.proof.bitmap, s.proof.siblings, { value: AMOUNT })
    ).to.be.revertedWithCustomError(s.gw, "InvalidProof");
  });
});
