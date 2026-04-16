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
  tab: {
    add: (workspaceId, tab) => ipcRenderer.invoke('tab:add', workspaceId, tab),
    update: (workspaceId, tab) => ipcRenderer.invoke('tab:update', workspaceId, tab),
    remove: (workspaceId, tabId) => ipcRenderer.invoke('tab:remove', workspaceId, tabId),
    setActive: (workspaceId, tabId) => ipcRenderer.invoke('tab:setActive', workspaceId, tabId),
  },
  notes: {
    update: (workspaceId, notes) => ipcRenderer.invoke('notes:update', workspaceId, notes),
  },
  files: {
    list: (path) => ipcRenderer.invoke('files:list', path),
  },
  terminal: {
    run: (command) => ipcRenderer.invoke('terminal:run', command),
  },
  scratchpad: {
    get: () => ipcRenderer.invoke('scratchpad:get'),
    save: (content) => ipcRenderer.invoke('scratchpad:save', content),
  },
});