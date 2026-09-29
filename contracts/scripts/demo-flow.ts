// Live demo on the deployed MST testnet contracts. Produces one real tx hash each for:
// publishEpoch, GuardedGateway deposit, challenge, resolve (plus release). Run after deploy-mst.ts:
//
//   npx hardhat run scripts/demo-flow.ts --network mst
//
// NOTE: the epoch published here is a DEMO epoch built from a locally generated tree (not Member 1's data).
// Uses the single configured signer for every role, so PUBLISHER_ADDRESS/ARBITER_ADDRESS must be that account.
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { SparseMerkleTree } from "../tests/helpers/smt";
import { Verdict, verdictArgs, verdictLeaf } from "../tests/helpers/verdict";

const explorer = (h: string) => (process.env.MST_EXPLORER_URL ? `${process.env.MST_EXPLORER_URL}/tx/${h}` : `(set MST_EXPLORER_URL) tx ${h}`);

async function main() {
  if (network.name === "hardhat") throw new Error("Run with --network mst");
  const file = path.join(__dirname, "..", "deployments", "mst-testnet.json");
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const live = (await ethers.provider.getNetwork()).chainId.toString();
  if (live !== dep.chainId) throw new Error(`live chainId ${live} != deployment chainId ${dep.chainId}`);
  console.log(`chainId ${live}`);

  const [signer] = await ethers.getSigners();
  const oracle: any = new ethers.Contract(dep.contracts.VerdictOracle.address, dep.contracts.VerdictOracle.abi, signer);
  const gw: any = new ethers.Contract(dep.contracts.GuardedGateway.address, dep.contracts.GuardedGateway.abi, signer);

  const minBond: bigint = await oracle.minBond();
  const bond: bigint = await oracle.publisherBond();
  if (bond < minBond) {
    const r = await (await oracle.depositBond({ value: minBond - bond })).wait();
    console.log(`depositBond      ${explorer(r.hash)}`);
  }

  // DEMO verdict: haircut 6000 >= 5000 -> the HAIRCUT-policy gateway holds the deposit
  const key = ethers.id(`demo-key-${Date.now()}`);
  const v: Verdict = { band: 2, riskBps: 7300, haircutBps: 6000, cwtBps: 3000, lowerBps: 4100, intent: 1, flags: 0 };
  const epoch = Number(await oracle.latestEpoch()) + 1;
  const tree = new SparseMerkleTree();
  tree.set(key, verdictLeaf(key, epoch, v));

  const pub = await (await oracle.publishEpoch(epoch, tree.root, await oracle.currentRoot(), ethers.id("demo-manifest"))).wait();
  console.log(`publishEpoch     ${explorer(pub.hash)}`);

  const proof = tree.prove(key);
  const dv = await (
    await gw.deposit(key, epoch, ...verdictArgs(v), proof.bitmap, proof.siblings, { value: (await oracle.minChallengeBond()) })
  ).wait();
  console.log(`gateway deposit  ${explorer(dv.hash)}  (held under HAIRCUT policy)`);

  const ch = await (
    await oracle.challenge(epoch, key, verdictLeaf(key, epoch, v), "demo: challenge", { value: await oracle.minChallengeBond() })
  ).wait();
  console.log(`challenge        ${explorer(ch.hash)}`);
  const id = await oracle.challengeCount();

  const rs = await (await oracle.resolve(id, true)).wait();
  console.log(`resolve(upheld)  ${explorer(rs.hash)}`);

  const rel = await (await gw.release(await gw.escrowCount())).wait();
  console.log(`release escrow   ${explorer(rel.hash)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
