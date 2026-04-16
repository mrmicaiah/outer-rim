// ============================================
// OUTER RIM - Renderer Application
// With Browser Features: Copy/Paste, DevTools, Context Menu
// ============================================

function uuidv4() {
  return crypto.randomUUID();
}

// State
let workspaces = [];
let activeWorkspace = null;
let activePane = 'left';
let scratchpadContent = '';

// Resizer state
let currentResizer = null;
let resizeOverlay = null;

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
  
  // Create resize overlay (blocks webview from stealing mouse events)
  resizeOverlay = document.createElement('div');
  resizeOverlay.id = 'resize-overlay';
  resizeOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
    display: none;
  `;
  document.body.appendChild(resizeOverlay);
  
  renderWorkspaces();
  renderPanes();
  updateNotepad();
  updateEmptyState();
  setupEventListeners();
  
  // Load screenshots
  loadScreenshots();
  
  // Listen for new screenshots
  window.outerRim.screenshots.onNew((filename) => {
    console.log('New screenshot:', filename);
    loadScreenshots();
  });
  
  // Listen for menu events
  window.outerRim.onMenuToggleDevTools(() => {
    toggleActiveWebviewDevTools();
  });
}

// ============================================
// GLOBAL RESIZE HANDLERS
// ============================================

function startResize(type, e, extras = {}) {
  currentResizer = {
    type,
    startX: e.clientX,
    startY: e.clientY,
    ...extras
  };
  resizeOverlay.style.display = 'block';
  document.body.style.cursor = type === 'bottom' ? 'row-resize' : 'col-resize';
  document.body.style.userSelect = 'none';
}

function stopResize() {
  currentResizer = null;
  resizeOverlay.style.display = 'none';
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

function handleMouseMove(e) {
  if (!currentResizer) return;
  
  const { type, startX, startY, startLeftWidth, startRightWidth, startWidth, startHeight } = currentResizer;
  
  if (type === 'pane') {
    const leftPane = document.getElementById('left-pane');
    const rightPane = document.getElementById('right-pane');
    const delta = e.clientX - startX;
    const newLeftWidth = startLeftWidth + delta;
    const newRightWidth = startRightWidth - delta;
    
    if (newLeftWidth >= 200 && newRightWidth >= 200) {
      leftPane.style.width = newLeftWidth + 'px';
      leftPane.style.flex = 'none';
      rightPane.style.width = newRightWidth + 'px';
      rightPane.style.flex = 'none';
    }
  } else if (type === 'notepad') {
    const delta = startX - e.clientX;
    const newWidth = startWidth + delta;
    
    if (newWidth >= 150 && newWidth <= 500) {
      notepadPanel.style.width = newWidth + 'px';
    }
  } else if (type === 'bottom') {
    const delta = startY - e.clientY;
    const newHeight = startHeight + delta;
    
    if (newHeight >= 80 && newHeight <= 400) {
      bottomPanel.style.height = newHeight + 'px';
      bottomPanel.classList.remove('collapsed');
      document.getElementById('bottom-panel-toggle').textContent = '▼';
    }
  } else if (type === 'screenshots-terminal') {
    const content = document.querySelector('.bottom-panel-content');
    const contentRect = content.getBoundingClientRect();
    const screenshotsSection = document.getElementById('screenshots-section');
    const newWidth = e.clientX - contentRect.left;
    const percent = (newWidth / contentRect.width) * 100;
    
    if (percent > 15 && percent < 60) {
      screenshotsSection.style.flex = `0 0 ${percent}%`;
    }
  } else if (type === 'terminal-scratchpad') {
    const content = document.querySelector('.bottom-panel-content');
    const contentRect = content.getBoundingClientRect();
    const scratchpadSection = document.getElementById('scratchpad-section');
    const newWidth = contentRect.right - e.clientX;
    const percent = (newWidth / contentRect.width) * 100;
    
    if (percent > 15 && percent < 50) {
      scratchpadSection.style.flex = `0 0 ${percent}%`;
    }
  }
}

// ============================================
// WEBVIEW DEVTOOLS & CONTEXT MENU
// ============================================

function toggleActiveWebviewDevTools() {
  if (!activeWorkspace) return;
  const pane = activeWorkspace.panes[activePane];
  if (!pane || !pane.activeTabId) return;
  
  const webview = document.getElementById(`webview-${activePane}-${pane.activeTabId}`);
  if (webview) {
    if (webview.isDevToolsOpened()) {
      webview.closeDevTools();
    } else {
      webview.openDevTools();
    }
  }
}

function setupWebviewContextMenu(webview, paneName) {
  webview.addEventListener('context-menu', (e) => {
    e.preventDefault();
    const params = e.params;
    
    const hasSelection = params.selectionText && params.selectionText.length > 0;
    const isEditable = params.isEditable;
    const hasLink = params.linkURL && params.linkURL.length > 0;
    
    let menuItems = [];
    
    if (hasLink) {
      menuItems.push({ label: 'Open Link in New Tab', action: () => createTab(paneName, params.linkURL) });
      menuItems.push({ label: 'Copy Link', action: () => navigator.clipboard.writeText(params.linkURL) });
      menuItems.push({ type: 'separator' });
    }
    
    if (hasSelection) {
      menuItems.push({ label: 'Copy', action: () => webview.copy() });
    }
    
    if (isEditable) {
      menuItems.push({ label: 'Cut', action: () => webview.cut() });
      menuItems.push({ label: 'Paste', action: () => webview.paste() });
      menuItems.push({ label: 'Select All', action: () => webview.selectAll() });
    }
    
    if (menuItems.length > 0) {
      menuItems.push({ type: 'separator' });
    }
    
    menuItems.push({ label: 'Back', action: () => webview.goBack(), disabled: !webview.canGoBack() });
    menuItems.push({ label: 'Forward', action: () => webview.goForward(), disabled: !webview.canGoForward() });
    menuItems.push({ label: 'Reload', action: () => webview.reload() });
    menuItems.push({ type: 'separator' });
    menuItems.push({ label: 'Inspect Element', action: () => webview.inspectElement(params.x, params.y) });
    
    showContextMenu(params.x, params.y, menuItems);
  });
}

function showContextMenu(x, y, items) {
  const existing = document.getElementById('context-menu');
  if (existing) existing.remove();
  
  const menu = document.createElement('div');
  menu.id = 'context-menu';
  menu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 4px 0;
    min-width: 180px;
    z-index: 10000;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  `;
  
  items.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.style.cssText = 'height: 1px; background: var(--border-color); margin: 4px 0;';
      menu.appendChild(sep);
    } else {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.disabled = item.disabled;
      btn.style.cssText = `
        display: block;
        width: 100%;
        padding: 8px 16px;
        background: none;
        border: none;
        color: ${item.disabled ? 'var(--text-muted)' : 'var(--text-primary)'};
        font-size: 13px;
        text-align: left;
        cursor: ${item.disabled ? 'default' : 'pointer'};
      `;
      if (!item.disabled) {
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--bg-hover)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'none');
        btn.addEventListener('click', () => {
          item.action();
          menu.remove();
        });
      }
      menu.appendChild(btn);
    }
  });
  
  document.body.appendChild(menu);
  
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
  }
  
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
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
  
  const separators = [' | ', ' - ', ' — ', ' · ', ': '];
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
        <button class="workspace-action-btn edit" title="Rename">✎</button>
        <button class="workspace-action-btn delete" title="Delete">×</button>
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
      <button class="pane-tab-close" title="Close tab">×</button>
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
    webview.setAttribute('allowpopups', 'true');
    
    webview.addEventListener('dom-ready', () => {
      setupWebviewContextMenu(webview, paneName);
    });
    
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
    
    webview.addEventListener('new-window', (e) => {
      e.preventDefault();
      createTab(paneName, e.url);
    });
    
    webview.addEventListener('focus', () => {
      activePane = paneName;
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
  notepadToggle.textContent = isCollapsed ? '▶' : '◀';
  notepadExpand.classList.toggle('hidden', !isCollapsed);
}

function expandNotepad() {
  notepadPanel.classList.remove('collapsed');
  notepadToggle.textContent = '◀';
  notepadExpand.classList.add('hidden');
}

// ============================================
// BOTTOM PANEL MANAGEMENT
// ============================================

function toggleBottomPanel() {
  const isCollapsed = bottomPanel.classList.toggle('collapsed');
  document.getElementById('bottom-panel-toggle').textContent = isCollapsed ? '▲' : '▼';
}

// ============================================
// SCREENSHOTS PANEL
// ============================================

async function loadScreenshots() {
  const list = document.getElementById('screenshots-list');
  list.innerHTML = '<div class="screenshots-empty">Loading...</div>';
  
  try {
    const screenshots = await window.outerRim.screenshots.list();
    renderScreenshots(screenshots);
  } catch (err) {
    list.innerHTML = `<div class="screenshots-empty">Error: ${err.message}</div>`;
  }
}

function renderScreenshots(screenshots) {
  const list = document.getElementById('screenshots-list');
  list.innerHTML = '';
  
  if (screenshots.length === 0) {
    list.innerHTML = '<div class="screenshots-empty">No screenshots yet. Press Cmd+Shift+4 to capture!</div>';
    return;
  }
  
  screenshots.forEach(screenshot => {
    const item = document.createElement('div');
    item.className = 'screenshot-item';
    item.draggable = true;
    
    const timeAgo = getTimeAgo(screenshot.mtime);
    
    item.innerHTML = `
      <img src="file://${screenshot.path}" alt="${escapeHtml(screenshot.name)}" loading="lazy">
      <div class="screenshot-name" title="${escapeHtml(screenshot.name)}">${escapeHtml(screenshot.name)}</div>
      <div class="screenshot-time">${timeAgo}</div>
    `;
    
    item.addEventListener('click', () => {
      openScreenshotPreview(screenshot.path);
    });
    
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/uri-list', `file://${screenshot.path}`);
      e.dataTransfer.setData('text/plain', screenshot.path);
    });
    
    list.appendChild(item);
  });
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

