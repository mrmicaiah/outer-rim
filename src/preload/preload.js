const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('outerRim', {
  // Workspace operations
  workspace: {
    getAll: () => ipcRenderer.invoke('workspace:getAll'),
    getActive: () => ipcRenderer.invoke('workspace:getActive'),
    create: (workspace) => ipcRenderer.invoke('workspace:create', workspace),
    update: (workspace) => ipcRenderer.invoke('workspace:update', workspace),
    delete: (workspaceId) => ipcRenderer.invoke('workspace:delete', workspaceId),
    setActive: (workspaceId) => ipcRenderer.invoke('workspace:setActive', workspaceId)
  },
  
  // Tab operations
  tab: {
    add: (workspaceId, tab) => ipcRenderer.invoke('tab:add', { workspaceId, tab }),
    update: (workspaceId, tab) => ipcRenderer.invoke('tab:update', { workspaceId, tab }),
    remove: (workspaceId, tabId) => ipcRenderer.invoke('tab:remove', { workspaceId, tabId }),
    setActive: (workspaceId, tabId) => ipcRenderer.invoke('tab:setActive', { workspaceId, tabId })
  },
  
  // Notes operations
  notes: {
    update: (workspaceId, notes) => ipcRenderer.invoke('notes:update', { workspaceId, notes })
  }
});