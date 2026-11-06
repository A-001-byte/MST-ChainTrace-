// Golden vectors (tests/vectors/smt_vectors.json) must pass byte-for-byte in BOTH the JS
// verifier and the deployed Solidity contract.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const path = require("path");
const V = require(path.join(__dirname, "..", "..", "tests", "vectors", "smt_vectors.json"));
const smt = require("../src/smt");

describe("golden vectors", function () {
  let registry;
  before(async () => {
    registry = await (await ethers.getContractFactory("ChainTraceRegistry")).deploy();
    await registry.waitForDeployment();
  });

  it("keccak KATs and default ladder", () => {
    for (const k of V.keccak_kats) expect(ethers.keccak256(k.inputHex)).to.equal(k.keccak256);
    expect(smt.DEFAULTS).to.deep.equal(V.defaults);
  });

  it("keys, leaves", async () => {
    for (const k of V.keyVectors) expect(smt.keyOf(k.address)).to.equal(k.key);
    for (const l of V.leafVectors) {
      expect(smt.leafHash(l)).to.equal(l.leaf);
      const enc = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint32", "uint8", "uint16", "uint16", "uint16", "uint16", "uint8", "uint8"],
        [l.key, l.epoch, l.band, l.riskBps, l.haircutBps, l.cwtBps, l.lowerBps, l.intent, l.flags]
      );
      expect(enc).to.equal(l.encoded);
      // the contract computes the same leaf
      const onchain = await registry.leafOf(l.key, [l.epoch, l.band, l.riskBps, l.haircutBps, l.cwtBps, l.lowerBps, l.intent, l.flags]);
      expect(onchain).to.equal(l.leaf);
    }
  });

  it("every proof case agrees with the vector (JS and Solidity)", async () => {
    expect(V.cases.length).to.be.gte(20);
    for (const c of V.cases) {
      const root = V.trees[c.tree].root;
      const js = smt.verifyProof(root, c.key, c.leaf, c.proof.bitmap, c.proof.siblings);
      expect(js, `js: ${c.name}`).to.equal(c.valid);

      let sol;
      try {
        sol = await registry.verifyRaw(root, c.key, c.leaf, c.proof.bitmap, c.proof.siblings);
      } catch (e) {
        sol = false; // a revert (malformed proof) counts as rejection
      }
      expect(sol, `solidity: ${c.name}`).to.equal(c.valid);
    }
  });

  it("registry: publish, verify score and absence from a real proof", async () => {
    const [owner, other] = await ethers.getSigners();
    const tree = V.trees.chaintrace_sample;
    const l = V.leafVectors[0];
    const proofCase = V.cases.find((c) => c.tree === "chaintrace_sample" && c.kind === "member" && c.key === l.key);
    const absent = V.cases.find((c) => c.tree === "chaintrace_sample" && c.kind === "non_member");

    let nonOwnerReverted = false;
    try { await registry.connect(other).publishRoot(1, tree.root); } catch { nonOwnerReverted = true; }
    expect(nonOwnerReverted, "only the owner may publish").to.equal(true);
    await registry.publishRoot(1, tree.root);
    expect(await registry.rootOf(1)).to.equal(tree.root);
    expect(await registry.latestEpoch()).to.equal(1n);
    let reverted = false;
    try { await registry.publishRoot(1, tree.root); } catch { reverted = true; }
    expect(reverted, "epoch must be strictly increasing").to.equal(true);

    const score = [l.epoch, l.band, l.riskBps, l.haircutBps, l.cwtBps, l.lowerBps, l.intent, l.flags];
    expect(await registry.verifyScore(l.address, score, proofCase.proof.bitmap, proofCase.proof.siblings)).to.equal(true);

    // tampered score must fail
    const bad = [...score]; bad[2] = bad[2] === 0 ? 1 : bad[2] - 1;
    expect(await registry.verifyScore(l.address, bad, proofCase.proof.bitmap, proofCase.proof.siblings)).to.equal(false);

    // unknown epoch fails
    const wrongEpoch = [...score]; wrongEpoch[0] = 9;
    expect(await registry.verifyScore(l.address, wrongEpoch, proofCase.proof.bitmap, proofCase.proof.siblings)).to.equal(false);

    // absence: the vector's non-member address is an unknown string; recover it from the vector name
    expect(await registry.verifyAbsent("1UnknownAddressNotInTheDatasetXXXXXX", 1, absent.proof.bitmap, absent.proof.siblings)).to.equal(true);
    expect(await registry.verifyAbsent(l.address, 1, absent.proof.bitmap, absent.proof.siblings)).to.equal(false);
  });
});
