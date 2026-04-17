const { app, BrowserWindow, ipcMain, nativeImage, clipboard, Menu, session } = require('electron');
const path = require('path');
const Store = require('./store');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

const store = new Store();

let mainWindow;

// Screenshot folder path
const SCREENSHOTS_PATH = path.join(os.homedir(), 'Desktop', 'screen_shot_data');

function createWindow() {
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

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
  
  // Watch for new screenshots
  watchScreenshots();
  
  // Initialize default profile if none exist
  initializeProfiles();
}

// Initialize profiles
function initializeProfiles() {
  const profiles = store.get('profiles') || [];
  if (profiles.length === 0) {
    store.set('profiles', [
      { id: 'default', name: 'Default', createdAt: new Date().toISOString() }
    ]);
  }
}

// Create application menu with Edit menu for copy/paste
function createAppMenu() {
  const template = [
    {
      label: 'Outer Rim',
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
        {
          label: 'Toggle Webview DevTools',
          accelerator: 'F12',
          click: () => {
            mainWindow.webContents.send('menu:toggleDevTools');
          }
        },
        {
          label: 'Toggle App DevTools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        },
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

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Watch screenshots folder for changes
let screenshotWatcher = null;
function watchScreenshots() {
  try {
    // Make sure folder exists
    if (!fs.existsSync(SCREENSHOTS_PATH)) {
      fs.mkdirSync(SCREENSHOTS_PATH, { recursive: true });
    }
    
    screenshotWatcher = fs.watch(SCREENSHOTS_PATH, (eventType, filename) => {
      if (filename && (filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg'))) {
        // Notify renderer of new screenshot
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
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (screenshotWatcher) {
    screenshotWatcher.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================
// WORKSPACE IPC HANDLERS
// ============================================

ipcMain.handle('workspace:getAll', () => {
  return store.get('workspaces') || [];
});

ipcMain.handle('workspace:getActive', () => {
  const activeId = store.get('activeWorkspaceId');
  const workspaces = store.get('workspaces') || [];
  return workspaces.find(w => w.id === activeId) || null;
});

ipcMain.handle('workspace:create', (event, workspace) => {
  const workspaces = store.get('workspaces') || [];
  workspaces.push(workspace);
  store.set('workspaces', workspaces);
  store.set('activeWorkspaceId', workspace.id);
  return workspace;
});

ipcMain.handle('workspace:update', (event, workspace) => {
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
// NOTES IPC HANDLERS
// ============================================

ipcMain.handle('notes:update', (event, workspaceId, notes) => {
  const workspaces = store.get('workspaces') || [];
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.notes = notes;
    store.set('workspaces', workspaces);
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
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  
  // Ensure unique ID
  let uniqueId = id;
  let counter = 1;
  while (profiles.some(p => p.id === uniqueId)) {
    uniqueId = `${id}-${counter}`;
    counter++;
  }
  
  const profile = {
    id: uniqueId,
    name: name,
    createdAt: new Date().toISOString()
  };
  
  profiles.push(profile);
  store.set('profiles', profiles);
  return profile;
});

ipcMain.handle('profiles:delete', (event, id) => {
  if (id === 'default') {
    return { error: 'Cannot delete default profile' };
  }
  
  let profiles = store.get('profiles') || [];
  profiles = profiles.filter(p => p.id !== id);
  store.set('profiles', profiles);
  
  // Clear session data for this profile
  try {
    const ses = session.fromPartition(`persist:profile-${id}`);
    ses.clearStorageData();
  } catch (e) {
    console.error('Error clearing session:', e);
  }
  
  return profiles;
});

ipcMain.handle('profiles:rename', (event, id, name) => {
  const profiles = store.get('profiles') || [];
  const profile = profiles.find(p => p.id === id);
  if (profile) {
    profile.name = name;
    store.set('profiles', profiles);
  }
  return profiles;
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
      files
        .filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f))
        .map(async (filename) => {
          const filepath = path.join(SCREENSHOTS_PATH, filename);
          const stat = await fs.promises.stat(filepath);
          return {
            name: filename,
            path: filepath,
            mtime: stat.mtime.getTime(),
            size: stat.size,
          };
        })
    );
    
    screenshots.sort((a, b) => b.mtime - a.mtime);
    
    return screenshots;
  } catch (err) {
    console.error('Error listing screenshots:', err);
    return [];
  }
});

ipcMain.handle('screenshots:copy', async (event, filepath) => {
  try {
    const image = nativeImage.createFromPath(filepath);
    clipboard.writeImage(image);
    return true;
  } catch (err) {
    console.error('Error copying screenshot:', err);
    return false;
  }
});

ipcMain.handle('screenshots:delete', async (event, filepath) => {
  try {
    await fs.promises.unlink(filepath);
    return true;
  } catch (err) {
    console.error('Error deleting screenshot:', err);
    return false;
  }
});

ipcMain.handle('screenshots:deleteAll', async () => {
  try {
    if (!fs.existsSync(SCREENSHOTS_PATH)) {
      return true;
    }
    
    const files = await fs.promises.readdir(SCREENSHOTS_PATH);
    const imageFiles = files.filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f));
    
    await Promise.all(
      imageFiles.map(filename => 
        fs.promises.unlink(path.join(SCREENSHOTS_PATH, filename))
      )
    );
    
    return true;
  } catch (err) {
    console.error('Error deleting all screenshots:', err);
    return false;
  }
});

ipcMain.handle('screenshots:getPath', () => {
  return SCREENSHOTS_PATH;
});

// ============================================
// FILES IPC HANDLERS
// ============================================

ipcMain.handle('files:list', async (event, inputPath) => {
  let resolvedPath = inputPath;
  
  if (resolvedPath.startsWith('~')) {
    resolvedPath = resolvedPath.replace('~', os.homedir());
  }
  
  try {
    const items = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
    
    const files = await Promise.all(items.map(async (item) => {
      let size = null;
      if (!item.isDirectory()) {
        try {
          const stat = await fs.promises.stat(path.join(resolvedPath, item.name));
          size = stat.size;
        } catch (e) {
          // ignore
        }
      }
      
      return {
        name: item.name,
        isDirectory: item.isDirectory(),
        size,
      };
    }));
    
    return files.filter(f => !f.name.startsWith('.'));
  } catch (err) {
    throw new Error(`Cannot read directory: ${err.message}`);
  }
});

// ============================================
// TERMINAL IPC HANDLERS
// ============================================

ipcMain.handle('terminal:run', async (event, command) => {
  return new Promise((resolve) => {
    const cwd = os.homedir();
    
    exec(command, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || (error ? error.message : ''),
        code: error ? error.code : 0,
      });
    });
  });
});

// ============================================
// SCRATCHPAD IPC HANDLERS
// ============================================

ipcMain.handle('scratchpad:get', () => {
  return store.get('scratchpad') || '';
});

ipcMain.handle('scratchpad:save', (event, content) => {
  store.set('scratchpad', content);
  return content;
});