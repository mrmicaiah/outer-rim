// ============================================
// Outer Rim Cloud Sync Worker
// ============================================
//
// Endpoints (see README.md for full contract):
//   GET  /oauth/start?app=quartet&port=47821
//   GET  /oauth/callback?code=...&state=...
//   GET  /v1/me
//   GET  /v1/state/{app}
//   PUT  /v1/state/{app}    (If-Match header carries etag)
//   DEL  /v1/state/{app}
//
// Storage model in KV:
//   oauth_state:{stateToken}  → { app, localPort, expiresAt }   (10 min TTL)
//   token:{opaqueToken}       → { githubUserId, githubLogin, createdAt }
//   state:{uid}:{app}         → { etag, data, updatedAt }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/') {
        return jsonResponse({ name: 'outer-rim-sync', ok: true });
      }

      if (url.pathname === '/oauth/start') {
        return handleOAuthStart(request, env, url);
      }
      if (url.pathname === '/oauth/callback') {
        return handleOAuthCallback(request, env, url);
      }

      if (url.pathname === '/v1/me') {
        return authed(request, env, (session) =>
          jsonResponse({ githubUserId: session.githubUserId, githubLogin: session.githubLogin })
        );
      }

      const stateMatch = url.pathname.match(/^\/v1\/state\/([a-z0-9_-]+)$/);
      if (stateMatch) {
        const app = stateMatch[1];
        if (!isValidApp(app, env)) {
          return jsonResponse({ error: 'unknown_app', app }, 400);
        }
        return authed(request, env, (session) => {
          if (request.method === 'GET') return handleGetState(env, session, app);
          if (request.method === 'PUT') return handlePutState(request, env, session, app);
          if (request.method === 'DELETE') return handleDeleteState(env, session, app);
          return jsonResponse({ error: 'method_not_allowed' }, 405);
        });
      }

      return jsonResponse({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'internal', detail: err.message }, 500);
    }
  },
};

// ============================================
// Helpers
// ============================================

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function isValidApp(app, env) {
  const valid = (env.VALID_APPS || 'outer-rim,parallel,perimeter,quartet')
    .split(',')
    .map((s) => s.trim());
  return valid.includes(app);
}

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function authed(request, env, handler) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return jsonResponse({ error: 'missing_token' }, 401);

  const token = m[1].trim();
  const raw = await env.SYNC_KV.get(`token:${token}`);
  if (!raw) return jsonResponse({ error: 'invalid_token' }, 401);

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: 'corrupt_session' }, 500);
  }

  return handler(session);
}

// ============================================
// OAuth
// ============================================

async function handleOAuthStart(request, env, url) {
  const app = url.searchParams.get('app');
  const localPort = url.searchParams.get('port');

  if (!app || !isValidApp(app, env)) {
    return new Response('Bad request: missing or invalid ?app=', { status: 400 });
  }
  if (!localPort || !/^\d{4,5}$/.test(localPort)) {
    return new Response('Bad request: missing or invalid ?port=', { status: 400 });
  }

  const state = randomToken(16);
  await env.SYNC_KV.put(
    `oauth_state:${state}`,
    JSON.stringify({ app, localPort, createdAt: Date.now() }),
    { expirationTtl: 600 }
  );

  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return new Response('Worker misconfigured: GITHUB_CLIENT_ID not set', { status: 500 });
  }

  const redirectUri = `${url.origin}/oauth/callback`;
  const ghUrl = new URL('https://github.com/login/oauth/authorize');
  ghUrl.searchParams.set('client_id', clientId);
  ghUrl.searchParams.set('redirect_uri', redirectUri);
  ghUrl.searchParams.set('scope', 'read:user');
  ghUrl.searchParams.set('state', state);
  ghUrl.searchParams.set('allow_signup', 'false');

  return Response.redirect(ghUrl.toString(), 302);
}

