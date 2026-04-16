// ============================================
// OUTER RIM - Renderer Application
// Dual-Pane + Navigation + Three-Column Bottom Panel
// ============================================

function uuidv4() {
  return crypto.randomUUID();
}

// State
let workspaces = [];
let activeWorkspace = null;
let activePane = 'left';
let currentFilesPath = '~';
let scratchpadContent = '';

// DOM Elements
const workspaceList = document.getElementById('workspace-list');
const notepadContent = document.getElementById('notepad-content');
const emptyStateOverlay = document.getElementById('empty-state-overlay');
const notepadPanel = document.getElementById('notepad-panel');
const notepadExpand = document.getElementById('notepad-expand');
const notepadToggle = document.getElementById('notepad-toggle');
const bottomPanel = document.getElementById('bottom-panel');

// Modals
const modalOverlay = document.getElementById('modal-overlay');
const workspaceNameInput = document.getElementById('workspace-name-input');
const tabModalOverlay = document.getElementById('tab-modal-overlay');
const tabUrlInput = document.getElementById('tab-url-input');

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  workspaces = await window.outerRim.workspace.getAll();
  const active = await window.outerRim.workspace.getActive();
  
  if (active) {
    activeWorkspace = workspaces.find(w => w.id === active.id);
  }
  
  // Load scratchpad
  scratchpadContent = await window.outerRim.scratchpad.get() || '';
  document.getElementById('scratchpad-content').value = scratchpadContent;
  
  renderWorkspaces();
  renderPanes();
  updateNotepad();
  updateEmptyState();
  setupEventListeners();
  
  // Initial file load
  loadFiles(currentFilesPath);
}

// ============================================
// UTILITY: Simplify Tab Title
// ============================================

function simplifyTitle(title, url) {
  if (!title || title === 'Loading...') return title || 'New Tab';
  
  let siteName = '';
  try {
    const hostname = new URL(url).hostname;
    siteName = hostname.replace(/^www\./, '').split('.')[0];
    siteName = siteName.charAt(0).toUpperCase() + siteName.slice(1);
  } catch (e) {
    siteName = '';
  }
  
  const knownBrands = [
    'Claude', 'GitHub', 'Google', 'Cloudflare', 'Vercel', 'Netlify', 
    'AWS', 'Azure', 'Firebase', 'Supabase', 'Discord', 'Slack',
    'Twitter', 'X', 'LinkedIn', 'Facebook', 'Instagram', 'YouTube',
    'Reddit', 'Stack Overflow', 'ChatGPT', 'OpenAI', 'Notion',
    'Figma', 'Linear', 'Jira', 'Trello', 'Asana'
  ];
  
  for (const brand of knownBrands) {
    if (title.toLowerCase().startsWith(brand.toLowerCase())) {
      return brand;
    }
    const patterns = [
      new RegExp(`^${brand}\\s*[-|:]`, 'i'),
      new RegExp(`[-|:]\\s*${brand}$`, 'i'),
    ];
    for (const pattern of patterns) {
      if (pattern.test(title)) {
        return brand;
      }
    }
  }
  
  const separators = [' | ', ' - ', ' \u2014 ', ' \u00b7 ', ': '];
  for (const sep of separators) {
    if (title.includes(sep)) {
      const parts = title.split(sep);
      const shortPart = parts
        .filter(p => p.trim().length >= 2)
        .sort((a, b) => a.length - b.length)[0];
      if (shortPart && shortPart.length <= 20) {
        return shortPart.trim();
      }
      if (parts[0].trim().length <= 25) {
        return parts[0].trim();
      }
    }
  }
  
  if (title.length <= 20) {
    return title;
  }
  
  if (siteName && siteName.length > 1) {
    return siteName;
  }
  
  return title.substring(0, 18) + '...';
}

// ============================================
// WORKSPACE MANAGEMENT
// ============================================

function renderWorkspaces() {
  workspaceList.innerHTML = '';
  
  workspaces.forEach(workspace => {
    const item = document.createElement('div');
    item.className = `workspace-item ${activeWorkspace?.id === workspace.id ? 'active' : ''}`;
    item.dataset.id = workspace.id;
    
    item.innerHTML = `
      <span class="workspace-name">${escapeHtml(workspace.name)}</span>
      <div class="workspace-actions">
        <button class="workspace-action-btn edit" title="Rename">\u270e</button>
        <button class="workspace-action-btn delete" title="Delete">\u00d7</button>
      </div>
    `;
    
    item.addEventListener('click', (e) => {
      if (!e.target.classList.contains('workspace-action-btn')) {
        switchWorkspace(workspace.id);
      }
    });
    
    item.querySelector('.edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openRenameModal(workspace);
    });
    
    item.querySelector('.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteWorkspace(workspace.id);
    });
    
    workspaceList.appendChild(item);
  });
}

