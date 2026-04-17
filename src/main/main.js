const { app, BrowserWindow, ipcMain, nativeImage, clipboard, Menu, session, dialog, globalShortcut } = require('electron');
const path = require('path');
const Store = require('./store');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const store = new Store();

let mainWindow;

// Screenshot folder path
const SCREENSHOTS_PATH = path.join(os.homedir(), 'Desktop', 'screen_shot_data');

// Default projects folder
const PROJECTS_PATH = path.join(os.homedir(), 'Projects');

// Cloud sync endpoint
const SYNC_API = 'https://micaiahs-worker.micaiah-tasks.workers.dev/api/outerrim';

// Find the actual git binary path
function findGitPath() {
  const candidates = [
    '/usr/bin/git',
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
  ];
  
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const result = spawnSync(candidate, ['--version'], { timeout: 5000 });
        if (result.status === 0) {
          console.log(`Found working git at: ${candidate}`);
          return candidate;
        }
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
    
    console.log(`Running: ${gitPath} ${args.join(' ')} in ${cwd}`);
    
    const child = spawn(gitPath, args, { cwd, env: SHELL_ENV, timeout });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    
    child.on('error', (error) => {
      resolve({ success: false, stdout, stderr: stderr || error.message, code: -1, error: error.message });
    });
    
    child.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr, code: code || 0 });
    });
    
    if (timeout > 0) {
      setTimeout(() => { try { child.kill(); } catch (e) {} }, timeout);
    }
  });
}

function createWindow() {
  console.log(`Git path: ${getGitPath()}`);
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
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

  // Open DevTools with --dev flag
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
  
  // Ensure projects folder exists
  if (!fs.existsSync(PROJECTS_PATH)) {
    fs.mkdirSync(PROJECTS_PATH, { recursive: true });
  }
  
  watchScreenshots();
  initializeProfiles();
  syncWorkspacesToCloud();
}

function initializeProfiles() {
  const profiles = store.get('profiles') || [];
  if (profiles.length === 0) {
    store.set('profiles', [{ id: 'default', name: 'Default', createdAt: new Date().toISOString() }]);
  }
}

// ============================================
// CLOUD SYNC
// ============================================

