// ============================================
// PARALLEL - Dual-Pane Browser for Parallel Workstreams
// ============================================

function uuidv4() {
  return crypto.randomUUID();
}

// State
let workspaces = [];
let activeWorkspace = null;
let profiles = [];
let focusedPane = 'left'; // 'left' | 'right' — tracks last-clicked pane for shortcuts

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

// Modals
const modalOverlay = document.getElementById('modal-overlay');
const workspaceNameInput = document.getElementById('workspace-name-input');
const tabModalOverlay = document.getElementById('tab-modal-overlay');
const tabUrlInput = document.getElementById('tab-url-input');
const profileModalOverlay = document.getElementById('profile-modal-overlay');

// Modal transient state
let pendingTabPaneId = 'left'; // which pane the new-tab modal will create into

const PANES = ['left', 'right'];

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  workspaces = await window.parallel.workspace.getAll();
  const active = await window.parallel.workspace.getActive();

  if (active) {
    activeWorkspace = workspaces.find(w => w.id === active.id);
  }

  profiles = await window.parallel.profiles.getAll();

  if (activeWorkspace) {
    migrateWorkspaceStructure(activeWorkspace);
  }

  updateProfileSelectors();

  resizeOverlay = document.createElement('div');
  resizeOverlay.id = 'resize-overlay';
  resizeOverlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:none;`;
  document.body.appendChild(resizeOverlay);

  renderWorkspaces();
  PANES.forEach(p => renderPane(p));
  updateNotepad();
  updateEmptyState();
  setFocusedPane('left');
  setupEventListeners();

  // Menu sends (event, pane) — pane may be 'left', 'right', or null (= focused pane)
  window.parallel.onMenuToggleDevTools((event, pane) => {
    toggleWebviewDevTools(pane || focusedPane);
  });
}

// ============================================
// WORKSPACE STRUCTURE MIGRATION
// ============================================

function migrateWorkspaceStructure(workspace) {
  if (!workspace.panes) {
    workspace.panes = {
      left: { activeProfileId: 'default', profiles: { 'default': { tabs: [], activeTabId: null } } },
      right: { activeProfileId: 'default', profiles: { 'default': { tabs: [], activeTabId: null } } }
    };
    window.parallel.workspace.update(workspace);
    return;
  }

  // Ensure both panes exist
  PANES.forEach(paneId => {
    if (!workspace.panes[paneId]) {
      workspace.panes[paneId] = { activeProfileId: 'default', profiles: { 'default': { tabs: [], activeTabId: null } } };
    }
    const pane = workspace.panes[paneId];
    // Legacy migration: old shape with pane.tabs directly
    if (!pane.profiles) {
      const oldProfileId = pane.profileId || 'default';
      workspace.panes[paneId] = {
        activeProfileId: oldProfileId,
        profiles: { [oldProfileId]: { tabs: pane.tabs || [], activeTabId: pane.activeTabId || null } }
      };
      if (oldProfileId !== 'default') {
        workspace.panes[paneId].profiles['default'] = { tabs: [], activeTabId: null };
      }
    }
  });

  window.parallel.workspace.update(workspace);
}

function ensurePaneProfile(pane, profileId) {
  if (!pane.profiles) pane.profiles = {};
  if (!pane.profiles[profileId]) pane.profiles[profileId] = { tabs: [], activeTabId: null };
  return pane.profiles[profileId];
}

function getPaneRoot(paneId) {
  if (!activeWorkspace?.panes?.[paneId]) return null;
  return activeWorkspace.panes[paneId];
}

function getPaneData(paneId) {
  const pane = getPaneRoot(paneId);
  if (!pane) return null;
  const profileId = pane.activeProfileId || 'default';
  return ensurePaneProfile(pane, profileId);
}

function getPaneProfileId(paneId) {
  const pane = getPaneRoot(paneId);
  return pane?.activeProfileId || 'default';
}

// ============================================
// FOCUSED PANE TRACKING
// ============================================

function setFocusedPane(paneId) {
  focusedPane = paneId;
  PANES.forEach(p => {
    const el = document.getElementById(`${p}-pane`);
    if (el) el.classList.toggle('focused', p === paneId);
  });
}

// ============================================
// PROFILE MANAGEMENT
// ============================================

function updateProfileSelectors() {
  PANES.forEach(paneId => {
    const select = document.querySelector(`.profile-select[data-pane="${paneId}"]`);
    if (!select) return;
    const currentValue = getPaneProfileId(paneId);
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
      <span class="profile-item-name">${escapeHtml(p.name)}</span>
      <div class="profile-item-actions">
        ${p.id !== 'default' ? `<button class="delete" title="Delete">🗑</button>` : ''}
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

  const profile = await window.parallel.profiles.create(name);
  profiles.push(profile);

  input.value = '';
  renderProfileList();
  updateProfileSelectors();
}

async function deleteProfile(id) {
  await window.parallel.profiles.delete(id);
  profiles = profiles.filter(p => p.id !== id);

  if (activeWorkspace) {
    PANES.forEach(paneId => {
      const pane = activeWorkspace.panes[paneId];
      if (pane?.profiles?.[id]) {
        pane.profiles[id].tabs.forEach(tab => {
          const webview = document.getElementById(`webview-${paneId}-${id}-${tab.id}`);
          if (webview) webview.remove();
          createdWebviews.delete(`${paneId}-${id}-${tab.id}`);
        });
        delete pane.profiles[id];
      }
      if (pane?.activeProfileId === id) pane.activeProfileId = 'default';
    });
    await window.parallel.workspace.update(activeWorkspace);
  }

  renderProfileList();
  updateProfileSelectors();
  PANES.forEach(p => renderPane(p));
}

function getPartitionForProfile(profileId) {
  return profileId === 'default' ? 'persist:parallel' : `persist:profile-${profileId}`;
}

// ============================================
// GLOBAL RESIZE HANDLERS
// ============================================

function startResize(type, e, extras = {}) {
  currentResizer = { type, startX: e.clientX, startY: e.clientY, ...extras };
  resizeOverlay.style.display = 'block';
  document.body.style.cursor = 'col-resize';
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

  const { type, startX, startLeftWidth, startRightWidth, startWidth } = currentResizer;

  if (type === 'pane') {
    const leftPane = document.getElementById('left-pane');
    const rightPane = document.getElementById('right-pane');
    const delta = e.clientX - startX;
    const newLeftWidth = startLeftWidth + delta;
    const newRightWidth = startRightWidth - delta;
    if (newLeftWidth >= 300 && newRightWidth >= 300) {
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
  }
}

// ============================================
// WEBVIEW DEVTOOLS & CONTEXT MENU
// ============================================

function toggleWebviewDevTools(paneId) {
  if (!activeWorkspace) return;
  const paneData = getPaneData(paneId);
  const profileId = getPaneProfileId(paneId);
  if (!paneData?.activeTabId) return;

  const webview = document.getElementById(`webview-${paneId}-${profileId}-${paneData.activeTabId}`);
  if (webview) {
    if (webview.isDevToolsOpened()) {
      webview.closeDevTools();
    } else {
      webview.openDevTools();
    }
  }
}

// Force webview to repaint after DevTools closes
function setupWebviewDevToolsHandler(webview) {
  webview.addEventListener('devtools-closed', () => {
    if (webview.classList.contains('active')) {
      webview.style.visibility = 'hidden';
      void webview.offsetHeight;
      requestAnimationFrame(() => {
        webview.style.visibility = 'visible';
      });
    }
  });
}

function setupWebviewContextMenu(webview, paneId) {
  webview.addEventListener('context-menu', (e) => {
    e.preventDefault();
    const params = e.params;
    const otherPane = paneId === 'left' ? 'right' : 'left';
    let menuItems = [];

    if (params.linkURL) {
      menuItems.push({ label: 'Open Link in New Tab', action: () => createTab(paneId, params.linkURL) });
      menuItems.push({ label: `Open Link in ${otherPane.charAt(0).toUpperCase() + otherPane.slice(1)} Pane`, action: () => createTab(otherPane, params.linkURL) });
      menuItems.push({ label: 'Copy Link', action: () => navigator.clipboard.writeText(params.linkURL) });
      menuItems.push({ type: 'separator' });
    }
    if (params.selectionText) menuItems.push({ label: 'Copy', action: () => webview.copy() });
    if (params.isEditable) {
      menuItems.push({ label: 'Cut', action: () => webview.cut() });
      menuItems.push({ label: 'Paste', action: () => webview.paste() });
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
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--light-bg);border:1px solid var(--light-border);border-radius:8px;padding:4px 0;min-width:200px;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.15);`;

  items.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--light-border);margin:4px 0;';
      menu.appendChild(sep);
    } else {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.disabled = item.disabled;
      btn.style.cssText = `display:block;width:100%;padding:10px 16px;background:none;border:none;color:${item.disabled ? '#999' : 'var(--light-text)'};font-size:13px;font-weight:500;text-align:left;cursor:${item.disabled ? 'default' : 'pointer'};`;
      if (!item.disabled) {
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--light-bg-secondary)');
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

  const knownBrands = ['Claude', 'GitHub', 'Google', 'Cloudflare', 'Vercel', 'Discord', 'Slack', 'YouTube', 'Reddit', 'ChatGPT', 'Notion', 'Figma', 'Linear'];

  for (const brand of knownBrands) {
    if (title.toLowerCase().includes(brand.toLowerCase())) return brand;
  }

  const separators = [' | ', ' - ', ' — ', ' · ', ': '];
  for (const sep of separators) {
    if (title.includes(sep)) {
      const parts = title.split(sep);
      if (parts[0].trim().length <= 25) return parts[0].trim();
    }
  }

  return title.length <= 20 ? title : title.substring(0, 18) + '...';
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
  // Default: open claude.ai in right pane, blank left pane
  const claudeTab = { id: uuidv4(), url: 'https://claude.ai', title: 'Loading...', createdAt: new Date().toISOString() };

  const workspace = {
    id: uuidv4(),
    name,
    panes: {
      left: {
        activeProfileId: 'default',
        profiles: { 'default': { tabs: [], activeTabId: null } }
      },
      right: {
        activeProfileId: 'default',
        profiles: { 'default': { tabs: [claudeTab], activeTabId: claudeTab.id } }
      }
    },
    notes: '',
    createdAt: new Date().toISOString()
  };

  await window.parallel.workspace.create(workspace);
  workspaces.push(workspace);
  activeWorkspace = workspace;

  updateProfileSelectors();
  renderWorkspaces();
  PANES.forEach(p => renderPane(p));
  updateNotepad();
  updateEmptyState();
}

