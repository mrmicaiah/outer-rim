// ============================================
// PERIMETER - Workspace + Browser + Git UI
// ============================================

function uuidv4() { return crypto.randomUUID(); }

// State
let workspaces = [];
let activeWorkspace = null;
let profiles = [];

// Webview tracking
const createdWebviews = new Set();

// Resizer state
let currentResizer = null;
let resizeOverlay = null;

// DOM
const workspaceList = document.getElementById('workspace-list');
const notepadContent = document.getElementById('notepad-content');
const emptyStateOverlay = document.getElementById('empty-state-overlay');
const notepadPanel = document.getElementById('notepad-panel');
const notepadExpand = document.getElementById('notepad-expand');
const notepadToggle = document.getElementById('notepad-toggle');

const modalOverlay = document.getElementById('modal-overlay');
const workspaceNameInput = document.getElementById('workspace-name-input');
const tabModalOverlay = document.getElementById('tab-modal-overlay');
const tabUrlInput = document.getElementById('tab-url-input');
const profileModalOverlay = document.getElementById('profile-modal-overlay');

// ============================================
// INIT
// ============================================

async function init() {
  workspaces = await window.perimeter.workspace.getAll();
  const active = await window.perimeter.workspace.getActive();

  if (active) activeWorkspace = workspaces.find(w => w.id === active.id);
  profiles = await window.perimeter.profiles.getAll();

  if (activeWorkspace) migrateWorkspaceStructure(activeWorkspace);
  updateProfileSelectors();

  resizeOverlay = document.createElement('div');
  resizeOverlay.id = 'resize-overlay';
  resizeOverlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:none;`;
  document.body.appendChild(resizeOverlay);

  renderWorkspaces();
  renderBrowserPane();
  updateNotepad();
  updateSidebar();
  updateEmptyState();
  setupEventListeners();

  // Initialize the terminal module (xterm.js lives in its own file)
  if (window.PerimeterTerminals) window.PerimeterTerminals.init();

  window.perimeter.onMenuToggleDevTools(() => toggleActiveWebviewDevTools());
}

// ============================================
// WORKSPACE STRUCTURE (single right-pane only)
// ============================================

function migrateWorkspaceStructure(workspace) {
  if (!workspace.panes) {
    workspace.panes = { right: { activeProfileId: 'default', profiles: { 'default': { tabs: [], activeTabId: null } } } };
    window.perimeter.workspace.update(workspace);
    return;
  }

  const rightPane = workspace.panes.right;
  if (rightPane && !rightPane.profiles) {
    const oldProfileId = rightPane.profileId || 'default';
    workspace.panes.right = {
      activeProfileId: oldProfileId,
      profiles: { [oldProfileId]: { tabs: rightPane.tabs || [], activeTabId: rightPane.activeTabId || null } }
    };
    if (oldProfileId !== 'default') {
      workspace.panes.right.profiles['default'] = { tabs: [], activeTabId: null };
    }
    window.perimeter.workspace.update(workspace);
  }

  if (!workspace.panes.right) {
    workspace.panes.right = { activeProfileId: 'default', profiles: { 'default': { tabs: [], activeTabId: null } } };
    window.perimeter.workspace.update(workspace);
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
  return activeWorkspace?.panes?.right?.activeProfileId || 'default';
}

// ============================================
// SIDEBAR - Workspace, Folder, Git
// ============================================

function updateSidebar() {
  const nameDisplay = document.getElementById('workspace-name-display');
  const folderInput = document.getElementById('folder-path-input');
  const folderStatus = document.getElementById('folder-status');
  const gitSection = document.getElementById('git-section');

  if (activeWorkspace) {
    nameDisplay.textContent = activeWorkspace.name;
    const folder = activeWorkspace.folderPath || '';
    folderInput.value = folder || '';
    folderInput.placeholder = folder ? '' : 'Select a folder...';

    // Make the folder available to the terminal module so new terminals
    // open in the workspace's project directory.
    window.__perimeterCurrentFolder = folder || undefined;

    if (folder) {
      folderStatus.textContent = '';
      gitSection.classList.remove('hidden');
      checkGitStatus();
    } else {
      folderStatus.textContent = 'No folder selected';
      gitSection.classList.add('hidden');
    }
  } else {
    nameDisplay.textContent = 'No workspace';
    folderInput.value = '';
    folderInput.placeholder = 'Select a folder...';
    folderStatus.textContent = '';
    gitSection.classList.add('hidden');
    window.__perimeterCurrentFolder = undefined;
  }
}

async function checkGitStatus() {
  if (!activeWorkspace?.folderPath) return;

  const badge = document.getElementById('git-status-badge');
  const statusDisplay = document.getElementById('git-status-display');
  const statusText = statusDisplay.querySelector('.git-status-text');

  badge.textContent = '...';
  badge.className = 'status-badge';
  statusText.textContent = 'Checking status...';

  try {
    const result = await window.perimeter.git.status(activeWorkspace.folderPath);
    if (result.success) {
      if (result.hasChanges) {
        badge.textContent = `${result.changes.length} changed`;
        badge.className = 'status-badge changes';
        const fileList = result.changes.slice(0, 5).map(c => `${c.status} ${c.file}`).join('\n');
        const more = result.changes.length > 5 ? `\n...and ${result.changes.length - 5} more` : '';
        statusText.textContent = `${result.changes.length} file(s) changed`;
        statusText.title = fileList + more;
      } else {
        badge.textContent = 'Clean';
        badge.className = 'status-badge clean';
        statusText.textContent = 'Working tree clean';
        statusText.title = '';
      }
    } else {
      badge.textContent = 'Error';
      badge.className = 'status-badge error';
      statusText.textContent = result.error || 'Not a git repository';
    }
  } catch (err) {
    badge.textContent = 'Error';
    badge.className = 'status-badge error';
    statusText.textContent = err.message;
  }
}

async function gitPush() {
  if (!activeWorkspace?.folderPath) return;

  const btn = document.getElementById('git-push-btn');
  const statusText = document.querySelector('#git-status-display .git-status-text');
  const commitInput = document.getElementById('commit-message');

  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Pushing...';
  statusText.textContent = 'Adding and committing...';

  try {
    const message = commitInput.value.trim() || undefined;
    const result = await window.perimeter.git.push(activeWorkspace.folderPath, message);
    if (result.success) {
      statusText.textContent = result.message || '✓ Pushed successfully!';
      commitInput.value = '';
      setTimeout(() => checkGitStatus(), 1000);
    } else {
      statusText.textContent = '✗ ' + result.error;
    }
  } catch (err) {
    statusText.textContent = '✗ ' + err.message;
  }

  btn.disabled = false;
  btn.querySelector('.btn-text').textContent = 'Push';
}

async function gitPull() {
  if (!activeWorkspace?.folderPath) return;

  const btn = document.getElementById('git-pull-btn');
  const statusText = document.querySelector('#git-status-display .git-status-text');

  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Pulling...';
  statusText.textContent = 'Pulling from remote...';

  try {
    const result = await window.perimeter.git.pull(activeWorkspace.folderPath);
    if (result.success) {
      statusText.textContent = result.message || '✓ Pulled successfully!';
      setTimeout(() => checkGitStatus(), 1000);
    } else {
      statusText.textContent = '✗ ' + result.error;
    }
  } catch (err) {
    statusText.textContent = '✗ ' + err.message;
  }

  btn.disabled = false;
  btn.querySelector('.btn-text').textContent = 'Pull';
}

async function browseFolder() {
  const folder = await window.perimeter.project.browse();
  if (folder && activeWorkspace) {
    activeWorkspace.folderPath = folder;
    await window.perimeter.workspace.update(activeWorkspace);
    updateSidebar();
  }
}

// ============================================
// PROFILES
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

function closeProfileModal() { profileModalOverlay.classList.add('hidden'); }

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

  const profile = await window.perimeter.profiles.create(name);
  profiles.push(profile);

  input.value = '';
  renderProfileList();
  updateProfileSelectors();
}

async function deleteProfile(id) {
  await window.perimeter.profiles.delete(id);
  profiles = profiles.filter(p => p.id !== id);

  if (activeWorkspace) {
    const pane = activeWorkspace.panes.right;
    if (pane.profiles?.[id]) {
      pane.profiles[id].tabs.forEach(tab => {
        const webview = document.getElementById(`webview-right-${id}-${tab.id}`);
        if (webview) webview.remove();
        createdWebviews.delete(`right-${id}-${tab.id}`);
      });
      delete pane.profiles[id];
    }
    if (pane.activeProfileId === id) pane.activeProfileId = 'default';
    await window.perimeter.workspace.update(activeWorkspace);
  }

  renderProfileList();
  updateProfileSelectors();
  renderBrowserPane();
}

function getPartitionForProfile(profileId) {
  return profileId === 'default' ? 'persist:perimeter' : `persist:profile-${profileId}`;
}

// ============================================
// RESIZERS
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
  // After a resize, refit terminals so xterm doesn't show stale dims
  if (window.PerimeterTerminals) window.PerimeterTerminals.refitAll();
}

function handleMouseMove(e) {
  if (!currentResizer) return;

  const { type, startX, startLeftWidth, startRightWidth, startWidth } = currentResizer;

  if (type === 'pane') {
    const leftPane = document.getElementById('terminal-pane');
    const rightPane = document.getElementById('browser-pane');
    const delta = e.clientX - startX;
    const newLeftWidth = startLeftWidth + delta;
    const newRightWidth = startRightWidth - delta;
    if (newLeftWidth >= 250 && newRightWidth >= 300) {
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

function toggleActiveWebviewDevTools() {
  if (!activeWorkspace) return;
  const paneData = getCurrentPaneData();
  const profileId = getCurrentProfileId();
  if (!paneData?.activeTabId) return;

  const webview = document.getElementById(`webview-right-${profileId}-${paneData.activeTabId}`);
  if (webview) {
    if (webview.isDevToolsOpened()) webview.closeDevTools();
    else webview.openDevTools();
  }
}

function setupWebviewDevToolsHandler(webview) {
  webview.addEventListener('devtools-closed', () => {
    if (webview.classList.contains('active')) {
      webview.style.visibility = 'hidden';
      void webview.offsetHeight;
      requestAnimationFrame(() => { webview.style.visibility = 'visible'; });
    }
  });
}

function setupWebviewContextMenu(webview) {
  webview.addEventListener('context-menu', (e) => {
    e.preventDefault();
    const params = e.params;
    let menuItems = [];

    if (params.linkURL) {
      menuItems.push({ label: 'Open Link in New Tab', action: () => createTab(params.linkURL) });
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
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--light-bg);border:1px solid var(--light-border);border-radius:8px;padding:4px 0;min-width:180px;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.15);`;

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
// WORKSPACES
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
    panes: { right: { activeProfileId: 'default', profiles: { 'default': { tabs: [], activeTabId: null } } } },
    notes: '',
    folderPath: '',
    createdAt: new Date().toISOString()
  };

  await window.perimeter.workspace.create(workspace);
  workspaces.push(workspace);
  activeWorkspace = workspace;

  updateProfileSelectors();
  renderWorkspaces();
  renderBrowserPane();
  updateNotepad();
  updateSidebar();
  updateEmptyState();
}

