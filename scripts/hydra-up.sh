#!/usr/bin/env bash
# Brings up the local HydraDB node and waits until it actually answers a query.
#
# `docker compose up -d` returning is not the same as the node being usable:
# graph-node opens its port well before it can serve Cypher, so a dev server
# started off the back of a bare `up` sees its first few generations silently
# lose their memory writes. This polls a real query instead.
set -euo pipefail

cd "$(dirname "$0")/.."

URL="${HYDRADB_URL:-http://127.0.0.1:8443}"
TOKEN="${HYDRADB_TOKEN:-local-development-token-32-bytes}"
GRAPH="${HYDRADB_GRAPH:-default}"
NAMESPACE="${HYDRADB_NAMESPACE:-default}"
CELL="${HYDRADB_CELL_ID:-cell-0}"

# The node reads its token from the bind mount, so the file has to exist before
# the container starts — and be owned by the host user running the container.
mkdir -p .hydradb/store .hydradb/cache
[ -f .hydradb/auth-token ] || printf '%s' "$TOKEN" > .hydradb/auth-token

# Compose substitutes UID/GID into the container's user, so the node writes the
# bind mount as whoever owns it. Passed through `env` because bash keeps UID
# readonly and rejects it even as a command prefix.
env "UID=$(id -u)" "GID=$(id -g)" docker compose -f docker-compose.hydradb.yml up -d

# A bare `RETURN 1` is rejected — the node only executes MATCH … RETURN — so
# readiness is a real read against a label nothing writes to.
READY_QUERY='MATCH (n:HydraUpProbe) RETURN n.id LIMIT 1'

printf 'Waiting for HydraDB at %s' "$URL"
for _ in $(seq 1 60); do
  if curl -sS -m 3 "$URL/v1/graphs/$GRAPH/query" \
      -H "Authorization: Bearer $TOKEN" \
      -H "X-Graph-Namespace: $NAMESPACE" \
      -H 'Content-Type: application/json' \
      --data "{\"cell_id\":\"$CELL\",\"query\":\"$READY_QUERY\",\"parameters\":{}}" \
      2>/dev/null | grep -q '"query_id"'; then
    printf '\nHydraDB is ready. Memory is on for the next generation.\n'
    exit 0
  fi
  printf '.'
  sleep 1
done

printf '\nHydraDB did not answer in 60s. Check `npm run hydra:logs`.\n' >&2
exit 1
