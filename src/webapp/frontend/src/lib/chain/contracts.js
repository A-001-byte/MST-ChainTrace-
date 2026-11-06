import { Contract, JsonRpcProvider } from "ethers";

/**
 * Bindings to the deployed verdict-layer contracts (contracts/ on main, SHARED SPEC v1):
 * VerdictOracle, GuardedGateway, ClearanceSBT. Addresses and ABIs come from the deployment
 * record the backend serves (contracts/deployments/mst-testnet.json) — never from constants.
 */

export const ZERO_ROOT = "0x" + "00".repeat(32);

// Enum order mirrors GuardedGateway.sol.
export const POLICY = { HAIRCUT: 0, CUSTODY: 1 };
export const POLICY_LABEL = ["HAIRCUT", "CUSTODY"];
export const OUTCOME = ["Accepted", "Held", "In review"];
export const OUTCOME_TONE = ["up", "down", ""];

export async function loadDeployment() {
  const res = await fetch("/api/chain/deployment");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `deployment lookup failed (${res.status})`);
  return body;
}

export function readProvider(deployment) {
  if (!deployment?.rpcUrl) throw new Error("deployment record carries no rpcUrl");
  return new JsonRpcProvider(deployment.rpcUrl, Number(deployment.chainId), { staticNetwork: true });
}

const bind = (name) => (deployment, runner) => {
  const c = deployment?.contracts?.[name];
  if (!c) throw new Error(`deployment has no ${name}`);
  return new Contract(c.address, c.abi, runner);
};
export const oracleContract = bind("VerdictOracle");
export const gatewayContract = bind("GuardedGateway");
export const clearanceContract = bind("ClearanceSBT");

/** The verdict tuple exactly as verifyVerdict / screen / deposit take it: (key, epoch, …fields, bitmap, siblings). */
export const verdictArgs = (v) => [
  v.key, v.epoch, v.fields.band, v.fields.riskBps, v.fields.haircutBps, v.fields.cwtBps,
  v.fields.lowerBps, v.fields.intent, v.fields.flags, v.proof.bitmap, v.proof.siblings,
];

/** The root VerdictOracle holds for an epoch, or null when that epoch was never published. */
export async function publishedRoot(oracle, epoch) {
  const e = await oracle.epochData(epoch);
  return e.root === ZERO_ROOT ? null : e.root;
}

export const explorerTxUrl = (deployment, hash) =>
  deployment?.explorerUrl ? `${deployment.explorerUrl.replace(/\/$/, "")}/tx/${hash}` : null;

export const explorerAddressUrl = (deployment, address) =>
  deployment?.explorerUrl ? `${deployment.explorerUrl.replace(/\/$/, "")}/address/${address}` : null;
