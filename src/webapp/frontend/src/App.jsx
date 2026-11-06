import { useEffect, useState } from "react";
import { Sidebar, HudBar, FootBar, ChainNav } from "./components/shell/Shell";
import { SECTIONS, CHAIN_SECTIONS, sectionMeta } from "./lib/sections";
import EntityDrawer from "./components/EntityDrawer";
import OverviewPage from "./components/pages/OverviewPage";
import AlertsPage from "./components/pages/AlertsPage";
import GraphPage from "./components/pages/GraphPage";
import KickDownPage from "./components/pages/KickDownPage";
import ProvenancePage from "./components/pages/ProvenancePage";
import GeoPage from "./components/pages/GeoPage";
import PatternPage from "./components/pages/PatternPage";
import SystemPage from "./components/pages/SystemPage";
import ScreenPage from "./components/pages/ScreenPage";
import AppealPage from "./components/pages/AppealPage";
import GatewayDemoPage from "./components/pages/GatewayDemoPage";
import EpochExplorerPage from "./components/pages/EpochExplorerPage";
import { useDeployment } from "./hooks/useChain";
import { useWallet } from "./hooks/useWallet";

const CHAIN_IDS = new Set(CHAIN_SECTIONS.map((s) => s.id));

export default function App() {
  const [active, setActive] = useState("overview");
  const [selected, setSelected] = useState(null); // graph focus / KDD target
  const [drawer, setDrawer] = useState(null);     // open record, tracked separately
  const [appealTarget, setAppealTarget] = useState(null);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("ct.side") === "min"; } catch { return false; } });
  const [mobileNav, setMobileNav] = useState(false);
  const toggleSide = () => setCollapsed((c) => { try { localStorage.setItem("ct.side", c ? "" : "min"); } catch { /* per-viewer nicety only */ } return !c; });

  // Chain state is lifted so wallet connection survives moving between chain pages.
  const { data: deployment, error: deploymentError } = useDeployment();
  const wallet = useWallet();

  const open = (id) => { setSelected(id); setDrawer(id); };
  const toGraph = (id) => { setSelected(id); setDrawer(null); setActive("graph"); };
  const toAppeal = (verdict) => { setAppealTarget(verdict); setActive("appeal"); };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setDrawer(null); return; }
      const s = SECTIONS.find((x) => x.key === e.key);
      if (s) { e.preventDefault(); setActive(s.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onChain = CHAIN_IDS.has(active);
  const meta = sectionMeta(active);
  const kicker = `"${meta.key ? `${meta.key} · ` : "On-chain · "}${meta.label}"`;

  return (
    <div className="shell">
      <Sidebar active={active} onSelect={setActive} collapsed={collapsed} onToggle={toggleSide}
        mobileOpen={mobileNav} onCloseMobile={() => setMobileNav(false)} />
      {mobileNav && <div className="scrim" onClick={() => setMobileNav(false)} aria-hidden="true" />}
      <div className="panel">
        <HudBar active={active} onLookup={open} onMenu={() => setMobileNav((o) => !o)} />
        <main className="page" style={{ "--kicker": kicker }}>
          {active === "overview" && <OverviewPage onOpen={open} onNav={setActive} />}
          {active === "alerts" && <AlertsPage onOpen={open} selected={selected} />}
          {active === "graph" && <GraphPage focus={selected} onOpen={open} />}
          {active === "kickdown" && <KickDownPage selected={selected} onSelect={setSelected} />}
          {active === "provenance" && <ProvenancePage />}
          {active === "geo" && <GeoPage />}
          {active === "pattern" && <PatternPage />}
          {active === "system" && <SystemPage />}

          {onChain && <ChainNav active={active} onSelect={setActive} />}
          {onChain && deploymentError && (
            <div className="card"><p className="note down">
              No chain deployment available: {deploymentError}
            </p></div>
          )}
          {active === "screen" && <ScreenPage deployment={deployment} wallet={wallet} onChallenge={toAppeal} />}
          {active === "appeal" && <AppealPage deployment={deployment} wallet={wallet} target={appealTarget} />}
          {active === "gateway" && <GatewayDemoPage deployment={deployment} wallet={wallet} />}
          {active === "epochs" && <EpochExplorerPage deployment={deployment} />}
        </main>
        <FootBar onChain={onChain} />
      </div>
      <EntityDrawer nodeId={drawer} onClose={() => setDrawer(null)} onGraph={toGraph} />
    </div>
  );
}
