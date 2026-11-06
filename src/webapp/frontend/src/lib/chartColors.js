/** "Deep Signal" palette for data marks. Ion is the single interactive accent; crimson and
 *  mint carry risk semantics only. Structural greys are cool blue-slates on the dark canvas.
 *  Key names are kept from the earlier palette so call sites read the same.
 *  Kept out of charts.jsx so that file only exports components. */
export const CHART_COLORS = {
  VIOLET: "#58e1ff", VIOLET_DEEP: "#9aefff", LILAC: "rgba(88,225,255,0.14)",
  INK: "#e4ecf8", GRAPHITE: "#9aa8c2", SLATE: "#8394b5", ASH: "#62708b",
  LINE: "#2a3a58", HAIR: "rgba(126,170,255,0.10)", LINEN: "rgba(126,170,255,0.06)",
  UP: "#3ce8a0", DOWN: "#ff4d7d", EMBER: "#ff8a2a", UV: "#8f7bff",
};

/** Risk score -> data colour. High = crimson, medium = amber, low = mint. */
export const riskColor = (r) =>
  (typeof r !== "number" || Number.isNaN(r) ? "#62708b" : r >= 0.6 ? "#ff4d7d" : r >= 0.4 ? "#ffc15a" : "#3ce8a0");
