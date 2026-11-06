import { getGeo } from "../services/api";
import { useApi } from "./useApi";

export const useGeo = () => useApi("geo", getGeo);
