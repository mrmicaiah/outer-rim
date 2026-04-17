// ============================================
// OUTER RIM - Renderer Application
// Right pane: Browser tabs | Left pane: Commander (handled separately)
// ============================================

function uuidv4() {
  return crypto.randomUUID();
}

// State
let workspaces = [];
let activeWorkspace = null;
let activePane = 'right'; // Default to right since left is now Commander
let scratchpadContent = '';
let profiles = [];

// Track which webviews have been created
const createdWebviews = new Set();

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
const profileModalOverlay = document.getElementById('profile-modal-overlay');

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  workspaces = await window.outerRim.workspace.getAll();
  const active = await window.outerRim.workspace.getActive();
  
  if (active) {
    activeWorkspace = workspaces.find(w => w.id === active.id);
  }
  
  profiles = await window.outerRim.profiles.getAll();
  
  if (activeWorkspace) {
    migrateWorkspaceStructure(activeWorkspace);
  }
  
  updateProfileSelectors();
  
  scratchpadContent = await window.outerRim.scratchpad.get() || '';
  document.getElementById('scratchpad-content').value = scratchpadContent;
  
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
  renderRightPane();
  updateNotepad();
  updateEmptyState();
  setupEventListeners();
  
  loadScreenshots();
  
  window.outerRim.screenshots.onNew((filename) => {
    loadScreenshots();
  });
  
  window.outerRim.onMenuToggleDevTools(() => {
    toggleActiveWebviewDevTools();
  });
}

// ============================================
// WORKSPACE STRUCTURE MIGRATION
// ============================================

function migrateWorkspaceStructure(workspace) {
  if (!workspace.panes) {
    workspace.panes = {
      right: { activeProfileId: 'default', profiles: { 'default': { tabs: [], activeTabId: null } } }
    };
    window.outerRim.workspace.update(workspace);
    return;
  }
  
  // Migrate right pane if needed
  const rightPane = workspace.panes.right;
  if (rightPane && !rightPane.profiles) {
    const oldProfileId = rightPane.profileId || 'default';
    workspace.panes.right = {
      activeProfileId: oldProfileId,
      profiles: {
        [oldProfileId]: { tabs: rightPane.tabs || [], activeTabId: rightPane.activeTabId || null }
      }
    };
    if (oldProfileId !== 'default') {
      workspace.panes.right.profiles['default'] = { tabs: [], activeTabId: null };
    }
    window.outerRim.workspace.update(workspace);
  }
  
  // Ensure right pane exists
  if (!workspace.panes.right) {
    workspace.panes.right = { activeProfileId: 'default', profiles: { 'default': { tabs: [], activeTabId: null } } };
    window.outerRim.workspace.update(workspace);
  }
}

function ensurePaneProfile(pane, profileId) {
  if (!pane.profiles) pane.profiles = {};
  if (!pane.profiles[profileId]) pane.profiles[profileId] = { tabs: [], activeTabId: null };
  return pane.profiles[profileId];
}

function getCurrentPaneData() {
  if (!activeWorkspace?.panes?.right) return null;
  const pane = activeWorkspace.panes.right;
  const profileId = pane.activeProfileId || 'default';
  return ensurePaneProfile(pane, profileId);
}

function getCurrentProfileId() {
  if (!activeWorkspace?.panes?.right) return 'default';
  return activeWorkspace.panes.right.activeProfileId || 'default';
}

// ============================================
// PROFILE MANAGEMENT
// ============================================