async function createWorkspace(name) {
  const workspace = {
    id: uuidv4(),
    name: name,
    panes: {
      left: { tabs: [], activeTabId: null },
      right: { tabs: [], activeTabId: null }
    },
    notes: '',
    createdAt: new Date().toISOString()
  };
  
  await window.outerRim.workspace.create(workspace);
  workspaces.push(workspace);
  activeWorkspace = workspace;
  
  renderWorkspaces();
  renderPanes();
  updateNotepad();
  updateEmptyState();
}

async function switchWorkspace(workspaceId) {
  activeWorkspace = workspaces.find(w => w.id === workspaceId);
  await window.outerRim.workspace.setActive(workspaceId);
  
  renderWorkspaces();
  renderPanes();
  updateNotepad();
}

async function deleteWorkspace(workspaceId) {
  if (!confirm('Delete this workspace and all its tabs?')) return;
  
  workspaces = await window.outerRim.workspace.delete(workspaceId);
  
  if (activeWorkspace?.id === workspaceId) {
    activeWorkspace = workspaces[0] || null;
  }
  
  renderWorkspaces();
  renderPanes();
  updateNotepad();
  updateEmptyState();
}

async function renameWorkspace(workspaceId, newName) {
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.name = newName;
    await window.outerRim.workspace.update(workspace);
    renderWorkspaces();
  }
}

// ============================================
// DUAL-PANE TAB MANAGEMENT
// ============================================

function renderPanes() {
  renderPane('left');
  renderPane('right');
}

function renderPane(paneName) {
  const tabList = document.querySelector(`.pane-tab-list[data-pane="${paneName}"]`);
  const webviewContainer = document.querySelector(`.pane-webview-container[data-pane="${paneName}"]`);
  const navBar = document.querySelector(`.pane-nav-bar[data-pane="${paneName}"]`);
  
  tabList.innerHTML = '';
  webviewContainer.querySelectorAll('webview').forEach(wv => wv.remove());
  
  if (!activeWorkspace) {
    webviewContainer.querySelector('.pane-empty-state').style.display = 'block';
    navBar.classList.add('hidden');
    return;
  }
  
  if (!activeWorkspace.panes) {
    activeWorkspace.panes = {
      left: { tabs: activeWorkspace.tabs || [], activeTabId: activeWorkspace.activeTabId || null },
      right: { tabs: [], activeTabId: null }
    };
    delete activeWorkspace.tabs;
    delete activeWorkspace.activeTabId;
    window.outerRim.workspace.update(activeWorkspace);
  }
  
  const pane = activeWorkspace.panes[paneName];
  
  const emptyState = webviewContainer.querySelector('.pane-empty-state');
  const hasTabs = pane.tabs.length > 0;
  emptyState.style.display = hasTabs ? 'none' : 'block';
  navBar.classList.toggle('hidden', !hasTabs);
  
  pane.tabs.forEach(tab => {
    const item = document.createElement('div');
    item.className = `pane-tab-item ${pane.activeTabId === tab.id ? 'active' : ''}`;
    item.dataset.id = tab.id;
    item.dataset.pane = paneName;
    
    const favicon = getFaviconUrl(tab.url);
    const displayTitle = simplifyTitle(tab.title, tab.url);
    
    item.innerHTML = `
      <img class="pane-tab-favicon" src="${favicon}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23666%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'">
      <span class="pane-tab-title" title="${escapeHtml(tab.title || '')}">${escapeHtml(displayTitle)}</span>
      <button class="pane-tab-close" title="Close tab">\u00d7</button>
    `;
    
    item.addEventListener('click', (e) => {
      if (!e.target.classList.contains('pane-tab-close')) {
        switchTab(paneName, tab.id);
      }
    });
    
    item.querySelector('.pane-tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(paneName, tab.id);
    });
    
    tabList.appendChild(item);
    
    const webview = document.createElement('webview');
    webview.id = `webview-${paneName}-${tab.id}`;
    webview.src = tab.url;
    webview.className = pane.activeTabId === tab.id ? 'active' : '';
    webview.setAttribute('partition', 'persist:outerrim');
    
    webview.addEventListener('page-title-updated', (e) => {
      updateTabTitle(paneName, tab.id, e.title);
    });
    
    webview.addEventListener('did-navigate', (e) => {
      updateTabUrl(paneName, tab.id, e.url);
      updateNavBar(paneName);
    });
    
    webview.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        updateTabUrl(paneName, tab.id, e.url);
        updateNavBar(paneName);
      }
    });
    
    webviewContainer.appendChild(webview);
  });
  
  updateNavBar(paneName);
}

