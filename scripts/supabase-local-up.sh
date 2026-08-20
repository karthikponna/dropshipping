#!/usr/bin/env bash
# Brings up a throwaway local Supabase stack for `npm run supabase:local:rls`.
#
# Nothing else in the app needs this — the dev server talks to the hosted
# project. It exists because the RLS check needs a database it is allowed to
# break, and a session it can actually obtain: the hosted project has email
# confirmation on and no service-role key, so no script can sign in there.
#
# The stack is built from supabase/migrations, so the tables and policies under
# test are the same ones production runs.
set -euo pipefail

cd "$(dirname "$0")/.."

# config.toml is generated rather than committed: it is machine-local, and the
# CLI's own supabase/.gitignore keeps the rest of its scratch files out.
if [ ! -f supabase/config.toml ]; then
  npx supabase init --force --with-vscode-settings=false --with-intellij-settings=false < /dev/null
fi

# Only the database, the auth server and PostgREST are wanted. The rest are
# excluded for speed, and analytics for correctness: logflare and its vector
# sidecar fail their health check on this setup, and a failed health check rolls
# the whole `supabase start` back rather than starting without them.
npx supabase start \
  -x vector,logflare,studio,edge-runtime,imgproxy,realtime,storage-api,supavisor,postgres-meta,mailpit

printf '\nLocal stack is up. Run `npm run supabase:local:rls`, then `npm run supabase:local:down`.\n'