async function switchWorkspace(workspaceId) {
  // Clear all webviews from both panes
  document.querySelectorAll('.pane-webview-container webview').forEach(wv => wv.remove());
  createdWebviews.clear();

  activeWorkspace = workspaces.find(w => w.id === workspaceId);
  await window.parallel.workspace.setActive(workspaceId);

  if (activeWorkspace) migrateWorkspaceStructure(activeWorkspace);

  updateProfileSelectors();
  renderWorkspaces();
  PANES.forEach(p => renderPane(p));
  updateNotepad();
}

async function deleteWorkspace(workspaceId) {
  if (!confirm('Delete this workspace and all its tabs?')) return;

  workspaces = await window.parallel.workspace.delete(workspaceId);

  if (activeWorkspace?.id === workspaceId) {
    document.querySelectorAll('.pane-webview-container webview').forEach(wv => wv.remove());
    createdWebviews.clear();
    activeWorkspace = workspaces[0] || null;
    if (activeWorkspace) migrateWorkspaceStructure(activeWorkspace);
  }

  updateProfileSelectors();
  renderWorkspaces();
  PANES.forEach(p => renderPane(p));
  updateNotepad();
  updateEmptyState();
}

async function renameWorkspace(workspaceId, newName) {
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.name = newName;
    await window.parallel.workspace.update(workspace);
    renderWorkspaces();
  }
}

