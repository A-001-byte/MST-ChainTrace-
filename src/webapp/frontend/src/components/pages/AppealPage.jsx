import { useState } from "react";
import { formatEther, parseEther } from "ethers";
import { PageHead, Section, Card, Empty, ErrorCard, Tag } from "../ui";
import WalletBar from "../verdicts/WalletBar";
import { useChallenges } from "../../hooks/useChain";
import { getVerdict } from "../../services/api";
import { oracleContract, publishedRoot, readProvider, explorerTxUrl } from "../../lib/chain/contracts";

const STAGES = ["Submitted", "Awaiting arbiter", "Resolved"];

const when = (s) => (s ? new Date(s * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-4)}` : "—");

/** Stage comes from committed state only: resolved on-chain, or still waiting on the arbiter. */
function Timeline({ challenge }) {
  const stage = challenge.resolved ? 2 : 1;
  return (
    <div className="timeline" role="list">
      {STAGES.map((label, i) => (
        <div key={label} role="listitem" className={`step${i <= stage ? " on" : ""}${i === stage ? " now" : ""}`}>
          <i aria-hidden="true" />
          <span>
            {label}
            {i === 2 && challenge.resolved && challenge.upheld != null && (
              <b className={challenge.upheld ? " up" : " down"}> · {challenge.upheld ? "Upheld" : "Rejected"}</b>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AppealPage({ deployment, wallet, target }) {
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading } = useChallenges(deployment, refresh);
  const [addr, setAddr] = useState(target?.address ?? "");
  const [reason, setReason] = useState("");
  const [bond, setBond] = useState("0.01");
  const [tx, setTx] = useState(null);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSending(true); setSubmitError(null); setTx(null);
    try {
      // A challenge names the exact leaf being disputed, so look the verdict up first.
      const v = await getVerdict(addr.trim());
      if (!v.found) throw new Error(`No verdict for ${v.address} in epoch ${v.epoch} — nothing to challenge.`);
      const reader = oracleContract(deployment, readProvider(deployment));
      if (!(await publishedRoot(reader, v.epoch))) {
        throw new Error(`Epoch ${v.epoch} is exported but not yet published on MST testnet, so VerdictOracle has nothing to challenge. `
          + "Publish it (in contracts/: npx hardhat run scripts/publish-real-epoch.ts --network mst), then challenge within the window.");
      }
      // The contract only takes challenges for challengeWindow seconds after publishing; check first so no gas is wasted.
      const [epochInfo, windowSec] = await Promise.all([reader.epochData(v.epoch), reader.challengeWindow()]);
      const closes = Number(epochInfo.publishedAt) + Number(windowSec);
      if (Date.now() / 1000 > closes) {
        throw new Error(`The challenge window for epoch ${v.epoch} closed at ${new Date(closes * 1000).toLocaleTimeString()} `
          + `(${Number(windowSec) / 60} min after publishing). Publish a new epoch to reopen it.`);
      }
      const oracle = oracleContract(deployment, await wallet.signer());
      const sent = await oracle.challenge(v.epoch, v.key, v.leaf, reason.trim(), { value: parseEther(bond || "0") });
      const receipt = await sent.wait();
      setTx({ hash: sent.hash, block: receipt.blockNumber });
      setRefresh((r) => r + 1);
      setReason("");
    } catch (err) {
      setSubmitError(err.shortMessage || err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Section>
      <PageHead
        title="Appeals"
        sub="Challenge a committed verdict by posting a bond. If the arbiter upholds it, the verdict is marked overturned on VerdictOracle — and the gateway accepts that wallet under both policies."
        right={<WalletBar wallet={wallet} deployment={deployment} />}
      />

      <Card title="Challenge a verdict">
        <form onSubmit={submit} className="screenform">
          <label className="label" htmlFor="appeal-addr">Bitcoin address or node id</label>
          <input id="appeal-addr" className="inp mono" value={addr} autoComplete="off"
            placeholder="wallet_…" onChange={(e) => setAddr(e.target.value)} />

          <label className="label" htmlFor="appeal-reason" style={{ marginTop: "var(--s12)" }}>Reason</label>
          <textarea id="appeal-reason" className="inp" rows={3} value={reason}
            placeholder="What is wrong with this verdict, and on what evidence? (stored on-chain as reasonURI)"
            onChange={(e) => setReason(e.target.value)} />

          <label className="label" htmlFor="appeal-bond" style={{ marginTop: "var(--s12)" }}>Bond (tMSTC)</label>
          <div className="row">
            <input id="appeal-bond" className="inp" style={{ width: 140 }} value={bond} onChange={(e) => setBond(e.target.value)} />
            <button className="btn primary" type="submit" disabled={!addr.trim() || !reason.trim() || !wallet.connected || sending}>
              {sending ? "Submitting…" : "Submit challenge"}
            </button>
          </div>
          <p className="note">
            Upheld: your bond comes back plus a reward from the publisher&apos;s bond. Rejected: the bond goes to the
            publisher. Payouts are claimed with withdrawPayout. {!wallet.connected && "Connect a wallet to submit."}
          </p>
          {submitError && <p className="note down" role="alert">{submitError}</p>}
          {tx && (
            <p className="note up">
              Submitted in block {tx.block} · <span className="mono">{tx.hash}</span>
              {explorerTxUrl(deployment, tx.hash) && (
                <> · <a className="lnk" href={explorerTxUrl(deployment, tx.hash)} target="_blank" rel="noreferrer">explorer</a></>
              )}
            </p>
          )}
        </form>
      </Card>

      {error && <ErrorCard error={error} />}
      {loading && !error && <Empty>Reading challenges from VerdictOracle…</Empty>}
      {data?.length === 0 && <Empty>No challenges submitted yet.</Empty>}

      {data?.map((c) => (
        <Card key={c.id} title={`Challenge #${c.id}`}
          right={<Tag t={c.resolved ? (c.upheld ? "lo" : "hi") : "warn"}>{c.resolved ? (c.upheld == null ? "Resolved" : c.upheld ? "Upheld" : "Rejected") : "Open"}</Tag>}>
          <Timeline challenge={c} />
          <dl className="kv" style={{ marginTop: "var(--s16)" }}>
            <span className="k">Epoch</span><span className="v">{c.epoch}</span>
            <span className="k">Key</span><span className="v mono">{short(c.key)}</span>
            <span className="k">Leaf</span><span className="v mono">{short(c.leafHash)}</span>
            <span className="k">Challenger</span><span className="v mono">{short(c.challenger)}</span>
            <span className="k">Bond</span><span className="v">{formatEther(c.bond)} tMSTC</span>
            <span className="k">Challenge window</span><span className="v">closes {when(c.windowEnds)}</span>
          </dl>
          {c.reason && <p className="note" style={{ marginTop: "var(--s12)" }}>{c.reason}</p>}
        </Card>
      ))}
    </Section>
  );
}
