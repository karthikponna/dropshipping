import { getHydraConfig, type HydraConfig } from "./config";

/**
 * Transport for HydraDB's HTTP query API.
 *
 * Two rules shape everything above this file:
 *
 * 1. **Never throw into a generation.** The graph makes answers better; it must
 *    not be able to make them fail. Every helper here returns `null` or an empty
 *    result on a missing node, a timeout, or a rejected query, and logs once.
 * 2. **Always parameterise.** Values travel in `parameters`, never spliced into
 *    the query string, so a shop description containing a quote cannot alter a
 *    statement.
 *
 * The dialect this speaks is narrower than Neo4j's, and `scripts/hydra-probe.sh`
 * is the executable record of exactly how — run it after upgrading the node.
 */

/* ───────────────────────────── wire format ─────────────────────────────── */

/** One cell of a result row, as HydraDB tags it. */
type HydraValue =
  | { type: "null" }
  | { type: "vertex_id"; value: number }
  | { type: "integer"; value: number }
  | { type: "signed_integer"; value: number }
  | { type: "float"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "string"; value: string }
  | { type: "list"; value: HydraValue[] }
  | { type: "path"; value: unknown };

interface HydraResponseBody {
  query_id: string;
  columns: string[];
  rows: HydraValue[][];
}

/** A result row flattened to plain JavaScript, keyed by projection name. */
export type HydraRow = Record<string, string | number | boolean | unknown[] | null>;

export type HydraParameters = Record<string, unknown>;

function unwrap(value: HydraValue): string | number | boolean | unknown[] | null {
  switch (value.type) {
    case "null":
      return null;
    case "list":
      return value.value.map(unwrap);
    case "path":
      return null;
    default:
      return value.value;
  }
}

function toRows(body: HydraResponseBody): HydraRow[] {
  return body.rows.map((row) => {
    const record: HydraRow = {};
    body.columns.forEach((column, index) => {
      const cell = row[index];
      record[column] = cell === undefined ? null : unwrap(cell);
    });
    return record;
  });
}

/* ─────────────────────────────── logging ───────────────────────────────── */

/**
 * The graph failing is a degraded experience, not an incident, and a generation
 * issues several queries — so a node that is down would otherwise print the same
 * line a dozen times per run. Log the first of each distinct reason and count
 * the rest.
 */
const reportedFailures = new Set<string>();

function reportOnce(reason: string, detail: unknown): void {
  if (reportedFailures.has(reason)) return;
  reportedFailures.add(reason);
  console.warn(`[hydra] ${reason} — memory features are degraded for now.`, detail);
}

/* ─────────────────────────────── querying ──────────────────────────────── */

export interface HydraQueryOptions {
  /** Overrides the config default; keep short on the generation hot path. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Runs one Cypher statement. Returns `null` when HydraDB is unconfigured or the
 * query did not succeed — callers treat that the same as "no context found".
 */
export async function hydraQuery(
  query: string,
  parameters: HydraParameters = {},
  options: HydraQueryOptions = {},
): Promise<HydraRow[] | null> {
  const config = getHydraConfig();
  if (!config) return null;
  return runQuery(config, query, parameters, options);
}

async function runQuery(
  config: HydraConfig,
  query: string,
  parameters: HydraParameters,
  options: HydraQueryOptions,
): Promise<HydraRow[] | null> {
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const timer = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([timer, options.signal]) : timer;

  try {
    const response = await fetch(`${config.url}/v1/graphs/${config.graph}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "X-Graph-Namespace": config.namespace,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cell_id: config.cellId,
        // The node derives a write's idempotency key from this, and generates
        // `http-query-<n>` from a counter that restarts with the process. Left
        // to the default, the first writes after a restart collide with keys
        // already stored under different payloads and are rejected — so every
        // request brings its own key instead.
        query_id: crypto.randomUUID(),
        query,
        parameters,
        // Reads take the node's current durable view. Nothing here is worth the
        // object-store round trip that `strong` would cost.
        consistency: "causal",
      }),
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      reportOnce(`query rejected with ${response.status}`, `${firstLine(query)} :: ${detail}`);
      return null;
    }

    const body = (await response.json()) as HydraResponseBody;
    return toRows(body);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    reportOnce(aborted ? `query exceeded ${timeoutMs}ms` : "node unreachable", firstLine(query));
    return null;
  }
}

/**
 * Runs statements in order, stopping at the first failure. Used by the ingest,
 * where a relationship write is pointless once its endpoints failed to land.
 * Returns false if anything did not succeed.
 */
export async function hydraWriteBatch(
  statements: readonly { query: string; parameters: HydraParameters }[],
  options: HydraQueryOptions = {},
): Promise<boolean> {
  const config = getHydraConfig();
  if (!config) return false;

  for (const statement of statements) {
    if (statement.parameters.rows !== undefined && isEmptyRows(statement.parameters.rows)) continue;
    const result = await runQuery(config, statement.query, statement.parameters, options);
    if (result === null) return false;
  }

  return true;
}

function isEmptyRows(rows: unknown): boolean {
  return Array.isArray(rows) && rows.length === 0;
}

function firstLine(query: string): string {
  return query.trim().split("\n", 1)[0]?.slice(0, 120) ?? "";
}

/** True when a node answers. Used by the settings page to show connection state. */
export async function hydraHealthy(): Promise<boolean> {
  const rows = await hydraQuery("MATCH (n:HealthProbe) RETURN n.id AS id LIMIT 1", {}, { timeoutMs: 2_000 });
  return rows !== null;
}
