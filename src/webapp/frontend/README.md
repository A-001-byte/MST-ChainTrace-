# ChainTrace console (frontend)

React 19 + Vite. Built into `../static/app/`, which the Flask server serves at `/app/`.

```bash
npm install
npm run dev        # http://localhost:5173/app/ — proxies /api to the Flask server on :5000
npm run build      # writes ../static/app/ (commit it: Flask serves the built bundle)
npm test           # vitest: browser sparse-Merkle verifier against the shared golden vectors
npm run lint
node scripts/smoke.mjs   # end-to-end: sign in and open every page against a running server
```

## Structure

```
src/main.jsx              asks the server for a session, then shows LoginPage or App
src/App.jsx               section routing (F1–F8 + on-chain), drawer, wallet state
src/components/shell/     sidebar, HUD bar, icons
src/components/pages/     one file per section
src/components/graph/     3D forensic graph (3d-force-graph + bloom)
src/components/geo/       geo-temporal globe (three.js) and the claimed-vs-actual explainer
src/components/auth/      sign-in page and its animated backdrop
src/components/verdicts/  verdict card, wallet bar
src/hooks/useApi.js       shared fetch: one request per key per session, derived loading state
src/lib/chain/            contract bindings (VerdictOracle, GuardedGateway, ClearanceSBT), wallet
src/lib/verify/smt.js     SHARED_SPEC_v1 sparse-Merkle verifier (port of the reference verifier)
src/index.css             the whole design system ("Deep Signal" tokens + components)
```

## Investigator sign-in

Sign-in is enforced by the server (`src/webapp/auth.py`): every `/api/*` call needs the HttpOnly
session cookie it sets. Accounts are salted PBKDF2-SHA256 hashes in `src/webapp/investigators.json`;
nothing secret ships in this bundle. Sessions last 8 hours; five failed attempts lock an ID for 30s.

Demo accounts (replace before any real use):

| Investigator ID | Passphrase        | Role               | Clearance |
|-----------------|-------------------|--------------------|-----------|
| NTRO-CYB-4471   | Tr4ce-the-Chain!  | Lead Analyst       | L3        |
| NTRO-CYB-2093   | Ledger$ight-09    | Field Investigator | L2        |
| NTRO-CYB-0007   | Satoshi-Hunt-7    | Duty Officer       | L4        |

Add or rotate an account from the repo root: `python -m src.webapp.auth add NTRO-CYB-1234`.
