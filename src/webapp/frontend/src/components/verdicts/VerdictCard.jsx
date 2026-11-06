import { motion, useReducedMotion } from "motion/react";
import { Card, Tag } from "../ui";

const pct = (v) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—");

const BAND_TONE = { High: "down", Medium: "", Low: "up", Unscored: "" };

/**
 * The three-point interval, drawn as one track so the SPAN is the thing you read.
 * Haircut sits at one end, fragile-merges-removed at the other; the distance between them
 * is how much of the score survives the adversarial ablation.
 */
function Interval({ interval }) {
  const rm = useReducedMotion();
  const { haircut, custodyWeighted, fragileMergesRemoved } = interval;
  const points = [
    { key: "haircut", label: "Haircut", value: haircut, color: "var(--down)" },
    { key: "cwt", label: "Custody-weighted", value: custodyWeighted, color: "var(--violet)" },
    { key: "ablated", label: "Fragile merges removed", value: fragileMergesRemoved, color: "var(--up)" },
  ];
  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));

  return (
    <div className="interval">
      <div className="track" role="img"
        aria-label={`Risk interval from ${pct(lo)} to ${pct(hi)}. Haircut ${pct(haircut)}, custody-weighted ${pct(custodyWeighted)}, fragile merges removed ${pct(fragileMergesRemoved)}.`}>
        <motion.i className="span"
          initial={{ scaleX: rm ? 1 : 0 }} animate={{ scaleX: 1 }}
          transition={{ duration: rm ? 0 : 0.24, ease: [0.4, 0, 0.2, 1] }}
          style={{ left: `${lo * 100}%`, width: `${Math.max(hi - lo, 0.004) * 100}%` }} />
        {points.map((p) => (
          <span key={p.key} className="pt" style={{ left: `${p.value * 100}%`, background: p.color }} />
        ))}
      </div>
      <dl className="pts">
        {points.map((p) => (
          <div key={p.key}>
            <dt><i style={{ background: p.color }} />{p.label}</dt>
            <dd className="num">{pct(p.value)}</dd>
          </div>
        ))}
      </dl>
      {/* Without this the three markers silently stack and the card reads as a broken
          chart. Saying which case it is turns a degenerate span into information. */}
      <p className="meta">
        {hi - lo < 0.005
          ? "All three measures agree — custody weighting does not move this score."
          : `Custody weighting moves this score by ${((hi - lo) * 100).toFixed(1)} points.`}
      </p>
    </div>
  );
}

/**
 * Verification, reported as it actually stands. Three honest states:
 *   published + both checks agree  -> verified on-chain
 *   published + a check fails      -> FAILED (and a disagreement is the loudest state)
 *   epoch not published            -> only the local export was checked; nothing on-chain yet
 */
export function VerificationRow({ verification: v, epoch, explorerUrl }) {
  if (!v) return null;

  if (v.agree === false) {
    return (
      <div className="verify disagree" role="alert">
        <b>Verification disagreement</b>
        <span>
          This browser says <b>{String(v.local)}</b>, VerdictOracle says <b>{String(v.onChain)}</b>.
          Do not rely on this result until the mismatch is explained.
        </span>
      </div>
    );
  }

  if (v.published === false) {
    return (
      <div className="verify unknown">
        <span className="res"><i aria-hidden="true" />Epoch {epoch} not published on-chain yet</span>
        <span className="meta">
          proof {v.localExport ? "checks out" : "does NOT check out"} against the local export
          {v.exportedRoot && <span className="mono"> · root {v.exportedRoot.slice(0, 10)}…</span>}
        </span>
        <span className="meta">It becomes verifiable on-chain once the publisher calls VerdictOracle.publishEpoch with this root.</span>
      </div>
    );
  }

  const ok = v.local === true && v.onChain === true;
  const bad = v.local === false || v.onChain === false || v.leafMatches === false;
  return (
    <div className={`verify ${ok ? "ok" : bad ? "bad" : "unknown"}`}>
      <span className="res">
        <i aria-hidden="true" />
        {ok ? `Verified on-chain · epoch ${epoch}` : bad ? "Verification FAILED" : "Partially verified"}
      </span>
      <span className="meta mono">root {v.chainRoot ? `${v.chainRoot.slice(0, 10)}…` : "—"}</span>
      <span className="meta">
        browser {v.local == null ? "n/a" : String(v.local)} · VerdictOracle{" "}
        {v.onChain == null ? (v.onChainError ? "unreachable" : "n/a") : String(v.onChain)}
      </span>
      {explorerUrl && <a className="lnk" href={explorerUrl} target="_blank" rel="noreferrer">View on explorer</a>}
      {v.onChainError && <span className="meta down">chain read failed: {v.onChainError}</span>}
    </div>
  );
}

export default function VerdictCard({ verdict, explorerUrl, onChallenge }) {
  if (!verdict) return null;
  const v = verdict.verification;

  if (!verdict.found) {
    return (
      <Card title="No verdict">
        <p className="lede" style={{ marginBottom: "var(--s16)" }}>
          <span className="mono">{verdict.address}</span> has no leaf in epoch {verdict.epoch}.
        </p>
        <p className="note">{verdict.note}</p>
        <VerificationRow verification={v} epoch={verdict.epoch} explorerUrl={explorerUrl} />
        <p className="caption">
          The sparse Merkle tree proves this key holds the empty leaf — a real proof of absence for this exact
          address string, not merely a failed lookup. It is not a statement that the owner is innocent.
        </p>
      </Card>
    );
  }

  const ctx = verdict.context ?? {};
  const tone = BAND_TONE[verdict.bandLabel] ?? "";

  return (
    <Card
      title={<span className="mono">{ctx.nodeId ?? verdict.address}</span>}
      right={v?.overturned ? <Tag t="hi">OVERTURNED</Tag> : ctx.source === "gateway" ? <Tag>Gateway demo</Tag> : null}
    >
      <div className="vhead">
        <div>
          <div className="label">Band</div>
          <div className={`band ${tone}`}>{verdict.bandLabel}</div>
        </div>
        <div>
          <div className="label">Risk</div>
          <div className="band">{(verdict.fields.riskBps / 100).toFixed(2)}%</div>
        </div>
        <div>
          <div className="label">Intent</div>
          <Tag t="on">{verdict.intentLabel}</Tag>
          {ctx.intentConfidence != null && (
            <span className="meta" style={{ marginLeft: 8 }}>{(ctx.intentConfidence * 100).toFixed(0)}% conf</span>
          )}
        </div>
      </div>

      <Interval interval={verdict.interval} />

      {verdict.flags.length > 0 && (
        <div className="chips">
          {verdict.flags.map((f) => <Tag key={f} t="warn">{f}</Tag>)}
        </div>
      )}

      {ctx.reason && <p className="note">{ctx.reason}</p>}
      {ctx.geoTemporalReason && <p className="note">{ctx.geoTemporalReason}</p>}

      <VerificationRow verification={v} epoch={verdict.epoch} explorerUrl={explorerUrl} />

      <p className="caption">
        The chain proves this verdict was committed and not altered. It does not prove the
        verdict is correct.
      </p>

      {onChallenge && (
        <button className="btn sm" onClick={() => onChallenge(verdict)} style={{ marginTop: "var(--s16)" }}>
          Challenge this verdict
        </button>
      )}
    </Card>
  );
}