// ============================================
// PANE RENDERING
// ============================================

function renderPane(paneId) {
  const tabList = document.querySelector(`.pane-tab-list[data-pane="${paneId}"]`);
  const webviewContainer = document.querySelector(`.pane-webview-container[data-pane="${paneId}"]`);
  const navBar = document.querySelector(`.pane-nav-bar[data-pane="${paneId}"]`);

  tabList.innerHTML = '';

  if (!activeWorkspace) {
    webviewContainer.querySelectorAll('webview').forEach(wv => wv.remove());
    webviewContainer.querySelector('.pane-empty-state').style.display = 'block';
    navBar.classList.add('hidden');
    return;
  }

  migrateWorkspaceStructure(activeWorkspace);

  const pane = activeWorkspace.panes[paneId];
  const activeProfileId = pane.activeProfileId || 'default';
  const activeProfileData = ensurePaneProfile(pane, activeProfileId);

  const emptyState = webviewContainer.querySelector('.pane-empty-state');
  const hasTabs = activeProfileData.tabs.length > 0;
  emptyState.style.display = hasTabs ? 'none' : 'block';
  navBar.classList.toggle('hidden', !hasTabs);

  // Deactivate all webviews in this pane
  webviewContainer.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));

  Object.entries(pane.profiles || {}).forEach(([profileId, profileData]) => {
    const partition = getPartitionForProfile(profileId);
    const isActiveProfile = profileId === activeProfileId;

    profileData.tabs.forEach(tab => {
      const webviewKey = `${paneId}-${profileId}-${tab.id}`;
      const webviewId = `webview-${paneId}-${profileId}-${tab.id}`;

      if (isActiveProfile) {
        const item = document.createElement('div');
        item.className = `pane-tab-item ${profileData.activeTabId === tab.id ? 'active' : ''}`;
        item.dataset.id = tab.id;

        const favicon = getFaviconUrl(tab.url);
        const displayTitle = simplifyTitle(tab.title, tab.url);

        item.innerHTML = `
          <img class="pane-tab-favicon" src="${favicon}" onerror="this.style.display='none'">
          <span class="pane-tab-title" title="${escapeHtml(tab.title || '')}">${escapeHtml(displayTitle)}</span>
          <button class="pane-tab-close" title="Close tab">×</button>
        `;

        item.addEventListener('click', (e) => {
          if (!e.target.classList.contains('pane-tab-close')) switchTab(paneId, tab.id);
        });
        item.querySelector('.pane-tab-close').addEventListener('click', (e) => {
          e.stopPropagation();
          closeTab(paneId, tab.id);
        });

        tabList.appendChild(item);
      }

      if (!createdWebviews.has(webviewKey)) {
        const webview = document.createElement('webview');
        webview.id = webviewId;
        webview.src = tab.url;
        webview.setAttribute('partition', partition);
        webview.setAttribute('allowpopups', 'true');

        webview.addEventListener('dom-ready', () => {
          setupWebviewContextMenu(webview, paneId);
          setupWebviewDevToolsHandler(webview);
        });
        webview.addEventListener('page-title-updated', (e) => updateTabTitle(paneId, tab.id, e.title, profileId));
        webview.addEventListener('did-navigate', (e) => {
          updateTabUrl(paneId, tab.id, e.url, profileId);
          if (isActiveProfile) updateNavBar(paneId);
        });
        webview.addEventListener('did-navigate-in-page', (e) => {
          updateTabUrl(paneId, tab.id, e.url, profileId);
          if (isActiveProfile) updateNavBar(paneId);
        });
        webview.addEventListener('new-window', (e) => { e.preventDefault(); createTab(paneId, e.url); });

        webviewContainer.appendChild(webview);
        createdWebviews.add(webviewKey);
      }

      if (isActiveProfile && profileData.activeTabId === tab.id) {
        document.getElementById(webviewId)?.classList.add('active');
      }
    });
  });

  updateNavBar(paneId);
}