async function switchWorkspace(workspaceId) {
  document.querySelectorAll('.pane-webview-container webview').forEach(wv => wv.remove());
  createdWebviews.clear();

  activeWorkspace = workspaces.find(w => w.id === workspaceId);
  await window.perimeter.workspace.setActive(workspaceId);

  if (activeWorkspace) migrateWorkspaceStructure(activeWorkspace);

  updateProfileSelectors();
  renderWorkspaces();
  renderBrowserPane();
  updateNotepad();
  updateSidebar();
}

async function deleteWorkspace(workspaceId) {
  if (!confirm('Delete this workspace and all its tabs?')) return;

  workspaces = await window.perimeter.workspace.delete(workspaceId);

  if (activeWorkspace?.id === workspaceId) {
    document.querySelectorAll('.pane-webview-container webview').forEach(wv => wv.remove());
    createdWebviews.clear();
    activeWorkspace = workspaces[0] || null;
  }

  renderWorkspaces();
  renderBrowserPane();
  updateNotepad();
  updateSidebar();
  updateEmptyState();
}

async function renameWorkspace(workspaceId, newName) {
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.name = newName;
    await window.perimeter.workspace.update(workspace);
    renderWorkspaces();
    updateSidebar();
  }
}

// ============================================
// BROWSER PANE TABS
// ============================================

