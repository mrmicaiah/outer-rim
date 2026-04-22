// Local copy of shared sync-client — electron-builder doesn't bundle sibling directories.
// If shared/sync-client.js changes, copy it here too.

const { app: electronApp, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_WORKER_URL = 'https://micaiahs-worker.micaiah-tasks.workers.dev';
const SYNC_PATH_PREFIX = '/sync';
const DIRTY_PUSH_INTERVAL_MS = 5 * 60 * 1000;
const LOOPBACK_PORT_RANGE = [47800, 47900];

function createSync(options) {
  const {
    appName,
    workerUrl = process.env.OUTER_RIM_SYNC_URL || DEFAULT_WORKER_URL,
    storePath,
    getLocalState,
    applyRemoteState,
    onStatusChange = () => {},
  } = options;

  if (!appName) throw new Error('sync-client: appName required');
  if (!storePath) throw new Error('sync-client: storePath required');
  if (typeof getLocalState !== 'function') throw new Error('sync-client: getLocalState required');
  if (typeof applyRemoteState !== 'function') throw new Error('sync-client: applyRemoteState required');

  let syncState = loadSyncState(storePath);
  let dirty = false;
  let autoPushTimer = null;
  let currentStatus = syncState.token ? 'idle' : 'signed-out';

  function setStatus(status, extra = {}) {
    currentStatus = status;
    onStatusChange({
      status,
      signedIn: !!syncState.token,
      githubLogin: syncState.githubLogin || null,
      lastSyncedAt: syncState.lastSyncedAt || null,
      ...extra,
    });
  }

  function saveSyncState() {
    try {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(syncState, null, 2), 'utf8');
    } catch (err) {
      console.error('[sync] failed to save sync state:', err);
    }
  }

  async function apiFetch(pathPart, { method = 'GET', body, extraHeaders = {} } = {}) {
    if (!syncState.token) throw new Error('not_signed_in');
    const resp = await fetch(`${workerUrl}${SYNC_PATH_PREFIX}${pathPart}`, {
      method,
      headers: {
        Authorization: `Bearer ${syncState.token}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return resp;
  }

  async function pullFromServer() {
    setStatus('pulling');
    const resp = await apiFetch(`/v1/state/${appName}`);
    if (resp.status === 404) { setStatus('idle'); return { existed: false }; }
    if (resp.status === 401) {
      syncState.token = null; syncState.githubLogin = null;
      saveSyncState(); setStatus('signed-out', { error: 'token_revoked' });
      throw new Error('token_revoked');
    }
    if (!resp.ok) {
      setStatus('error', { error: `pull_failed_${resp.status}` });
      throw new Error(`pull_failed_${resp.status}`);
    }
    const payload = await resp.json();
    applyRemoteState(payload.data);
    syncState.etag = payload.etag;
    syncState.lastSyncedAt = payload.updatedAt;
    saveSyncState();
    setStatus('idle');
    return { existed: true, etag: payload.etag, updatedAt: payload.updatedAt };
  }

  async function pushToServer({ force = false } = {}) {
    setStatus('pushing');
    const data = await getLocalState();
    const headers = {};
    if (force) headers['If-Match'] = '*';
    else if (syncState.etag) headers['If-Match'] = syncState.etag;
    else headers['If-Match'] = '*';

    const resp = await apiFetch(`/v1/state/${appName}`, { method: 'PUT', body: { data }, extraHeaders: headers });

    if (resp.status === 409) {
      const body = await resp.json().catch(() => ({}));
      setStatus('conflict', { serverEtag: body.serverEtag, serverUpdatedAt: body.serverUpdatedAt });
      return { conflict: true, body };
    }
    if (resp.status === 401) {
      syncState.token = null; syncState.githubLogin = null;
      saveSyncState(); setStatus('signed-out', { error: 'token_revoked' });
      throw new Error('token_revoked');
    }
    if (!resp.ok) {
      setStatus('error', { error: `push_failed_${resp.status}` });
      throw new Error(`push_failed_${resp.status}`);
    }
    const payload = await resp.json();
    syncState.etag = payload.etag;
    syncState.lastSyncedAt = payload.updatedAt;
    saveSyncState();
    dirty = false;
    setStatus('idle');
    return { ok: true, etag: payload.etag };
  }

  async function syncNow({ direction = 'auto' } = {}) {
    if (!syncState.token) { setStatus('signed-out'); return { skipped: 'signed-out' }; }
    try {
      if (direction === 'pull' || !syncState.etag) await pullFromServer();
      if (direction !== 'pull') {
        const result = await pushToServer();
        if (result.conflict) return result;
      }
      return { ok: true };
    } catch (err) {
      if (err.message === 'token_revoked') return { error: 'token_revoked' };
      setStatus('error', { error: err.message });
      return { error: err.message };
    }
  }

  function markDirty() { dirty = true; }

  function startAutoPushTimer() {
    if (autoPushTimer) clearInterval(autoPushTimer);
    autoPushTimer = setInterval(() => {
      if (dirty && syncState.token) {
        pushToServer().catch((err) => console.error('[sync] auto-push failed:', err));
      }
    }, DIRTY_PUSH_INTERVAL_MS);
    if (autoPushTimer.unref) autoPushTimer.unref();
  }

  function wireQuitHook() {
    electronApp.on('before-quit', async (e) => {
      if (!dirty || !syncState.token) return;
      e.preventDefault();
      try {
        await Promise.race([pushToServer(), new Promise((res) => setTimeout(res, 3000))]);
      } catch (err) {
        console.error('[sync] quit-time push failed:', err);
      }
      electronApp.exit(0);
    });
  }

  async function signIn() {
    if (syncState.token) return { alreadySignedIn: true, githubLogin: syncState.githubLogin };
    const { server, port } = await openLoopbackServer();
    const credsPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { server.close(); reject(new Error('oauth_timeout')); }, 5 * 60 * 1000);
      server.once('sync-creds', (creds) => { clearTimeout(timeout); server.close(); resolve(creds); });
    });
    const startUrl = `${workerUrl}${SYNC_PATH_PREFIX}/oauth/start?app=${encodeURIComponent(appName)}&port=${port}`;
    shell.openExternal(startUrl);
    try {
      const creds = await credsPromise;
      syncState.token = creds.token;
      syncState.githubLogin = creds.githubLogin;
      syncState.githubUserId = creds.githubUserId;
      syncState.etag = null;
      syncState.lastSyncedAt = null;
      saveSyncState();
      setStatus('idle');
      await syncNow({ direction: 'pull' }).catch(() => {});
      return { ok: true, githubLogin: creds.githubLogin };
    } catch (err) {
      setStatus('signed-out', { error: err.message });
      return { error: err.message };
    }
  }

  async function signOut() {
    syncState.token = null;
    syncState.githubLogin = null;
    syncState.githubUserId = null;
    syncState.etag = null;
    syncState.lastSyncedAt = null;
    saveSyncState();
    setStatus('signed-out');
    return { ok: true };
  }

  async function init() {
    wireQuitHook();
    startAutoPushTimer();
    setStatus(syncState.token ? 'idle' : 'signed-out');
    if (syncState.token) {
      syncNow({ direction: 'pull' }).catch((err) => console.error('[sync] startup pull failed:', err));
    }
  }

  return {
    init, signIn, signOut, syncNow, markDirty, pushToServer, pullFromServer,
    getStatus: () => ({
      status: currentStatus,
      signedIn: !!syncState.token,
      githubLogin: syncState.githubLogin || null,
      lastSyncedAt: syncState.lastSyncedAt || null,
      etag: syncState.etag || null,
      dirty,
    }),
    isSignedIn: () => !!syncState.token,
  };
}

function loadSyncState(storePath) {
  try {
    if (fs.existsSync(storePath)) {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      return {
        token: parsed.token || null,
        githubLogin: parsed.githubLogin || null,
        githubUserId: parsed.githubUserId || null,
        etag: parsed.etag || null,
        lastSyncedAt: parsed.lastSyncedAt || null,
      };
    }
  } catch (err) {
    console.error('[sync] failed to load sync state:', err);
  }
  return { token: null, githubLogin: null, githubUserId: null, etag: null, lastSyncedAt: null };
}

function openLoopbackServer() {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > LOOPBACK_PORT_RANGE[1]) { reject(new Error('no_free_loopback_port')); return; }
      const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (req.method === 'POST' && req.url === '/auth') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            try {
              const creds = JSON.parse(body);
              if (!creds.token || !creds.githubLogin) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'incomplete_creds' }));
                return;
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
              server.emit('sync-creds', creds);
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'bad_json' }));
            }
          });
          return;
        }
        res.writeHead(404);
        res.end('not_found');
      });
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') tryPort(port + 1);
        else reject(err);
      });
      server.listen(port, '127.0.0.1', () => resolve({ server, port }));
    };
    tryPort(LOOPBACK_PORT_RANGE[0]);
  });
}

module.exports = createSync;
