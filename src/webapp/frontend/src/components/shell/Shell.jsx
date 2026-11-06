import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useStats } from "../../hooks/useStats";
import { SECTIONS, CHAIN_SECTIONS, sectionMeta } from "../../lib/sections";
import { num } from "../../lib/format";
import { getSession, signOut } from "../../lib/auth";
import { Icon, Mark } from "./icons";

const PILL_SPRING = { type: "spring", stiffness: 380, damping: 32, mass: 0.8 };

function NavButton({ id, label, on, onClick, kbd, pillId, collapsed }) {
  const rm = useReducedMotion();
  return (
    <button className={`navbtn${on ? " on" : ""}`} onClick={onClick}
      aria-current={on ? "page" : undefined} title={collapsed ? label : undefined}>
      {on && <motion.span layoutId={pillId} className="navpill" transition={rm ? { duration: 0 } : PILL_SPRING} />}
      <Icon name={id} size={18} />
      <span className="navtxt">{label}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

/**
 * Watermelon-style sidebar: brand, grouped nav with a spring-animated active pill, the
 * on-chain pages nested under one expandable entry, and the signed-in investigator.
 */
export function Sidebar({ active, onSelect, collapsed, onToggle, mobileOpen, onCloseMobile }) {
  const session = getSession();
  const onChain = CHAIN_SECTIONS.some((s) => s.id === active);
  const [chainOpen, setChainOpen] = useState(true);
  const min = collapsed && !mobileOpen;
  const pick = (id) => { onSelect(id); onCloseMobile?.(); };
  const initials = session?.name?.split(" ").map((w) => w[0]).join("").slice(0, 2) ?? "—";

  const onChainClick = () => {
    if (!onChain) { pick(CHAIN_SECTIONS[0].id); setChainOpen(true); } else setChainOpen((o) => !o);
  };

  return (
    <aside className={`side${min ? " min" : ""}${mobileOpen ? " mob" : ""}`} aria-label="Primary">
      <div className="brandrow">
        <span className="logo"><Mark size={22} /></span>
        <span className="wm"><span className="wordmark">Chain<i>Trace</i></span><small>Forensic console</small></span>
        <button className="iconbtn collapse" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <Icon name="collapse" size={17} style={{ transform: collapsed ? "scaleX(-1)" : undefined }} />
        </button>
      </div>

      <LayoutGroup>
        <nav className="scrollnav">
          <div className="grp">Intelligence</div>
          {SECTIONS.map((s) => (
            <NavButton key={s.id} id={s.id} label={s.label} kbd={s.key} on={active === s.id} collapsed={min}
              pillId="navpill" onClick={() => pick(s.id)} />
          ))}

          <div className="grp">Verdict layer</div>
          <button className={`navbtn chain${onChain ? " on" : ""}`} aria-expanded={chainOpen}
            title={min ? "On-chain" : undefined} onClick={onChainClick}>
            <Icon name="chain" size={18} />
            <span className="navtxt">On-chain</span>
            <Icon name="chev" size={14} className={`chev${chainOpen ? " open" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {chainOpen && (
              <motion.div className="subnav" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }} style={{ overflow: "hidden" }}>
                {CHAIN_SECTIONS.map((s) => (
                  <NavButton key={s.id} id={s.id} label={s.label} on={active === s.id} collapsed={min}
                    pillId="subpill" onClick={() => pick(s.id)} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </nav>
      </LayoutGroup>

      <div className="who">
        <span className="av" aria-hidden="true">{initials}</span>
        <span className="meta-col">
          <b title={session?.unit}>{session?.name ?? "Investigator"}</b>
          <span>{session?.id} · {session?.clearance}</span>
        </span>
        <button className="iconbtn danger" onClick={signOut} aria-label="Sign out" title="Sign out">
          <Icon name="logout" size={17} />
        </button>
      </div>
    </aside>
  );
}

/** Entity lookup — a SEARCH over already-computed output via /api/entity-lookup.
 *  Not an ingestion control; nothing here re-runs the pipeline.
 *  Watermelon "morphing button": a pill that opens into a field. */
function Lookup({ onSubmit }) {
  const rm = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const submit = (e) => {
    e.preventDefault();
    if (!open) { setOpen(true); return; }
    const id = v.trim();
    if (id) { onSubmit?.(id); setV(""); setOpen(false); }
  };
  return (
    <motion.form layout transition={rm ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 28 }}
      className={`lookup${open ? " open" : ""}`} onSubmit={submit} style={{ width: open ? 300 : "auto" }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && !v.trim()) setOpen(false); }}>
      {open && (
        <input ref={inputRef} className="mono" aria-label="Look up an entity by node id" placeholder="wallet_… / tx_…"
          value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      )}
      <button type="submit" className="lk" disabled={open && !v.trim()}>
        <Icon name="search" size={15} />{open ? "Trace" : "Look up"}
      </button>
    </motion.form>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="clock">{now.toISOString().slice(11, 19)}<i>UTC</i></span>;
}

/** Floating HUD bar at the top of the content panel. */
export function HudBar({ active, onLookup, onMenu }) {
  const { data, error } = useStats();
  const mock = data?.data_source_label?.toLowerCase().includes("mock");
  const m = sectionMeta(active);
  return (
    <header className="hudbar">
      <button className="iconbtn menubtn" onClick={onMenu} aria-label="Open navigation"><Icon name="menu" /></button>
      <span className="crumbs"><span>{m.group}</span><span className="sl">/</span><b>{m.label}</b></span>
      <span className="grow" />
      <Lookup onSubmit={onLookup} />
      <Clock />
      <span className={`status${error || mock ? " warn" : ""}`}><i />{error ? "Offline" : mock ? "Mock data" : "Live"}</span>
    </header>
  );
}

/** Sub-nav for the on-chain group — Watermelon "fluid tabs": the ember pill slides. */
export function ChainNav({ active, onSelect }) {
  const rm = useReducedMotion();
  return (
    <div className="pills fluid chainnav" role="tablist" aria-label="On-chain verdict pages">
      {CHAIN_SECTIONS.map((s) => (
        <button key={s.id} role="tab" aria-selected={active === s.id}
          className={active === s.id ? "on" : ""} onClick={() => onSelect(s.id)}>
          {active === s.id && <motion.i layoutId="chainpill" className="pillbg" transition={rm ? { duration: 0 } : PILL_SPRING} />}
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
}

export function FootBar({ onChain = false }) {
  const { data } = useStats();
  return (
    <footer className="footbar">
      <div className="inner">
        <span>Source <b>{data?.data_source_label ?? "…"}</b></span>
        <span>Transactions <b>{num(data?.total_transactions)}</b></span>
        <span>Flagged <b>{num(data?.total_flagged)}</b></span>
        <span style={{ marginLeft: "auto" }}>
          {onChain
            ? "This section talks to a chain RPC and your wallet · not a real-world identity claim"
            : "Runs offline · no external calls at runtime · not a real-world identity claim"}
        </span>
      </div>
    </footer>
  );
}
