# Cloud Sync Worker

Cloudflare Worker that backs sync for all four sister apps (Outer Rim, Parallel, Perimeter, Quartet). Runs on your Cloudflare account's free tier — the workload is trivial (a few hundred KV ops per day across all your devices).

## What it does

- **GitHub OAuth** — apps open a browser, user clicks approve, Worker exchanges the code for a GitHub user identity and issues a long-lived sync token.
- **Per-user, per-app state blobs** — each GitHub user has isolated state for each of the four apps. Keyed as `state:{githubUserId}:{appName}`.
- **Versioned writes** — every blob has an etag. If you try to PUT with a stale etag, the server returns `409 Conflict` and your app prompts to resolve.
- **Tokens** — stored in KV under `token:{opaqueToken}` → `{githubUserId, githubLogin, createdAt}`. Revoke a device by deleting its token.

## Prerequisites

1. **Cloudflare account** (you have one — the productivity MCP is already there).
2. **Wrangler CLI**: `npm install -g wrangler` then `wrangler login`.
3. **GitHub OAuth App**: go to https://github.com/settings/developers → New OAuth App.
   - Application name: `Outer Rim Sync` (or whatever)
   - Homepage URL: `https://outer-rim-sync.YOUR-SUBDOMAIN.workers.dev` (placeholder, update after first deploy)
   - Authorization callback URL: `https://outer-rim-sync.YOUR-SUBDOMAIN.workers.dev/oauth/callback`
   - Save the **Client ID** and **Client Secret**.

## Deploy

```bash
cd cloud-sync
npm install

# Create the KV namespace (one-time)
wrangler kv:namespace create SYNC_KV
# Copy the id it prints into wrangler.toml under [[kv_namespaces]]

# Set secrets (one-time, per environment)
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put TOKEN_SIGNING_KEY  # any random long string

# Deploy
wrangler deploy
```

After deploy, wrangler prints your Worker URL (something like `outer-rim-sync.mrmicaiah.workers.dev`). Update your GitHub OAuth App's homepage and callback URLs to use this real URL.

## Endpoints

All non-OAuth endpoints require `Authorization: Bearer {syncToken}` header.

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET`  | `/oauth/start?app={app}&port={localPort}` | — | 302 redirect to GitHub |
| `GET`  | `/oauth/callback?code=...&state=...`      | — | HTML page that posts token back to the app's local loopback |
| `GET`  | `/v1/me`                                  | — | `{ githubUserId, githubLogin }` |
| `GET`  | `/v1/state/{app}`                         | — | `{ etag, data, updatedAt }` or 404 |
| `PUT`  | `/v1/state/{app}`                         | `{ data }` + `If-Match: {etag}` header | `{ etag, updatedAt }` or 409 |
| `DELETE` | `/v1/state/{app}`                       | — | `{ ok: true }` |

`{app}` is one of: `outer-rim`, `parallel`, `perimeter`, `quartet`.

## Local development

```bash
wrangler dev
```

Runs the worker on `http://localhost:8787`. Point your Electron app's sync client at that URL via env var for testing.

## Costs

Free tier: 100k requests/day, 1k KV writes/day, 100k KV reads/day. You will use roughly 288 writes/day/app if auto-sync runs every 5 min continuously — so ~1200 writes/day across all 4 apps. You'll bump into the KV write limit first.

Two mitigations if that becomes a problem:
1. The Worker already rejects writes where `data` hasn't actually changed (etag-based).
2. Upgrade to Workers Paid ($5/mo) for 1M writes/day.
