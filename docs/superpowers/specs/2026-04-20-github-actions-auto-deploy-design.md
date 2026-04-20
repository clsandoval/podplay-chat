# GitHub Actions Auto-Deploy for podplay-chat

**Date:** 2026-04-20
**Status:** Design approved, pending implementation plan
**Scope:** Single environment (prod). Push to `main` deploys both Fly apps and applies Supabase migrations against the user's personal Supabase project.

## Goals

- Auto-deploy `podplay-chat` (client) and `podplay-chat-api` (server) Fly apps on every merge to `main`.
- Auto-apply Supabase migrations to the personal `podplay-chat` Supabase project on every merge to `main`.
- Gate deploys on migration success: a bad migration prevents the app from being redeployed against a mismatched schema.
- Run build/typecheck on every PR as a cheap safety net (no deploy, no DB changes on PRs).
- Document all one-time bootstrap steps so future setup (or re-setup after secret rotation) doesn't require reverse-engineering.

Non-goals (explicitly): preview environments per PR, a persistent staging environment, automated rollback, deploy notifications beyond GitHub's default email-on-failure.

## Environment

- **Supabase project:** `podplay-chat`, ref `ojwhcbuszjuubhqfjlrz`, region `ap-southeast-1` (Singapore), personal org `dgyaaaumttcqwgtetcgm`. URL: `https://ojwhcbuszjuubhqfjlrz.supabase.co`.
- **Fly apps** (to be created during bootstrap):
  - `podplay-chat` — static client (Vite + nginx), region `sin`, per `client/fly.toml`.
  - `podplay-chat-api` — Hono server on Node, region `sin`, per `server/fly.toml`.
- **Repo:** monorepo with `client/` and `server/` top-level directories; existing Dockerfiles in each.

## Architecture

### Workflow DAG

On push to `main`:

```
checks ──► migrate ──► deploy-server ─┐
                                      ├──► done
          (parallel)   deploy-client ─┘
```

On pull request targeting `main`: only `checks` runs.

### Jobs

Single workflow file: `.github/workflows/deploy.yml`.

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false   # don't cancel a prod deploy mid-flight
```

**1. `checks`** — runs on `push` and `pull_request`.

- Matrix over `[client, server]`, both jobs in parallel.
- Steps: checkout → `actions/setup-node@v4` with Node 20 → `npm ci` (cache on `${{ matrix.app }}/package-lock.json`) → `npm run build`.
- `npm run build` runs `tsc` for both apps, so typecheck is covered without a separate job.

**2. `migrate`** — runs only on push to `main`; `needs: checks`.

- Checkout → `supabase/setup-cli@v1`.
- `supabase link --project-ref $SUPABASE_PROJECT_REF` (uses `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` from env).
- `supabase db push` — idempotent; no-op if no new migrations.
- Uses `working-directory: server` so the CLI finds `server/supabase/migrations/`.
- **Gate semantics:** if this fails, `deploy-*` jobs don't start (enforced by `needs: migrate`).

**3. `deploy-server`** — runs only on push to `main`; `needs: migrate`.

- Checkout → `superfly/flyctl-actions/setup-flyctl@master`.
- `flyctl deploy --remote-only` with `working-directory: server` (picks up `server/fly.toml` and `server/Dockerfile` automatically).
- Uses `FLY_API_TOKEN` secret.

**4. `deploy-client`** — runs only on push to `main`; `needs: migrate`. Runs in parallel with `deploy-server`.

- Same pattern, from `client/`, with build args injecting the VITE env:
  - `--build-arg VITE_API_URL=https://podplay-chat-api.fly.dev`
  - `--build-arg VITE_SUPABASE_URL=https://ojwhcbuszjuubhqfjlrz.supabase.co`
  - `--build-arg VITE_SUPABASE_ANON_KEY=${{ secrets.VITE_SUPABASE_ANON_KEY }}`

### Required code change: `client/Dockerfile`

The client's Supabase and API URLs are baked into the JS bundle at `vite build` time. The current Dockerfile runs `npm run build` without accepting build args. It must be modified to:

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

The `server/Dockerfile` needs no changes; server config is loaded from Fly runtime secrets.

## Secrets & config matrix

### GitHub repo secrets (for CI)

| Name | Value / source | Used by |
|---|---|---|
| `FLY_API_TOKEN` | `fly auth token` (personal account) | `deploy-server`, `deploy-client` |
| `SUPABASE_ACCESS_TOKEN` | Supabase dashboard → Account → Access Tokens | `migrate` |
| `SUPABASE_DB_PASSWORD` | DB password set during project creation | `migrate` |
| `SUPABASE_PROJECT_REF` | `ojwhcbuszjuubhqfjlrz` | `migrate` |
| `VITE_SUPABASE_ANON_KEY` | `supabase projects api-keys --project-ref ojwhcbuszjuubhqfjlrz` → `anon` | `deploy-client` (build arg) |

The prod Supabase URL (`https://ojwhcbuszjuubhqfjlrz.supabase.co`) and API URL (`https://podplay-chat-api.fly.dev`) are **not secrets** — they're hard-coded as build arg literals in the workflow.

### Fly secrets on `podplay-chat-api` (server runtime)

