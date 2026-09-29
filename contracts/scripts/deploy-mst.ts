// Deploys VerdictOracle, GuardedGateway and ClearanceSBT to the MST testnet and writes
// deployments/mst-testnet.json ({ chainId, deployer, params, contracts: { Name: { address, abi, txHash } } }).
//
//   npx hardhat run scripts/deploy-mst.ts --network mst
//
// Config comes from .env only (see .env.example): MST_RPC_URL, MST_CHAIN_ID, DEPLOYER_PRIVATE_KEY, ...
// SMTVerifier and VerdictLeaf are internal libraries, inlined into the contracts: nothing to deploy for them.
import { ethers, network, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const POLICY_HAIRCUT = 0;

async function main() {
  const expected = process.env.MST_CHAIN_ID;
  if (!expected) throw new Error("MST_CHAIN_ID is not set in .env; refusing to deploy without an intended chainId");
  if (network.name === "hardhat") throw new Error("Run with --network mst; refusing to 'deploy' to the in-process network");

  // Verify the LIVE chainId from the RPC (do not trust config/assumptions).
  const live = (await ethers.provider.getNetwork()).chainId;
  console.log(`Live chainId from RPC: ${live}  (intended MST_CHAIN_ID: ${expected})`);
  if (live.toString() !== BigInt(expected).toString()) {
    throw new Error(`chainId mismatch: RPC reports ${live}, .env says ${expected}. Aborting - nothing deployed.`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account: set DEPLOYER_PRIVATE_KEY in .env");
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}  balance: ${ethers.formatEther(balance)}`);

  const publisher = process.env.PUBLISHER_ADDRESS || deployer.address;
  const arbiter = process.env.ARBITER_ADDRESS || deployer.address;
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  if (arbiter === deployer.address) {
    console.warn("WARNING: arbiter defaults to the deployer. The arbiter is a single trusted, centralized role (v1).");
  }

  const p = {
    minBond: ethers.parseEther(process.env.MIN_BOND || "0.1"),
    minChallengeBond: ethers.parseEther(process.env.MIN_CHALLENGE_BOND || "0.01"),
    challengeWindow: Number(process.env.CHALLENGE_WINDOW || 600), // ~10 min so it is demoable live
    slashReward: ethers.parseEther(process.env.SLASH_REWARD || "0.05"),
  };

  const deployed: Record<string, { address: string; abi: unknown; txHash: string | undefined }> = {};
  const record = async (name: string, contract: any) => {
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    const abi = (await artifacts.readArtifact(name)).abi;
    deployed[name] = { address, abi, txHash: contract.deploymentTransaction()?.hash };
    console.log(`${name}: ${address}  (tx ${contract.deploymentTransaction()?.hash})`);
    return contract;
  };

  const oracle = await record(
    "VerdictOracle",
    await (await ethers.getContractFactory("VerdictOracle")).deploy(
      deployer.address, publisher, arbiter, p.minBond, p.minChallengeBond, p.challengeWindow, p.slashReward
    )
  );
  const oracleAddr = await oracle.getAddress();
  await record(
    "GuardedGateway",
    await (await ethers.getContractFactory("GuardedGateway")).deploy(oracleAddr, deployer.address, treasury, POLICY_HAIRCUT)
  );
  await record("ClearanceSBT", await (await ethers.getContractFactory("ClearanceSBT")).deploy(oracleAddr));

  const out = {
    network: "mst-testnet",
    chainId: live.toString(),
    deployer: deployer.address,
    roles: { publisher, arbiter, treasury },
    params: {
      minBond: p.minBond.toString(),
      minChallengeBond: p.minChallengeBond.toString(),
      challengeWindow: p.challengeWindow,
      slashReward: p.slashReward.toString(),
      gatewayThresholdsBps: { haircutHold: 5000, custodyHold: 5000 },
    },
    deployedAt: new Date().toISOString(),
    contracts: deployed,
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "mst-testnet.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