function updateNavBar(paneId) {
  if (!activeWorkspace) return;

  const paneData = getPaneData(paneId);
  const profileId = getPaneProfileId(paneId);
  if (!paneData?.activeTabId) return;

  const webview = document.getElementById(`webview-${paneId}-${profileId}-${paneData.activeTabId}`);
  const navUrl = document.querySelector(`.nav-url[data-pane="${paneId}"]`);
  const navBack = document.querySelector(`.nav-back[data-pane="${paneId}"]`);
  const navForward = document.querySelector(`.nav-forward[data-pane="${paneId}"]`);

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

// ============================================
// TAB MANAGEMENT (per pane)
// ============================================

async function createTab(paneId, url) {
  if (!activeWorkspace) { alert('Create a workspace first'); return; }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = url.includes('.') && !url.includes(' ') ? 'https://' + url : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }

  const tab = { id: uuidv4(), url, title: 'Loading...', createdAt: new Date().toISOString() };
  const paneData = getPaneData(paneId);
  if (!paneData) return;

  paneData.tabs.push(tab);
  paneData.activeTabId = tab.id;

  await window.parallel.workspace.update(activeWorkspace);
  renderPane(paneId);
  setFocusedPane(paneId);
}

async function switchTab(paneId, tabId) {
  if (!activeWorkspace) return;

  const paneData = getPaneData(paneId);
  const profileId = getPaneProfileId(paneId);
  paneData.activeTabId = tabId;
  await window.parallel.workspace.update(activeWorkspace);

  // Update tab bar highlight within this pane only
  document.querySelectorAll(`.pane-tab-list[data-pane="${paneId}"] .pane-tab-item`).forEach(item => {
    item.classList.toggle('active', item.dataset.id === tabId);
  });

  // Update webview visibility within this pane only
  document.querySelectorAll(`.pane-webview-container[data-pane="${paneId}"] webview`).forEach(wv => {
    wv.classList.toggle('active', wv.id === `webview-${paneId}-${profileId}-${tabId}`);
  });

  updateNavBar(paneId);
  setFocusedPane(paneId);
}