Set once during bootstrap via `fly secrets set --app podplay-chat-api KEY=value ...`.

| Name | Source |
|---|---|
| `SUPABASE_URL` | `https://ojwhcbuszjuubhqfjlrz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase projects api-keys` → `service_role` |
| `ANTHROPIC_API_KEY` | from local `server/.env` |
| `GITHUB_TOKEN` | from local `server/.env` |
| `ENVIRONMENT_ID` | from local `server/.env` |
| `VAULT_ID` | from local `server/.env` |
| `AGENT_ID` | from local `server/.env` |
| `AGENT_VERSION` | from local `server/.env` |
| `FRONTEND_URL` | `https://podplay-chat.fly.dev` |

`PORT` is not a Fly secret; Fly routes via `internal_port = 3001` from `server/fly.toml`.

### Fly secrets on `podplay-chat` (client)

None. The client is static assets served by nginx; all config is baked in at build time.

### Local `.env` files

Unchanged for dev workflow. `server/.env` continues to point at local Supabase (`127.0.0.1:54321`). The `SUPABASE_PROD_*` lines added during bootstrap are for CLI convenience (so `supabase db push` from local also works) and are not read by the running server.

## One-time bootstrap

Run these commands manually before the first CI run. The spec assumes each command succeeds before the next is attempted.

### Supabase

Personal project `podplay-chat` (ref `ojwhcbuszjuubhqfjlrz`) already exists — created 2026-04-20 in personal org, SIN region.

```bash
cd server
npx supabase link --project-ref ojwhcbuszjuubhqfjlrz
# commit the resulting supabase/config.toml

npx supabase db push   # applies 00001_chat_sessions.sql to prod

npx supabase projects api-keys --project-ref ojwhcbuszjuubhqfjlrz
# capture the `anon` key (for VITE_SUPABASE_ANON_KEY GH secret)
# capture the `service_role` key (for Fly secret on podplay-chat-api)
```

### Fly apps

```bash
cd server
fly launch --no-deploy --name podplay-chat-api --region sin --copy-config

fly secrets set --app podplay-chat-api \
  SUPABASE_URL=https://ojwhcbuszjuubhqfjlrz.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
  ANTHROPIC_API_KEY=<from server/.env> \
  GITHUB_TOKEN=<from server/.env> \
  ENVIRONMENT_ID=<from server/.env> \
  VAULT_ID=<from server/.env> \
  AGENT_ID=<from server/.env> \
  AGENT_VERSION=1 \
  FRONTEND_URL=https://podplay-chat.fly.dev

cd ../client
fly launch --no-deploy --name podplay-chat --region sin --copy-config
# no fly secrets needed on the client app
```

### Dockerfile change

Modify `client/Dockerfile` to accept the three `VITE_*` build args and expose them as env vars during `npm run build`, per the snippet in the Architecture section. Commit this change before the first CI run.

### GitHub repo secrets

Create all five secrets from the table above via GitHub UI (Settings → Secrets and variables → Actions) or `gh secret set`.

### Server-side FRONTEND_URL / CORS

Confirm `server/src` trusts `https://podplay-chat.fly.dev` as a CORS origin and/or uses `FRONTEND_URL` from env for any redirect logic. If not, add that as part of the implementation work.

## Rollback, observability, and edge cases

**Rollback:** manual. Fly retains prior releases. Recovery:

```bash
fly releases --app podplay-chat-api
fly releases rollback <version> --app podplay-chat-api
```

Supabase migrations are forward-only. If a migration breaks prod, write a new compensating migration.

**Observability:** Actions tab for CI status; `fly logs --app <name>` for runtime. GitHub emails the committer on workflow failure by default. No Slack/Discord integration in this iteration.

**Edge cases:**

- **Rapid successive merges:** `concurrency` group with `cancel-in-progress: false` queues the second run. The in-flight deploy completes first; the second run then re-applies migrations (idempotent) and redeploys with the latest code.
- **Renamed migration file:** `supabase db push` errors if the applied migration's filename/hash doesn't match what's tracked remotely. Runbook: never rename a migration that's already been applied; add a new one instead.
- **Partial deploy failure** (server succeeds, client fails or vice versa): prod is briefly mismatched. The next push to `main` fixes it because both apps always deploy on every push. To fix sooner, re-run the failed job from the Actions UI.
- **First CI run hitting schema mismatch:** bootstrap applies `00001_chat_sessions.sql` locally via `supabase db push`; CI's first `db push` is then a no-op.

## Implementation scope

This spec is appropriately sized for a single implementation plan. The implementation work consists of:

1. Modify `client/Dockerfile` to accept `VITE_*` build args.
2. Create `.github/workflows/deploy.yml` with the four-job structure described above.
3. Write a bootstrap runbook (could be inlined into this doc or a separate `docs/bootstrap.md`) that lists the manual commands above in order.
4. Execute the bootstrap manually (Supabase link, db push, Fly launch, secrets, GitHub secrets).
5. Open a PR with the Dockerfile + workflow changes to verify `checks` runs green on PR.
6. Merge and verify full pipeline runs green on `main`.

Steps 1–3 are code/doc changes that belong in the plan. Steps 4–6 are execution steps the user runs.