function updateProfileSelectors() {
  document.querySelectorAll('.profile-select').forEach(select => {
    const currentValue = getCurrentProfileId();
    select.innerHTML = profiles.map(p => 
      `<option value="${p.id}" ${p.id === currentValue ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
  });
}

function openProfileModal() {
  renderProfileList();
  profileModalOverlay.classList.remove('hidden');
  document.getElementById('new-profile-input').focus();
}

function closeProfileModal() {
  profileModalOverlay.classList.add('hidden');
}

function renderProfileList() {
  const list = document.getElementById('profile-list');
  list.innerHTML = profiles.map(p => `
    <div class="profile-item" data-id="${p.id}">
      <div>
        <span class="profile-item-name">${escapeHtml(p.name)}</span>
        ${p.id === 'default' ? '<span class="profile-item-default">(cannot delete)</span>' : ''}
      </div>
      <div class="profile-item-actions">
        ${p.id !== 'default' ? `<button class="delete" title="Delete">🗑️</button>` : ''}
      </div>
    </div>
  `).join('');
  
  list.querySelectorAll('.profile-item-actions .delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const item = e.target.closest('.profile-item');
      const id = item.dataset.id;
      if (confirm(`Delete profile "${profiles.find(p => p.id === id)?.name}"?`)) {
        await deleteProfile(id);
      }
    });
  });
}

async function addProfile() {
  const input = document.getElementById('new-profile-input');
  const name = input.value.trim();
  if (!name) return;
  
  const profile = await window.outerRim.profiles.create(name);
  profiles.push(profile);
  
  input.value = '';
  renderProfileList();
  updateProfileSelectors();
}

async function deleteProfile(id) {
  await window.outerRim.profiles.delete(id);
  profiles = profiles.filter(p => p.id !== id);
  
  if (activeWorkspace) {
    const pane = activeWorkspace.panes.right;
    
    // Remove webviews for deleted profile
    if (pane.profiles && pane.profiles[id]) {
      pane.profiles[id].tabs.forEach(tab => {
        const webviewKey = `right-${id}-${tab.id}`;
        const webview = document.getElementById(`webview-right-${id}-${tab.id}`);
        if (webview) webview.remove();
        createdWebviews.delete(webviewKey);
      });
      delete pane.profiles[id];
    }
    
    if (pane.activeProfileId === id) {
      pane.activeProfileId = 'default';
    }
    
    await window.outerRim.workspace.update(activeWorkspace);
  }
  
  renderProfileList();
  updateProfileSelectors();
  renderRightPane();
}

function getPartitionForProfile(profileId) {
  return profileId === 'default' ? 'persist:outerrim' : `persist:profile-${profileId}`;
}

// ============================================
// GLOBAL RESIZE HANDLERS
// ============================================

function startResize(type, e, extras = {}) {
  currentResizer = { type, startX: e.clientX, startY: e.clientY, ...extras };
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
    if (newLeftWidth >= 280 && newRightWidth >= 300) {
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
    const percent = ((e.clientX - contentRect.left) / contentRect.width) * 100;
    if (percent > 15 && percent < 60) {
      screenshotsSection.style.flex = `0 0 ${percent}%`;
    }
  } else if (type === 'terminal-scratchpad') {
    const content = document.querySelector('.bottom-panel-content');
    const contentRect = content.getBoundingClientRect();
    const scratchpadSection = document.getElementById('scratchpad-section');
    const percent = ((contentRect.right - e.clientX) / contentRect.width) * 100;
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
  const paneData = getCurrentPaneData();
  const profileId = getCurrentProfileId();
  if (!paneData?.activeTabId) return;
  
  const webview = document.getElementById(`webview-right-${profileId}-${paneData.activeTabId}`);
  if (webview) {
    webview.isDevToolsOpened() ? webview.closeDevTools() : webview.openDevTools();
  }
}

function setupWebviewContextMenu(webview) {
  webview.addEventListener('context-menu', (e) => {
    e.preventDefault();
    const params = e.params;
    const hasSelection = params.selectionText?.length > 0;
    const isEditable = params.isEditable;
    const hasLink = params.linkURL?.length > 0;
    
    let menuItems = [];
    
    if (hasLink) {
      menuItems.push({ label: 'Open Link in New Tab', action: () => createTab(params.linkURL) });
      menuItems.push({ label: 'Copy Link', action: () => navigator.clipboard.writeText(params.linkURL) });
      menuItems.push({ type: 'separator' });
    }
    if (hasSelection) menuItems.push({ label: 'Copy', action: () => webview.copy() });
    if (isEditable) {
      menuItems.push({ label: 'Cut', action: () => webview.cut() });
      menuItems.push({ label: 'Paste', action: () => webview.paste() });
      menuItems.push({ label: 'Select All', action: () => webview.selectAll() });
    }
    if (menuItems.length > 0) menuItems.push({ type: 'separator' });
    
    menuItems.push({ label: 'Back', action: () => webview.goBack(), disabled: !webview.canGoBack() });
    menuItems.push({ label: 'Forward', action: () => webview.goForward(), disabled: !webview.canGoForward() });
    menuItems.push({ label: 'Reload', action: () => webview.reload() });
    menuItems.push({ type: 'separator' });
    menuItems.push({ label: 'Inspect Element', action: () => webview.inspectElement(params.x, params.y) });
    
    showContextMenu(params.x, params.y, menuItems);
  });
}

function showContextMenu(x, y, items) {
  document.getElementById('context-menu')?.remove();
  
  const menu = document.createElement('div');
  menu.id = 'context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:4px 0;min-width:180px;z-index:10000;box-shadow:0 8px 32px rgba(0,0,0,0.4);`;
  
  items.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--border-color);margin:4px 0;';
      menu.appendChild(sep);
    } else {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.disabled = item.disabled;
      btn.style.cssText = `display:block;width:100%;padding:8px 16px;background:none;border:none;color:${item.disabled ? 'var(--text-muted)' : 'var(--text-primary)'};font-size:13px;text-align:left;cursor:${item.disabled ? 'default' : 'pointer'};`;
      if (!item.disabled) {
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--bg-hover)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'none');
        btn.addEventListener('click', () => { item.action(); menu.remove(); });
      }
      menu.appendChild(btn);
    }
  });
  
  document.body.appendChild(menu);
  
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
  
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
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
  } catch (e) {}
  
  const knownBrands = ['Claude', 'GitHub', 'Google', 'Cloudflare', 'Vercel', 'Netlify', 'AWS', 'Azure', 'Firebase', 'Supabase', 'Discord', 'Slack', 'Twitter', 'X', 'LinkedIn', 'Facebook', 'Instagram', 'YouTube', 'Reddit', 'Stack Overflow', 'ChatGPT', 'OpenAI', 'Notion', 'Figma', 'Linear', 'Jira', 'Trello', 'Asana'];
  
  for (const brand of knownBrands) {
    if (title.toLowerCase().startsWith(brand.toLowerCase())) return brand;
    if (new RegExp(`^${brand}\\s*[-|:]`, 'i').test(title) || new RegExp(`[-|:]\\s*${brand}$`, 'i').test(title)) return brand;
  }
  
  const separators = [' | ', ' - ', ' — ', ' · ', ': '];
  for (const sep of separators) {
    if (title.includes(sep)) {
      const parts = title.split(sep);
      const shortPart = parts.filter(p => p.trim().length >= 2).sort((a, b) => a.length - b.length)[0];
      if (shortPart?.length <= 20) return shortPart.trim();
      if (parts[0].trim().length <= 25) return parts[0].trim();
    }
  }
  
  if (title.length <= 20) return title;
  if (siteName?.length > 1) return siteName;
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
      if (!e.target.classList.contains('workspace-action-btn')) switchWorkspace(workspace.id);
    });
    item.querySelector('.edit').addEventListener('click', (e) => { e.stopPropagation(); openRenameModal(workspace); });
    item.querySelector('.delete').addEventListener('click', (e) => { e.stopPropagation(); deleteWorkspace(workspace.id); });
    
    workspaceList.appendChild(item);
  });
}

