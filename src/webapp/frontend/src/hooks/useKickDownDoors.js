import { getKickDownDoors } from "../services/api";
import { useApi } from "./useApi";

/** Local disruption analysis around one entity. */
export const useKickDownDoors = (nodeId) =>
  useApi(nodeId ? `kdd:${nodeId}` : null, () => getKickDownDoors(nodeId));
