// JS reference verifier for SHARED SPEC v1 (keccak256 sparse Merkle tree, depth 256).
// Uses ethers' keccak256, never NIST sha3-256.
const { keccak256, getBytes, toUtf8Bytes, concat, zeroPadValue, toBeHex, AbiCoder } = require("ethers");

const DEPTH = 256;
const ZERO = "0x" + "00".repeat(32);

const DEFAULTS = (() => {
  const d = [ZERO];
  for (let i = 0; i < DEPTH; i++) d.push(keccak256(concat([d[i], d[i]])));
  return d;
})();

const keyOf = (address) => keccak256(toUtf8Bytes(address));

const LEAF_TYPES = ["bytes32", "uint32", "uint8", "uint16", "uint16", "uint16", "uint16", "uint8", "uint8"];
function leafHash(f) {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(LEAF_TYPES, [
      f.key, f.epoch, f.band, f.riskBps, f.haircutBps, f.cwtBps, f.lowerBps, f.intent, f.flags,
    ])
  );
}

// Fold `leaf` up the path of `key`; throws on a malformed proof.
function computeRoot(key, leaf, bitmap, siblings) {
  const k = BigInt(key);
  const bm = BigInt(bitmap);
  if (bm < 0n || bm >= 1n << 256n) throw new Error("bitmap out of range");
  let popcount = 0;
  for (let i = 0; i < DEPTH; i++) if ((bm >> BigInt(i)) & 1n) popcount++;
  if (popcount !== siblings.length) throw new Error("sibling count does not match bitmap popcount");
  let node = leaf;
  let used = 0;
  for (let i = 0; i < DEPTH; i++) {
    const sib = (bm >> BigInt(i)) & 1n ? siblings[used++] : DEFAULTS[i];
    node = (k >> BigInt(i)) & 1n ? keccak256(concat([sib, node])) : keccak256(concat([node, sib]));
  }
  return node;
}

function verifyProof(root, key, leaf, bitmap, siblings) {
  try {
    return computeRoot(key, leaf, bitmap, siblings) === root.toLowerCase();
  } catch {
    return false;
  }
}

module.exports = { DEPTH, ZERO, DEFAULTS, keyOf, leafHash, computeRoot, verifyProof };