function navigateBack(paneId) {
  const paneData = getPaneData(paneId);
  const profileId = getPaneProfileId(paneId);
  if (!paneData?.activeTabId) return;
  const webview = document.getElementById(`webview-${paneId}-${profileId}-${paneData.activeTabId}`);
  if (webview?.canGoBack()) webview.goBack();
}

function navigateForward(paneId) {
  const paneData = getPaneData(paneId);
  const profileId = getPaneProfileId(paneId);
  if (!paneData?.activeTabId) return;
  const webview = document.getElementById(`webview-${paneId}-${profileId}-${paneData.activeTabId}`);
  if (webview?.canGoForward()) webview.goForward();
}

function refreshTab(paneId) {
  const paneData = getPaneData(paneId);
  const profileId = getPaneProfileId(paneId);
  if (!paneData?.activeTabId) return;
  document.getElementById(`webview-${paneId}-${profileId}-${paneData.activeTabId}`)?.reload();
}

function navigateToUrl(paneId, url) {
  const paneData = getPaneData(paneId);
  const profileId = getPaneProfileId(paneId);
  if (!paneData?.activeTabId) return;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = url.includes('.') && !url.includes(' ') ? 'https://' + url : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }

  const webview = document.getElementById(`webview-${paneId}-${profileId}-${paneData.activeTabId}`);
  if (webview) webview.src = url;
}

