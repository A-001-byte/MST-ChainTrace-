import { getEntityHours } from "../services/api";
import { useApi } from "./useApi";

/** Activity-hour histogram for one entity. */
export const useEntityHours = (nodeId) =>
  useApi(nodeId ? `hours:${nodeId}` : null, () => getEntityHours(nodeId));
