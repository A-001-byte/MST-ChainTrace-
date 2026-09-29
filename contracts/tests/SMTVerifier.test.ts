import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { DEFAULTS, EMPTY_ROOT, SparseMerkleTree, keyFrom } from "./helpers/smt";
import { verdictLeaf } from "./helpers/verdict";

const VECTORS_PATH = path.join(__dirname, "vectors", "smt_vectors.json");

async function deploy() {
  return (await ethers.getContractFactory("SMTVerifierHarness")).deploy();
}

/**
 * GOLDEN VECTORS (Member 1's tests/vectors/smt_vectors.json). Schema is documented in contracts/SPEC.md.
 * If the file is absent this suite FAILS with an explicit message - it is not skipped or mocked.
 */
describe("SMTVerifier - golden vectors (smt_vectors.json)", () => {
  it("vectors file exists", () => {
    if (!fs.existsSync(VECTORS_PATH)) {
      throw new Error(
        `NOT RUNNABLE: ${VECTORS_PATH} does not exist yet (Member 1 has not delivered it). ` +
          `No golden vector has been verified.`
      );
    }
  });

  if (fs.existsSync(VECTORS_PATH)) {
    const raw = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8"));
    const vectors: any[] = Array.isArray(raw) ? raw : raw.vectors;
    it("contains at least one vector", () => expect(vectors.length).to.be.greaterThan(0));
    vectors.forEach((v, i) => {
      it(`vector ${i} ${v.name ?? ""} (${v.type ?? "?"})`, async () => {
        const h = await deploy();
        const expected = v.expected === undefined ? true : Boolean(v.expected);
        const bitmap = BigInt(v.bitmap);
        expect(await h.verify(v.root, v.key, v.leafHash, bitmap, v.siblings)).to.equal(expected);
        if (expected) expect(await h.computeRoot(v.key, v.leafHash, bitmap, v.siblings)).to.equal(v.root);
        if (v.type === "exclusion") expect(v.leafHash).to.equal(ethers.ZeroHash);
        if (v.verdict) {
          // cross-team check: the leaf preimage encoding must match Member 1's
          expect(verdictLeaf(v.key, v.epoch, v.verdict)).to.equal(v.leafHash);
        }
      });
    });
  }
});

/**
 * Tests below use a LOCALLY BUILT reference tree (tests/helpers/smt.ts). They exercise the library's
 * behavior and tamper handling; they are NOT golden vectors and do not stand in for them.
 */