async function createWorkspace(name) {
  const workspace = {
    id: uuidv4(),
    name,
    panes: {
      right: { activeProfileId: 'default', profiles: { 'default': { tabs: [], activeTabId: null } } }
    },
    notes: '',
    createdAt: new Date().toISOString()
  };
  
  await window.outerRim.workspace.create(workspace);
  workspaces.push(workspace);
  activeWorkspace = workspace;
  
  updateProfileSelectors();
  renderWorkspaces();
  renderRightPane();
  updateNotepad();
  updateEmptyState();
}

async function switchWorkspace(workspaceId) {
  // Clear all webviews when switching workspaces
  document.querySelectorAll('.pane-webview-container webview').forEach(wv => wv.remove());
  createdWebviews.clear();
  
  activeWorkspace = workspaces.find(w => w.id === workspaceId);
  await window.outerRim.workspace.setActive(workspaceId);
  
  if (activeWorkspace) migrateWorkspaceStructure(activeWorkspace);
  
  updateProfileSelectors();
  renderWorkspaces();
  renderRightPane();
  updateNotepad();
}

async function deleteWorkspace(workspaceId) {
  if (!confirm('Delete this workspace and all its tabs?')) return;
  
  workspaces = await window.outerRim.workspace.delete(workspaceId);
  
  if (activeWorkspace?.id === workspaceId) {
    document.querySelectorAll('.pane-webview-container webview').forEach(wv => wv.remove());
    createdWebviews.clear();
    activeWorkspace = workspaces[0] || null;
  }
  
  renderWorkspaces();
  renderRightPane();
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
// RIGHT PANE TAB MANAGEMENT
// ============================================

function renderRightPane() {
  const tabList = document.querySelector('.pane-tab-list[data-pane="right"]');
  const webviewContainer = document.querySelector('.pane-webview-container[data-pane="right"]');
  const navBar = document.querySelector('.pane-nav-bar[data-pane="right"]');
  
  tabList.innerHTML = '';
  
  if (!activeWorkspace) {
    webviewContainer.querySelectorAll('webview').forEach(wv => wv.remove());
    webviewContainer.querySelector('.pane-empty-state').style.display = 'block';
    navBar.classList.add('hidden');
    return;
  }
  
  migrateWorkspaceStructure(activeWorkspace);
  
  const pane = activeWorkspace.panes.right;
  const activeProfileId = pane.activeProfileId || 'default';
  const activeProfileData = ensurePaneProfile(pane, activeProfileId);
  
  const emptyState = webviewContainer.querySelector('.pane-empty-state');
  const hasTabs = activeProfileData.tabs.length > 0;
  emptyState.style.display = hasTabs ? 'none' : 'block';
  navBar.classList.toggle('hidden', !hasTabs);
  
  // Hide all webviews first
  webviewContainer.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));
  
  // Render tabs and webviews for ALL profiles
  Object.entries(pane.profiles || {}).forEach(([profileId, profileData]) => {
    const partition = getPartitionForProfile(profileId);
    const profile = profiles.find(p => p.id === profileId);
    const isActiveProfile = profileId === activeProfileId;
    
    profileData.tabs.forEach(tab => {
      const webviewKey = `right-${profileId}-${tab.id}`;
      const webviewId = `webview-right-${profileId}-${tab.id}`;
      
      // Only render tab items for active profile
      if (isActiveProfile) {
        const item = document.createElement('div');
        item.className = `pane-tab-item ${profileData.activeTabId === tab.id ? 'active' : ''}`;
        item.dataset.id = tab.id;
        item.dataset.profile = profileId;
        
        const favicon = getFaviconUrl(tab.url);
        const displayTitle = simplifyTitle(tab.title, tab.url);
        const profileBadge = profileId !== 'default' ? `<span class="pane-tab-profile-badge">${escapeHtml(profile?.name || profileId)}</span>` : '';
        
        item.innerHTML = `
          <img class="pane-tab-favicon" src="${favicon}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23666%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'">
          <span class="pane-tab-title" title="${escapeHtml(tab.title || '')}">${escapeHtml(displayTitle)}</span>
          ${profileBadge}
          <button class="pane-tab-close" title="Close tab">×</button>
        `;
        
        item.addEventListener('click', (e) => {
          if (!e.target.classList.contains('pane-tab-close')) switchTab(tab.id);
        });
        item.querySelector('.pane-tab-close').addEventListener('click', (e) => {
          e.stopPropagation();
          closeTab(tab.id);
        });
        
        tabList.appendChild(item);
      }
      
      // Create webview if not exists
      if (!createdWebviews.has(webviewKey)) {
        const webview = document.createElement('webview');
        webview.id = webviewId;
        webview.src = tab.url;
        webview.setAttribute('partition', partition);
        webview.setAttribute('allowpopups', 'true');
        webview.dataset.profile = profileId;
        webview.dataset.tab = tab.id;
        
        webview.addEventListener('dom-ready', () => setupWebviewContextMenu(webview));
        webview.addEventListener('page-title-updated', (e) => updateTabTitle(tab.id, e.title, profileId));
        webview.addEventListener('did-navigate', (e) => {
          updateTabUrl(tab.id, e.url, profileId);
          if (isActiveProfile) updateNavBar();
        });
        webview.addEventListener('did-navigate-in-page', (e) => {
          if (e.isMainFrame) {
            updateTabUrl(tab.id, e.url, profileId);
            if (isActiveProfile) updateNavBar();
          }
        });
        webview.addEventListener('new-window', (e) => { e.preventDefault(); createTab(e.url); });
        
        webviewContainer.appendChild(webview);
        createdWebviews.add(webviewKey);
      }
      
      // Show active tab's webview for active profile
      if (isActiveProfile && profileData.activeTabId === tab.id) {
        document.getElementById(webviewId)?.classList.add('active');
      }
    });
  });
  
  updateNavBar();
}

