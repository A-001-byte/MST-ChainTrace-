import { getGraphData } from "../services/api";
import { useApi } from "./useApi";

/** Node/edge JSON for the forensic graph. */
export const useGraphData = () => useApi("graph-data", getGraphData);
