import { useEffect, useState } from "react";

// Pipeline output only changes when the pipeline re-runs, so one fetch per key per page
// session is enough: the HUD bar, footer and every page that asks for /api/stats share a
// single request instead of each firing its own. A failed request is dropped from the cache
// so the next mount retries it.
const shared = new Map();

/**
 * Fetch `load()` once per `key` and track it. Pass key = null to fetch nothing.
 * `loading` is derived (state belongs to a different key, or none yet) rather than set
 * from inside the effect, so a key change never renders stale data under the new key.
 *
 * @param {string|null} key
 * @param {() => Promise<any>} load
 * @param {{ cache?: boolean }} [opts]  cache=false for live data (e.g. chain state)
 * @returns {{ data: any, error: string|null, loading: boolean }}
 */
export function useApi(key, load, { cache = true } = {}) {
  const [state, setState] = useState({ key: null, data: null, error: null });

  useEffect(() => {
    if (key == null) return undefined;
    let promise = cache ? shared.get(key) : null;
    if (!promise) {
      promise = load();
      if (cache) {
        shared.set(key, promise);
        promise.catch(() => shared.delete(key));
      }
    }
    let cancelled = false;
    promise.then(
      (data) => { if (!cancelled) setState({ key, data, error: null }); },
      (err) => { if (!cancelled) setState({ key, data: null, error: err?.shortMessage || err?.message || String(err) }); },
    );
    return () => { cancelled = true; };
    // `load` is expected to be stable for a given key; the key alone decides when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cache]);

  const current = key != null && state.key === key;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: key != null && !current };
}
