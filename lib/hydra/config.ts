/**
 * HydraDB connection settings, read defensively.
 *
 * The graph is an enhancement, never a dependency: with these unset every
 * `lib/hydra` entry point becomes a no-op that returns empty context, and
 * generation runs exactly as it did before the graph existed. That is what lets
 * the app boot — and the test suite run — without a node.
 */

export interface HydraConfig {
  /** Base URL of the HTTP query API, e.g. `http://127.0.0.1:8443`. */
  url: string;
  token: string;
  /** Graph name in the URL path. */
  graph: string;
  /** Sent as `X-Graph-Namespace`. */
  namespace: string;
  /** Cell to route the query to; single-node development uses one cell. */
  cellId: string;
  /** Per-query ceiling. The graph must never be what makes a generation slow. */
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 4_000;

export function getHydraConfig(): HydraConfig | null {
  const url = process.env.HYDRADB_URL?.trim();
  const token = process.env.HYDRADB_TOKEN?.trim();

  if (!url || !token) return null;

  const timeout = Number.parseInt(process.env.HYDRADB_TIMEOUT_MS ?? "", 10);

  return {
    url: url.replace(/\/+$/, ""),
    token,
    graph: process.env.HYDRADB_GRAPH?.trim() || "default",
    namespace: process.env.HYDRADB_NAMESPACE?.trim() || "default",
    cellId: process.env.HYDRADB_CELL_ID?.trim() || "cell-0",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

export function isHydraConfigured(): boolean {
  return getHydraConfig() !== null;
}

export const HYDRA_SETUP_HINT =
  "HydraDB is not configured, so cross-page and cross-session memory is off. Run `npm run hydra:up`, then set HYDRADB_URL and HYDRADB_TOKEN in .env.local.";
