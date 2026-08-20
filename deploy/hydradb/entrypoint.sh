#!/bin/sh
# Turns the platform's environment variables into the on-disk shape graph-node
# expects, then hands over to it.
#
# Fails loudly and early on anything missing. A node that starts without its
# token, or with a store directory that does not exist, does not fail here — it
# comes up, answers /readyz, and then rejects or aborts on the first real query,
# which is a far worse thing to debug from a deploy log.

set -eu

fail() {
  echo "hydradb-entrypoint: $1" >&2
  exit 1
}

: "${GRAPH_AUTH_TOKEN:?set GRAPH_AUTH_TOKEN to the shared secret the app sends as its bearer token}"

# The node enforces this itself and exits, but it reads the token late — after
# the store is open — so the failure surfaces further from the cause.
if [ "${#GRAPH_AUTH_TOKEN}" -lt 32 ]; then
  fail "GRAPH_AUTH_TOKEN must be at least 32 characters (got ${#GRAPH_AUTH_TOKEN})"
fi

# Defaults to /tmp rather than the data volume on purpose: the token arrives
# fresh from the environment on every boot, so it has no reason to be on durable
# storage, and keeping it off the volume removes one thing that can fail on a
# host that mounts volumes root-owned.
TOKEN_FILE="${GRAPH_AUTH_TOKEN_FILE:-/tmp/hydradb-auth-token}"
export GRAPH_AUTH_TOKEN_FILE="$TOKEN_FILE"

mkdir -p "$(dirname "$TOKEN_FILE")" || fail "cannot create $(dirname "$TOKEN_FILE")"
# Written before the umask-dependent default can apply: the token is the only
# thing standing between the public internet and the graph.
( umask 077 && printf '%s\n' "$GRAPH_AUTH_TOKEN" > "$TOKEN_FILE" ) ||
  fail "cannot write the token to $TOKEN_FILE"

# `LOCAL_PATH` must point at a directory that already exists; the node does not
# create it. Only relevant for CLOUD_PROVIDER=local, where it is the whole graph.
if [ "${CLOUD_PROVIDER:-local}" = "local" ]; then
  : "${LOCAL_PATH:?set LOCAL_PATH to a writable directory, ideally on a mounted volume}"
  mkdir -p "$LOCAL_PATH" || fail "cannot create LOCAL_PATH=$LOCAL_PATH — is the volume mounted and writable by uid $(id -u)?"
fi

if [ -n "${GRAPH_DATA_CACHE_DIR:-}" ]; then
  mkdir -p "$GRAPH_DATA_CACHE_DIR" || fail "cannot create GRAPH_DATA_CACHE_DIR=$GRAPH_DATA_CACHE_DIR"
fi

# Managed hosts route to one port and name it $PORT. The node has its own
# default, so only override when the platform actually asked for something.
if [ -n "${PORT:-}" ] && [ -z "${GRAPH_HTTP_ADDR:-}" ]; then
  export GRAPH_HTTP_ADDR="0.0.0.0:${PORT}"
fi

# graph-node's async query futures overflow the default thread stack: without
# this it serves /readyz and then aborts on the first query.
export RUST_MIN_STACK="${RUST_MIN_STACK:-33554432}"

echo "hydradb-entrypoint: starting graph-node on ${GRAPH_HTTP_ADDR:-0.0.0.0:8443} (uid $(id -u), store ${CLOUD_PROVIDER:-local})"

# exec so graph-node becomes PID 1 and receives the platform's stop signals.
exec /usr/local/bin/graph-node "$@"