function updateNavBar() {
  if (!activeWorkspace) return;
  
  const paneData = getCurrentPaneData();
  const profileId = getCurrentProfileId();
  if (!paneData?.activeTabId) return;
  
  const webview = document.getElementById(`webview-right-${profileId}-${paneData.activeTabId}`);
  const navUrl = document.querySelector('.nav-url[data-pane="right"]');
  const navBack = document.querySelector('.nav-back[data-pane="right"]');
  const navForward = document.querySelector('.nav-forward[data-pane="right"]');
  
  if (webview && navUrl) {
    const tab = paneData.tabs.find(t => t.id === paneData.activeTabId);
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

async function createTab(url) {
  if (!activeWorkspace) {
    alert('Create a workspace first');
    return;
  }
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = url.includes('.') && !url.includes(' ') ? 'https://' + url : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }
  
  const tab = { id: uuidv4(), url, title: 'Loading...', createdAt: new Date().toISOString() };
  
  const paneData = getCurrentPaneData();
  if (!paneData) {
    console.error('No pane data available');
    return;
  }
  
  paneData.tabs.push(tab);
  paneData.activeTabId = tab.id;
  
  await window.outerRim.workspace.update(activeWorkspace);
  workspaces[workspaces.findIndex(w => w.id === activeWorkspace.id)] = activeWorkspace;
  
  renderRightPane();
}

async function switchTab(tabId) {
  if (!activeWorkspace) return;
  
  const paneData = getCurrentPaneData();
  const profileId = getCurrentProfileId();
  paneData.activeTabId = tabId;
  await window.outerRim.workspace.update(activeWorkspace);
  workspaces[workspaces.findIndex(w => w.id === activeWorkspace.id)] = activeWorkspace;
  
  document.querySelector('.pane-tab-list[data-pane="right"]').querySelectorAll('.pane-tab-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === tabId);
  });
  
  document.querySelector('.pane-webview-container[data-pane="right"]').querySelectorAll('webview').forEach(wv => {
    wv.classList.toggle('active', wv.id === `webview-right-${profileId}-${tabId}`);
  });
  
  updateNavBar();
}

