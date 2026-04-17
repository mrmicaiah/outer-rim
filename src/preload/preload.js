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
  // Claude Commander
  commander: {
    load: () => ipcRenderer.invoke('commander:load'),
    save: (data) => ipcRenderer.invoke('commander:save', data),
  },
  // Local Project Operations
  project: {
    getProjectsPath: () => ipcRenderer.invoke('project:getProjectsPath'),
    exists: (localPath) => ipcRenderer.invoke('project:exists', localPath),
    browse: () => ipcRenderer.invoke('project:browse'),
    listFiles: (projectPath, subPath) => ipcRenderer.invoke('project:listFiles', projectPath, subPath),
    readFile: (projectPath, filePath) => ipcRenderer.invoke('project:readFile', projectPath, filePath),
    writeFile: (projectPath, filePath, content) => ipcRenderer.invoke('project:writeFile', projectPath, filePath, content),
    createFile: (projectPath, filePath, content) => ipcRenderer.invoke('project:createFile', projectPath, filePath, content),
    deleteFile: (projectPath, filePath) => ipcRenderer.invoke('project:deleteFile', projectPath, filePath),
  },
  // Git Operations
  git: {
    clone: (repoName, localPath) => ipcRenderer.invoke('git:clone', repoName, localPath),
    status: (projectPath) => ipcRenderer.invoke('git:status', projectPath),
    push: (projectPath, message) => ipcRenderer.invoke('git:push', projectPath, message),
    pull: (projectPath) => ipcRenderer.invoke('git:pull', projectPath),
  },
  // Claude Agent SDK (runs in main process)
  agent: {
    /**
     * Start a Commander turn.
     * @param {object} args
     * @param {string} args.chatId       - identifies which chat this turn belongs to
     * @param {string} args.prompt       - user message
     * @param {string|null} args.sessionId - pass to continue a prior session
     * @param {string} args.projectPath  - absolute path to the active project
     * @param {string} args.apiKey       - Anthropic API key
     * @param {string} [args.task]       - optional task description for system prompt
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    start: (args) => ipcRenderer.invoke('agent:start', args),

    /** Cancel the running turn for a specific chat. */
    cancel: (chatId) => ipcRenderer.invoke('agent:cancel', { chatId }),

    /** Subscribe to every SDKMessage. Returns an unsubscribe fn. */
    onMessage: (callback) => {
      const handler = (_e, payload) => callback(payload);
      ipcRenderer.on('agent:message', handler);
      return () => ipcRenderer.removeListener('agent:message', handler);
    },

    /** Fires once per turn with the final result summary. */
    onDone: (callback) => {
      const handler = (_e, payload) => callback(payload);
      ipcRenderer.on('agent:done', handler);
      return () => ipcRenderer.removeListener('agent:done', handler);
    },

    /** Fires if the agent loop throws. */
    onError: (callback) => {
      const handler = (_e, payload) => callback(payload);
      ipcRenderer.on('agent:error', handler);
      return () => ipcRenderer.removeListener('agent:error', handler);
    },
  },
  // Menu events
  onMenuToggleDevTools: (callback) => ipcRenderer.on('menu:toggleDevTools', callback),
});
