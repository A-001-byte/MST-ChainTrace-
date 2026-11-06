import { describe, it, expect } from "vitest";
import { keyOf, leafHash, verifyProof } from "./smt";

// Cases copied verbatim from Member 1's golden vectors (tests/vectors/smt_vectors.json on
// main, SHARED SPEC v1): a member, a non-member, and two deliberately invalid proofs.
const LEAF = {"address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "key": "0x77c6e9d5d93ff9921129ddedcc2d859bd54a7be81343f60c11961da1e54f5be3", "epoch": 1, "band": 3, "riskBps": 9123, "haircutBps": 8500, "cwtBps": 7812, "lowerBps": 4000, "intent": 1, "flags": 8, "leaf": "0x960abb818510c2b03d50e50241c018b316069d8a3913c38fa3a3f7f7c66bd613"};
const CASES = [
  {
    "key": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "leaf": "0x350bb3dca2efdb96db44fe0ad0417cf25bfe6be8ef4c46499b2585bd7001b9f2",
    "proof": {
      "bitmap": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "siblings": []
    },
    "valid": true,
    "root": "0x3d4aba27080307c998f6844d401a8bf0d5b01d8e39fc2e96b80e9aaf2e2bb702",
    "name": "member: key all-zeros"
  },
  {
    "key": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "leaf": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "proof": {
      "bitmap": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "siblings": []
    },
    "valid": true,
    "root": "0xa7ff9e28ffd3def443d324547688c2c4eb98edf7da757d6bfa22bff55b9ce24a",
    "name": "non-member: empty tree, key zero"
  },
  {
    "key": "0x77c6e9d5d93ff9921129ddedcc2d859bd54a7be81343f60c11961da1e54f5be3",
    "leaf": "0x2d732dfdcadad6103cf313aa83f46e7c48e8ad520fb4b9a718de0b436570d9df",
    "proof": {
      "bitmap": "0xf000000000000000000000000000000000000000000000000000000000000000",
      "siblings": [
        "0x56409550c15a23fdefa34a308c6a6c1e9e7646feaa44c4d593a69cc7796cc267",
        "0xaa3d081628d6c68871e6d1ad6ff0e4f0c2d0b95fd8bca57d46794ba302ca8116",
        "0x00b52c5e44e4300ab83f94f9fc8daabfd1ebe4a17ae7c92dcef07a0f4fee0616",
        "0x276612efd146a045586336042c8be91ebab94e52b293fe16fcda59a8fa6f87d2"
      ]
    },
    "valid": false,
    "root": "0xe4202cbdc2fe2339fbe50e92d64b152ecd435c0845d0e54f52ce97b5a8a418fb",
    "name": "invalid: wrong leaf value"
  },
  {
    "key": "0x77c6e9d5d93ff9921129ddedcc2d859bd54a7be81343f60c11961da1e54f5be3",
    "leaf": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "proof": {
      "bitmap": "0xf000000000000000000000000000000000000000000000000000000000000000",
      "siblings": [
        "0x56409550c15a23fdefa34a308c6a6c1e9e7646feaa44c4d593a69cc7796cc267",
        "0xaa3d081628d6c68871e6d1ad6ff0e4f0c2d0b95fd8bca57d46794ba302ca8116",
        "0x00b52c5e44e4300ab83f94f9fc8daabfd1ebe4a17ae7c92dcef07a0f4fee0616",
        "0x276612efd146a045586336042c8be91ebab94e52b293fe16fcda59a8fa6f87d2"
      ]
    },
    "valid": false,
    "root": "0xe4202cbdc2fe2339fbe50e92d64b152ecd435c0845d0e54f52ce97b5a8a418fb",
    "name": "invalid: membership proof claimed as non-membership"
  }
];

describe("SMT verifier (SHARED SPEC v1 golden vectors)", () => {
  it("derives the key and leaf hash exactly as the spec does", () => {
    expect(keyOf(LEAF.address)).toBe(LEAF.key);
    expect(leafHash(LEAF.key, LEAF.epoch, LEAF)).toBe(LEAF.leaf);
  });
  it.each(CASES)("$name -> valid=$valid", (c) => {
    expect(verifyProof(c.root, c.key, c.leaf, c.proof.bitmap, c.proof.siblings)).toBe(c.valid);
  });
});