function updateNavBar(paneName) {
  if (!activeWorkspace) return;
  
  const pane = activeWorkspace.panes[paneName];
  if (!pane || !pane.activeTabId) return;
  
  const webview = document.getElementById(`webview-${paneName}-${pane.activeTabId}`);
  const navUrl = document.querySelector(`.nav-url[data-pane="${paneName}"]`);
  const navBack = document.querySelector(`.nav-back[data-pane="${paneName}"]`);
  const navForward = document.querySelector(`.nav-forward[data-pane="${paneName}"]`);
  
  if (webview && navUrl) {
    const tab = pane.tabs.find(t => t.id === pane.activeTabId);
    navUrl.value = tab?.url || '';
    
    try {
      navBack.disabled = !webview.canGoBack();
      navForward.disabled = !webview.canGoForward();
    } catch (e) {
      navBack.disabled = true;
      navForward.disabled = true;
    }
  }
}

async function createTab(paneName, url) {
  if (!activeWorkspace) return;
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.includes('.') && !url.includes(' ')) {
      url = 'https://' + url;
    } else {
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
  }
  
  const tab = {
    id: uuidv4(),
    url: url,
    title: 'Loading...',
    createdAt: new Date().toISOString()
  };
  
  activeWorkspace.panes[paneName].tabs.push(tab);
  activeWorkspace.panes[paneName].activeTabId = tab.id;
  
  await window.outerRim.workspace.update(activeWorkspace);
  
  const idx = workspaces.findIndex(w => w.id === activeWorkspace.id);
  workspaces[idx] = activeWorkspace;
  
  renderPane(paneName);
}

async function switchTab(paneName, tabId) {
  if (!activeWorkspace) return;
  
  activeWorkspace.panes[paneName].activeTabId = tabId;
  await window.outerRim.workspace.update(activeWorkspace);
  
  const idx = workspaces.findIndex(w => w.id === activeWorkspace.id);
  workspaces[idx] = activeWorkspace;
  
  const tabList = document.querySelector(`.pane-tab-list[data-pane="${paneName}"]`);
  tabList.querySelectorAll('.pane-tab-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === tabId);
  });
  
  const container = document.querySelector(`.pane-webview-container[data-pane="${paneName}"]`);
  container.querySelectorAll('webview').forEach(wv => {
    wv.classList.toggle('active', wv.id === `webview-${paneName}-${tabId}`);
  });
  
  updateNavBar(paneName);
}

function navigateBack(paneName) {
  if (!activeWorkspace) return;
  const pane = activeWorkspace.panes[paneName];
  if (!pane || !pane.activeTabId) return;
  
  const webview = document.getElementById(`webview-${paneName}-${pane.activeTabId}`);
  if (webview && webview.canGoBack()) {
    webview.goBack();
  }
}

function navigateForward(paneName) {
  if (!activeWorkspace) return;
  const pane = activeWorkspace.panes[paneName];
  if (!pane || !pane.activeTabId) return;
  
  const webview = document.getElementById(`webview-${paneName}-${pane.activeTabId}`);
  if (webview && webview.canGoForward()) {
    webview.goForward();
  }
}

function refreshTab(paneName, tabId) {
  const webview = document.getElementById(`webview-${paneName}-${tabId}`);
  if (webview) {
    webview.reload();
  }
}

function refreshActiveTab(paneName) {
  if (!activeWorkspace) return;
  const pane = activeWorkspace.panes[paneName];
  if (pane && pane.activeTabId) {
    refreshTab(paneName, pane.activeTabId);
  }
}

