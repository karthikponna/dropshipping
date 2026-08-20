# HydraDB for a managed container host (Railway, Render, Fly, Cloud Run).
#
# The published image is almost deployable as-is. One thing stops it: the node
# reads its auth token from a *file* (`GRAPH_AUTH_TOKEN_FILE`, and
# `RuntimeConfig::read_auth_token` does a plain `fs::read_to_string`), while
# every one of those hosts supplies secrets as environment variables. Baking a
# token into the image is not an option — this repository is public.
#
# So this image adds the smallest thing that can bridge the two: a shell. The
# upstream image is distroless and carries none, which is also why the token
# cannot be written by a plain `sh -c` command override at the platform level.
# The entrypoint writes the token out of the environment at boot, creates the
# directories the node expects to already exist, and then execs the real
# binary, so PID 1 is still `graph-node` and signals reach it unchanged.

FROM busybox:1.37-uclibc AS busybox

FROM ghcr.io/hydra-db/hydradb:latest

# Just the one static binary; every applet is a symlink to it, and `sh` is all
# the entrypoint needs.
COPY --from=busybox /bin/busybox /bin/busybox

COPY entrypoint.sh /usr/local/bin/hydradb-entrypoint.sh

# Create the mount point in the image, owned by the runtime user, before any
# volume lands on it. An empty volume mounted over a path that exists in the
# image inherits that path's ownership; mounted over one that does not, it is
# created root-owned and an unprivileged node cannot write a byte to it. This
# is the whole reason the upstream `docker run` recipe passes `--user $(id -u)`
# against a host directory the host user already owns.
USER root
RUN ["/bin/busybox", "sh", "-c", "mkdir -p /data/store /data/cache && chown -R 10001:10001 /data"]

# Matches the upstream image, which runs unprivileged. Named explicitly so a
# platform that resets USER cannot quietly promote the node to root.
USER 10001:10001

EXPOSE 8443

ENTRYPOINT ["/bin/busybox", "sh", "/usr/local/bin/hydradb-entrypoint.sh"]
