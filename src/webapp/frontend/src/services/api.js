async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  // Session expired or signed out elsewhere: reload into the sign-in screen rather than
  // leaving every panel showing an error.
  if (res.status === 401) {
    window.location.reload();
    throw new Error("Sign in required.");
  }
  if (!res.ok) {
    const message = body?.error || `Request to ${url} failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

export function getStats() {
  return fetchJson("/api/stats");
}

export function getAlerts() {
  return fetchJson("/api/alerts");
}

export function getEntity(nodeId) {
  return fetchJson(`/api/entity/${encodeURIComponent(nodeId)}`);
}

export function getKickDownDoors(nodeId) {
  return fetchJson(`/api/entity/${encodeURIComponent(nodeId)}/kick-down-doors`);
}

export function getGeo() {
  return fetchJson("/api/geo");
}
export function getGraphData() {
  return fetchJson("/api/graph-data");
}

// Superset of getEntity(): resolves any node_id, not just the top-N ranked alerts.
export function lookupEntity(nodeId) {
  return fetchJson(`/api/entity-lookup/${encodeURIComponent(nodeId)}`);
}

export function getEntityHours(nodeId) {
  return fetchJson(`/api/entity-hours/${encodeURIComponent(nodeId)}`);
}

export function getAplSummary() {
  return fetchJson("/api/apl/summary");
}

export function getAplAgency(nodeId) {
  return fetchJson(`/api/apl/agency/${encodeURIComponent(nodeId)}`);
}

// --- on-chain verdict layer -------------------------------------------------

export function getVerdict(address) {
  return fetchJson(`/api/verdict/${encodeURIComponent(address)}`);
}

export function getGatewayPreview() {
  return fetchJson("/api/verdict/gateway-preview");
}