function navigateToUrl(paneName, url) {
  if (!activeWorkspace) return;
  const pane = activeWorkspace.panes[paneName];
  if (!pane || !pane.activeTabId) return;
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.includes('.') && !url.includes(' ')) {
      url = 'https://' + url;
    } else {
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
  }
  
  const webview = document.getElementById(`webview-${paneName}-${pane.activeTabId}`);
  if (webview) {
    webview.src = url;
  }
}

async function closeTab(paneName, tabId) {
  if (!activeWorkspace) return;
  
  const pane = activeWorkspace.panes[paneName];
  pane.tabs = pane.tabs.filter(t => t.id !== tabId);
  
  if (pane.activeTabId === tabId) {
    pane.activeTabId = pane.tabs[0]?.id || null;
  }
  
  await window.outerRim.workspace.update(activeWorkspace);
  
  const idx = workspaces.findIndex(w => w.id === activeWorkspace.id);
  workspaces[idx] = activeWorkspace;
  
  renderPane(paneName);
}

async function updateTabTitle(paneName, tabId, title) {
  if (!activeWorkspace) return;
  
  const tab = activeWorkspace.panes[paneName].tabs.find(t => t.id === tabId);
  if (tab) {
    tab.title = title;
    await window.outerRim.workspace.update(activeWorkspace);
    
    const tabEl = document.querySelector(`.pane-tab-item[data-pane="${paneName}"][data-id="${tabId}"] .pane-tab-title`);
    if (tabEl) {
      const displayTitle = simplifyTitle(title, tab.url);
      tabEl.textContent = displayTitle;
      tabEl.title = title;
    }
  }
}

async function updateTabUrl(paneName, tabId, url) {
  if (!activeWorkspace) return;
  
  const tab = activeWorkspace.panes[paneName].tabs.find(t => t.id === tabId);
  if (tab) {
    tab.url = url;
    await window.outerRim.workspace.update(activeWorkspace);
    
    const pane = activeWorkspace.panes[paneName];
    if (pane.activeTabId === tabId) {
      const navUrl = document.querySelector(`.nav-url[data-pane="${paneName}"]`);
      if (navUrl) {
        navUrl.value = url;
      }
    }
  }
}

// ============================================
// NOTEPAD MANAGEMENT
// ============================================

function updateNotepad() {
  if (activeWorkspace) {
    notepadContent.value = activeWorkspace.notes || '';
    notepadContent.disabled = false;
  } else {
    notepadContent.value = '';
    notepadContent.disabled = true;
  }
}

let notepadSaveTimeout = null;
async function saveNotes() {
  if (!activeWorkspace) return;
  
  clearTimeout(notepadSaveTimeout);
  notepadSaveTimeout = setTimeout(async () => {
    activeWorkspace.notes = notepadContent.value;
    await window.outerRim.notes.update(activeWorkspace.id, notepadContent.value);
  }, 500);
}

function toggleNotepad() {
  const isCollapsed = notepadPanel.classList.toggle('collapsed');
  notepadToggle.textContent = isCollapsed ? '\u25b6' : '\u25c0';
  notepadExpand.classList.toggle('hidden', !isCollapsed);
}

function expandNotepad() {
  notepadPanel.classList.remove('collapsed');
  notepadToggle.textContent = '\u25c0';
  notepadExpand.classList.add('hidden');
}

// ============================================
// BOTTOM PANEL MANAGEMENT
// ============================================

function toggleBottomPanel() {
  const isCollapsed = bottomPanel.classList.toggle('collapsed');
  document.getElementById('bottom-panel-toggle').textContent = isCollapsed ? '\u25b2' : '\u25bc';
}

// ============================================
// FILES PANEL
// ============================================

async function loadFiles(path) {
  currentFilesPath = path;
  document.getElementById('files-path').value = path;
  
  const filesList = document.getElementById('files-list');
  filesList.innerHTML = '<div class="file-item"><span class="file-icon">\u23f3</span><span class="file-name">Loading...</span></div>';
  
  try {
    const files = await window.outerRim.files.list(path);
    renderFiles(files);
  } catch (err) {
    filesList.innerHTML = `<div class="file-item"><span class="file-icon">\u274c</span><span class="file-name">Error: ${err.message}</span></div>`;
  }
}