function navigateBack() {
  const paneData = getCurrentPaneData();
  const profileId = getCurrentProfileId();
  if (!paneData?.activeTabId) return;
  const webview = document.getElementById(`webview-right-${profileId}-${paneData.activeTabId}`);
  if (webview?.canGoBack()) webview.goBack();
}

function navigateForward() {
  const paneData = getCurrentPaneData();
  const profileId = getCurrentProfileId();
  if (!paneData?.activeTabId) return;
  const webview = document.getElementById(`webview-right-${profileId}-${paneData.activeTabId}`);
  if (webview?.canGoForward()) webview.goForward();
}

function refreshActiveTab() {
  const paneData = getCurrentPaneData();
  const profileId = getCurrentProfileId();
  if (!paneData?.activeTabId) return;
  document.getElementById(`webview-right-${profileId}-${paneData.activeTabId}`)?.reload();
}

function navigateToUrl(url) {
  const paneData = getCurrentPaneData();
  const profileId = getCurrentProfileId();
  if (!paneData?.activeTabId) return;
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = url.includes('.') && !url.includes(' ') ? 'https://' + url : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }
  
  const webview = document.getElementById(`webview-right-${profileId}-${paneData.activeTabId}`);
  if (webview) webview.src = url;
}

async function closeTab(tabId) {
  if (!activeWorkspace) return;
  
  const paneData = getCurrentPaneData();
  const profileId = getCurrentProfileId();
  
  const webviewKey = `right-${profileId}-${tabId}`;
  document.getElementById(`webview-right-${profileId}-${tabId}`)?.remove();
  createdWebviews.delete(webviewKey);
  
  paneData.tabs = paneData.tabs.filter(t => t.id !== tabId);
  if (paneData.activeTabId === tabId) paneData.activeTabId = paneData.tabs[0]?.id || null;
  
  await window.outerRim.workspace.update(activeWorkspace);
  workspaces[workspaces.findIndex(w => w.id === activeWorkspace.id)] = activeWorkspace;
  
  renderRightPane();
}

