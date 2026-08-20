#!/usr/bin/env bash
# Probes the exact Cypher shapes lib/hydra relies on against a local node.
# Every query here mirrors one the app actually issues, so a clean run means the
# integration's dialect assumptions still hold against the running build.
#
# HydraDB's OpenCypher subset is narrower than Neo4j's in ways this script pins
# down:
#   1. an UNWIND vertex upsert sets exactly one label
#   2. relationship-upsert endpoints must each carry exactly one label
#   3. list parameters are only legal as UNWIND input, never as `IN $list`
#   4. a read-side UNWIND MATCH takes no labels and the row id must bind the
#      *source* of the pattern, so reverse traversal needs a materialised
#      reverse edge
#   5. a write's idempotency key is derived from the request's query_id, and the
#      node's default counter restarts with the process — so every request sends
#      its own, exactly as lib/hydra/client.ts does
#
# Every node this script writes carries a Probe* label of its own, so the
# cleanup at the end can never touch application data sharing the real labels.
set -uo pipefail

URL="${HYDRADB_URL:-http://127.0.0.1:8443}"
TOKEN="${HYDRADB_TOKEN:-local-development-token-32-bytes}"
GRAPH="${HYDRADB_GRAPH:-default}"
NAMESPACE="${HYDRADB_NAMESPACE:-default}"
CELL="${HYDRADB_CELL_ID:-cell-0}"

pass=0
fail=0

