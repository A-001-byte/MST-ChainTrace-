// Deploy ChainTraceRegistry to MST testnet and (optionally) publish an epoch root.
//
//   set MST_PRIVATE_KEY=<funded testnet key>          (never commit this)
//   npx hardhat run scripts/deploy.js --network mst
//   EPOCH=1 ROOT=0x... npx hardhat run scripts/deploy.js --network mst   # also publishes a root
//
// ROOT comes from `python -m src.mst.export --epoch N` (outputs/mst/latest_root.json).
const { ethers, network } = require("hardhat");

async function main() {
  const net = await ethers.provider.getNetwork();
  // Trust the node, not a constant: community sources disagree (0x5752035 vs 0x5752c35).
  console.log(`network ${network.name}, chainId ${net.chainId} (0x${net.chainId.toString(16)})`);

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no signer: set MST_PRIVATE_KEY");
  console.log("deployer", deployer.address);

  const registry = await (await ethers.getContractFactory("ChainTraceRegistry")).deploy();
  await registry.waitForDeployment();
  console.log("ChainTraceRegistry", await registry.getAddress());

  if (process.env.ROOT && process.env.EPOCH) {
    const tx = await registry.publishRoot(Number(process.env.EPOCH), process.env.ROOT);
    await tx.wait();
    console.log(`published epoch ${process.env.EPOCH} root ${process.env.ROOT}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
