import { formatEther, id } from "ethers";
import { PageHead, Section, Card, Empty, ErrorCard, Stat, Stats, Tag } from "../ui";
import { useEpochs } from "../../hooks/useChain";
import { ZERO_ROOT } from "../../lib/chain/contracts";

const when = (seconds) =>
  seconds ? new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

const hash = (h) => (h && h !== ZERO_ROOT ? `${h.slice(0, 14)}…${h.slice(-6)}` : "—");

// contracts/scripts/demo-flow.ts publishes a one-leaf test tree under this manifest hash.
const DEMO_MANIFEST = id("demo-manifest");

/**
 * Epochs drawn as a chain rather than a table: each entry's prevRoot is shown against the
 * previous entry's root, so a broken or backfilled link is visible rather than implied.
 */
export default function EpochExplorerPage({ deployment }) {
  const { data, error, loading } = useEpochs(deployment);
  const local = deployment?.localEpoch;

  if (error) return <ErrorCard error={error} />;
  if (loading || !data) return <Empty>Reading epochs from VerdictOracle…</Empty>;

  const { rows, latest, challengeCount, publisherBond } = data;
  const localPublished = local && rows.some((r) => r.number === local.epoch && r.root.toLowerCase() === local.root.toLowerCase());

  return (
    <Section>
      <PageHead
        title="Epochs"
        sub="Every verdict root published to VerdictOracle on MST testnet, newest first. Each commits to the one before it."
      />

      <Stats>
        <Stat k="Published" v={rows.length} s={`latest epoch ${latest}`} />
        <Stat k="Challenges" v={challengeCount} s="filed against verdicts" />
        <Stat k="Bond" v={formatEther(publisherBond)} s="tMSTC the publisher has at stake" />
        <Stat k="Local" v={local ? `#${local.epoch}` : "—"} s={local ? `${local.leafCount} verdicts exported` : "nothing exported"} />
      </Stats>

      {local && !localPublished && (
        <Card band title={`Epoch ${local.epoch} — exported, not yet on-chain`} right={<Tag t="warn">Ready to publish</Tag>}>
          <dl className="kv">
            <span className="k">Root</span><span className="v mono">{local.root}</span>
            <span className="k">Verdicts</span><span className="v num">{local.leafCount}</span>
            <span className="k">Spec</span><span className="v">{local.spec}</span>
          </dl>
          <p className="note" style={{ marginTop: "var(--s16)" }}>
            Built from this pipeline&apos;s real alerts by <span className="mono">python -m scripts.export_verdict_set --epoch {local.epoch}</span>.
            It goes live when the publisher key calls <span className="mono">VerdictOracle.publishEpoch</span> with this root —
            until then Screen, Gateway and Appeals can check proofs locally but not on-chain.
          </p>
        </Card>
      )}

      {rows.length === 0 ? <Empty>No epochs published yet.</Empty> : (
        <div className="chainlist">
          {rows.map((e, i) => {
            const prev = rows[i + 1];
            const linked = prev ? e.prevRoot.toLowerCase() === prev.root.toLowerCase() : e.prevRoot === ZERO_ROOT;
            const demo = e.manifestHash === DEMO_MANIFEST;
            return (
              <Card key={e.number} className="epoch" title={`Epoch ${e.number}`}
                right={demo ? <Tag t="warn">Demo tree — not pipeline data</Tag> : <Tag t="on">Pipeline verdicts</Tag>}>
                <dl className="kv">
                  <span className="k">Published</span><span className="v">{when(e.publishedAt)}</span>
                  <span className="k">Root</span><span className="v mono">{hash(e.root)}</span>
                  <span className="k">Previous</span>
                  <span className="v mono">
                    {hash(e.prevRoot)}
                    {linked
                      ? <span className="meta up" style={{ marginLeft: 8 }}>linked</span>
                      : <span className="meta down" style={{ marginLeft: 8 }}>BROKEN LINK</span>}
                  </span>
                  <span className="k">Manifest</span><span className="v mono">{hash(e.manifestHash)}</span>
                </dl>
                {i < rows.length - 1 && <span className="link" aria-hidden="true" />}
              </Card>
            );
          })}
        </div>
      )}

      <p className="caption">
        A root proves the verdict set was fixed when it was published. Because the tree is sparse it proves
        absence too — but only for the exact address string hashed, and never that a wallet&apos;s owner is innocent.
      </p>
    </Section>
  );
}
