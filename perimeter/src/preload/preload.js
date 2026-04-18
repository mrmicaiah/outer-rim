const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('perimeter', {
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
  terminal: {
    create: (opts) => ipcRenderer.invoke('terminal:create', opts),
    write: (termId, data) => ipcRenderer.send('terminal:write', { termId, data }),
    resize: (termId, cols, rows) => ipcRenderer.send('terminal:resize', { termId, cols, rows }),
    destroy: (termId) => ipcRenderer.invoke('terminal:destroy', { termId }),
    // Callbacks get (event, payload) — payload = { termId, data }
    onData: (callback) => ipcRenderer.on('terminal:data', callback),
    onExit: (callback) => ipcRenderer.on('terminal:exit', callback),
  },
  devtools: {
    toggle: () => ipcRenderer.invoke('devtools:toggle'),
    openWebview: () => ipcRenderer.invoke('devtools:openWebview'),
  },
  onMenuToggleDevTools: (callback) => ipcRenderer.on('menu:toggleDevTools', callback),
  onMenuNewTerminal: (callback) => ipcRenderer.on('menu:newTerminal', callback),
  onMenuCloseTerminal: (callback) => ipcRenderer.on('menu:closeTerminal', callback),
});
