// Publishes Member 1's REAL epoch root (latest_root.json from `python -m src.mst.export`) to the deployed VerdictOracle.
//
//   ROOT_FILE=C:\path\latest_root.json npx hardhat run scripts/publish-real-epoch.ts --network mst
//
// prevRoot is read from the oracle (0x00..00 on a fresh oracle). manifestHash = keccak256 of the file's bytes.
// Records the result under "realEpoch" in deployments/mst-testnet.json.
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  if (network.name === "hardhat") throw new Error("Run with --network mst");
  const rootFile = process.env.ROOT_FILE || path.join(__dirname, "..", "..", "outputs", "mst", "latest_root.json");
  const raw = fs.readFileSync(rootFile);
  const j = JSON.parse(raw.toString("utf8"));
  if (j.spec !== "SHARED_SPEC_v1") throw new Error(`unexpected spec ${j.spec}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(j.root)) throw new Error("root is not a bytes32");
  const manifestHash = ethers.keccak256(raw);

  const depFile = path.join(__dirname, "..", "deployments", "mst-testnet.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  const live = (await ethers.provider.getNetwork()).chainId.toString();
  if (live !== dep.chainId) throw new Error(`live chainId ${live} != deployment chainId ${dep.chainId}`);
  console.log(`chainId ${live}`);

  const [signer] = await ethers.getSigners();
  const oracle: any = new ethers.Contract(dep.contracts.VerdictOracle.address, dep.contracts.VerdictOracle.abi, signer);
  console.log(`oracle ${await oracle.getAddress()}  latestEpoch=${await oracle.latestEpoch()}`);

  const minBond: bigint = await oracle.minBond();
  const bond: bigint = await oracle.publisherBond();
  if (bond < minBond) {
    const r = await (await oracle.depositBond({ value: minBond - bond })).wait();
    console.log(`depositBond   ${process.env.MST_EXPLORER_URL}/tx/${r.hash}`);
  }

  const prevRoot: string = await oracle.currentRoot();
  console.log(`epoch=${j.epoch} root=${j.root} prevRoot=${prevRoot} leafCount=${j.leafCount} manifestHash=${manifestHash}`);
  const rc = await (await oracle.publishEpoch(j.epoch, j.root, prevRoot, manifestHash)).wait();
  console.log(`publishEpoch  ${process.env.MST_EXPLORER_URL}/tx/${rc.hash}  (status ${rc.status}, block ${rc.blockNumber})`);

  console.log(`on-chain: latestEpoch=${await oracle.latestEpoch()} currentRoot=${await oracle.currentRoot()}`);
  dep.realEpoch = { epoch: j.epoch, root: j.root, leafCount: j.leafCount, manifestHash, txHash: rc.hash, blockNumber: rc.blockNumber };
  fs.writeFileSync(depFile, JSON.stringify(dep, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
