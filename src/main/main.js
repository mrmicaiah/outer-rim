const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const Store = require('./store');

// Initialize data store
const store = new Store({
  configName: 'outer-rim-data',
  defaults: {
    workspaces: [],
    activeWorkspaceId: null,
    windowBounds: { width: 1400, height: 900 }
  }
});

let mainWindow;

function createWindow() {
  const bounds = store.get('windowBounds');
  
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset', // Clean look on Mac
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true // Enable webview for tabs
    },
    backgroundColor: '#0f0f14',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show when ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Save window position on close
  mainWindow.on('close', () => {
    store.set('windowBounds', mainWindow.getBounds());
  });

  // Open devtools in dev mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// ============================================
// IPC Handlers - Communication with renderer
// ============================================

// Workspace operations
ipcMain.handle('workspace:getAll', () => {
  return store.get('workspaces');
});

ipcMain.handle('workspace:getActive', () => {
  const workspaces = store.get('workspaces');
  const activeId = store.get('activeWorkspaceId');
  return workspaces.find(w => w.id === activeId) || null;
});

ipcMain.handle('workspace:create', (event, workspace) => {
  const workspaces = store.get('workspaces');
  workspaces.push(workspace);
  store.set('workspaces', workspaces);
  store.set('activeWorkspaceId', workspace.id);
  return workspace;
});

ipcMain.handle('workspace:update', (event, updatedWorkspace) => {
  const workspaces = store.get('workspaces');
  const index = workspaces.findIndex(w => w.id === updatedWorkspace.id);
  if (index !== -1) {
    workspaces[index] = updatedWorkspace;
    store.set('workspaces', workspaces);
  }
  return updatedWorkspace;
});

ipcMain.handle('workspace:delete', (event, workspaceId) => {
  let workspaces = store.get('workspaces');
  workspaces = workspaces.filter(w => w.id !== workspaceId);
  store.set('workspaces', workspaces);
  
  // If we deleted the active workspace, switch to another
  if (store.get('activeWorkspaceId') === workspaceId) {
    store.set('activeWorkspaceId', workspaces[0]?.id || null);
  }
  return workspaces;
});

ipcMain.handle('workspace:setActive', (event, workspaceId) => {
  store.set('activeWorkspaceId', workspaceId);
  return workspaceId;
});

// Tab operations
ipcMain.handle('tab:add', (event, { workspaceId, tab }) => {
  const workspaces = store.get('workspaces');
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.tabs.push(tab);
    workspace.activeTabId = tab.id;
    store.set('workspaces', workspaces);
  }
  return workspace;
});

ipcMain.handle('tab:update', (event, { workspaceId, tab }) => {
  const workspaces = store.get('workspaces');
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    const index = workspace.tabs.findIndex(t => t.id === tab.id);
    if (index !== -1) {
      workspace.tabs[index] = tab;
      store.set('workspaces', workspaces);
    }
  }
  return workspace;
});

ipcMain.handle('tab:remove', (event, { workspaceId, tabId }) => {
  const workspaces = store.get('workspaces');
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.tabs = workspace.tabs.filter(t => t.id !== tabId);
    if (workspace.activeTabId === tabId) {
      workspace.activeTabId = workspace.tabs[0]?.id || null;
    }
    store.set('workspaces', workspaces);
  }
  return workspace;
});

ipcMain.handle('tab:setActive', (event, { workspaceId, tabId }) => {
  const workspaces = store.get('workspaces');
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.activeTabId = tabId;
    store.set('workspaces', workspaces);
  }
  return workspace;
});

// Notes operations
ipcMain.handle('notes:update', (event, { workspaceId, notes }) => {
  const workspaces = store.get('workspaces');
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.notes = notes;
    store.set('workspaces', workspaces);
  }
  return workspace;
});

// App lifecycle
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