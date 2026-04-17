const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('outerRim', {
  workspace: {
    getAll: () => ipcRenderer.invoke('workspace:getAll'),
    getActive: () => ipcRenderer.invoke('workspace:getActive'),
    create: (workspace) => ipcRenderer.invoke('workspace:create', workspace),
    update: (workspace) => ipcRenderer.invoke('workspace:update', workspace),
    delete: (id) => ipcRenderer.invoke('workspace:delete', id),
    setActive: (id) => ipcRenderer.invoke('workspace:setActive', id),
  },
  notes: {
    update: (workspaceId, notes) => ipcRenderer.invoke('notes:update', workspaceId, notes),
  },
  profiles: {
    getAll: () => ipcRenderer.invoke('profiles:getAll'),
    create: (name) => ipcRenderer.invoke('profiles:create', name),
    delete: (id) => ipcRenderer.invoke('profiles:delete', id),
    rename: (id, name) => ipcRenderer.invoke('profiles:rename', id, name),
  },
  screenshots: {
    list: () => ipcRenderer.invoke('screenshots:list'),
    copy: (filepath) => ipcRenderer.invoke('screenshots:copy', filepath),
    delete: (filepath) => ipcRenderer.invoke('screenshots:delete', filepath),
    deleteAll: () => ipcRenderer.invoke('screenshots:deleteAll'),
    getPath: () => ipcRenderer.invoke('screenshots:getPath'),
    onNew: (callback) => ipcRenderer.on('screenshot:new', (event, filename) => callback(filename)),
  },
  // Project folder operations
  project: {
    browse: () => ipcRenderer.invoke('project:browse'),
    exists: (localPath) => ipcRenderer.invoke('project:exists', localPath),
  },
  // Git Operations
  git: {
    status: (projectPath) => ipcRenderer.invoke('git:status', projectPath),
    push: (projectPath, message) => ipcRenderer.invoke('git:push', projectPath, message),
    pull: (projectPath) => ipcRenderer.invoke('git:pull', projectPath),
  },
  // DevTools
  devtools: {
    toggle: () => ipcRenderer.invoke('devtools:toggle'),
    openWebview: () => ipcRenderer.invoke('devtools:openWebview'),
  },
  // Menu events
  onMenuToggleDevTools: (callback) => ipcRenderer.on('menu:toggleDevTools', callback),
});
