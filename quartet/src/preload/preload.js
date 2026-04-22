const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quartet', {
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
  project: {
    browse: () => ipcRenderer.invoke('project:browse'),
    exists: (localPath) => ipcRenderer.invoke('project:exists', localPath),
  },
  git: {
    status: (projectPath) => ipcRenderer.invoke('git:status', projectPath),
    push: (projectPath, message) => ipcRenderer.invoke('git:push', projectPath, message),
    pull: (projectPath) => ipcRenderer.invoke('git:pull', projectPath),
  },
  sync: {
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    signIn: () => ipcRenderer.invoke('sync:signIn'),
    signOut: () => ipcRenderer.invoke('sync:signOut'),
    syncNow: (opts) => ipcRenderer.invoke('sync:syncNow', opts || {}),
    pushForce: () => ipcRenderer.invoke('sync:pushForce'),
    pullForce: () => ipcRenderer.invoke('sync:pullForce'),
    onStatus: (callback) => ipcRenderer.on('sync:status', (e, status) => callback(status)),
    onRemoteApplied: (callback) => ipcRenderer.on('sync:remote-applied', () => callback()),
  },
  devtools: {
    toggle: () => ipcRenderer.invoke('devtools:toggle'),
    openWebview: (pane) => ipcRenderer.invoke('devtools:openWebview', pane),
  },
  onMenuToggleDevTools: (callback) => ipcRenderer.on('menu:toggleDevTools', callback),
});
