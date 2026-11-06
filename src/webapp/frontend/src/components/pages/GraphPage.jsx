import { lazy, Suspense, useMemo } from "react";
import { useGraphData } from "../../hooks/useGraphData";
import { CHART_COLORS as C } from "../../lib/chartColors";
import { CLUSTER_PALETTE } from "../../lib/clusterColors";
import { num } from "../../lib/format";
import { Card, Stat, Stats, PageHead, Empty, ErrorCard, Reveal } from "../ui";

// three.js is ~1MB; it only loads when this page is opened.
const ForensicGraph3D = lazy(() => import("../graph/ForensicGraph3D"));

function Key({ c, ring, children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <i style={{ width: 10, height: 10, borderRadius: "50%", background: ring ? "transparent" : c, border: ring ? `2px solid ${ring}` : "none", boxShadow: `0 0 8px ${ring ?? c}`, flex: "none" }} />
      {children}
    </span>
  );
}

/** Cluster colour is nominal, so the key shows the ramp rather than one swatch. */
function Ramp() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "inline-flex", gap: 3 }}>
        {CLUSTER_PALETTE.slice(0, 5).map((c) => <i key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />)}
      </span>
      Colour is the cluster
    </span>
  );
}

export default function GraphPage({ focus, onOpen }) {
  const { data, error, loading } = useGraphData();
  const m = useMemo(() => {
    if (!data) return null;
    const scored = data.nodes.filter((n) => !n.is_context);
    const clusters = new Set(scored.map((n) => n.cluster_id).filter((c) => c !== null && c !== undefined));
    return { scored: scored.length, clusters: clusters.size, geo: scored.filter((n) => n.geo_temporal_flag).length };
  }, [data]);

  if (loading) return <Empty>Building graph…</Empty>;
  if (error) return <ErrorCard error={error} />;

  return (
    <>
      <Reveal>
        <PageHead
          title="Forensic graph"
          sub="The neighbourhood around the flagged entities. Layout is force-directed — position carries no meaning beyond connectivity."
        />
      </Reveal>

      <Reveal delay={0.04}>
        <Stats>
          <Stat k="Nodes" v={num(data.nodes.length)} s={`${num(m.scored)} scored`} />
          <Stat k="Edges" v={num(data.edges.length)} s="connections" />
          <Stat k="Clusters" v={num(m.clusters)} s="co-spend groups" />
          <Stat k="Mismatches" v={num(m.geo)} t="down" s="geo-temporal" />
        </Stats>
      </Reveal>

      <Reveal delay={0.08}>
        <Card flush>
          <div className="viewport">
            <Suspense fallback={<div className="empty" style={{ padding: 24, height: "72vh" }}>Loading renderer…</div>}>
              <ForensicGraph3D data={data} focusNodeId={focus} onSelectNode={onOpen} height="72vh" />
            </Suspense>
            <div className="hudc" aria-hidden="true"><i /><i /><i /><i /></div>
            <div className="scan" aria-hidden="true" />
            <div className="readout" aria-hidden="true">
              <div><span className="rec" />Live render</div>
              <div>Nodes <b>{num(data.nodes.length)}</b> · edges <b>{num(data.edges.length)}</b></div>
              {focus && <div>Target <b>{focus.length > 22 ? `${focus.slice(0, 22)}…` : focus}</b></div>}
            </div>
            <div className="legend">
              <Ramp />
              <Key c={C.VIOLET}>Size is the risk score</Key>
              <Key ring={C.DOWN}>Geo-temporal mismatch</Key>
              <Key c="#3a4a68">Unscored context</Key>
              <span className="hint">Drag to orbit · scroll to zoom · hover to trace flow · click for the record</span>
            </div>
          </div>
        </Card>
      </Reveal>
    </>
  );
}
