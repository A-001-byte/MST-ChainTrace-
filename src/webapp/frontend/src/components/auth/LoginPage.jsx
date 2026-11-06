import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "motion/react";
import { verifyInvestigator } from "../../lib/auth";
import { Icon, Mark } from "../shell/icons";

// three.js only loads for this screen and the graph/globe pages.
const BitcoinBackdrop = lazy(() => import("./BitcoinBackdrop"));

const STEPS = ["Verifying investigator ID", "Deriving session key", "Checking clearance"];
const STEP_MS = 420;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Watermelon "animated text": each character springs in, blurred to sharp. */
function SpringText({ text }) {
  const rm = useReducedMotion();
  if (rm) return <span aria-hidden="true">{text}</span>;
  return (
    <span style={{ display: "inline-flex", position: "relative", zIndex: 1 }} aria-hidden="true">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={text} style={{ display: "inline-flex" }}>
          {text.split("").map((ch, i) => (
            <motion.span key={i}
              initial={{ y: 10, opacity: 0, scale: 0.5, filter: "blur(2px)" }}
              animate={{ y: 0, opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ y: -10, opacity: 0, scale: 0.5, filter: "blur(2px)" }}
              transition={{ type: "spring", stiffness: 240, damping: 16, mass: 1.2, delay: i * 0.012 }}
              style={{ display: "inline-block", whiteSpace: ch === " " ? "pre" : undefined }}>
              {ch}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Investigator sign-in. One button carries the whole flow (Watermelon "run action
 * button"): idle → stepping through the checks → granted / denied.
 */
export default function LoginPage({ onAuthed }) {
  const rm = useReducedMotion();
  const [id, setId] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [state, setState] = useState("idle");   // idle | running | done | denied
  const [step, setStep] = useState(0);
  const [error, setError] = useState(null);
  const card = useAnimationControls();
  const idRef = useRef(null);
  useEffect(() => { idRef.current?.focus(); }, []);

  const busy = state === "running" || state === "done";

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(null); setState("running"); setStep(0);
    const t0 = performance.now();
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), STEP_MS);
    try {
      await nextFrame();                               // let the "running" state paint first
      const session = await verifyInvestigator(id, pass);
      await new Promise((r) => setTimeout(r, Math.max(0, STEP_MS * STEPS.length - (performance.now() - t0))));
      clearInterval(ticker);
      setState("done");
      setTimeout(() => onAuthed(session), rm ? 0 : 900);
    } catch (err) {
      clearInterval(ticker);
      setState("denied"); setError(err.message); setPass("");
      if (!rm) card.start({ x: [0, -10, 9, -6, 4, 0], transition: { duration: 0.42 } });
      setTimeout(() => setState("idle"), 1400);
    }
  };

  const label = state === "running" ? STEPS[step] : state === "done" ? "Access granted" : state === "denied" ? "Access denied" : "Authenticate";

  return (
    <div className="login">
      <Suspense fallback={null}><BitcoinBackdrop /></Suspense>
      <div className="vignette" />

      <motion.section className="pitch" initial={{ opacity: 0, y: rm ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}>
        <span className="wordmark"><span className="logo"><Mark size={22} /></span><span>Chain<i>Trace</i></span></span>
        <div>
          <div className="label" style={{ color: "var(--ember)" }}>Restricted system · Investigator access only</div>
          <h1>Trace the <em>coin</em>,<br />not the cover story.</h1>
          <p className="lede">
            ChainTrace fuses Bitcoin&apos;s network layer with its ledger into one entity graph, and ranks the
            wallets worth an investigator&apos;s time — each lead with its evidence attached.
          </p>
        </div>
        <div className="ticks">
          <span><b>2 layers</b>network + ledger</span>
          <span><b>Offline</b>no external calls</span>
          <span><b>Explainable</b>every flag has a reason</span>
        </div>
      </motion.section>

      <motion.div animate={card} style={{ width: "100%", display: "flex", justifyContent: "center" }}>
        <motion.div className="authcard" initial={{ opacity: 0, y: rm ? 0 : 18, scale: rm ? 1 : 0.98 }}
          animate={state === "done" && !rm
            ? { opacity: 0, y: -8, scale: 1.02, transition: { delay: 0.55, duration: 0.35 } }
            : { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: [0.2, 0, 0, 1], delay: 0.1 } }}>
          <div className="seal">
            <span className="logo"><Icon name="badge" size={24} /></span>
            <div>
              <h2>Investigator sign-in</h2>
              <p className="sub">Authorised personnel only.</p>
            </div>
          </div>

          <form onSubmit={submit} noValidate>
            <div>
              <div className={`field${error ? " err" : ""}`}>
                <input ref={idRef} id="inv-id" name="username" autoComplete="username" placeholder=" " spellCheck={false}
                  value={id} onChange={(e) => setId(e.target.value.toUpperCase())} aria-describedby="inv-id-hint"
                  aria-invalid={!!error} disabled={busy} />
                <label htmlFor="inv-id">Investigator ID</label>
                <Icon name="badge" size={18} />
              </div>
              <div className="fieldhint" id="inv-id-hint">Format NTRO-CYB-0000</div>
            </div>

            <div>
              <div className={`field${error ? " err" : ""}`}>
                <input id="inv-pass" name="password" type={show ? "text" : "password"} autoComplete="current-password" placeholder=" "
                  value={pass} onChange={(e) => setPass(e.target.value)} aria-invalid={!!error}
                  onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)} disabled={busy} />
                <label htmlFor="inv-pass">Passphrase</label>
                <Icon name="key" size={18} />
                <button type="button" className="iconbtn eye" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide passphrase" : "Show passphrase"}>
                  <Icon name={show ? "eyeoff" : "eye"} size={17} />
                </button>
              </div>
              {caps && <div className="fieldhint warn">Caps Lock is on</div>}
            </div>

            <AnimatePresence initial={false}>
              {error && (
                <motion.p className="autherr" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Icon name="alert" size={16} style={{ flex: "none", marginTop: 1 }} />{error}
                </motion.p>
              )}
            </AnimatePresence>

            <button type="submit" className={`runbtn ${state}`} disabled={busy}>
              {state === "running" && <span className="spin" aria-hidden="true" />}
              <SpringText text={label} />
              <span className="sr-only" aria-live="polite">{label}</span>
              {state === "running" && (
                <motion.i className="prog" initial={{ scaleX: 0 }} animate={{ scaleX: (step + 1) / STEPS.length }} transition={{ duration: 0.35 }} />
              )}
            </button>
          </form>

          <div className="authfoot"><span>Session ends when this tab closes</span><span>SIH26146</span></div>
        </motion.div>
      </motion.div>
    </div>
  );
}