describe("SMTVerifier - local reference tree", () => {
  const key = keyFrom(0xabcdef);
  const otherKey = keyFrom(0x123456789n);
  const missing = keyFrom(0xdeadbeef);
  let tree: SparseMerkleTree;
  const leaf = ethers.id("leaf-A");

  before(() => {
    tree = new SparseMerkleTree();
    tree.set(key, leaf);
    tree.set(otherKey, ethers.id("leaf-B"));
  });

  it("precomputed constants equal an independent recomputation", async () => {
    expect(EMPTY_ROOT).to.equal("0xa7ff9e28ffd3def443d324547688c2c4eb98edf7da757d6bfa22bff55b9ce24a");
    expect(DEFAULTS.length).to.equal(257);
    const src = fs.readFileSync(path.join(__dirname, "..", "contracts", "libraries", "SMTDefaults.sol"), "utf8");
    const hex = src.match(/hex"([0-9a-f]+)"/)![1];
    expect("0x" + hex).to.equal("0x" + DEFAULTS.map((d) => d.slice(2)).join(""));
  });

  it("empty tree: exclusion proof with an empty bitmap verifies against the empty root", async () => {
    const h = await deploy();
    expect(await h.verify(EMPTY_ROOT, missing, ethers.ZeroHash, 0n, [])).to.equal(true);
  });

  it("member inclusion proof verifies and computeRoot matches", async () => {
    const h = await deploy();
    const p = tree.prove(key);
    expect(await h.verify(tree.root, key, leaf, p.bitmap, p.siblings)).to.equal(true);
    expect(await h.computeRoot(key, leaf, p.bitmap, p.siblings)).to.equal(tree.root);
  });

  it("non-member exclusion proof verifies", async () => {
    const h = await deploy();
    const p = tree.prove(missing);
    expect(await h.verify(tree.root, missing, ethers.ZeroHash, p.bitmap, p.siblings)).to.equal(true);
  });

  it("tampering any single byte of leaf, key, root, bitmap or a sibling returns false (no revert)", async () => {
    const h = await deploy();
    const p = tree.prove(key);
    const flip = (hex: string, byte: number) => {
      const b = ethers.getBytes(hex);
      b[byte] ^= 0x01;
      return ethers.hexlify(b);
    };
    for (const byte of [0, 15, 31]) {
      expect(await h.verify(tree.root, key, flip(leaf, byte), p.bitmap, p.siblings), `leaf byte ${byte}`).to.equal(false);
      expect(await h.verify(tree.root, flip(key, byte), leaf, p.bitmap, p.siblings), `key byte ${byte}`).to.equal(false);
      expect(await h.verify(flip(tree.root, byte), key, leaf, p.bitmap, p.siblings), `root byte ${byte}`).to.equal(false);
      for (let i = 0; i < p.siblings.length; i++) {
        const s = [...p.siblings];
        s[i] = flip(s[i], byte);
        expect(await h.verify(tree.root, key, leaf, p.bitmap, s), `sibling ${i} byte ${byte}`).to.equal(false);
      }
    }
    // flipping a bitmap bit either mis-sizes the proof or changes a sibling: false either way
    for (const bit of [0n, 7n, 200n, 255n]) {
      expect(await h.verify(tree.root, key, leaf, p.bitmap ^ (1n << bit), p.siblings), `bitmap bit ${bit}`).to.equal(false);
    }
  });

  it("wrong sibling count returns false from verify and reverts MalformedProof from computeRoot", async () => {
    const h = await deploy();
    const p = tree.prove(key);
    expect(await h.verify(tree.root, key, leaf, p.bitmap, p.siblings.slice(1))).to.equal(false);
    expect(await h.verify(tree.root, key, leaf, p.bitmap, [...p.siblings, ethers.ZeroHash])).to.equal(false);
    await expect(h.computeRoot(key, leaf, p.bitmap, p.siblings.slice(1))).to.be.revertedWithCustomError(h, "MalformedProof");
  });

  it("a member proof cannot be replayed as an exclusion proof (and vice versa)", async () => {
    const h = await deploy();
    const p = tree.prove(key);
    expect(await h.verify(tree.root, key, ethers.ZeroHash, p.bitmap, p.siblings)).to.equal(false);
    const q = tree.prove(missing);
    expect(await h.verify(tree.root, missing, leaf, q.bitmap, q.siblings)).to.equal(false);
  });

  it("gas (local reference tree, NOT the golden vectors): member vs non-member", async () => {
    const h = await deploy();
    const pm = tree.prove(key);
    const pn = tree.prove(missing);
    const [okM, gasM] = await h.verifyGas(tree.root, key, leaf, pm.bitmap, pm.siblings);
    const [okN, gasN] = await h.verifyGas(tree.root, missing, ethers.ZeroHash, pn.bitmap, pn.siblings);
    const rM = await (await h.verifyTx(tree.root, key, leaf, pm.bitmap, pm.siblings)).wait();
    const rN = await (await h.verifyTx(tree.root, missing, ethers.ZeroHash, pn.bitmap, pn.siblings)).wait();
    expect(okM && okN).to.equal(true);
    console.log(
      `      [local-tree gas] member: verify-only=${gasM} total-tx=${rM!.gasUsed} (siblings=${pm.siblings.length}) | ` +
        `non-member: verify-only=${gasN} total-tx=${rN!.gasUsed} (siblings=${pn.siblings.length})`
    );
  });
});
