# Shared code

Files here are consumed by all four sister apps (Outer Rim, Parallel, Perimeter, Quartet). They are loaded via relative `require` from each app's `src/main/main.js`.

## sync-client.js

Factory that returns a sync client bound to one app. The app supplies:

- `appName` — one of `outer-rim`, `parallel`, `perimeter`, `quartet`
- `storePath` — where to save the sync metadata JSON (token, etag, etc.). Keep this separate from the app's main data file.
- `getLocalState()` — returns the full JSON blob that should be synced.
- `applyRemoteState(data)` — called with a remote blob; app should replace or merge its own state, then re-render.
- `onStatusChange(status)` — called whenever sync state changes (`idle`, `pushing`, `pulling`, `conflict`, `signed-out`, `error`). App should forward this to the renderer so the sidebar badge updates.

The client returns:

- `init()` — call once after Electron is ready. Starts the 5-min auto-push timer, wires the `before-quit` hook, and kicks off a pull-from-server if already signed in.
- `signIn()` — opens the browser for GitHub OAuth. Returns after the user approves and credentials come back through the loopback server.
- `signOut()` — clears local creds. Does not revoke the token server-side (do that by deleting the `token:{x}` key in KV if needed).
- `syncNow({ direction })` — force pull+push round trip. `direction` defaults to `auto` (pull first if no etag, then push). Use `'pull'` for Sync Now button when switching machines.
- `markDirty()` — call this anywhere the app changes state. The next auto-push tick will pick it up.
- `pushToServer()` / `pullFromServer()` — low-level. Prefer `syncNow()`.
- `getStatus()` — current `{status, signedIn, githubLogin, lastSyncedAt, etag, dirty}`.

## Why a shared file instead of an npm package

Four separate Electron apps with independent `node_modules` and build configs. A file-based shared module means no publish step, no version churn — just `git pull` and all four apps pick up the new version. If this module ever grows dependencies of its own, convert it to a local workspace package instead.
