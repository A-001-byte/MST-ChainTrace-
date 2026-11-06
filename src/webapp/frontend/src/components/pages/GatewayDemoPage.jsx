import { useEffect, useMemo, useState } from "react";
import { parseEther } from "ethers";
import { PageHead, Section, Card, Stat, Stats, ErrorCard, Empty, Reveal, Tag } from "../ui";
import WalletBar from "../verdicts/WalletBar";
import { useGatewayPreview } from "../../hooks/useChain";
import {
  OUTCOME, OUTCOME_TONE, POLICY, POLICY_LABEL, gatewayContract, oracleContract, publishedRoot,
  readProvider, verdictArgs, explorerTxUrl,
} from "../../lib/chain/contracts";

/** Counters are derived from the outcomes the contract returns — never literals. */
function tally(rows, policy) {
  const counts = [0, 0, 0];
  rows.forEach((r) => { const o = r.outcomes?.[policy]; if (o != null) counts[o] += 1; });
  return counts;
}

function PolicyColumn({ title, subtitle, policy, rows, selected, onSelect }) {
  const [accepted, held, review] = tally(rows, policy);
  return (
    <Card title={title} right={<span className="meta">{subtitle}</span>}>
      <Stats sm className="counters">
        <Stat k="Held" v={held} t={held > 0 ? "down" : ""} />
        <Stat k="Review" v={review} />
        <Stat k="Accepted" v={accepted} t={accepted > 0 ? "up" : ""} />
      </Stats>
      <div className="scroll" style={{ maxHeight: 360, marginTop: "var(--s16)" }}>
        <table className="tbl">
          <thead><tr><th>Address</th><th className="r">{policy === POLICY.HAIRCUT ? "Haircut" : "Custody"}</th><th className="r">Outcome</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const o = r.outcomes?.[policy];
              const bps = policy === POLICY.HAIRCUT ? r.fields.haircutBps : r.fields.cwtBps;
              return (
                <tr key={r.address} className={selected === r.address ? "on" : ""} onClick={() => onSelect(r.address)}>
                  <td className="mono trunc">{r.address}{r.context?.source === "gateway" && <Tag>demo</Tag>}</td>
                  <td className="r num">{(bps / 100).toFixed(1)}%</td>
                  <td className={`r ${OUTCOME_TONE[o] ?? ""}`}>{o == null ? "—" : OUTCOME[o]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function GatewayDemoPage({ deployment, wallet }) {
  const { data, error, loading } = useGatewayPreview();
  const [chain, setChain] = useState({ rows: [], policy: null, published: null, error: null });
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("0.01");
  const [tx, setTx] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  // Outcomes come from GuardedGateway.evaluate — the same pure function deposit() applies,
  // so this split screen cannot drift from what a real deposit would do.
  useEffect(() => {
    if (!data?.rows?.length || !deployment?.available) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const provider = readProvider(deployment);
        const gateway = gatewayContract(deployment, provider);
        const oracle = oracleContract(deployment, provider);
        const [policy, root] = await Promise.all([gateway.policy(), publishedRoot(oracle, data.epoch)]);
        const rows = await Promise.all(data.rows.map(async (r) => {
          const overturned = await oracle.overturned(r.epoch, r.key);
          const [h, c] = await Promise.all([POLICY.HAIRCUT, POLICY.CUSTODY].map((p) =>
            gateway.evaluate(p, r.fields.haircutBps, r.fields.cwtBps, r.fields.flags, overturned)));
          return { ...r, overturned, outcomes: { [POLICY.HAIRCUT]: Number(h), [POLICY.CUSTODY]: Number(c) } };
        }));
        if (!cancelled) setChain({ rows, policy: Number(policy), published: root != null, error: null });
      } catch (err) {
        if (!cancelled) setChain((s) => ({ ...s, error: err.shortMessage || err.message }));
      }
    })();
    return () => { cancelled = true; };
  }, [data, deployment]);

  const { rows } = chain;
  // Diverging rows first: they are the point of the comparison.
  const sorted = useMemo(() => [...rows].sort((a, b) =>
    Number(b.outcomes[0] !== b.outcomes[1]) - Number(a.outcomes[0] !== a.outcomes[1])), [rows]);
  const diverging = sorted.filter((r) => r.outcomes[0] !== r.outcomes[1]).length;
  const waiting = loading || (Boolean(data?.rows?.length) && rows.length === 0 && !chain.error);

  const sendDeposit = async () => {
    setSending(true); setTx(null); setSendError(null);
    try {
      const row = rows.find((r) => r.address === selected);
      const gateway = gatewayContract(deployment, await wallet.signer());
      const sent = await gateway.deposit(...verdictArgs(row), { value: parseEther(amount || "0") });
      const receipt = await sent.wait();
      setTx({ hash: sent.hash, block: receipt.blockNumber });
    } catch (err) {
      setSendError(err.shortMessage || err.message);
    } finally {
      setSending(false);
    }
  };

  if (error) return <ErrorCard error={error} />;

  return (
    <Section>
      <PageHead
        title="Gateway"
        sub={rows.length
          ? `${rows.length} verdicts from epoch ${data.epoch}; the two policies judge ${diverging} of them differently.`
          : "Same verdicts, two custody policies, side by side."}
        right={<WalletBar wallet={wallet} deployment={deployment} />}
      />
      <p className="note">
        HAIRCUT holds anything whose naive haircut taint reaches the hold line. CUSTODY holds on custody-weighted
        taint instead, lets exonerated (received-only) wallets through, and sends contested evidence to review.
        Every outcome below is computed by GuardedGateway.evaluate on MST testnet.
      </p>

      {waiting && <Empty>Asking GuardedGateway for outcomes…</Empty>}
      {chain.error && <p className="note down" role="alert">{chain.error}</p>}

      {rows.length > 0 && (
        <Reveal>
          <div className="policysplit">
            <PolicyColumn title="HAIRCUT policy" subtitle="naive haircut taint" policy={POLICY.HAIRCUT}
              rows={sorted} selected={selected} onSelect={setSelected} />
            <PolicyColumn title="CUSTODY policy" subtitle="custody-weighted, exonerated pass" policy={POLICY.CUSTODY}
              rows={sorted} selected={selected} onSelect={setSelected} />
          </div>
        </Reveal>
      )}

      <Card title="Live deposit" right={chain.policy != null ? <Tag t="on">gateway policy: {POLICY_LABEL[chain.policy]}</Tag> : null}>
        <p className="note">
          Sends a real transaction to GuardedGateway with the verdict and its proof. The contract re-verifies the
          proof against VerdictOracle, then accepts, holds in escrow or sends to review under its current policy
          (set by the owner). Deposits only work for the latest published epoch.
        </p>
        {chain.published === false && (
          <p className="note down">
            Epoch {data?.epoch} is not published on-chain yet, so the gateway would reject these proofs. Publish its
            root with VerdictOracle.publishEpoch first.
          </p>
        )}
        <div className="row" style={{ marginTop: "var(--s16)", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="inp" aria-label="Address" value={selected ?? ""} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Choose an address…</option>
            {sorted.map((r) => <option key={r.address} value={r.address}>{r.address}</option>)}
          </select>
          <input className="inp" aria-label="Amount in tMSTC" style={{ width: 120 }} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn primary" disabled={!selected || !wallet.connected || sending || !chain.published} onClick={sendDeposit}>
            {sending ? "Sending…" : "Deposit"}
          </button>
        </div>
        {!wallet.connected && <p className="note">Connect a wallet to send a deposit.</p>}
        {sendError && <p className="note down" role="alert">{sendError}</p>}
        {tx && (
          <p className="note up">
            Sent in block {tx.block} · <span className="mono">{tx.hash}</span>
            {explorerTxUrl(deployment, tx.hash) && (
              <> · <a className="lnk" href={explorerTxUrl(deployment, tx.hash)} target="_blank" rel="noreferrer">explorer</a></>
            )}
          </p>
        )}
      </Card>
    </Section>
  );
}
