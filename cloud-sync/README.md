# cloud-sync/ is deprecated

The standalone sync worker was merged into [`mrmicaiah/micaiahs-worker`](https://github.com/mrmicaiah/micaiahs-worker) so all of Micaiah's personal backend tools live in one deploy.

The sync endpoints are now mounted at `/sync/*` on the existing worker:

- `https://micaiahs-worker.micaiah-tasks.workers.dev/sync/oauth/start`
- `https://micaiahs-worker.micaiah-tasks.workers.dev/sync/v1/state/{app}`
- etc.

**Deployment walkthrough:** see [`DEPLOYMENT.md`](https://github.com/mrmicaiah/micaiahs-worker/blob/main/DEPLOYMENT.md) in the `micaiahs-worker` repo.

**The actual sync code:** see [`src/sync.js`](https://github.com/mrmicaiah/micaiahs-worker/blob/main/src/sync.js) in the `micaiahs-worker` repo.

**The Electron client:** [`shared/sync-client.js`](../shared/sync-client.js) in this repo — already points at the new URL.

The files that used to live here (`src/index.js`, `wrangler.toml`, `package.json`, `DEPLOYMENT.md`) are obsolete and have been removed. If you find any references to `outer-rim-sync.*.workers.dev` in other files, update them to `micaiahs-worker.micaiah-tasks.workers.dev/sync`.
