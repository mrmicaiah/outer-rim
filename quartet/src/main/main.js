const { app, BrowserWindow, ipcMain, Menu, session } = require('electron');
const path = require('path');
const Store = require('./store');

const store = new Store();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 1100,
    minWidth: 1100,
    minHeight: 700,
    title: 'Quartet',
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
      label: 'Quartet',
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
        { type: 'separator' },
        {
          label: 'Toggle Top-Left DevTools',
          accelerator: 'CmdOrCtrl+Shift+1',
          click: () => mainWindow.webContents.send('menu:toggleDevTools', 'topLeft')
        },
        {
          label: 'Toggle Top-Right DevTools',
          accelerator: 'CmdOrCtrl+Shift+2',
          click: () => mainWindow.webContents.send('menu:toggleDevTools', 'topRight')
        },
        {
          label: 'Toggle Bottom-Left DevTools',
          accelerator: 'CmdOrCtrl+Shift+3',
          click: () => mainWindow.webContents.send('menu:toggleDevTools', 'bottomLeft')
        },
        {
          label: 'Toggle Bottom-Right DevTools',
          accelerator: 'CmdOrCtrl+Shift+4',
          click: () => mainWindow.webContents.send('menu:toggleDevTools', 'bottomRight')
        },
        {
          label: 'Toggle Focused Pane DevTools',
          accelerator: 'F12',
          click: () => mainWindow.webContents.send('menu:toggleDevTools', null)
        },
        {
          label: 'Toggle App DevTools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => mainWindow.webContents.toggleDevTools()
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

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createAppMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================
// DEVTOOLS IPC
// ============================================

ipcMain.handle('devtools:toggle', () => {
  mainWindow.webContents.toggleDevTools();
});

ipcMain.handle('devtools:openWebview', (event, pane) => {
  mainWindow.webContents.send('menu:toggleDevTools', pane);
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
// NOTES IPC HANDLERS
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
