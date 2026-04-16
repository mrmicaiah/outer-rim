const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('./store');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

const store = new Store();

let mainWindow;

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
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
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
// FILES IPC HANDLERS
// ============================================

ipcMain.handle('files:list', async (event, inputPath) => {
  let resolvedPath = inputPath;
  
  // Expand ~ to home directory
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
    
    // Filter out hidden files (starting with .)
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
    // Run in user's home directory
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