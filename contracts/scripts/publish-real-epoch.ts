// Publishes the REAL pipeline-derived epoch (outputs/mst/epoch_<N>.json, produced by
// `python -m scripts.export_verdict_set`) to VerdictOracle on MST testnet — as opposed to
// demo-flow.ts, which publishes a synthetic one-leaf demo tree.
//
// Every leaf/proof in the export was already computed against `root` by the exporter, so
// this script does not rebuild the tree — it only has to get `root` on-chain correctly
// chained onto whatever `currentRoot` actually is right now, which the contract enforces
// via prevRoot == currentRoot (VerdictOracle.sol:188).
//
//   npx hardhat run scripts/publish-real-epoch.ts --network mst -- --epoch 2
//
// Requires contracts/.env: MST_RPC_URL, DEPLOYER_PRIVATE_KEY (must be the configured
// `publisher`), MST_EXPLORER_URL (optional, for the printed links).
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const explorer = (h: string) =>
  process.env.MST_EXPLORER_URL ? `${process.env.MST_EXPLORER_URL}/tx/${h}` : `(set MST_EXPLORER_URL) tx ${h}`;

function parseEpochArg(): number {
  const flagIdx = process.argv.indexOf("--epoch");
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) return Number(process.argv[flagIdx + 1]);
  // Fall back to the newest outputs/mst/epoch_*.json on disk.
  const dir = path.join(__dirname, "..", "..", "outputs", "mst");
  const nums = fs
    .readdirSync(dir)
    .map((f) => f.match(/^epoch_(\d+)\.json$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => Number(m[1]));
  if (nums.length === 0) throw new Error(`no epoch_*.json in ${dir}`);
  return Math.max(...nums);
}

// DECISION (not specified anywhere in SHARED_SPEC_v1 or the contract): manifestHash below
// is ethers.keccak256 of the manifest object's canonical (sorted-key) JSON — see main().
// The contract stores this opaquely and never interprets it, so any deterministic hash
// works, but every future publish must derive it the SAME way or manifestHash stops
// meaning "the manifest that produced this root" to anyone comparing epochs.

async function main() {
  if (network.name === "hardhat") throw new Error("Run with --network mst");

  const epochNum = parseEpochArg();
  const exportPath = path.join(__dirname, "..", "..", "outputs", "mst", `epoch_${epochNum}.json`);
  if (!fs.existsSync(exportPath)) throw new Error(`missing ${exportPath}`);
  const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  if (!exported.root || !exported.manifest || !Array.isArray(exported.entries)) {
    throw new Error(`${exportPath} is missing root/manifest/entries — is this a real export, not a stub?`);
  }

  // Override for testing against a non-shared deployment record (e.g. a local chain) —
  // never point this at deployments/mst-testnet.json for anything other than the real
  // publisher, since that file is the live record the backend and frontend both read.
  const depFile = process.env.DEPLOYMENT_FILE || path.join(__dirname, "..", "deployments", "mst-testnet.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  const liveChainId = (await ethers.provider.getNetwork()).chainId.toString();
  if (liveChainId !== dep.chainId) {
    throw new Error(`live chainId ${liveChainId} != deployment chainId ${dep.chainId} — wrong network`);
  }

  const [signer] = await ethers.getSigners();
  const oracle: any = new ethers.Contract(dep.contracts.VerdictOracle.address, dep.contracts.VerdictOracle.abi, signer);

  const publisher: string = await oracle.publisher();
  if (signer.address.toLowerCase() !== publisher.toLowerCase()) {
    throw new Error(
      `DEPLOYER_PRIVATE_KEY signs as ${signer.address}, but the configured publisher is ${publisher}. `
      + `Only the publisher can call publishEpoch.`
    );
  }

  const latestEpoch = Number(await oracle.latestEpoch());
  if (epochNum <= latestEpoch) {
    throw new Error(`epoch ${epochNum} <= latestEpoch ${latestEpoch} on-chain — bump the export's epoch number`);
  }

  const minBond: bigint = await oracle.minBond();
  const bond: bigint = await oracle.publisherBond();
  if (bond < minBond) {
    const topUp = minBond - bond;
    console.log(`publisherBond ${ethers.formatEther(bond)} < minBond ${ethers.formatEther(minBond)} — depositing ${ethers.formatEther(topUp)} tMSTC`);
    const r = await (await oracle.depositBond({ value: topUp })).wait();
    console.log(`depositBond      ${explorer(r.hash)}`);
  }

  const currentRoot: string = await oracle.currentRoot();
  const mHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(exported.manifest, Object.keys(exported.manifest).sort())));

  console.log(`epoch            ${epochNum}`);
  console.log(`root             ${exported.root}`);
  console.log(`prevRoot (live)  ${currentRoot}`);
  console.log(`manifestHash     ${mHash}`);
  console.log(`leaves           ${exported.entries.length}`);

  const pub = await (await oracle.publishEpoch(epochNum, exported.root, currentRoot, mHash)).wait();
  console.log(`\npublishEpoch     ${explorer(pub.hash)}`);

  // Self-check: verify one real leaf from the export against the epoch just published,
  // using the contract itself — not this script's own maths — as the source of truth.
  const probe = exported.entries[Math.floor(exported.entries.length / 2)];
  const ok = await oracle.verifyVerdict(
    probe.key, epochNum, probe.band, probe.riskBps, probe.haircutBps, probe.cwtBps, probe.lowerBps,
    probe.intent, probe.flags, probe.proof.bitmap, probe.proof.siblings
  );
  console.log(`on-chain verifyVerdict for ${probe.address}: ${ok}`);
  if (!ok) throw new Error("published root does not verify a real leaf from its own export — do not trust this publish");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
