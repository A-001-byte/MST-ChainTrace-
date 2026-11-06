/**
 * Investigator session, held by the server (src/webapp/auth.py): an HttpOnly session cookie
 * that every /api/* call carries. Nothing secret lives in this bundle — accounts and their
 * PBKDF2 hashes are server-side in src/webapp/investigators.json.
 */

let current = null;

/** The signed-in investigator as last confirmed by the server, or null. */
export const getSession = () => current;

/** Ask the server who (if anyone) this browser is signed in as. */
export async function loadSession() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    current = res.ok ? (await res.json()).investigator : null;
  } catch {
    current = null;
  }
  return current;
}

/**
 * Sign in. Resolves to the investigator; throws an Error with a user-facing message
 * otherwise (wrong credentials, malformed ID, or a temporary lock after repeated failures).
 */
export async function verifyInvestigator(id, passphrase) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, passphrase }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Sign-in failed (${res.status})`);
  current = body.investigator;
  return current;
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  current = null;
  window.location.reload();
}
