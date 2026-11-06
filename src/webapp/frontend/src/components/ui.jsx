import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { riskColor } from "../lib/chartColors";

/** Glass panel with HUD corner brackets (drawn in CSS). */
export function Card({ title, right, flush = false, band = false, className = "", style, children }) {
  return (
    <section className={`card${flush ? " flush" : ""}${band ? " band" : ""}${className ? ` ${className}` : ""}`} style={style}>
      {(title || right) && (
        <div className="ch">
          {title ? <h3>{title}</h3> : <span />}
          {right && <span className="meta">{right}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

const GLYPHS = "0123456789ABCDEF#%$";
const DECODE_MS = 650;

/**
 * Terminal-style reveal: a string value scrambles, then locks in left to right.
 * Anything that is not a plain string/number (a <Risk/> node, say) renders untouched.
 * Only the visible text animates — the final value is what screen readers get.
 */
export function Decode({ value }) {
  const rm = useReducedMotion();
  const text = typeof value === "string" || typeof value === "number" ? String(value) : null;
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (text === null || rm) return undefined;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / DECODE_MS);
      const locked = Math.floor(p * text.length);
      setShown(text.split("").map((ch, i) => (i < locked || !/[0-9A-Za-z]/.test(ch) ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join(""));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, rm]);

  if (text === null) return value;
  return <><span aria-hidden="true">{rm ? text : shown}</span><span className="sr-only">{text}</span></>;
}

/** Stat block: one-word label, then the number. Stats sit in a shared telemetry strip. */
export function Stat({ k, v, s, t }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={`v${t ? ` ${t}` : ""}`}><Decode value={v} /></div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}
export function Stats({ sm = false, className = "", children }) {
  return <div className={`stats${sm ? " sm" : ""}${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function PageHead({ title, sub, right }) {
  return (
    <div className="pagehead">
      {/* the eyebrow text comes from --kicker, set per section by App */}
      <div><div className="eyebrow label"><i /></div><h1>{title}</h1>{sub && <p className="lede">{sub}</p>}</div>
      {right}
    </div>
  );
}

export function Section({ title, right, children }) {
  return (
    <div className="section">
      {(title || right) && <div className="head"><div>{title && <h2>{title}</h2>}</div>{right}</div>}
      {children}
    </div>
  );
}

export function Tag({ t = "", children, title }) { return <span className={`tag${t ? ` ${t}` : ""}`} title={title}>{children}</span>; }

/** A risk score reads as a number in its semantic colour — red high, green low. */
export function Risk({ score }) {
  const ok = typeof score === "number" && !Number.isNaN(score);
  return <span className="num" style={{ color: ok ? riskColor(score) : "var(--ash)" }}>{ok ? score.toFixed(3) : "—"}</span>;
}
export function KV({ rows }) {
  return (
    <div className="kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <span className="k">{k}</span><span className="v">{v ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

/** Proportional bar for inside a table cell. Grows on transform, never width. */
export function Bar({ frac, color = "var(--violet)" }) {
  const rm = useReducedMotion();
  const f = Math.max(0, Math.min(1, Number(frac) || 0));
  return (
    <div className="bar">
      <motion.i initial={{ scaleX: rm ? f : 0 }} animate={{ scaleX: f }} transition={{ duration: rm ? 0 : 0.5, ease: [0.2, 0, 0, 1] }}
        style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${color} 35%, transparent), ${color})`, boxShadow: `0 0 10px ${color}`, width: "100%" }} />
    </div>
  );
}

export function Scroll({ max = 420, children }) { return <div className="scroll" style={{ maxHeight: max }}>{children}</div>; }
export function Empty({ children }) { return <div className="empty">{children}</div>; }
export function ErrorCard({ error }) { return <Card title="Unavailable"><p className="note">{String(error)}</p></Card>; }

/** Mount reveal: opacity + 6px, 0.2s. Respects reduced motion. */
export function Reveal({ children, delay = 0, style, className }) {
  const rm = useReducedMotion();
  return (
    <motion.div className={className} style={style}
      initial={{ opacity: 0, y: rm ? 0 : 6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: rm ? 0 : 0.2, ease: [0.4, 0, 0.2, 1], delay: rm ? 0 : delay }}>
      {children}
    </motion.div>
  );
}
