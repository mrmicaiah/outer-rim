const { app, BrowserWindow, ipcMain, Menu, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const Store = require('./store');
const { registerTerminalHandlers } = require('./terminal');
const createSync = require('./sync-client');

const store = new Store();
let mainWindow;
let terminalCleanup = { cleanupAll() {} };
let sync = null;

function markDirty() { if (sync) sync.markDirty(); }

// ============================================
// GIT HELPERS
// ============================================

function findGitPath() {
  const candidates = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const result = spawnSync(candidate, ['--version'], { timeout: 5000 });
        if (result.status === 0) return candidate;
      }
    } catch (e) {}
  }
  return 'git';
}

let GIT_PATH = null;
function getGitPath() {
  if (!GIT_PATH) GIT_PATH = findGitPath();
  return GIT_PATH;
}

const SHELL_ENV = {
  ...process.env,
  PATH: `/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}`,
  HOME: os.homedir()
};

function runGit(args, options = {}) {
  return new Promise((resolve) => {
    const gitPath = getGitPath();
    const cwd = options.cwd || os.homedir();
    const timeout = options.timeout || 60000;

    // Allow caller to override env (used to inject GH_TOKEN for HTTPS auth).
    const env = options.env || SHELL_ENV;

    const child = spawn(gitPath, args, { cwd, env, timeout });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ success: false, stdout, stderr: stderr || err.message, code: -1, error: err.message }));
    child.on('close', (code) => resolve({ success: code === 0, stdout, stderr, code: code || 0 }));

    if (timeout > 0) setTimeout(() => { try { child.kill(); } catch (e) {} }, timeout);
  });
}

function repoNameFromUrl(url) {
  if (!url) return null;
  let trimmed = url.trim();
  trimmed = trimmed.replace(/\.git$/i, '').replace(/\/$/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  const lastColon = trimmed.lastIndexOf(':');
  const cut = Math.max(lastSlash, lastColon);
  if (cut === -1) return null;
  const name = trimmed.substring(cut + 1);
  if (!name || /[^A-Za-z0-9._-]/.test(name)) return null;
  return name;
}

// Inject the GitHub token into an HTTPS clone URL so private clones work
// without prompting. Format: https://x-access-token:{token}@github.com/owner/repo.git
function injectTokenIntoHttpsUrl(url, token) {
  if (!token) return url;
  if (!/^https?:\/\//i.test(url)) return url; // SSH or other — leave as-is
  return url.replace(/^(https?:\/\/)/i, `$1x-access-token:${token}@`);
}

// ============================================
// WINDOW
// ============================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Perimeter',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  initializeProfiles();
}

function initializeProfiles() {
  const profiles = store.get('profiles') || [];
  if (profiles.length === 0) {
    store.set('profiles', [{ id: 'default', name: 'Default', createdAt: new Date().toISOString() }]);
  }
}

// ============================================
// Cloud sync wiring
// ============================================

function initializeSync() {
  const syncStatePath = path.join(app.getPath('userData'), 'perimeter-sync.json');

  sync = createSync({
    appName: 'perimeter',
    storePath: syncStatePath,
    workerUrl: process.env.OUTER_RIM_SYNC_URL,
    getLocalState: () => store.getAll(),
    applyRemoteState: (data) => {
      store.replaceAll(data);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:remote-applied');
      }
    },
    onStatusChange: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:status', status);
      }
    },
  });

  sync.init();
}

