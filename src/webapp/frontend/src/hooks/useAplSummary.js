import { getAplSummary } from "../services/api";
import { useApi } from "./useApi";

/** Manifest + measured headline stats for the Adversarial Provenance Layer. */
export const useAplSummary = () => useApi("apl-summary", getAplSummary);