async function syncWorkspacesToCloud() {
  try {
    const workspaces = store.get('workspaces') || [];
    const syncData = workspaces.map(w => ({
      id: w.id, name: w.name, notes: w.notes || '',
      updatedAt: w.updatedAt || w.createdAt || new Date().toISOString()
    }));
    
    const response = await fetch(`${SYNC_API}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaces: syncData })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`☁️ Synced ${result.workspaces?.length || 0} workspaces to cloud`);
      if (result.workspaces) mergeCloudWorkspaces(result.workspaces);
    }
  } catch (err) {
    console.error('Cloud sync error:', err.message);
  }
}

function mergeCloudWorkspaces(cloudWorkspaces) {
  const localWorkspaces = store.get('workspaces') || [];
  let updated = false;
  
  for (const cloud of cloudWorkspaces) {
    const local = localWorkspaces.find(w => w.id === cloud.id);
    if (local) {
      const cloudTime = new Date(cloud.updatedAt || 0).getTime();
      const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
      
      if (cloudTime > localTime && cloud.notes !== local.notes) {
        local.notes = cloud.notes;
        local.updatedAt = cloud.updatedAt;
        updated = true;
      }
    }
  }
  
  if (updated) {
    store.set('workspaces', localWorkspaces);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspaces:updated');
    }
  }
}

let syncTimeout = null;
function scheduleSyncToCloud() {
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(syncWorkspacesToCloud, 2000);
}

function createAppMenu() {
  const template = [
    {
      label: 'Outer Rim',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Sync Now', accelerator: 'CmdOrCtrl+Shift+S', click: () => syncWorkspacesToCloud() },
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
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { label: 'Toggle Webview DevTools', accelerator: 'F12', click: () => mainWindow.webContents.send('menu:toggleDevTools') },
        { label: 'Toggle App DevTools', accelerator: 'Alt+CmdOrCtrl+I', click: () => mainWindow.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let screenshotWatcher = null;
function watchScreenshots() {
  try {
    if (!fs.existsSync(SCREENSHOTS_PATH)) {
      fs.mkdirSync(SCREENSHOTS_PATH, { recursive: true });
    }
    
    screenshotWatcher = fs.watch(SCREENSHOTS_PATH, (eventType, filename) => {
      if (filename && /\.(png|jpg|jpeg)$/i.test(filename)) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('screenshot:new', filename);
        }
      }
    });
  } catch (err) {
    console.error('Error watching screenshots folder:', err);
  }
}

app.whenReady().then(() => {
  createAppMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (screenshotWatcher) screenshotWatcher.close();
  if (process.platform !== 'darwin') app.quit();
});

// ============================================
// DEVTOOLS IPC
// ============================================

ipcMain.handle('devtools:toggle', () => {
  mainWindow.webContents.toggleDevTools();
});

ipcMain.handle('devtools:openWebview', () => {
  mainWindow.webContents.send('menu:toggleDevTools');
});

// ============================================
// WORKSPACE IPC HANDLERS
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
  scheduleSyncToCloud();
  return workspace;
});

ipcMain.handle('workspace:update', (event, workspace) => {
  workspace.updatedAt = new Date().toISOString();
  const workspaces = store.get('workspaces') || [];
  const index = workspaces.findIndex(w => w.id === workspace.id);
  if (index !== -1) {
    workspaces[index] = workspace;
    store.set('workspaces', workspaces);
    scheduleSyncToCloud();
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
  scheduleSyncToCloud();
  return workspaces;
});

ipcMain.handle('workspace:setActive', (event, id) => {
  store.set('activeWorkspaceId', id);
  return id;
});

// ============================================
// NOTES IPC HANDLERS
// ============================================

ipcMain.handle('notes:update', (event, workspaceId, notes) => {
  const workspaces = store.get('workspaces') || [];
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.notes = notes;
    workspace.updatedAt = new Date().toISOString();
    store.set('workspaces', workspaces);
    scheduleSyncToCloud();
  }
  return notes;
});

// ============================================
// PROFILES IPC HANDLERS
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
// CLOUD SYNC IPC HANDLERS
// ============================================

ipcMain.handle('sync:now', async () => { await syncWorkspacesToCloud(); return { success: true }; });

ipcMain.handle('sync:pull', async () => {
  try {
    const response = await fetch(`${SYNC_API}/workspaces`);
    if (response.ok) {
      const data = await response.json();
      if (data.workspaces) { mergeCloudWorkspaces(data.workspaces); return { success: true, count: data.workspaces.length }; }
    }
    return { success: false };
  } catch (err) { return { success: false, error: err.message }; }
});

// ============================================
// PROJECT FOLDER OPERATIONS
// ============================================

function resolvePath(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath.startsWith('~')) return inputPath.replace('~', os.homedir());
  return inputPath;
}

ipcMain.handle('project:getProjectsPath', () => PROJECTS_PATH);

ipcMain.handle('project:exists', async (event, localPath) => {
  const resolved = resolvePath(localPath);
  return fs.existsSync(resolved);
});

ipcMain.handle('project:browse', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  });
  return result.canceled ? null : result.filePaths[0];
});

// ============================================
// GIT OPERATIONS
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
  } else {
    return { success: false, error: result.stderr || 'Status check failed' };
  }
});

ipcMain.handle('git:push', async (event, projectPath, commitMessage) => {
  const cwd = resolvePath(projectPath);
  const message = commitMessage || `Update from Outer Rim - ${new Date().toLocaleString()}`;
  
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
  } else {
    return { success: false, error: 'git push failed: ' + (result.stderr || result.error) };
  }
});

ipcMain.handle('git:pull', async (event, projectPath) => {
  const cwd = resolvePath(projectPath);
  
  const result = await runGit(['pull'], { cwd, timeout: 60000 });
  if (result.success) {
    return { success: true, message: result.stdout || 'Pulled successfully' };
  } else {
    return { success: false, error: result.stderr || result.error || 'Pull failed' };
  }
});

// ============================================
// SCREENSHOTS IPC HANDLERS
// ============================================

ipcMain.handle('screenshots:list', async () => {
  try {
    if (!fs.existsSync(SCREENSHOTS_PATH)) {
      fs.mkdirSync(SCREENSHOTS_PATH, { recursive: true });
      return [];
    }
    const files = await fs.promises.readdir(SCREENSHOTS_PATH);
    const screenshots = await Promise.all(
      files.filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f)).map(async (filename) => {
        const filepath = path.join(SCREENSHOTS_PATH, filename);
        const stat = await fs.promises.stat(filepath);
        return { name: filename, path: filepath, mtime: stat.mtime.getTime(), size: stat.size };
      })
    );
    screenshots.sort((a, b) => b.mtime - a.mtime);
    return screenshots;
  } catch (err) {
    return [];
  }
});

ipcMain.handle('screenshots:copy', async (event, filepath) => {
  try { clipboard.writeImage(nativeImage.createFromPath(filepath)); return true; } catch { return false; }
});

ipcMain.handle('screenshots:delete', async (event, filepath) => {
  try { await fs.promises.unlink(filepath); return true; } catch { return false; }
});

ipcMain.handle('screenshots:deleteAll', async () => {
  try {
    if (!fs.existsSync(SCREENSHOTS_PATH)) return true;
    const files = await fs.promises.readdir(SCREENSHOTS_PATH);
    await Promise.all(files.filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f)).map(f => fs.promises.unlink(path.join(SCREENSHOTS_PATH, f))));
    return true;
  } catch { return false; }
});

ipcMain.handle('screenshots:getPath', () => SCREENSHOTS_PATH);

// ============================================
// SCRATCHPAD IPC HANDLERS
// ============================================

ipcMain.handle('scratchpad:get', () => store.get('scratchpad') || '');
ipcMain.handle('scratchpad:save', (event, content) => { store.set('scratchpad', content); return content; });