async function updateTabTitle(tabId, title, profileId) {
  if (!activeWorkspace) return;
  
  const pane = activeWorkspace.panes.right;
  const profileData = pane.profiles?.[profileId];
  const tab = profileData?.tabs.find(t => t.id === tabId);
  
  if (tab) {
    tab.title = title;
    await window.outerRim.workspace.update(activeWorkspace);
    
    if (profileId === pane.activeProfileId) {
      const tabEl = document.querySelector(`.pane-tab-item[data-id="${tabId}"] .pane-tab-title`);
      if (tabEl) {
        tabEl.textContent = simplifyTitle(title, tab.url);
        tabEl.title = title;
      }
    }
  }
}

async function updateTabUrl(tabId, url, profileId) {
  if (!activeWorkspace) return;
  
  const pane = activeWorkspace.panes.right;
  const profileData = pane.profiles?.[profileId];
  const tab = profileData?.tabs.find(t => t.id === tabId);
  
  if (tab) {
    tab.url = url;
    await window.outerRim.workspace.update(activeWorkspace);
    
    if (profileId === pane.activeProfileId && profileData.activeTabId === tabId) {
      const navUrl = document.querySelector('.nav-url[data-pane="right"]');
      if (navUrl) navUrl.value = url;
    }
  }
}

async function changeProfile(profileId) {
  if (!activeWorkspace) return;
  
  const pane = activeWorkspace.panes.right;
  pane.activeProfileId = profileId;
  ensurePaneProfile(pane, profileId);
  
  await window.outerRim.workspace.update(activeWorkspace);
  
  renderRightPane();
  updateProfileSelectors();
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
    
    item.innerHTML = `
      <img src="file://${screenshot.path}" alt="${escapeHtml(screenshot.name)}" loading="lazy">
      <div class="screenshot-name" title="${escapeHtml(screenshot.name)}">${escapeHtml(screenshot.name)}</div>
      <div class="screenshot-time">${getTimeAgo(screenshot.mtime)}</div>
    `;
    
    item.addEventListener('click', () => openScreenshotPreview(screenshot.path));
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
  const success = await window.outerRim.screenshots.copy(img.dataset.path);
  if (success) {
    const btn = document.getElementById('screenshot-copy');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 1500);
  }
}

async function deleteCurrentScreenshot() {
  const img = document.getElementById('screenshot-preview-img');
  if (!confirm('Delete this screenshot?')) return;
  if (await window.outerRim.screenshots.delete(img.dataset.path)) {
    closeScreenshotPreview();
    loadScreenshots();
  }
}

async function deleteAllScreenshots() {
  if (!confirm('Delete ALL screenshots? This cannot be undone.')) return;
  if (await window.outerRim.screenshots.deleteAll()) loadScreenshots();
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
    if (result.stdout) appendTerminalOutput(result.stdout, 'output');
    if (result.stderr) appendTerminalOutput(result.stderr, 'error');
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
    await window.outerRim.scratchpad.save(document.getElementById('scratchpad-content').value);
  }, 500);
}

// ============================================
// UI HELPERS
// ============================================

function updateEmptyState() {
  emptyStateOverlay.classList.toggle('hidden', workspaces.length > 0 && activeWorkspace);
}

function getFaviconUrl(url) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
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
  editingWorkspaceId ? renameWorkspace(editingWorkspaceId, name) : createWorkspace(name);
  closeWorkspaceModal();
}