function renderFiles(files) {
  const filesList = document.getElementById('files-list');
  filesList.innerHTML = '';
  
  if (files.length === 0) {
    filesList.innerHTML = '<div class="file-item"><span class="file-icon">\ud83d\udced</span><span class="file-name">Empty directory</span></div>';
    return;
  }
  
  // Sort: directories first, then files
  files.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
  
  files.forEach(file => {
    const item = document.createElement('div');
    item.className = `file-item ${file.isDirectory ? 'directory' : ''}`;
    
    const icon = file.isDirectory ? '\ud83d\udcc1' : getFileIcon(file.name);
    const size = file.isDirectory ? '' : formatFileSize(file.size);
    
    item.innerHTML = `
      <span class="file-icon">${icon}</span>
      <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
      <span class="file-size">${size}</span>
    `;
    
    item.addEventListener('click', () => {
      if (file.isDirectory) {
        const newPath = currentFilesPath === '~' 
          ? `~/${file.name}`
          : `${currentFilesPath}/${file.name}`;
        loadFiles(newPath);
      }
    });
    
    filesList.appendChild(item);
  });
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    js: '\ud83d\udcdc', ts: '\ud83d\udcdc', jsx: '\u269b\ufe0f', tsx: '\u269b\ufe0f',
    html: '\ud83c\udf10', css: '\ud83c\udfa8', scss: '\ud83c\udfa8',
    json: '\ud83d\udccb', md: '\ud83d\udcdd', txt: '\ud83d\udcc4',
    py: '\ud83d\udc0d', rb: '\ud83d\udc8e', go: '\ud83d\udd37',
    jpg: '\ud83d\uddbc\ufe0f', jpeg: '\ud83d\uddbc\ufe0f', png: '\ud83d\uddbc\ufe0f', gif: '\ud83d\uddbc\ufe0f', svg: '\ud83d\uddbc\ufe0f',
    pdf: '\ud83d\udcd5', doc: '\ud83d\udcd8', docx: '\ud83d\udcd8',
    zip: '\ud83d\udce6', tar: '\ud83d\udce6', gz: '\ud83d\udce6',
    mp3: '\ud83c\udfb5', wav: '\ud83c\udfb5', mp4: '\ud83c\udfac', mov: '\ud83c\udfac',
    sh: '\u2699\ufe0f', bash: '\u2699\ufe0f', zsh: '\u2699\ufe0f',
  };
  return icons[ext] || '\ud83d\udcc4';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function navigateFilesUp() {
  if (currentFilesPath === '~' || currentFilesPath === '/') return;
  
  const parts = currentFilesPath.split('/');
  parts.pop();
  const newPath = parts.join('/') || '~';
  loadFiles(newPath);
}

// ============================================
// TERMINAL PANEL
// ============================================

const terminalHistory = [];
let historyIndex = -1;

