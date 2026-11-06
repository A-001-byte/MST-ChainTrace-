import { getAlerts } from "../services/api";
import { useApi } from "./useApi";

export const useAlerts = () => useApi("alerts", getAlerts);