async function handleOAuthCallback(request, env, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return htmlPage('Missing code or state.', 'error');
  }

  const rawState = await env.SYNC_KV.get(`oauth_state:${state}`);
  if (!rawState) {
    return htmlPage('Login session expired — please try signing in again.', 'error');
  }
  const { app, localPort } = JSON.parse(rawState);
  // One-shot: remove state token.
  await env.SYNC_KV.delete(`oauth_state:${state}`);

  // Exchange code for a GitHub access token.
  const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!tokenResp.ok) {
    return htmlPage(`GitHub token exchange failed (${tokenResp.status}).`, 'error');
  }
  const tokenPayload = await tokenResp.json();
  if (!tokenPayload.access_token) {
    return htmlPage(`GitHub rejected the code: ${tokenPayload.error || 'unknown'}.`, 'error');
  }

  // Identify the user.
  const userResp = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'outer-rim-sync',
    },
  });
  if (!userResp.ok) {
    return htmlPage('Could not read GitHub user profile.', 'error');
  }
  const ghUser = await userResp.json();
  if (!ghUser.id || !ghUser.login) {
    return htmlPage('GitHub user profile missing id/login.', 'error');
  }

  // Mint an opaque sync token for this device.
  const syncToken = randomToken(32);
  await env.SYNC_KV.put(
    `token:${syncToken}`,
    JSON.stringify({
      githubUserId: String(ghUser.id),
      githubLogin: ghUser.login,
      app,
      createdAt: Date.now(),
    })
  );

  // Render a page that posts the token to the local Electron loopback.
  // The Electron app is listening on http://127.0.0.1:{localPort}/auth with a
  // one-shot server. If POST fails (e.g. app closed), the user can copy the
  // token manually from the displayed code block.
  const body = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Signed in — Outer Rim Sync</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #1a1a1f; color: #eee; padding: 40px; text-align: center; }
    h1 { color: #3b82f6; }
    p { color: #a0a0a8; max-width: 480px; margin: 16px auto; line-height: 1.5; }
    code { background: #232329; padding: 4px 8px; border-radius: 4px; color: #fff; font-family: 'SF Mono', Monaco, monospace; word-break: break-all; }
    .status { margin-top: 20px; font-size: 14px; }
    .ok { color: #22c55e; }
    .pending { color: #f59e0b; }
    .fail { color: #ef4444; }
    details { margin-top: 24px; max-width: 600px; margin-left: auto; margin-right: auto; }
    summary { cursor: pointer; color: #a0a0a8; font-size: 13px; }
    pre { background: #232329; padding: 12px; border-radius: 6px; overflow-x: auto; color: #fff; text-align: left; }
  </style>
</head>
<body>
  <h1>✓ Signed in as @${escapeHtml(ghUser.login)}</h1>
  <p>Sending credentials back to <strong>${escapeHtml(app)}</strong>…</p>
  <p class="status pending" id="status">Connecting…</p>
  <p id="close-hint" style="display:none; color:#a0a0a8; font-size:13px;">You can close this window.</p>

  <details>
    <summary>Trouble? Paste this token into the app manually.</summary>
    <pre id="manual-token">${escapeHtml(syncToken)}</pre>
  </details>

  <script>
    const token = ${JSON.stringify(syncToken)};
    const app = ${JSON.stringify(app)};
    const ghLogin = ${JSON.stringify(ghUser.login)};
    const ghUserId = ${JSON.stringify(String(ghUser.id))};
    const port = ${JSON.stringify(localPort)};
    const statusEl = document.getElementById('status');
    const closeHint = document.getElementById('close-hint');

    fetch('http://127.0.0.1:' + port + '/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, app: app, githubLogin: ghLogin, githubUserId: ghUserId })
    }).then((r) => {
      if (r.ok) {
        statusEl.textContent = '✓ App received credentials.';
        statusEl.className = 'status ok';
        closeHint.style.display = 'block';
      } else {
        statusEl.textContent = '⚠ App rejected credentials — paste the token manually below.';
        statusEl.className = 'status fail';
      }
    }).catch((err) => {
      statusEl.textContent = '⚠ Could not reach the app. Paste the token manually below.';
      statusEl.className = 'status fail';
    });
  </script>
</body>
</html>`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
  });
}

function htmlPage(message, kind = 'info') {
  const color = kind === 'error' ? '#ef4444' : '#3b82f6';
  const body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Outer Rim Sync</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:#1a1a1f;color:#eee;padding:40px;text-align:center}h1{color:${color}}</style></head><body><h1>${escapeHtml(message)}</h1></body></html>`;
  return new Response(body, {
    status: kind === 'error' ? 400 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ============================================
// State endpoints
// ============================================

async function handleGetState(env, session, app) {
  const key = `state:${session.githubUserId}:${app}`;
  const raw = await env.SYNC_KV.get(key);
  if (!raw) {
    return jsonResponse({ error: 'not_found' }, 404);
  }
  const record = JSON.parse(raw);
  return jsonResponse({
    etag: record.etag,
    data: record.data,
    updatedAt: record.updatedAt,
  });
}

async function handlePutState(request, env, session, app) {
  const ifMatch = request.headers.get('If-Match');
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  if (!body || typeof body.data === 'undefined') {
    return jsonResponse({ error: 'missing_data_field' }, 400);
  }

  const key = `state:${session.githubUserId}:${app}`;
  const existingRaw = await env.SYNC_KV.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;

  // Concurrency check: if the client sent If-Match, the server etag must match.
  // If the client sent If-Match: * or no header AND there's no existing record, it's a create.
  if (existing) {
    if (!ifMatch) {
      return jsonResponse(
        { error: 'etag_required', serverEtag: existing.etag },
        428 // Precondition Required
      );
    }
    if (ifMatch !== '*' && ifMatch !== existing.etag) {
      return jsonResponse(
        {
          error: 'conflict',
          serverEtag: existing.etag,
          serverUpdatedAt: existing.updatedAt,
          serverData: existing.data,
        },
        409
      );
    }
  } else {
    // No existing record.
    if (ifMatch && ifMatch !== '*') {
      // Client thinks they're updating something that doesn't exist.
      return jsonResponse({ error: 'not_found' }, 404);
    }
  }

  const newEtag = randomToken(8);
  const now = new Date().toISOString();
  const record = {
    etag: newEtag,
    data: body.data,
    updatedAt: now,
  };
  await env.SYNC_KV.put(key, JSON.stringify(record));

  return jsonResponse({ etag: newEtag, updatedAt: now });
}

async function handleDeleteState(env, session, app) {
  const key = `state:${session.githubUserId}:${app}`;
  await env.SYNC_KV.delete(key);
  return jsonResponse({ ok: true });
}
