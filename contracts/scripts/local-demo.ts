// Local stand-in for MST testnet while the publisher key is unavailable: deploys the same three
// contracts to a local Hardhat node and publishes the exported pipeline epoch.
//   npx hardhat node                                   (terminal 1)
//   npx hardhat run scripts/local-demo.ts --network localhost
// Challenge window is 7 days here so the demo is not time-boxed.
import { ethers, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const raw = fs.readFileSync(path.join(__dirname, "..", "..", "outputs", "mst", "latest_root.json"), "utf8");
  const manifest = JSON.parse(raw);
  const deployed: Record<string, any> = {};
  const record = async (name: string, c: any) => {
    await c.waitForDeployment();
    deployed[name] = { address: await c.getAddress(), abi: (await artifacts.readArtifact(name)).abi, txHash: c.deploymentTransaction()?.hash };
    return c;
  };
  const p = { minBond: ethers.parseEther("0.1"), minChallengeBond: ethers.parseEther("0.01"), challengeWindow: 7 * 24 * 3600, slashReward: ethers.parseEther("0.05") };
  const oracle = await record("VerdictOracle", await (await ethers.getContractFactory("VerdictOracle")).deploy(
    deployer.address, deployer.address, deployer.address, p.minBond, p.minChallengeBond, p.challengeWindow, p.slashReward));
  await record("GuardedGateway", await (await ethers.getContractFactory("GuardedGateway")).deploy(await oracle.getAddress(), deployer.address, deployer.address, 0));
  await record("ClearanceSBT", await (await ethers.getContractFactory("ClearanceSBT")).deploy(await oracle.getAddress()));

  await (await oracle.depositBond({ value: p.minBond })).wait();
  await (await oracle.publishEpoch(manifest.epoch, manifest.root, await oracle.currentRoot(), ethers.id(raw))).wait();

  const chainId = (await ethers.provider.getNetwork()).chainId.toString();
  const out = { network: "localhost", chainId, deployer: deployer.address,
    roles: { publisher: deployer.address, arbiter: deployer.address, treasury: deployer.address },
    params: { minBond: p.minBond.toString(), minChallengeBond: p.minChallengeBond.toString(), challengeWindow: p.challengeWindow, slashReward: p.slashReward.toString(), gatewayThresholdsBps: { haircutHold: 5000, custodyHold: 5000 } },
    deployedAt: new Date().toISOString(), contracts: deployed };
  fs.writeFileSync(path.join(__dirname, "..", "deployments", "localhost.json"), JSON.stringify(out, null, 2));
  console.log(`local chain ${chainId}: published epoch ${manifest.epoch} root ${manifest.root}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
