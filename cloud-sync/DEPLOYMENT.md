# Cloud Sync — Deployment Guide

Step-by-step walkthrough to turn on sync for Quartet (and any of the other three apps you wire up later).

## Phase 1 — Deploy the Worker (one-time, ~15 min)

### 1. Install wrangler

```bash
npm install -g wrangler
wrangler login
```

Browser opens, approve Cloudflare access. Done.

### 2. Create the KV namespace

From the `cloud-sync/` directory:

```bash
cd cloud-sync
wrangler kv:namespace create SYNC_KV
```

You'll see something like:

```
🌀 Creating namespace with title "outer-rim-sync-SYNC_KV"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "SYNC_KV", id = "abc123def456..." }
```

Copy that `id`. Open `wrangler.toml` and replace `REPLACE_WITH_KV_ID` with the real id.

### 3. Create a GitHub OAuth App

Go to https://github.com/settings/developers → **New OAuth App**.

- **Application name**: `Outer Rim Sync` (or whatever — users see this on the GitHub approval screen)
- **Homepage URL**: `https://outer-rim-sync.YOUR-SUBDOMAIN.workers.dev` — you won't know this yet, use any placeholder like `https://example.com`, update later
- **Authorization callback URL**: *same URL* + `/oauth/callback`, e.g. `https://outer-rim-sync.YOUR-SUBDOMAIN.workers.dev/oauth/callback`

Click **Register application**. Copy the **Client ID**. Click **Generate a new client secret** and copy that too.

### 4. Set Worker secrets

```bash
wrangler secret put GITHUB_CLIENT_ID
# paste the Client ID when prompted

wrangler secret put GITHUB_CLIENT_SECRET
# paste the Client Secret when prompted

wrangler secret put TOKEN_SIGNING_KEY
# paste any random long string, e.g. output of: openssl rand -hex 32
```

### 5. Deploy

```bash
npm install
wrangler deploy
```

Wrangler prints the deployed URL:

```
Uploaded outer-rim-sync (2.14 sec)
Published outer-rim-sync (0.34 sec)
  https://outer-rim-sync.YOUR-SUBDOMAIN.workers.dev
Current Deployment ID: ...
```

Copy that URL — it's your permanent Worker URL.

### 6. Update the GitHub OAuth App with the real URL

Back on the GitHub OAuth app page:
- Update **Homepage URL** to the real Worker URL
- Update **Authorization callback URL** to `{WorkerURL}/oauth/callback`
- Save

### 7. Sanity check

Open `https://outer-rim-sync.YOUR-SUBDOMAIN.workers.dev/` in a browser. Should return:

```json
{ "name": "outer-rim-sync", "ok": true }
```

If yes, the Worker is live.

## Phase 2 — Point Quartet at the Worker

The sync client defaults to a placeholder URL. You have two options to override:

### Option A — Set env var per machine (recommended for testing)

On the Mac where you'll launch Quartet:

```bash
export OUTER_RIM_SYNC_URL="https://outer-rim-sync.YOUR-SUBDOMAIN.workers.dev"
open /Applications/Quartet.app
```

Env var is inherited by the Electron app. Downside: only works when launched from a terminal.

### Option B — Hardcode into the app before building (recommended for permanent use)

Open `shared/sync-client.js`, find `DEFAULT_WORKER_URL`, replace the placeholder with your real URL:

```js
const DEFAULT_WORKER_URL = 'https://outer-rim-sync.YOUR-SUBDOMAIN.workers.dev';
```

Commit, rebuild Quartet, reinstall. Now the app always uses your Worker with no env var needed.

### 3. Rebuild Quartet

```bash
cd quartet
npm install            # first time only, picks up the `shared/` relative require
npm run build:mac
rm -rf /Applications/Quartet.app
cp -r dist/mac/Quartet.app /Applications/
```

(Intel iMac Pro: `dist/mac/`. Apple Silicon: `dist/mac-arm64/`.)

## Phase 3 — Try it end to end

1. Launch Quartet. In the sidebar you should see a new **Cloud Sync** section with "Off" badge and a **Sign in with GitHub** button.
2. Click Sign in. Browser opens → GitHub asks you to approve `Outer Rim Sync` → you land on a page that says "Signed in as @yourname" → the Electron app picks up the token and the sidebar flips to signed-in state.
3. Create a workspace, add a tab, type some notes. The sidebar badge will say "Synced" after a moment.
4. On the second machine, install Quartet, sign in with the same GitHub account. It will pull your state and your workspace + tab + notes appear.
5. Make a change on machine B. Within 5 min (or hit **Sync Now**), machine A will pick it up on next auto-pull or app relaunch.

## When conflicts happen

If machine A and B both change something in the same sync window:

- Whoever pushes second gets a **Conflict** badge.
- A yellow banner in the sidebar explains: *"Cloud has newer data"*.
- Two escape hatches:
  - **Pull (overwrite local)** — discard your unsynced changes, take what the cloud has.
  - **Push (overwrite cloud)** — discard what the cloud has, keep your version.

The app won't silently clobber anything. You always get to pick.

## Troubleshooting

**"Worker misconfigured: GITHUB_CLIENT_ID not set"** — you forgot `wrangler secret put GITHUB_CLIENT_ID`. Run it again.

**"invalid_token" on every sync** — the token in `quartet-sync.json` (in Electron's userData dir) is stale. Sign out and sign in again.

**OAuth callback fails with a browser error about `127.0.0.1`** — the loopback port is blocked. The sync client tries ports 47800–47900; if all are taken, change the range in `shared/sync-client.js`.

**KV write limit (1k/day on free tier)** — upgrade to Workers Paid ($5/mo, 1M writes/day). The client tries not to push when there are no changes, but heavy use can still burn through.

**Worker logs** — run `wrangler tail` while using the app to see every request hit the Worker in real time. Super useful for debugging.

## Extending to other apps

The hard work is done. For Parallel / Perimeter / Outer Rim you need:

1. Add `getAll()` / `replaceAll()` to each app's `store.js` (copy from quartet/src/main/store.js).
2. Import `createSync` in each app's `main.js`, wire `initializeSync()` like Quartet does.
3. Add `markDirty()` calls in each mutating IPC handler.
4. Add the same sync IPC handlers (`sync:signIn`, `sync:getStatus`, etc.).
5. Expose them on the app's `preload.js`.
6. Add the "Cloud Sync" sidebar section to index.html + styles.
7. Copy the `initSync()` function into app.js.

All four apps then share the same Worker and the same KV namespace. Each user's GitHub identity keys them to their own per-app state blobs: `state:{userId}:quartet`, `state:{userId}:parallel`, etc.
