export const SECTIONS = [
  { id: "overview", key: "F1", label: "Overview" },
  { id: "alerts", key: "F2", label: "Alerts" },
  { id: "graph", key: "F3", label: "Graph" },
  { id: "kickdown", key: "F4", label: "Kick Down Doors" },
  { id: "provenance", key: "F5", label: "Provenance" },
  { id: "geo", key: "F6", label: "Geo" },
  { id: "pattern", key: "F7", label: "Pattern" },
  { id: "system", key: "F8", label: "System" },
];

/** On-chain verdict layer. Grouped separately in the nav because these pages read and
 *  write a chain, unlike everything above them, which reads local pipeline output. */
export const CHAIN_SECTIONS = [
  { id: "screen", label: "Screen" },
  { id: "appeal", label: "Appeals" },
  { id: "gateway", label: "Gateway" },
  { id: "epochs", label: "Epochs" },
];

export const ALL_SECTION_IDS = [...SECTIONS, ...CHAIN_SECTIONS].map((s) => s.id);

/** Human label for any section id — used by the breadcrumb and the page eyebrow. */
export function sectionMeta(id) {
  const s = SECTIONS.find((x) => x.id === id);
  if (s) return { group: "Intelligence", label: s.label, key: s.key };
  const c = CHAIN_SECTIONS.find((x) => x.id === id);
  return { group: "On-chain", label: c?.label ?? id, key: null };
}
