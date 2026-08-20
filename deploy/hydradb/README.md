# Deploying HydraDB for a hosted DropShipping

The app runs on Vercel, which cannot host HydraDB: Vercel functions are
per-request and hold no listening socket or disk, while `graph-node` is a
long-running server with its own store. So the graph runs on a container host
and the app reaches it over HTTPS. `lib/hydra/client.ts` only ever speaks the
HTTP query API, never Bolt, so exactly one port needs to be public.

Memory is optional by design. With `HYDRADB_URL` and `HYDRADB_TOKEN` unset,
`getHydraConfig()` returns null and generation runs as it did before the graph
existed — so a failed deploy here degrades the product, it does not break it.

## Why this image exists

The published `ghcr.io/hydra-db/hydradb` image is nearly deployable as-is. One
thing stops it: the node reads its auth token from a **file**
(`GRAPH_AUTH_TOKEN_FILE`), while managed hosts supply secrets as **environment
variables**. The image is distroless, so there is no shell to bridge the two
with a command override, and baking a token into the image is not an option
because this repository is public.

This image adds a static `busybox` and an entrypoint that writes the token out
of the environment at boot, creates the directories the node expects to already
exist, maps the platform's `$PORT`, and then `exec`s the real binary so
`graph-node` is still PID 1.

## Railway

1. **New Project → Deploy from GitHub repo**, pick this repository.
2. In the service's **Settings → Build**, set **Dockerfile Path** to
   `deploy/hydradb/Dockerfile` and **Root Directory** to `deploy/hydradb`.
3. **Settings → Networking → Generate Domain**, and set the port to `8443`.
4. Add a **Volume** mounted at `/data`.
5. Add the variables below.
6. Deploy, then verify with the round trip at the end of this file.

### Variables

| Variable | Value | Why |
|---|---|---|
| `GRAPH_AUTH_TOKEN` | 32+ random characters | The bearer token the app sends. `openssl rand -hex 24` |
| `CLOUD_PROVIDER` | `local` | Store on the mounted volume. See below for S3. |
| `LOCAL_PATH` | `/data/store` | Durable graph. Must be on the volume. |
| `GRAPH_DATA_CACHE_DIR` | `/data/cache` | Disposable local cache. |
| `GRAPH_ALLOW_PLAINTEXT` | `true` | The platform terminates TLS; the node runs plaintext behind it. |
| `GRAPH_NAMESPACE` | `default` | |
| `GRAPH_ID` | `default` | |
| `GRAPH_CELL_ID` | `cell-0` | |
| `GRAPH_CELLS` | `cell-0` | |
| `GRAPH_NODE_ID` | `node-0` | |
| `GRAPH_BOLT_NODE_ADDRESSES` | `node-0=127.0.0.1:7687` | Required even though the app never uses Bolt. |
| `GRAPH_ADVERTISED_BOLT_ADDR` | `127.0.0.1:7687` | As above. |

Then set these on the **Vercel** project and redeploy:

```
HYDRADB_URL=https://<your-service>.up.railway.app
HYDRADB_TOKEN=<the same GRAPH_AUTH_TOKEN>
HYDRADB_GRAPH=default
HYDRADB_NAMESPACE=default
HYDRADB_CELL_ID=cell-0
```

## Notes that cost time if missed

**Do not use a host that sleeps when idle.** `lib/hydra/client.ts` gives every
query 4 seconds. A cold container silently misses that, and the first
generation after a quiet period runs with no memory at all.

**Volume ownership.** The node runs as uid `10001`. An empty volume mounted
over a path that does not exist in the image is created root-owned and the node
cannot write to it. The Dockerfile creates `/data` owned by `10001` ahead of the
mount for this reason. If a host ignores that, the entrypoint fails with a clear
message rather than starting a node that cannot store anything.

**Region.** Put the node near the Vercel functions. Every cross-region hop
comes out of the same 4-second budget.

**S3 instead of a volume.** HydraDB is object-store-native, so pointing
`CLOUD_PROVIDER` at S3 or R2 makes the container disposable and removes the
volume entirely. Worth doing for anything long-lived; the volume is simply
fewer moving parts for a demo.

## Verify

A listening port is not proof. A round-tripped write is:

```bash
URL=https://<your-service>.up.railway.app
TOKEN=<your token>

curl -sS "$URL/v1/graphs/default/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'X-Graph-Namespace: default' \
  -H 'Content-Type: application/json' \
  --data '{"cell_id":"cell-0","query_id":"probe-1","query":"CREATE (a {id: 1})-[:FOLLOWS]->(b {id: 2})"}'

curl -sS "$URL/v1/graphs/default/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'X-Graph-Namespace: default' \
  -H 'Content-Type: application/json' \
  --data '{"cell_id":"cell-0","query_id":"probe-2","query":"MATCH (a {id: 1})-[:FOLLOWS]->(b) RETURN b.id AS id"}'
```

The second call returns one row containing `{"type":"vertex_id","value":2}`. A
request with a wrong token must return `401`; check that too, since the node is
now on the public internet with only this token in front of it.
