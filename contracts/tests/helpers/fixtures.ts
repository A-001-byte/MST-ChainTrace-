import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SparseMerkleTree, keyFrom } from "./smt";
import { Verdict, verdictLeaf } from "./verdict";

export const MIN_BOND = ethers.parseEther("10");
export const MIN_CHALLENGE_BOND = ethers.parseEther("1");
export const CHALLENGE_WINDOW = 600; // 10 minutes, as on testnet
export const SLASH_REWARD = ethers.parseEther("3");

export const KEY_A = keyFrom(0xa11ce);
export const KEY_UNFLAGGED = keyFrom(0xf00d);

/** Build a one-verdict-per-key tree for `epoch`, returning the tree and a helper to get proofs. */
export function buildEpochTree(epoch: number, verdicts: Array<[string, Verdict]>) {
  const tree = new SparseMerkleTree();
  for (const [key, v] of verdicts) tree.set(key, verdictLeaf(key, epoch, v));
  return tree;
}

export async function deployOracle() {
  const [owner, publisher, arbiter, challenger, user, treasury, other] = await ethers.getSigners();
  const Oracle = await ethers.getContractFactory("VerdictOracle");
  const oracle = await Oracle.deploy(
    owner.address,
    publisher.address,
    arbiter.address,
    MIN_BOND,
    MIN_CHALLENGE_BOND,
    CHALLENGE_WINDOW,
    SLASH_REWARD
  );
  await oracle.waitForDeployment();
  return { oracle, owner, publisher, arbiter, challenger, user, treasury, other };
}

/** Oracle with a funded publisher bond and epoch 1 published from `verdicts`. */
export async function oracleWithEpoch(verdicts: Array<[string, Verdict]>, bond = MIN_BOND) {
  const ctx = await deployOracle();
  await ctx.oracle.connect(ctx.publisher).depositBond({ value: bond });
  const tree = buildEpochTree(1, verdicts);
  await ctx.oracle.connect(ctx.publisher).publishEpoch(1, tree.root, ethers.ZeroHash, ethers.id("manifest-1"));
  return { ...ctx, tree, epoch: 1 };
}

export { time };
