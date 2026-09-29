import { expect } from "chai";
import { ethers } from "hardhat";
import { getBytes, hexlify, toUtf8Bytes } from "ethers";
import { deployOracle, MIN_BOND } from "./helpers/fixtures";
import { SparseMerkleTree } from "./helpers/smt";
import { DemoKey, p2pkhAddress, p2wpkhAddress } from "./helpers/btc";
import { EXONERATED, Verdict, verdictArgs, verdictLeaf } from "./helpers/verdict";

const keyOf = (addr: string) => ethers.keccak256(toUtf8Bytes(addr));
const exonerated: Verdict = { band: 0, riskBps: 900, haircutBps: 0, cwtBps: 8000, lowerBps: 100, intent: 0, flags: EXONERATED };
const flagged: Verdict = { ...exonerated, band: 3, flags: 0 };

// Every address below is generated from a throwaway "demo key"; none is a real dataset address.
const demoA = new DemoKey(); // P2WPKH, EXONERATED in the tree
const demoB = new DemoKey(); // P2PKH, unflagged (absent from the tree)
const demoC = new DemoKey(); // P2WPKH, flagged (not exonerated)

async function setup() {
  const ctx = await deployOracle();
  const keyA = keyOf(demoA.p2wpkh);
  const keyC = keyOf(demoC.p2wpkh);
  const tree = new SparseMerkleTree();
  tree.set(keyA, verdictLeaf(keyA, 1, exonerated));
  tree.set(keyC, verdictLeaf(keyC, 1, flagged));
  await ctx.oracle.connect(ctx.publisher).depositBond({ value: MIN_BOND });
  await ctx.oracle.connect(ctx.publisher).publishEpoch(1, tree.root, ethers.ZeroHash, ethers.ZeroHash);
  const sbt = await (await ethers.getContractFactory("ClearanceSBT")).deploy(await ctx.oracle.getAddress());
  return { ...ctx, tree, sbt, keyA, keyC };
}

/** Build the BtcProof struct: demo `key` signs the message binding (key, wallet). */
async function btcProof(sbt: any, demo: DemoKey, addr: string, key: string, wallet: string) {
  const msg = getBytes(await sbt.ownershipMessage(key, wallet));
  const { x, y } = demo.xy;
  const sig = demo.signMessage(msg);
  return { btcAddress: addr, pubX: x, pubY: y, ...sig };
}