function openTabModal() {
  if (!activeWorkspace) { alert('Create a workspace first'); return; }
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
  createTab(url);
  closeTabModal();
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', stopResize);
  
  document.getElementById('add-workspace').addEventListener('click', openCreateWorkspaceModal);
  document.getElementById('empty-create-workspace').addEventListener('click', openCreateWorkspaceModal);
  
  // Right pane add tab button
  document.querySelector('.pane-add-tab[data-pane="right"]').addEventListener('click', openTabModal);
  
  document.querySelectorAll('.profile-select').forEach(select => {
    select.addEventListener('change', (e) => changeProfile(e.target.value));
  });
  
  document.querySelectorAll('.profile-manage-btn').forEach(btn => {
    btn.addEventListener('click', openProfileModal);
  });
  
  document.getElementById('profile-modal-close').addEventListener('click', closeProfileModal);
  document.getElementById('add-profile-btn').addEventListener('click', addProfile);
  document.getElementById('new-profile-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') addProfile(); });
  profileModalOverlay.addEventListener('click', (e) => { if (e.target === profileModalOverlay) closeProfileModal(); });
  
  document.querySelector('.nav-back[data-pane="right"]').addEventListener('click', navigateBack);
  document.querySelector('.nav-forward[data-pane="right"]').addEventListener('click', navigateForward);
  document.querySelector('.nav-refresh[data-pane="right"]').addEventListener('click', refreshActiveTab);
  document.querySelector('.nav-url[data-pane="right"]').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') { navigateToUrl(e.target.value.trim()); e.target.blur(); }
  });
  
  document.getElementById('bottom-panel-toggle').addEventListener('click', toggleBottomPanel);
  document.getElementById('screenshots-refresh').addEventListener('click', loadScreenshots);
  document.getElementById('screenshots-delete-all').addEventListener('click', deleteAllScreenshots);
  
  document.getElementById('screenshot-preview-overlay').addEventListener('click', (e) => { if (e.target.id === 'screenshot-preview-overlay') closeScreenshotPreview(); });
  document.getElementById('screenshot-copy').addEventListener('click', copyScreenshotToClipboard);
  document.getElementById('screenshot-delete').addEventListener('click', deleteCurrentScreenshot);
  document.getElementById('screenshot-close').addEventListener('click', closeScreenshotPreview);
  
  document.getElementById('terminal-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runTerminalCommand(e.target.value);
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (historyIndex > 0) e.target.value = terminalHistory[--historyIndex]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.target.value = historyIndex < terminalHistory.length - 1 ? terminalHistory[++historyIndex] : (historyIndex = terminalHistory.length, ''); }
  });
  
  document.getElementById('scratchpad-content').addEventListener('input', saveScratchpad);
  
  document.getElementById('modal-cancel').addEventListener('click', closeWorkspaceModal);
  document.getElementById('modal-confirm').addEventListener('click', confirmWorkspaceModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeWorkspaceModal(); });
  workspaceNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirmWorkspaceModal(); });
  
  document.getElementById('tab-modal-cancel').addEventListener('click', closeTabModal);
  document.getElementById('tab-modal-confirm').addEventListener('click', confirmTabModal);
  tabModalOverlay.addEventListener('click', (e) => { if (e.target === tabModalOverlay) closeTabModal(); });
  tabUrlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirmTabModal(); });
  
  document.querySelectorAll('.quick-link').forEach(btn => {
    btn.addEventListener('click', () => { createTab(btn.dataset.url); closeTabModal(); });
  });
  
  notepadContent.addEventListener('input', saveNotes);
  notepadToggle.addEventListener('click', toggleNotepad);
  notepadExpand.addEventListener('click', expandNotepad);
  
  document.getElementById('pane-resizer').addEventListener('mousedown', (e) => {
    startResize('pane', e, { startLeftWidth: document.getElementById('left-pane').offsetWidth, startRightWidth: document.getElementById('right-pane').offsetWidth });
  });
  document.getElementById('notepad-resizer').addEventListener('mousedown', (e) => {
    startResize('notepad', e, { startWidth: notepadPanel.offsetWidth });
  });
  document.getElementById('bottom-panel-resizer').addEventListener('mousedown', (e) => {
    startResize('bottom', e, { startHeight: bottomPanel.offsetHeight });
  });
  document.querySelectorAll('.bottom-section-resizer').forEach(resizer => {
    resizer.addEventListener('mousedown', (e) => startResize(resizer.dataset.resize, e, {}));
  });
  
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 't') { e.preventDefault(); openTabModal(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') { e.preventDefault(); const pd = getCurrentPaneData(); if (pd?.activeTabId) closeTab(pd.activeTabId); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); openCreateWorkspaceModal(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') { e.preventDefault(); refreshActiveTab(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') { e.preventDefault(); const nav = document.querySelector('.nav-url[data-pane="right"]'); nav?.focus(); nav?.select(); }
    if ((e.metaKey || e.ctrlKey) && e.key === '`') { e.preventDefault(); toggleBottomPanel(); }
    if (e.key === 'F12') { e.preventDefault(); toggleActiveWebviewDevTools(); }
    if (e.key === 'Escape') { closeWorkspaceModal(); closeTabModal(); closeProfileModal(); closeScreenshotPreview(); }
  });
}

document.addEventListener('DOMContentLoaded', init);
