const { app, BrowserWindow, ipcMain, Menu, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const Store = require('./store');
const { registerTerminalHandlers } = require('./terminal');

const store = new Store();
let mainWindow;
let terminalCleanup = { cleanupAll() {} };

// ============================================
// GIT HELPERS (same pattern as Outer Rim)
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

    const child = spawn(gitPath, args, { cwd, env: SHELL_ENV, timeout });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ success: false, stdout, stderr: stderr || err.message, code: -1, error: err.message }));
    child.on('close', (code) => resolve({ success: code === 0, stdout, stderr, code: code || 0 }));

    if (timeout > 0) setTimeout(() => { try { child.kill(); } catch (e) {} }, timeout);
  });
}

// Extract "repo-name" from a git URL.
// Handles:
//   https://github.com/owner/repo.git -> repo
//   https://github.com/owner/repo     -> repo
//   git@github.com:owner/repo.git     -> repo
//   https://gitlab.com/group/sub/repo.git -> repo
function repoNameFromUrl(url) {
  if (!url) return null;
  let trimmed = url.trim();
  // Strip trailing slash and .git
  trimmed = trimmed.replace(/\.git$/i, '').replace(/\/$/, '');
  // Last path segment is the repo name
  const lastSlash = trimmed.lastIndexOf('/');
  const lastColon = trimmed.lastIndexOf(':');
  const cut = Math.max(lastSlash, lastColon);
  if (cut === -1) return null;
  const name = trimmed.substring(cut + 1);
  // Sanity: must look like a valid folder name
  if (!name || /[^A-Za-z0-9._-]/.test(name)) return null;
  return name;
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

function createAppMenu() {
  const template = [
    {
      label: 'Perimeter',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
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
        {
          label: 'Toggle Webview DevTools',
          accelerator: 'F12',
          click: () => mainWindow?.webContents.send('menu:toggleDevTools')
        },
        {
          label: 'Toggle App DevTools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => mainWindow?.webContents.toggleDevTools()
        },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'New Terminal Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow?.webContents.send('menu:newTerminal')
        },
        {
          label: 'Close Terminal Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('menu:closeTerminal')
        }
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
// WORKSPACE
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
  return workspace;
});

ipcMain.handle('workspace:delete', (event, id) => {
  let workspaces = store.get('workspaces') || [];
  workspaces = workspaces.filter(w => w.id !== id);
  store.set('workspaces', workspaces);
  if (store.get('activeWorkspaceId') === id) {
    store.set('activeWorkspaceId', workspaces[0]?.id || null);
  }
  return workspaces;
});

ipcMain.handle('workspace:setActive', (event, id) => {
  store.set('activeWorkspaceId', id);
  return id;
});

// ============================================
// NOTES
// ============================================

ipcMain.handle('notes:update', (event, workspaceId, notes) => {
  const workspaces = store.get('workspaces') || [];
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.notes = notes;
    workspace.updatedAt = new Date().toISOString();
    store.set('workspaces', workspaces);
  }
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
  return profile;
});

ipcMain.handle('profiles:delete', (event, id) => {
  if (id === 'default') return { error: 'Cannot delete default profile' };
  let profiles = store.get('profiles') || [];
  profiles = profiles.filter(p => p.id !== id);
  store.set('profiles', profiles);
  try { session.fromPartition(`persist:profile-${id}`).clearStorageData(); } catch (e) {}
  return profiles;
});

ipcMain.handle('profiles:rename', (event, id, name) => {
  const profiles = store.get('profiles') || [];
  const profile = profiles.find(p => p.id === id);
  if (profile) { profile.name = name; store.set('profiles', profiles); }
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

// ---- git:clone ----------------------------------------------------
//
// Clone a repository into a parent folder. The parent is the workspace's
// Project Folder if set, otherwise we auto-create ~/Projects.
//
// Args: { url, parentPath }
//   url        — git URL to clone (https or ssh)
//   parentPath — directory to clone INTO (the repo will become a subfolder)
//                If null/empty, defaults to ~/Projects (created if missing).
//
// Returns: { success, clonedPath, repoName, parentPath, message } on success
//          { success: false, error } on failure
//
ipcMain.handle('git:clone', async (event, args = {}) => {
  const { url, parentPath } = args;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { success: false, error: 'Repository URL is required' };
  }

  const repoName = repoNameFromUrl(url);
  if (!repoName) {
    return { success: false, error: 'Could not parse a repository name from that URL' };
  }

  // Resolve the parent directory. If none provided, use ~/Projects.
  let parent = resolvePath(parentPath || '');
  if (!parent) {
    parent = path.join(os.homedir(), 'Projects');
  }

  // Create parent if it doesn't exist (recursive so ~/Projects "just works")
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

  // Clone. Using `git clone <url> <repoName>` with cwd=parent so dest is
  // <parent>/<repoName>. timeout=5min for big repos.
  const result = await runGit(['clone', url.trim(), repoName], {
    cwd: parent,
    timeout: 5 * 60 * 1000,
  });

  if (!result.success) {
    // Surface git's actual error so the user can act on it (auth, 404, etc).
    const errMsg = (result.stderr || result.error || 'git clone failed').trim();
    return { success: false, error: errMsg };
  }

  return {
    success: true,
    clonedPath: destPath,
    repoName,
    parentPath: parent,
    message: `Cloned ${repoName} into ${parent}`,
  };
});
