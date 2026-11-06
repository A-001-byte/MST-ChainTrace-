// Cluster ids are nominal labels, never a status. On the dark canvas they take a cool/warm
// spectral ramp — ion, ultraviolet, ember, orchid, sky, sand, teal — all separable against
// the void and deliberately clear of the crimson/mint that carry risk meaning.
const RAMP = ["#58e1ff", "#8f7bff", "#ff8a2a", "#d77bff", "#6fa8ff", "#e8d27a", "#3fc6c0"];

/** Stable tone for a cluster id; muted slate for unclustered / context. */
export function clusterColor(clusterId) {
  if (clusterId === null || clusterId === undefined) return "#3a4a68";
  const n = Number(clusterId);
  if (Number.isNaN(n)) return "#3a4a68";
  // spread ids across the ramp with a multiplicative hash so adjacent ids differ
  return RAMP[((n * 7) + (n >> 3)) % RAMP.length];
}

export { RAMP as CLUSTER_PALETTE };