describe("BitcoinAddress - encoders/decoders (demo keys and published test vectors)", () => {
  it("test-side encoders match published BIP173 / well-known vectors", () => {
    const h = getBytes("0x751e76e8199196d454941c45d1b3a323f1433bd6");
    expect(p2wpkhAddress(h)).to.equal("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    // same hash160 (compressed pubkey of secret key 1) as the BIP173 example, in legacy P2PKH form
    expect(p2pkhAddress(h)).to.equal("1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH");
  });

  it("on-chain decode returns the demo key's hash160 for P2PKH and P2WPKH", async () => {
    const h = await (await ethers.getContractFactory("BitcoinAddressHarness")).deploy();
    expect(await h.toHash160(demoA.p2wpkh)).to.equal(hexlify(demoA.hash160));
    expect(await h.toHash160(demoB.p2pkh)).to.equal(hexlify(demoB.hash160));
    expect(await h.toHash160("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).to.equal("0x751e76e8199196d454941c45d1b3a323f1433bd6");
    expect(await h.toHash160("1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH")).to.equal("0x751e76e8199196d454941c45d1b3a323f1433bd6");
  });

  it("rejects bad checksums, uppercase/non-canonical spellings, and unsupported types", async () => {
    const h = await (await ethers.getContractFactory("BitcoinAddressHarness")).deploy();
    const good = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    await expect(h.toHash160(good.slice(0, -1) + "5")).to.be.reverted; // bech32 checksum
    await expect(h.toHash160(good.toUpperCase())).to.be.reverted; // uppercase is a different string for the same hash160
    await expect(h.toHash160("1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMI")).to.be.reverted; // base58 checksum / bad char
    await expect(h.toHash160("11BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH")).to.be.reverted; // extra leading '1' (non-canonical)
    await expect(h.toHash160("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).to.be.reverted; // P2SH is unsupported
    await expect(h.toHash160("bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297")).to.be.reverted; // taproot unsupported
  });
});

describe("ClearanceSBT", () => {
  it("mints an EXONERATED key to msg.sender with key + epoch stored (demo key, P2WPKH)", async () => {
    const { sbt, tree, keyA, user } = await setup();
    const p = tree.prove(keyA);
    const btc = await btcProof(sbt, demoA, demoA.p2wpkh, keyA, user.address);
    await expect(sbt.connect(user).mintExonerated(keyA, 1, ...verdictArgs(exonerated), p.bitmap, p.siblings, btc))
      .to.emit(sbt, "ClearanceMinted")
      .withArgs(0, user.address, keyA, 1);
    expect(await sbt.ownerOf(0)).to.equal(user.address);
    const c = await sbt.clearanceOf(0);
    expect([c.key, c.epoch]).to.deep.equal([keyA, 1n]);
    expect((await sbt.tokenOfKey(keyA))[1]).to.equal(true);
  });

  it("mints for an unflagged key with an exclusion proof (demo key, P2PKH)", async () => {
    const { sbt, tree, user } = await setup();
    const keyB = keyOf(demoB.p2pkh);
    const p = tree.prove(keyB);
    const btc = await btcProof(sbt, demoB, demoB.p2pkh, keyB, user.address);
    await sbt.connect(user).mintUnflagged(keyB, 1, p.bitmap, p.siblings, btc);
    expect(await sbt.ownerOf(0)).to.equal(user.address);
  });

  it("TRANSFER REVERTS: transferFrom / safeTransferFrom / approve / setApprovalForAll", async () => {
    const { sbt, tree, keyA, user, other } = await setup();
    const p = tree.prove(keyA);
    await sbt.connect(user).mintExonerated(keyA, 1, ...verdictArgs(exonerated), p.bitmap, p.siblings, await btcProof(sbt, demoA, demoA.p2wpkh, keyA, user.address));
    await expect(sbt.connect(user).transferFrom(user.address, other.address, 0)).to.be.revertedWithCustomError(sbt, "NonTransferable");
    await expect(sbt.connect(user)["safeTransferFrom(address,address,uint256)"](user.address, other.address, 0)).to.be.revertedWithCustomError(sbt, "NonTransferable");
    await expect(sbt.connect(user).approve(other.address, 0)).to.be.revertedWithCustomError(sbt, "NonTransferable");
    await expect(sbt.connect(user).setApprovalForAll(other.address, true)).to.be.revertedWithCustomError(sbt, "NonTransferable");
    expect(await sbt.ownerOf(0)).to.equal(user.address);
  });

  it("a flagged, non-exonerated key cannot mint", async () => {
    const { sbt, tree, keyC, user } = await setup();
    const p = tree.prove(keyC);
    const btc = await btcProof(sbt, demoC, demoC.p2wpkh, keyC, user.address);
    await expect(sbt.connect(user).mintExonerated(keyC, 1, ...verdictArgs(flagged), p.bitmap, p.siblings, btc)).to.be.revertedWithCustomError(sbt, "NotCleared");
    await expect(sbt.connect(user).mintUnflagged(keyC, 1, p.bitmap, p.siblings, btc)).to.be.revertedWithCustomError(sbt, "InvalidProof");
  });

  it("a tampered verdict (claiming EXONERATED for a flagged key) fails the proof", async () => {
    const { sbt, tree, keyC, user } = await setup();
    const p = tree.prove(keyC);
    const btc = await btcProof(sbt, demoC, demoC.p2wpkh, keyC, user.address);
    await expect(sbt.connect(user).mintExonerated(keyC, 1, ...verdictArgs(exonerated), p.bitmap, p.siblings, btc)).to.be.revertedWithCustomError(sbt, "InvalidProof");
  });

  it("ownership proof is bound to the minting wallet (replay from another wallet fails)", async () => {
    const { sbt, tree, keyA, user, other } = await setup();
    const p = tree.prove(keyA);
    const forUser = await btcProof(sbt, demoA, demoA.p2wpkh, keyA, user.address);
    await expect(sbt.connect(other).mintExonerated(keyA, 1, ...verdictArgs(exonerated), p.bitmap, p.siblings, forUser)).to.be.revertedWithCustomError(sbt, "OwnershipProofFailed");
  });

  it("a signature from a different key than the claimed address fails", async () => {
    const { sbt, tree, keyA, user } = await setup();
    const p = tree.prove(keyA);
    const impostor = new DemoKey();
    const btc = await btcProof(sbt, impostor, demoA.p2wpkh, keyA, user.address);
    await expect(sbt.connect(user).mintExonerated(keyA, 1, ...verdictArgs(exonerated), p.bitmap, p.siblings, btc)).to.be.revertedWithCustomError(sbt, "OwnershipProofFailed");
  });

  it("claimed address must hash to the proven key; a second mint for the same key reverts", async () => {
    const { sbt, tree, keyA, user } = await setup();
    const p = tree.prove(keyA);
    const btc = await btcProof(sbt, demoA, demoA.p2wpkh, keyA, user.address);
    await expect(sbt.connect(user).mintExonerated(keyA, 1, ...verdictArgs(exonerated), p.bitmap, p.siblings, { ...btc, btcAddress: demoB.p2pkh })).to.be.revertedWithCustomError(sbt, "KeyAddressMismatch");
    await sbt.connect(user).mintExonerated(keyA, 1, ...verdictArgs(exonerated), p.bitmap, p.siblings, btc);
    await expect(sbt.connect(user).mintExonerated(keyA, 1, ...verdictArgs(exonerated), p.bitmap, p.siblings, btc)).to.be.revertedWithCustomError(sbt, "AlreadyMinted");
  });

  it("non-canonical spelling of a flagged address cannot be used to mint as 'unflagged'", async () => {
    const { sbt, tree, user } = await setup();
    const fake = demoC.p2wpkh.toUpperCase(); // same hash160, different string => different key => absent from tree
    const key = keyOf(fake);
    const p = tree.prove(key);
    const btc = await btcProof(sbt, demoC, fake, key, user.address);
    await expect(sbt.connect(user).mintUnflagged(key, 1, p.bitmap, p.siblings, btc)).to.be.reverted;
  });

  it("stale epoch is rejected", async () => {
    const { sbt, tree, keyA, user } = await setup();
    const p = tree.prove(keyA);
    const btc = await btcProof(sbt, demoA, demoA.p2wpkh, keyA, user.address);
    await expect(sbt.connect(user).mintExonerated(keyA, 7, ...verdictArgs(exonerated), p.bitmap, p.siblings, btc)).to.be.revertedWithCustomError(sbt, "StaleEpoch");
  });
});
