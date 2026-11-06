import { getStats } from "../services/api";
import { useApi } from "./useApi";

export const useStats = () => useApi("stats", getStats);