function renderBrowserPane() {
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

  webviewContainer.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));

  Object.entries(pane.profiles || {}).forEach(([profileId, profileData]) => {
    const partition = getPartitionForProfile(profileId);
    const isActiveProfile = profileId === activeProfileId;

    profileData.tabs.forEach(tab => {
      const webviewKey = `right-${profileId}-${tab.id}`;
      const webviewId = `webview-right-${profileId}-${tab.id}`;

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
          if (!e.target.classList.contains('pane-tab-close')) switchTab(tab.id);
        });
        item.querySelector('.pane-tab-close').addEventListener('click', (e) => {
          e.stopPropagation();
          closeTab(tab.id);
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
          setupWebviewContextMenu(webview);
          setupWebviewDevToolsHandler(webview);
        });
        webview.addEventListener('page-title-updated', (e) => updateTabTitle(tab.id, e.title, profileId));
        webview.addEventListener('did-navigate', (e) => {
          updateTabUrl(tab.id, e.url, profileId);
          if (isActiveProfile) updateNavBar();
        });
        webview.addEventListener('did-navigate-in-page', (e) => {
          updateTabUrl(tab.id, e.url, profileId);
          if (isActiveProfile) updateNavBar();
        });
        webview.addEventListener('new-window', (e) => { e.preventDefault(); createTab(e.url); });

        webviewContainer.appendChild(webview);
        createdWebviews.add(webviewKey);
      }

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
  if (!activeWorkspace) { alert('Create a workspace first'); return; }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = url.includes('.') && !url.includes(' ') ? 'https://' + url : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }

  const tab = { id: uuidv4(), url, title: 'Loading...', createdAt: new Date().toISOString() };
  const paneData = getCurrentPaneData();
  if (!paneData) return;

  paneData.tabs.push(tab);
  paneData.activeTabId = tab.id;

  await window.perimeter.workspace.update(activeWorkspace);
  renderBrowserPane();
}