probe() {
  local label="$1" query="$2" params="${3:-}"
  local body response
  [ -z "$params" ] && params='{}'
  body=$(python3 -c 'import json,sys,uuid; print(json.dumps({"cell_id":sys.argv[1],"query_id":str(uuid.uuid4()),"query":sys.argv[2],"parameters":json.loads(sys.argv[3])}))' \
    "$CELL" "$query" "$params")

  response=$(curl -sS -m 15 "$URL/v1/graphs/$GRAPH/query" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Graph-Namespace: $NAMESPACE" \
    -H 'Content-Type: application/json' \
    --data "$body" 2>&1)

  if printf '%s' "$response" | grep -qE '"error"|Failed to parse'; then
    printf 'FAIL  %s\n      %s\n' "$label" "$response"
    fail=$((fail + 1))
  else
    printf 'ok    %-44s %s\n' "$label" "$(printf '%s' "$response" | cut -c1-130)"
    pass=$((pass + 1))
  fi
}

# ── writes ────────────────────────────────────────────────────────────────

probe "vertex upsert, one label" \
  'UNWIND $rows AS row MERGE (n {id: row.id}) SET n:ProbeProject, n.name = row.name, n.created_at = row.created_at' \
  '{"rows":[{"id":901001,"name":"skincare shop","created_at":1755300000000},{"id":901002,"name":"coffee shop","created_at":1755386400000}]}'

probe "vertex upsert, second label type" \
  'UNWIND $rows AS row MERGE (n {id: row.id}) SET n:ProbeGeneration, n.page_type = row.page_type, n.created_at = row.created_at' \
  '{"rows":[{"id":902001,"page_type":"landing","created_at":1755300000000},{"id":902002,"page_type":"product","created_at":1755300100000}]}'

probe "vertex upsert, concepts" \
  'UNWIND $rows AS row MERGE (n {id: row.id}) SET n:ProbeConcept, n.name = row.name' \
  '{"rows":[{"id":909001,"name":"skincare"},{"id":909002,"name":"organic"}]}'

probe "vertex upsert, theme" \
  'UNWIND $rows AS row MERGE (n {id: row.id}) SET n:ProbeTheme, n.primary = row.primary, n.heading_font = row.heading_font' \
  '{"rows":[{"id":907001,"primary":"#2F5D3A","heading_font":"Playfair Display"}]}'

probe "relationship upsert, labeled endpoints" \
  'UNWIND $rows AS row MATCH (s:ProbeProject {id: row.src}), (d:ProbeGeneration {id: row.dst}) MERGE (s)-[r:HAS_GENERATION {id: row.id}]->(d)' \
  '{"rows":[{"id":903001,"src":901001,"dst":902001},{"id":903002,"src":901001,"dst":902002}]}'

probe "relationship upsert with SET props" \
  'UNWIND $rows AS row MATCH (s:ProbeGeneration {id: row.src}), (d:ProbeGeneration {id: row.dst}) MERGE (s)-[r:DERIVED_FROM {id: row.id}]->(d) SET r.reason = row.reason' \
  '{"rows":[{"id":903003,"src":902002,"dst":902001,"reason":"theme inheritance"}]}'

probe "forward edge, project mentions concept" \
  'UNWIND $rows AS row MATCH (s:ProbeProject {id: row.src}), (d:ProbeConcept {id: row.dst}) MERGE (s)-[r:MENTIONS {id: row.id}]->(d)' \
  '{"rows":[{"id":903004,"src":901001,"dst":909001},{"id":903005,"src":901001,"dst":909002},{"id":903006,"src":901002,"dst":909002}]}'

probe "reverse edge, concept mentioned by project" \
  'UNWIND $rows AS row MATCH (s:ProbeConcept {id: row.src}), (d:ProbeProject {id: row.dst}) MERGE (s)-[r:MENTIONED_BY {id: row.id}]->(d)' \
  '{"rows":[{"id":904004,"src":909001,"dst":901001},{"id":904005,"src":909002,"dst":901001},{"id":904006,"src":909002,"dst":901002}]}'

probe "relationship upsert, generation uses theme" \
  'UNWIND $rows AS row MATCH (s:ProbeGeneration {id: row.src}), (d:ProbeTheme {id: row.dst}) MERGE (s)-[r:USES_THEME {id: row.id}]->(d)' \
  '{"rows":[{"id":903007,"src":902001,"dst":907001}]}'

# ── reads ─────────────────────────────────────────────────────────────────

probe "one-hop traversal + ORDER BY + LIMIT" \
  'MATCH (p:ProbeProject {id: $project})-[:HAS_GENERATION]->(g:ProbeGeneration) RETURN g.id AS id, g.page_type AS page_type, g.created_at AS created_at ORDER BY g.created_at DESC LIMIT 5' \
  '{"project":901001}'

probe "newest generation of one page type" \
  'MATCH (p:ProbeProject {id: $project})-[:HAS_GENERATION]->(g:ProbeGeneration {page_type: $page_type}) RETURN g.id AS id ORDER BY g.created_at DESC LIMIT 1' \
  '{"project":901001,"page_type":"landing"}'

probe "two-hop: generation to its theme" \
  'MATCH (p:ProbeProject {id: $project})-[:HAS_GENERATION]->(g:ProbeGeneration {page_type: $page_type})-[:USES_THEME]->(t:ProbeTheme) RETURN t.primary AS primary, t.heading_font AS heading_font ORDER BY g.created_at DESC LIMIT 1' \
  '{"project":901001,"page_type":"landing"}'

# The read-side UNWIND fan-in: no labels, and the row id binds the source. This
# is why the ingest writes MENTIONED_BY alongside MENTIONS.
# The only legal batch fan-in: one hop, exactly two projections, and the first
# must be the row's own id. Property hydration is a separate plain MATCH, and
# ranking happens in TypeScript.
probe "UNWIND fan-in, id pairs" \
  'UNWIND $rows AS row MATCH (c {id: row.id})-[:MENTIONED_BY]->(p) RETURN row.id AS concept, p.id AS project' \
  '{"rows":[{"id":909001},{"id":909002}]}'

probe "hydrate one project by id" \
  'MATCH (p:ProbeProject {id: $id}) RETURN p.name AS name, p.created_at AS created_at' \
  '{"id":901001}'

probe "plain MATCH, reverse arrow" \
  'MATCH (c:ProbeConcept {id: $id})<-[:MENTIONS]-(p:ProbeProject) RETURN p.id AS project, p.name AS name' \
  '{"id":909002}'

probe "range predicate on timestamp" \
  'MATCH (g:ProbeGeneration) WHERE g.created_at >= $since RETURN g.id AS id ORDER BY g.created_at DESC' \
  '{"since":1755300050000}'

probe "DERIVED_FROM traversal" \
  'MATCH (product:ProbeGeneration {id: $id})-[:DERIVED_FROM]->(landing:ProbeGeneration) RETURN landing.id AS id, landing.page_type AS page_type' \
  '{"id":902002}'

probe "OPTIONAL MATCH" \
  'MATCH (g:ProbeGeneration {id: $id}) OPTIONAL MATCH (g)-[:USES_THEME]->(t:ProbeTheme) RETURN g.id AS id, t.id AS theme' \
  '{"id":902001}'

probe "bounded variable-length path" \
  'MATCH (a:ProbeProject {id: $project})-[:HAS_GENERATION*1..3]->(g) RETURN g.id AS id LIMIT 10' \
  '{"project":901001}'

probe "collect() aggregation" \
  'MATCH (p:ProbeProject {id: $project})-[:HAS_GENERATION]->(g:ProbeGeneration) RETURN collect(g.page_type) AS page_types' \
  '{"project":901001}'

probe "STARTS WITH on string" \
  'MATCH (n:ProbeProject) WHERE n.name STARTS WITH $prefix RETURN n.name AS name' \
  '{"prefix":"skin"}'

# ── cleanup ───────────────────────────────────────────────────────────────
# Scoped to the Probe* labels this script owns.

probe "cleanup projects" 'MATCH (n:ProbeProject) DETACH DELETE n'
probe "cleanup generations" 'MATCH (n:ProbeGeneration) DETACH DELETE n'
probe "cleanup concepts" 'MATCH (n:ProbeConcept) DETACH DELETE n'
probe "cleanup themes" 'MATCH (n:ProbeTheme) DETACH DELETE n'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
