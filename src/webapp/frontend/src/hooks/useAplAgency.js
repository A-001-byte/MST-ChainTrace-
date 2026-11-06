import { getAplAgency } from "../services/api";
import { useApi } from "./useApi";

/** Per-wallet custody-agency record. */
export const useAplAgency = (nodeId) =>
  useApi(nodeId ? `agency:${nodeId}` : null, () => getAplAgency(nodeId));