function appendTerminalOutput(text, type = 'output') {
  const output = document.getElementById('terminal-output');
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

async function runTerminalCommand(command) {
  if (!command.trim()) return;
  
  terminalHistory.push(command);
  historyIndex = terminalHistory.length;
  
  appendTerminalOutput(`$ ${command}`, 'command');
  
  try {
    const result = await window.outerRim.terminal.run(command);
    if (result.stdout) {
      appendTerminalOutput(result.stdout, 'output');
    }
    if (result.stderr) {
      appendTerminalOutput(result.stderr, 'error');
    }
  } catch (err) {
    appendTerminalOutput(`Error: ${err.message}`, 'error');
  }
  
  document.getElementById('terminal-input').value = '';
}

// ============================================
// SCRATCHPAD PANEL
// ============================================

let scratchpadSaveTimeout = null;
async function saveScratchpad() {
  clearTimeout(scratchpadSaveTimeout);
  scratchpadSaveTimeout = setTimeout(async () => {
    const content = document.getElementById('scratchpad-content').value;
    await window.outerRim.scratchpad.save(content);
  }, 500);
}

// ============================================
// UI HELPERS
// ============================================

function updateEmptyState() {
  if (workspaces.length === 0 || !activeWorkspace) {
    emptyStateOverlay.classList.remove('hidden');
  } else {
    emptyStateOverlay.classList.add('hidden');
  }
}

function getFaviconUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="%23666" width="16" height="16" rx="2"/></svg>';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// MODAL HANDLERS
// ============================================

let editingWorkspaceId = null;

function openCreateWorkspaceModal() {
  editingWorkspaceId = null;
  document.getElementById('modal-title').textContent = 'New Workspace';
  document.getElementById('modal-confirm').textContent = 'Create';
  workspaceNameInput.value = '';
  modalOverlay.classList.remove('hidden');
  workspaceNameInput.focus();
}

function openRenameModal(workspace) {
  editingWorkspaceId = workspace.id;
  document.getElementById('modal-title').textContent = 'Rename Workspace';
  document.getElementById('modal-confirm').textContent = 'Save';
  workspaceNameInput.value = workspace.name;
  modalOverlay.classList.remove('hidden');
  workspaceNameInput.focus();
  workspaceNameInput.select();
}

function closeWorkspaceModal() {
  modalOverlay.classList.add('hidden');
  editingWorkspaceId = null;
}

function confirmWorkspaceModal() {
  const name = workspaceNameInput.value.trim();
  if (!name) return;
  
  if (editingWorkspaceId) {
    renameWorkspace(editingWorkspaceId, name);
  } else {
    createWorkspace(name);
  }
  
  closeWorkspaceModal();
}

function openTabModal(paneName) {
  if (!activeWorkspace) {
    alert('Create a workspace first');
    return;
  }
  activePane = paneName;
  tabUrlInput.value = '';
  tabModalOverlay.classList.remove('hidden');
  tabUrlInput.focus();
}

function closeTabModal() {
  tabModalOverlay.classList.add('hidden');
}

function confirmTabModal() {
  const url = tabUrlInput.value.trim();
  if (!url) return;
  
  createTab(activePane, url);
  closeTabModal();
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  document.getElementById('add-workspace').addEventListener('click', openCreateWorkspaceModal);
  document.getElementById('empty-create-workspace').addEventListener('click', openCreateWorkspaceModal);
  
  document.querySelectorAll('.pane-add-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      openTabModal(btn.dataset.pane);
    });
  });
  
  // Navigation bar buttons
  document.querySelectorAll('.nav-back').forEach(btn => {
    btn.addEventListener('click', () => navigateBack(btn.dataset.pane));
  });
  
  document.querySelectorAll('.nav-forward').forEach(btn => {
    btn.addEventListener('click', () => navigateForward(btn.dataset.pane));
  });
  
  document.querySelectorAll('.nav-refresh').forEach(btn => {
    btn.addEventListener('click', () => refreshActiveTab(btn.dataset.pane));
  });
  
  document.querySelectorAll('.nav-url').forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        navigateToUrl(input.dataset.pane, input.value.trim());
        input.blur();
      }
    });
  });
  
  // Bottom panel toggle
  document.getElementById('bottom-panel-toggle').addEventListener('click', toggleBottomPanel);
  
  // Files panel
  document.getElementById('files-path').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loadFiles(e.target.value.trim());
    }
  });
  
  document.getElementById('files-up').addEventListener('click', navigateFilesUp);
  document.getElementById('files-refresh').addEventListener('click', () => loadFiles(currentFilesPath));
  
  // Terminal panel
  document.getElementById('terminal-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      runTerminalCommand(e.target.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        e.target.value = terminalHistory[historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex < terminalHistory.length - 1) {
        historyIndex++;
        e.target.value = terminalHistory[historyIndex];
      } else {
        historyIndex = terminalHistory.length;
        e.target.value = '';
      }
    }
  });
  
  // Scratchpad panel
  document.getElementById('scratchpad-content').addEventListener('input', saveScratchpad);
  
  // Workspace modal
  document.getElementById('modal-cancel').addEventListener('click', closeWorkspaceModal);
  document.getElementById('modal-confirm').addEventListener('click', confirmWorkspaceModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeWorkspaceModal();
  });
  workspaceNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmWorkspaceModal();
  });
  
  // Tab modal
  document.getElementById('tab-modal-cancel').addEventListener('click', closeTabModal);
  document.getElementById('tab-modal-confirm').addEventListener('click', confirmTabModal);
  tabModalOverlay.addEventListener('click', (e) => {
    if (e.target === tabModalOverlay) closeTabModal();
  });
  tabUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmTabModal();
  });
  
  document.querySelectorAll('.quick-link').forEach(btn => {
    btn.addEventListener('click', () => {
      createTab(activePane, btn.dataset.url);
      closeTabModal();
    });
  });
  
  notepadContent.addEventListener('input', saveNotes);
  notepadToggle.addEventListener('click', toggleNotepad);
  notepadExpand.addEventListener('click', expandNotepad);
  
  setupPaneResizer();
  setupNotepadResizer();
  setupBottomPanelResizer();
  setupBottomSectionResizers();
  
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      e.preventDefault();
      openTabModal(activePane);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      if (activeWorkspace?.panes[activePane]?.activeTabId) {
        closeTab(activePane, activeWorkspace.panes[activePane].activeTabId);
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      openCreateWorkspaceModal();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '1') {
      e.preventDefault();
      activePane = 'left';
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '2') {
      e.preventDefault();
      activePane = 'right';
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
      e.preventDefault();
      refreshActiveTab(activePane);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault();
      const navUrl = document.querySelector(`.nav-url[data-pane="${activePane}"]`);
      if (navUrl) {
        navUrl.focus();
        navUrl.select();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '`') {
      e.preventDefault();
      toggleBottomPanel();
    }
    if (e.key === 'Escape') {
      closeWorkspaceModal();
      closeTabModal();
    }
  });
}