async function switchTab(tabId) {
  if (!activeWorkspace) return;

  const paneData = getCurrentPaneData();
  const profileId = getCurrentProfileId();
  paneData.activeTabId = tabId;
  await window.perimeter.workspace.update(activeWorkspace);

  document.querySelectorAll(`.pane-tab-list[data-pane="right"] .pane-tab-item`).forEach(item => {
    item.classList.toggle('active', item.dataset.id === tabId);
  });

  document.querySelectorAll('.pane-webview-container webview').forEach(wv => {
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

  document.getElementById(`webview-right-${profileId}-${tabId}`)?.remove();
  createdWebviews.delete(`right-${profileId}-${tabId}`);

  paneData.tabs = paneData.tabs.filter(t => t.id !== tabId);
  if (paneData.activeTabId === tabId) paneData.activeTabId = paneData.tabs[0]?.id || null;

  await window.perimeter.workspace.update(activeWorkspace);
  renderBrowserPane();
}

async function updateTabTitle(tabId, title, profileId) {
  if (!activeWorkspace) return;

  const pane = activeWorkspace.panes.right;
  const profileData = pane.profiles?.[profileId];
  const tab = profileData?.tabs.find(t => t.id === tabId);

  if (tab) {
    tab.title = title;
    await window.perimeter.workspace.update(activeWorkspace);

    if (profileId === pane.activeProfileId) {
      const tabEl = document.querySelector(`.pane-tab-list[data-pane="right"] .pane-tab-item[data-id="${tabId}"] .pane-tab-title`);
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
    await window.perimeter.workspace.update(activeWorkspace);

    if (profileId === pane.activeProfileId && profileData.activeTabId === tabId) {
      const navUrl = document.querySelector('.nav-url[data-pane="right"]');
      if (navUrl) navUrl.value = url;

      const favEl = document.querySelector(`.pane-tab-list[data-pane="right"] .pane-tab-item[data-id="${tabId}"] .pane-tab-favicon`);
      if (favEl) { favEl.src = getFaviconUrl(url); favEl.style.display = ''; }
    }
  }
}

async function changeProfile(profileId) {
  if (!activeWorkspace) return;

  const pane = activeWorkspace.panes.right;
  pane.activeProfileId = profileId;
  ensurePaneProfile(pane, profileId);

  await window.perimeter.workspace.update(activeWorkspace);
  renderBrowserPane();
  updateProfileSelectors();
}

// ============================================
// NOTEPAD
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
    await window.perimeter.notes.update(activeWorkspace.id, notepadContent.value);
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
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; }
  catch { return ''; }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// MODALS
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

function closeTabModal() { tabModalOverlay.classList.add('hidden'); }

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

  document.getElementById('devtools-btn').addEventListener('click', toggleActiveWebviewDevTools);

  document.getElementById('add-workspace').addEventListener('click', openCreateWorkspaceModal);
  document.getElementById('empty-create-workspace').addEventListener('click', openCreateWorkspaceModal);

  document.getElementById('folder-browse-btn').addEventListener('click', browseFolder);
  document.getElementById('folder-path-input').addEventListener('click', browseFolder);

  document.getElementById('git-push-btn').addEventListener('click', gitPush);
  document.getElementById('git-pull-btn').addEventListener('click', gitPull);
  document.getElementById('git-refresh-btn').addEventListener('click', checkGitStatus);

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

  notepadContent.addEventListener('input', saveNotes);
  notepadToggle.addEventListener('click', toggleNotepad);
  notepadExpand.addEventListener('click', expandNotepad);

  document.getElementById('pane-resizer').addEventListener('mousedown', (e) => {
    startResize('pane', e, {
      startLeftWidth: document.getElementById('terminal-pane').offsetWidth,
      startRightWidth: document.getElementById('browser-pane').offsetWidth
    });
  });
  document.getElementById('notepad-resizer').addEventListener('mousedown', (e) => {
    startResize('notepad', e, { startWidth: notepadPanel.offsetWidth });
  });

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

  // Keyboard shortcuts — Cmd+T/W are handled by the Terminal menu so they
  // work regardless of focus. We only add the browser-specific ones here.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); openCreateWorkspaceModal(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
      // Only intercept Cmd+R when the browser pane is focused — otherwise
      // let it flow to the terminal if xterm has focus.
      const ae = document.activeElement;
      if (ae && (ae.id === 'notepad-content' || ae.closest('.terminal-instance'))) return;
      e.preventDefault(); refreshActiveTab();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault();
      const nav = document.querySelector('.nav-url[data-pane="right"]');
      nav?.focus(); nav?.select();
    }
    if (e.key === 'F12') { e.preventDefault(); toggleActiveWebviewDevTools(); }
    if (e.key === 'Escape') { closeWorkspaceModal(); closeTabModal(); closeProfileModal(); }
  });
}

document.addEventListener('DOMContentLoaded', init);