function createAppMenu() {
  const template = [
    {
      label: 'Perimeter',
      submenu: [
        { role: 'about' }, { type: 'separator' }, { role: 'services' },
        { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { label: 'Toggle Webview DevTools', accelerator: 'F12', click: () => mainWindow?.webContents.send('menu:toggleDevTools') },
        { label: 'Toggle App DevTools', accelerator: 'Alt+CmdOrCtrl+I', click: () => mainWindow?.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Terminal',
      submenu: [
        { label: 'New Terminal Tab', accelerator: 'CmdOrCtrl+T', click: () => mainWindow?.webContents.send('menu:newTerminal') },
        { label: 'Close Terminal Tab', accelerator: 'CmdOrCtrl+W', click: () => mainWindow?.webContents.send('menu:closeTerminal') }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
        { role: 'front' }, { type: 'separator' }, { role: 'window' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createAppMenu();
  createWindow();
  terminalCleanup = registerTerminalHandlers();
  initializeSync();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  terminalCleanup.cleanupAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  terminalCleanup.cleanupAll();
});

// ============================================
// DEVTOOLS
// ============================================

ipcMain.handle('devtools:toggle', () => mainWindow?.webContents.toggleDevTools());
ipcMain.handle('devtools:openWebview', () => mainWindow?.webContents.send('menu:toggleDevTools'));

// ============================================
// WORKSPACE (mutations mark sync dirty)
// ============================================

ipcMain.handle('workspace:getAll', () => store.get('workspaces') || []);

ipcMain.handle('workspace:getActive', () => {
  const activeId = store.get('activeWorkspaceId');
  return (store.get('workspaces') || []).find(w => w.id === activeId) || null;
});

ipcMain.handle('workspace:create', (event, workspace) => {
  workspace.updatedAt = new Date().toISOString();
  const workspaces = store.get('workspaces') || [];
  workspaces.push(workspace);
  store.set('workspaces', workspaces);
  store.set('activeWorkspaceId', workspace.id);
  markDirty();
  return workspace;
});

ipcMain.handle('workspace:update', (event, workspace) => {
  workspace.updatedAt = new Date().toISOString();
  const workspaces = store.get('workspaces') || [];
  const index = workspaces.findIndex(w => w.id === workspace.id);
  if (index !== -1) {
    workspaces[index] = workspace;
    store.set('workspaces', workspaces);
  }
  markDirty();
  return workspace;
});

ipcMain.handle('workspace:delete', (event, id) => {
  let workspaces = store.get('workspaces') || [];
  workspaces = workspaces.filter(w => w.id !== id);
  store.set('workspaces', workspaces);
  if (store.get('activeWorkspaceId') === id) {
    store.set('activeWorkspaceId', workspaces[0]?.id || null);
  }
  markDirty();
  return workspaces;
});

ipcMain.handle('workspace:setActive', (event, id) => {
  store.set('activeWorkspaceId', id);
  markDirty();
  return id;
});

ipcMain.handle('notes:update', (event, workspaceId, notes) => {
  const workspaces = store.get('workspaces') || [];
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.notes = notes;
    workspace.updatedAt = new Date().toISOString();
    store.set('workspaces', workspaces);
  }
  markDirty();
  return notes;
});

// ============================================
// PROFILES
// ============================================

ipcMain.handle('profiles:getAll', () => {
  return store.get('profiles') || [{ id: 'default', name: 'Default', createdAt: new Date().toISOString() }];
});

ipcMain.handle('profiles:create', (event, name) => {
  const profiles = store.get('profiles') || [];
  let id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  let uniqueId = id, counter = 1;
  while (profiles.some(p => p.id === uniqueId)) { uniqueId = `${id}-${counter++}`; }
  const profile = { id: uniqueId, name, createdAt: new Date().toISOString() };
  profiles.push(profile);
  store.set('profiles', profiles);
  markDirty();
  return profile;
});

ipcMain.handle('profiles:delete', (event, id) => {
  if (id === 'default') return { error: 'Cannot delete default profile' };
  let profiles = store.get('profiles') || [];
  profiles = profiles.filter(p => p.id !== id);
  store.set('profiles', profiles);
  try { session.fromPartition(`persist:profile-${id}`).clearStorageData(); } catch (e) {}
  markDirty();
  return profiles;
});

ipcMain.handle('profiles:rename', (event, id, name) => {
  const profiles = store.get('profiles') || [];
  const profile = profiles.find(p => p.id === id);
  if (profile) { profile.name = name; store.set('profiles', profiles); }
  markDirty();
  return profiles;
});

// ============================================
// PROJECT FOLDER
// ============================================

function resolvePath(p) {
  if (!p) return p;
  if (p.startsWith('~')) return p.replace('~', os.homedir());
  return p;
}

ipcMain.handle('project:browse', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('project:exists', async (event, localPath) => {
  const resolved = resolvePath(localPath);
  return fs.existsSync(resolved);
});

// ============================================
// GIT
// ============================================

ipcMain.handle('git:status', async (event, projectPath) => {
  const cwd = resolvePath(projectPath);
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { success: false, error: 'Not a git repository' };
  }
  const result = await runGit(['status', '--porcelain'], { cwd });
  if (result.success) {
    const changes = result.stdout.trim().split('\n').filter(Boolean).map(line => ({
      status: line.substring(0, 2).trim(),
      file: line.substring(3)
    }));
    return { success: true, changes, hasChanges: changes.length > 0 };
  }
  return { success: false, error: result.stderr || 'Status check failed' };
});

ipcMain.handle('git:push', async (event, projectPath, commitMessage) => {
  const cwd = resolvePath(projectPath);
  const message = commitMessage || `Update from Perimeter - ${new Date().toLocaleString()}`;

  let result = await runGit(['add', '-A'], { cwd });
  if (!result.success) return { success: false, error: 'git add failed: ' + (result.stderr || result.error) };

  result = await runGit(['commit', '-m', message], { cwd });
  if (!result.success) {
    if (result.stdout.includes('nothing to commit') || result.stderr.includes('nothing to commit')) {
      return { success: true, message: 'Nothing to commit' };
    }
    return { success: false, error: 'git commit failed: ' + (result.stderr || result.error) };
  }

  result = await runGit(['push'], { cwd, timeout: 60000 });
  if (result.success) {
    return { success: true, message: result.stdout || 'Pushed successfully' };
  }
  return { success: false, error: 'git push failed: ' + (result.stderr || result.error) };
});

ipcMain.handle('git:pull', async (event, projectPath) => {
  const cwd = resolvePath(projectPath);
  const result = await runGit(['pull'], { cwd, timeout: 60000 });
  if (result.success) {
    return { success: true, message: result.stdout || 'Pulled successfully' };
  }
  return { success: false, error: result.stderr || result.error || 'Pull failed' };
});

ipcMain.handle('git:clone', async (event, args = {}) => {
  const { url, parentPath } = args;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { success: false, error: 'Repository URL is required' };
  }

  const repoName = repoNameFromUrl(url);
  if (!repoName) {
    return { success: false, error: 'Could not parse a repository name from that URL' };
  }

  let parent = resolvePath(parentPath || '');
  if (!parent) parent = path.join(os.homedir(), 'Projects');

  try {
    fs.mkdirSync(parent, { recursive: true });
  } catch (err) {
    return { success: false, error: `Could not create parent folder: ${err.message}` };
  }

  const destPath = path.join(parent, repoName);
  if (fs.existsSync(destPath)) {
    return {
      success: false,
      error: `A folder named "${repoName}" already exists in ${parent}. Choose a different name or delete it first.`,
      destPath,
    };
  }

  // If signed in to GitHub via cloud sync AND this looks like a github URL,
  // inject the token so private repos work without prompting. SSH URLs are
  // left alone (those use the user's SSH keys).
  let cloneUrl = url.trim();
  if (sync && sync.isSignedIn() && /^https?:\/\/(www\.)?github\.com\//i.test(cloneUrl)) {
    try {
      const token = await sync.getGithubToken();
      cloneUrl = injectTokenIntoHttpsUrl(cloneUrl, token);
    } catch (err) {
      // Token fetch failed — fall through and try without auth (public repo case).
      console.warn('[clone] could not fetch GitHub token, attempting unauthenticated clone:', err.message);
    }
  }

  const result = await runGit(['clone', cloneUrl, repoName], {
    cwd: parent,
    timeout: 5 * 60 * 1000,
  });

  if (!result.success) {
    // Scrub any token from the error message before returning to the renderer
    const safeStderr = (result.stderr || result.error || 'git clone failed').replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
    return { success: false, error: safeStderr.trim() };
  }

  return {
    success: true,
    clonedPath: destPath,
    repoName,
    parentPath: parent,
    message: `Cloned ${repoName} into ${parent}`,
  };
});

// ============================================
// GITHUB API (list user repos)
// ============================================

ipcMain.handle('github:listRepos', async () => {
  if (!sync || !sync.isSignedIn()) {
    return { success: false, error: 'Not signed in to GitHub. Sign in via Cloud Sync first.' };
  }

  let token;
  try {
    token = await sync.getGithubToken();
  } catch (err) {
    if (err.message === 'stale_session_resign_in') {
      return { success: false, error: 'Your session is from before GitHub auth was wired up. Sign out and sign in again.' };
    }
    return { success: false, error: `Could not fetch GitHub token: ${err.message}` };
  }

  // Fetch up to 100 most-recently-updated repos. If user has more than that,
  // they can search by typing the URL directly.
  try {
    const resp = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'perimeter-app',
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { success: false, error: `GitHub API error (${resp.status}): ${body.substring(0, 200)}` };
    }
    const repos = await resp.json();
    const slim = repos.map(r => ({
      name: r.name,
      full_name: r.full_name,
      description: r.description,
      private: r.private,
      fork: r.fork,
      clone_url: r.clone_url,
      ssh_url: r.ssh_url,
      html_url: r.html_url,
      updated_at: r.updated_at,
      default_branch: r.default_branch,
    }));
    return { success: true, repos: slim };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============================================
// CLOUD SYNC IPC
// ============================================

ipcMain.handle('sync:getStatus', () => {
  return sync ? sync.getStatus() : { status: 'signed-out', signedIn: false };
});

ipcMain.handle('sync:signIn', async () => {
  if (!sync) return { error: 'sync_not_ready' };
  return await sync.signIn();
});

ipcMain.handle('sync:signOut', async () => {
  if (!sync) return { error: 'sync_not_ready' };
  return await sync.signOut();
});

ipcMain.handle('sync:syncNow', async (event, { direction } = {}) => {
  if (!sync) return { error: 'sync_not_ready' };
  return await sync.syncNow({ direction });
});

ipcMain.handle('sync:pushForce', async () => {
  if (!sync) return { error: 'sync_not_ready' };
  return await sync.pushToServer({ force: true });
});

ipcMain.handle('sync:pullForce', async () => {
  if (!sync) return { error: 'sync_not_ready' };
  return await sync.pullFromServer();
});