async function closeTab(paneId, tabId) {
  if (!activeWorkspace) return;

  const paneData = getPaneData(paneId);
  const profileId = getPaneProfileId(paneId);

  document.getElementById(`webview-${paneId}-${profileId}-${tabId}`)?.remove();
  createdWebviews.delete(`${paneId}-${profileId}-${tabId}`);

  paneData.tabs = paneData.tabs.filter(t => t.id !== tabId);
  if (paneData.activeTabId === tabId) paneData.activeTabId = paneData.tabs[0]?.id || null;

  await window.parallel.workspace.update(activeWorkspace);
  renderPane(paneId);
}

async function updateTabTitle(paneId, tabId, title, profileId) {
  if (!activeWorkspace) return;

  const pane = activeWorkspace.panes[paneId];
  const profileData = pane?.profiles?.[profileId];
  const tab = profileData?.tabs.find(t => t.id === tabId);

  if (tab) {
    tab.title = title;
    await window.parallel.workspace.update(activeWorkspace);

    if (profileId === pane.activeProfileId) {
      const tabEl = document.querySelector(`.pane-tab-list[data-pane="${paneId}"] .pane-tab-item[data-id="${tabId}"] .pane-tab-title`);
      if (tabEl) {
        tabEl.textContent = simplifyTitle(title, tab.url);
        tabEl.title = title;
      }
    }
  }
}

async function updateTabUrl(paneId, tabId, url, profileId) {
  if (!activeWorkspace) return;

  const pane = activeWorkspace.panes[paneId];
  const profileData = pane?.profiles?.[profileId];
  const tab = profileData?.tabs.find(t => t.id === tabId);

  if (tab) {
    tab.url = url;
    await window.parallel.workspace.update(activeWorkspace);

    if (profileId === pane.activeProfileId && profileData.activeTabId === tabId) {
      const navUrl = document.querySelector(`.nav-url[data-pane="${paneId}"]`);
      if (navUrl) navUrl.value = url;

      // Also refresh favicon in tab bar
      const tabEl = document.querySelector(`.pane-tab-list[data-pane="${paneId}"] .pane-tab-item[data-id="${tabId}"] .pane-tab-favicon`);
      if (tabEl) {
        tabEl.src = getFaviconUrl(url);
        tabEl.style.display = '';
      }
    }
  }
}