function openScreenshotPreview(filepath) {
  const overlay = document.getElementById('screenshot-preview-overlay');
  const img = document.getElementById('screenshot-preview-img');
  
  img.src = `file://${filepath}`;
  img.dataset.path = filepath;
  overlay.classList.remove('hidden');
}

function closeScreenshotPreview() {
  document.getElementById('screenshot-preview-overlay').classList.add('hidden');
}

async function copyScreenshotToClipboard() {
  const img = document.getElementById('screenshot-preview-img');
  const filepath = img.dataset.path;
  
  const success = await window.outerRim.screenshots.copy(filepath);
  if (success) {
    const btn = document.getElementById('screenshot-copy');
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = 'Copy to Clipboard';
    }, 1500);
  }
}

async function deleteCurrentScreenshot() {
  const img = document.getElementById('screenshot-preview-img');
  const filepath = img.dataset.path;
  
  if (!confirm('Delete this screenshot?')) return;
  
  const success = await window.outerRim.screenshots.delete(filepath);
  if (success) {
    closeScreenshotPreview();
    loadScreenshots();
  }
}

async function deleteAllScreenshots() {
  if (!confirm('Delete ALL screenshots? This cannot be undone.')) return;
  
  const success = await window.outerRim.screenshots.deleteAll();
  if (success) {
    loadScreenshots();
  }
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
  // Global mouse handlers for resizing
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', stopResize);
  
  document.getElementById('add-workspace').addEventListener('click', openCreateWorkspaceModal);
  document.getElementById('empty-create-workspace').addEventListener('click', openCreateWorkspaceModal);
  
  document.querySelectorAll('.pane-add-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      openTabModal(btn.dataset.pane);
    });
  });
  
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
  
  document.getElementById('bottom-panel-toggle').addEventListener('click', toggleBottomPanel);
  
  document.getElementById('screenshots-refresh').addEventListener('click', loadScreenshots);
  document.getElementById('screenshots-delete-all').addEventListener('click', deleteAllScreenshots);
  
  document.getElementById('screenshot-preview-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'screenshot-preview-overlay') {
      closeScreenshotPreview();
    }
  });
  document.getElementById('screenshot-copy').addEventListener('click', copyScreenshotToClipboard);
  document.getElementById('screenshot-delete').addEventListener('click', deleteCurrentScreenshot);
  document.getElementById('screenshot-close').addEventListener('click', closeScreenshotPreview);
  
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
  
  document.getElementById('scratchpad-content').addEventListener('input', saveScratchpad);
  
  document.getElementById('modal-cancel').addEventListener('click', closeWorkspaceModal);
  document.getElementById('modal-confirm').addEventListener('click', confirmWorkspaceModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeWorkspaceModal();
  });
  workspaceNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmWorkspaceModal();
  });
  
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
  
  // Setup resizers
  document.getElementById('pane-resizer').addEventListener('mousedown', (e) => {
    const leftPane = document.getElementById('left-pane');
    const rightPane = document.getElementById('right-pane');
    startResize('pane', e, {
      startLeftWidth: leftPane.offsetWidth,
      startRightWidth: rightPane.offsetWidth
    });
  });
  
  document.getElementById('notepad-resizer').addEventListener('mousedown', (e) => {
    startResize('notepad', e, {
      startWidth: notepadPanel.offsetWidth
    });
  });
  
  document.getElementById('bottom-panel-resizer').addEventListener('mousedown', (e) => {
    startResize('bottom', e, {
      startHeight: bottomPanel.offsetHeight
    });
  });
  
  document.querySelectorAll('.bottom-section-resizer').forEach(resizer => {
    resizer.addEventListener('mousedown', (e) => {
      startResize(resizer.dataset.resize, e, {});
    });
  });
  
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
    if (e.key === 'F12') {
      e.preventDefault();
      toggleActiveWebviewDevTools();
    }
    if (e.key === 'Escape') {
      closeWorkspaceModal();
      closeTabModal();
      closeScreenshotPreview();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);