function setupPaneResizer() {
  const resizer = document.getElementById('pane-resizer');
  const leftPane = document.getElementById('left-pane');
  const rightPane = document.getElementById('right-pane');
  let isResizing = false;
  
  resizer.addEventListener('mousedown', () => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const container = document.getElementById('dual-pane-container');
    const containerRect = container.getBoundingClientRect();
    const notepadWidth = notepadPanel.classList.contains('collapsed') ? 0 : notepadPanel.offsetWidth;
    const availableWidth = containerRect.width - notepadWidth - 12;
    const newLeftWidth = e.clientX - containerRect.left;
    
    const leftPercent = (newLeftWidth / availableWidth) * 100;
    
    if (leftPercent > 20 && leftPercent < 80) {
      leftPane.style.flex = `0 0 ${leftPercent}%`;
      rightPane.style.flex = `0 0 ${100 - leftPercent}%`;
    }
  });
  
  document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = '';
  });
}

function setupNotepadResizer() {
  const resizer = document.getElementById('notepad-resizer');
  let isResizing = false;
  
  resizer.addEventListener('mousedown', () => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const container = document.getElementById('dual-pane-container');
    const containerRect = container.getBoundingClientRect();
    const newWidth = containerRect.right - e.clientX;
    
    if (newWidth > 150 && newWidth < 500) {
      notepadPanel.style.width = newWidth + 'px';
    }
  });
  
  document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = '';
  });
}

function setupBottomPanelResizer() {
  const resizer = document.getElementById('bottom-panel-resizer');
  let isResizing = false;
  
  resizer.addEventListener('mousedown', () => {
    isResizing = true;
    document.body.style.cursor = 'row-resize';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const mainContent = document.getElementById('main-content');
    const mainRect = mainContent.getBoundingClientRect();
    const workspaceBarHeight = 42;
    const newHeight = mainRect.bottom - e.clientY - workspaceBarHeight;
    
    if (newHeight > 80 && newHeight < 400) {
      bottomPanel.style.height = newHeight + 'px';
      bottomPanel.classList.remove('collapsed');
      document.getElementById('bottom-panel-toggle').textContent = '\u25bc';
    }
  });
  
  document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = '';
  });
}

function setupBottomSectionResizers() {
  const resizers = document.querySelectorAll('.bottom-section-resizer');
  
  resizers.forEach(resizer => {
    let isResizing = false;
    const resizeType = resizer.dataset.resize;
    
    resizer.addEventListener('mousedown', () => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const content = document.querySelector('.bottom-panel-content');
      const contentRect = content.getBoundingClientRect();
      
      if (resizeType === 'files-terminal') {
        const filesSection = document.getElementById('files-section');
        const newWidth = e.clientX - contentRect.left;
        const percent = (newWidth / contentRect.width) * 100;
        
        if (percent > 15 && percent < 50) {
          filesSection.style.flex = `0 0 ${percent}%`;
        }
      } else if (resizeType === 'terminal-scratchpad') {
        const scratchpadSection = document.getElementById('scratchpad-section');
        const newWidth = contentRect.right - e.clientX;
        const percent = (newWidth / contentRect.width) * 100;
        
        if (percent > 15 && percent < 50) {
          scratchpadSection.style.flex = `0 0 ${percent}%`;
        }
      }
    });
    
    document.addEventListener('mouseup', () => {
      isResizing = false;
      document.body.style.cursor = '';
    });
  });
}

document.addEventListener('DOMContentLoaded', init);