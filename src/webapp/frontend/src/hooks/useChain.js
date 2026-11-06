import { useApi } from "./useApi";
import { getGatewayPreview, getVerdict } from "../services/api";
import {
  loadDeployment, oracleContract, publishedRoot, readProvider, verdictArgs, ZERO_ROOT,
} from "../lib/chain/contracts";
import { leafHash, verifyProof } from "../lib/verify/smt";

/** The active deployment record: addresses, ABIs, RPC, and the locally exported epoch. */
export function useDeployment() {
  return useApi("chain-deployment", loadDeployment);
}

/** Looks up one verdict and checks it in the browser and against VerdictOracle. */
async function loadVerdict(deployment, addr) {
  const api = await getVerdict(addr);
  const leaf = api.found ? leafHash(api.key, api.epoch, api.fields) : ZERO_ROOT;
  const leafMatches = leaf === api.leaf;
  const exportedRoot = deployment?.localEpoch?.epoch === api.epoch ? deployment.localEpoch.root : null;

  const v = { leaf, leafMatches, exportedRoot, chainRoot: null, published: null, local: null, onChain: null, onChainError: null, overturned: false };
  if (exportedRoot) v.localExport = verifyProof(exportedRoot, api.key, leaf, api.proof.bitmap, api.proof.siblings);

  if (deployment?.available) {
    try {
      const oracle = oracleContract(deployment, readProvider(deployment));
      v.chainRoot = await publishedRoot(oracle, api.epoch);
      v.published = v.chainRoot != null;
      if (v.published) {
        v.local = leafMatches && verifyProof(v.chainRoot, api.key, leaf, api.proof.bitmap, api.proof.siblings);
        if (api.found) {
          v.onChain = await oracle.verifyVerdict(...verdictArgs(api));
          v.overturned = Boolean(await oracle.overturned(api.epoch, api.key));
        } else {
          v.onChain = await oracle.verifyUnflagged(api.key, api.epoch, api.proof.bitmap, api.proof.siblings);
        }
      }
    } catch (err) {
      v.onChainError = err.shortMessage || err.message;
    }
  }
  // Only a genuine disagreement counts; a missing result stays "unknown".
  v.agree = v.local != null && v.onChain != null ? v.local === v.onChain : null;
  return { ...api, verification: v };
}

/**
 * A verdict (or its absence), checked twice:
 *   local   — this browser recomputes the leaf from its fields and folds the proof up to a
 *             root, compared with the root the chain holds for that epoch
 *   onChain — VerdictOracle.verifyVerdict (member) or verifyUnflagged (non-member) over RPC
 * If the epoch's root was never published there is nothing on-chain to check against, and
 * that is reported as such — never folded into a pass. Not cached: chain state moves.
 */
export function useVerdict(deployment, address) {
  const key = address ? `verdict:${deployment?.chainId ?? "-"}:${address}` : null;
  return useApi(key, () => loadVerdict(deployment, address), { cache: false });
}

/** Every verdict in the exported epoch, for the gateway comparison. */
export function useGatewayPreview() {
  return useApi("gateway-preview", getGatewayPreview);
}

/** Every published epoch on VerdictOracle, newest first, plus a few oracle-wide figures. */
export function useEpochs(deployment) {
  return useApi(deployment?.available ? `epochs:${deployment.chainId}` : null, async () => {
    const oracle = oracleContract(deployment, readProvider(deployment));
    const latest = Number(await oracle.latestEpoch());
    const rows = [];
    for (let n = latest; n >= 1; n--) {
      const e = await oracle.epochData(n);
      if (e.root === ZERO_ROOT) continue; // epochs may skip numbers
      rows.push({ number: n, root: e.root, prevRoot: e.prevRoot, manifestHash: e.manifestHash, publishedAt: Number(e.publishedAt) });
    }
    const [challenges, bond] = await Promise.all([oracle.challengeCount(), oracle.publisherBond()]);
    return { rows, latest, challengeCount: Number(challenges), publisherBond: bond };
  }, { cache: false });
}

/**
 * Challenges from VerdictOracle (ids are 1-based). The struct records only `resolved`; the
 * verdict (upheld / rejected) lives in the ChallengeResolved event, read from the deploy block on.
 */
export function useChallenges(deployment, refreshKey = 0) {
  return useApi(deployment?.available ? `challenges:${deployment.chainId}:${refreshKey}` : null, async () => {
    const provider = readProvider(deployment);
    const oracle = oracleContract(deployment, provider);
    const [count, window] = await Promise.all([oracle.challengeCount(), oracle.challengeWindow()]);

    const upheldById = new Map();
    try {
      const deployTx = await provider.getTransactionReceipt(deployment.contracts.VerdictOracle.txHash);
      const logs = await oracle.queryFilter(oracle.filters.ChallengeResolved(), deployTx?.blockNumber ?? 0);
      logs.forEach((l) => upheldById.set(Number(l.args.challengeId), l.args.upheld));
    } catch { /* outcome stays unknown if the RPC refuses the log range */ }

    const rows = [];
    for (let id = Number(count); id >= 1; id--) {
      const c = await oracle.getChallenge(id);
      const e = await oracle.epochData(c.epoch);
      rows.push({
        id, challenger: c.challenger, epoch: Number(c.epoch), key: c.key, leafHash: c.leafHash,
        bond: c.bond, reason: c.reasonURI, resolved: c.resolved, upheld: upheldById.get(id) ?? null,
        windowEnds: Number(e.publishedAt) + Number(window),
      });
    }
    return rows;
  }, { cache: false });
}
