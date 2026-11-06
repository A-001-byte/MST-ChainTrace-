import { lookupEntity } from "../services/api";
import { useApi } from "./useApi";

// Points at /api/entity-lookup rather than /api/entity: same {alert, linked_transactions}
// shape plus an in_top_alerts flag, but it resolves ANY node_id, not only the top-N alerts.
export const useEntity = (nodeId) =>
  useApi(nodeId ? `entity:${nodeId}` : null, () => lookupEntity(nodeId));
