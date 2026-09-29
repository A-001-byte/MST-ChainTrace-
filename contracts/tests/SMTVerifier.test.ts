import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { DEFAULTS, EMPTY_ROOT, SparseMerkleTree, keyFrom } from "./helpers/smt";
import { verdictArgs } from "./helpers/verdict";

// Member 1's golden vectors (docs/SHARED_SPEC_v1.md). Looked up in contracts/tests/vectors/ first, then at the repo
// root tests/vectors/ where Member 1 publishes it. Nothing is copied, so it can never go stale.
const CANDIDATES = [
  path.join(__dirname, "vectors", "smt_vectors.json"),
  path.join(__dirname, "..", "..", "tests", "vectors", "smt_vectors.json"),
];
const VECTORS_PATH = CANDIDATES.find((p) => fs.existsSync(p));

async function deploy() {
  return (await ethers.getContractFactory("SMTVerifierHarness")).deploy();
}

/**
 * GOLDEN VECTORS. If the file is absent this suite FAILS with an explicit message - it is not skipped or mocked.
 */
describe("SMTVerifier - golden vectors (smt_vectors.json)", () => {
  it("vectors file exists", () => {
    if (!VECTORS_PATH) {
      throw new Error(`NOT RUNNABLE: smt_vectors.json not found in ${CANDIDATES.join(" or ")}. No golden vector verified.`);
    }
  });
  if (!VECTORS_PATH) return;

  const V = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8"));
  const gas: { member: number[]; non_member: number[] } = { member: [], non_member: [] };

  it("spec header: keccak256, depth 256", () => {
    expect(V.hash).to.equal("keccak256");
    expect(V.depth).to.equal(256);
    expect(V.cases.length).to.be.greaterThanOrEqual(20);
  });

  it("keccak KATs and key derivation (key = keccak256(utf8 address)) match", () => {
    for (const k of V.keccak_kats) expect(ethers.keccak256(k.inputHex)).to.equal(k.keccak256);
    for (const k of V.keyVectors) expect(ethers.keccak256(ethers.toUtf8Bytes(k.address))).to.equal(k.key);
  });

  it("all 257 default hashes equal the constants compiled into SMTDefaults.sol", () => {
    expect(V.defaults.length).to.equal(257);
    const src = fs.readFileSync(path.join(__dirname, "..", "contracts", "libraries", "SMTDefaults.sol"), "utf8");
    const hex = src.match(/hex"([0-9a-f]+)"/)![1];
    expect("0x" + hex).to.equal("0x" + V.defaults.map((d: string) => d.slice(2)).join(""));
    expect(V.trees.empty.root).to.equal(EMPTY_ROOT);
  });

  it("every leafVector: on-chain VerdictLeaf.hash equals the golden leaf (abi.encode layout)", async () => {
    const h = await deploy();
    expect(V.leafVectors.length).to.be.greaterThan(0);
    for (const lv of V.leafVectors) {
      const onchain = await h.verdictLeaf(lv.key, lv.epoch, ...verdictArgs(lv));
      expect(onchain, `leaf for ${lv.address}`).to.equal(lv.leaf);
    }
  });

  V.cases.forEach((c: any, i: number) => {
    it(`case ${i}: ${c.name} [${c.kind}] valid=${c.valid}`, async () => {
      const h = await deploy();
      const root = V.trees[c.tree].root;
      const bitmap = BigInt(c.proof.bitmap);
      expect(await h.verify(root, c.key, c.leaf, bitmap, c.proof.siblings)).to.equal(c.valid);
      if (c.valid) {
        expect(await h.computeRoot(c.key, c.leaf, bitmap, c.proof.siblings)).to.equal(root);
        const [ok, g] = await h.verifyGas(root, c.key, c.leaf, bitmap, c.proof.siblings);
        expect(ok).to.equal(true);
        gas[c.kind as "member" | "non_member"].push(Number(g));
      }
      if (c.kind === "non_member" && c.valid) expect(c.leaf).to.equal(ethers.ZeroHash);
    });
  });

  it("mutation vectors replay on the reference tree (set / delete) with the golden roots", () => {
    const m = V.mutation;
    for (const [name, mm] of Object.entries<any>(m).filter(([, x]) => x && x.steps)) {
      const t = new SparseMerkleTree();
      for (const l of V.trees[mm.tree].leaves) t.set(l.key, l.leaf);
      for (const st of mm.steps) {
        t.set(st.key, st.op === "delete" ? ethers.ZeroHash : st.leaf);
        expect(t.root, `${name} step`).to.equal(st.rootAfter);
      }
    }
  });

  after(() => {
    const stat = (a: number[]) => (a.length ? `n=${a.length} min=${Math.min(...a)} max=${Math.max(...a)} avg=${Math.round(a.reduce((x, y) => x + y, 0) / a.length)}` : "n=0");
    console.log(`\n      [GOLDEN-VECTOR gas, verification only (gasleft delta), source ${VECTORS_PATH}]`);
    console.log(`      member inclusion : ${stat(gas.member)}`);
    console.log(`      non-member (excl): ${stat(gas.non_member)}`);
  });
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
});
