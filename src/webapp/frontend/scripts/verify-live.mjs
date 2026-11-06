// Runs the browser verifier against the live API response — the exact path that threw
// "Cannot read properties of undefined (reading 'band')" when the server was stale.

import { leafHash, verifyProof, keyOf } from "../src/lib/verify/smt.js";

const BASE = process.env.API_BASE || "http://127.0.0.1:5000";
const ADDRS = process.argv.slice(2);

// The exported root lives on the deployment record, not on the per-verdict response.
const deployment = await (await fetch(`${BASE}/api/chain/deployment`)).json();
const EXPORTED_ROOT = deployment?.localEpoch?.root;
console.log(`exported epoch ${deployment?.localEpoch?.epoch} root ${EXPORTED_ROOT?.slice(0, 18)}…`
  + ` (${deployment?.localEpoch?.leafCount} leaves)\n`);

if (ADDRS.length === 0) {
  const preview = await (await fetch(`${BASE}/api/verdict/gateway-preview`)).json();
  ADDRS.push(...(preview.rows ?? preview.wallets ?? []).slice(0, 3).map((r) => r.address ?? r.nodeId));
  ADDRS.push("bc1qdefinitelynotinthisset");
}

let bad = 0;
for (const addr of ADDRS) {
  const v = await (await fetch(`${BASE}/api/verdict/${encodeURIComponent(addr)}`)).json();

  if (!v.fields) { console.log(`${addr}\n  NO fields — this is what crashed the page`); bad++; continue; }

  const leaf = leafHash(v.key, v.epoch, v.fields);            // <- the line that threw
  const leafOk = leaf.toLowerCase() === String(v.leaf).toLowerCase();
  const keyOk = keyOf(v.address).toLowerCase() === String(v.key).toLowerCase();
  const rootOk = verifyProof(EXPORTED_ROOT, v.key, leaf, v.proof.bitmap, v.proof.siblings);

  console.log(`${v.address}`);
  console.log(`  found ${v.found} · band ${v.bandLabel ?? v.fields.band} · risk ${(v.fields.riskBps / 100).toFixed(2)}%`);
  console.log(`  key matches keccak(address): ${keyOk}`);
  console.log(`  recomputed leaf matches server: ${leafOk}`);
  console.log(`  proof folds to exported root:   ${rootOk}  (${v.proof.siblings.length} siblings)`);
  if (!leafOk || !keyOk) bad++;
}

console.log(bad === 0 ? "\nall good — the Screen page path works" : `\n${bad} problem(s)`);
process.exitCode = bad === 0 ? 0 : 1;