async function changeProfile(paneId, profileId) {
  if (!activeWorkspace) return;

  const pane = activeWorkspace.panes[paneId];
  pane.activeProfileId = profileId;
  ensurePaneProfile(pane, profileId);

  await window.parallel.workspace.update(activeWorkspace);
  renderPane(paneId);
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
    await window.parallel.notes.update(activeWorkspace.id, notepadContent.value);
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
// UI HELPERS
// ============================================

function updateEmptyState() {
  emptyStateOverlay.classList.toggle('hidden', workspaces.length > 0 && !!activeWorkspace);
}

function getFaviconUrl(url) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
  } catch {
    return '';
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

function openTabModal(paneId) {
  if (!activeWorkspace) { alert('Create a workspace first'); return; }
  pendingTabPaneId = paneId;
  const title = document.getElementById('tab-modal-title');
  if (title) {
    title.textContent = `New Tab (${paneId.charAt(0).toUpperCase() + paneId.slice(1)} Pane)`;
  }
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
  createTab(pendingTabPaneId, url);
  closeTabModal();
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', stopResize);

  // Focused pane tracking — click anywhere inside a pane to focus it
  PANES.forEach(paneId => {
    const paneEl = document.getElementById(`${paneId}-pane`);
    if (paneEl) {
      paneEl.addEventListener('mousedown', () => setFocusedPane(paneId));
      // webview 'focus' doesn't always bubble, so we also rely on mousedown on the container
    }
  });

  // Workspace buttons
  document.getElementById('add-workspace').addEventListener('click', openCreateWorkspaceModal);
  document.getElementById('empty-create-workspace').addEventListener('click', openCreateWorkspaceModal);

  // Tab management — per pane
  document.querySelectorAll('.pane-add-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const paneId = btn.dataset.pane;
      setFocusedPane(paneId);
      openTabModal(paneId);
    });
  });

  // Profile management — per pane
  document.querySelectorAll('.profile-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const paneId = select.dataset.pane;
      changeProfile(paneId, e.target.value);
    });
  });
  document.querySelectorAll('.profile-manage-btn').forEach(btn => {
    btn.addEventListener('click', openProfileModal);
  });
  document.getElementById('profile-modal-close').addEventListener('click', closeProfileModal);
  document.getElementById('add-profile-btn').addEventListener('click', addProfile);
  document.getElementById('new-profile-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') addProfile(); });
  profileModalOverlay.addEventListener('click', (e) => { if (e.target === profileModalOverlay) closeProfileModal(); });

  // Navigation — per pane
  PANES.forEach(paneId => {
    document.querySelector(`.nav-back[data-pane="${paneId}"]`).addEventListener('click', () => navigateBack(paneId));
    document.querySelector(`.nav-forward[data-pane="${paneId}"]`).addEventListener('click', () => navigateForward(paneId));
    document.querySelector(`.nav-refresh[data-pane="${paneId}"]`).addEventListener('click', () => refreshTab(paneId));
    document.querySelector(`.nav-url[data-pane="${paneId}"]`).addEventListener('keypress', (e) => {
      if (e.key === 'Enter') { navigateToUrl(paneId, e.target.value.trim()); e.target.blur(); }
    });
  });

  // Notepad
  notepadContent.addEventListener('input', saveNotes);
  notepadToggle.addEventListener('click', toggleNotepad);
  notepadExpand.addEventListener('click', expandNotepad);

  // Resizers
  document.getElementById('pane-resizer').addEventListener('mousedown', (e) => {
    startResize('pane', e, {
      startLeftWidth: document.getElementById('left-pane').offsetWidth,
      startRightWidth: document.getElementById('right-pane').offsetWidth
    });
  });
  document.getElementById('notepad-resizer').addEventListener('mousedown', (e) => {
    startResize('notepad', e, { startWidth: notepadPanel.offsetWidth });
  });

  // Modals
  document.getElementById('modal-cancel').addEventListener('click', closeWorkspaceModal);
  document.getElementById('modal-confirm').addEventListener('click', confirmWorkspaceModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeWorkspaceModal(); });
  workspaceNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirmWorkspaceModal(); });

  document.getElementById('tab-modal-cancel').addEventListener('click', closeTabModal);
  document.getElementById('tab-modal-confirm').addEventListener('click', confirmTabModal);
  tabModalOverlay.addEventListener('click', (e) => { if (e.target === tabModalOverlay) closeTabModal(); });
  tabUrlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirmTabModal(); });

  document.querySelectorAll('.quick-link').forEach(btn => {
    btn.addEventListener('click', () => { createTab(pendingTabPaneId, btn.dataset.url); closeTabModal(); });
  });

  // Keyboard shortcuts — routed to focused pane
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      e.preventDefault();
      openTabModal(focusedPane);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      const pd = getPaneData(focusedPane);
      if (pd?.activeTabId) closeTab(focusedPane, pd.activeTabId);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      openCreateWorkspaceModal();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
      e.preventDefault();
      refreshTab(focusedPane);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault();
      const nav = document.querySelector(`.nav-url[data-pane="${focusedPane}"]`);
      nav?.focus();
      nav?.select();
    }
    // Cmd+1-9 switch tabs within focused pane
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      const pd = getPaneData(focusedPane);
      if (pd?.tabs?.length) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < pd.tabs.length) {
          e.preventDefault();
          switchTab(focusedPane, pd.tabs[idx].id);
        }
      }
    }
    if (e.key === 'F12') {
      e.preventDefault();
      toggleWebviewDevTools(focusedPane);
    }
    if (e.key === 'Escape') {
      closeWorkspaceModal();
      closeTabModal();
      closeProfileModal();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
