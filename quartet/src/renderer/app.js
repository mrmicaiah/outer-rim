// ============================================
// QUARTET - Four-Pane Browser for Parallel Workstreams
// with Git sidebar (left) + Notepad (right) + Cloud Sync
// ============================================

function uuidv4() {
  return crypto.randomUUID();
}

// State
let workspaces = [];
let activeWorkspace = null;
let profiles = [];
let focusedPane = 'topLeft';

const createdWebviews = new Set();

let currentResizer = null;
let resizeOverlay = null;

// DOM Elements — main
const workspaceList = document.getElementById('workspace-list');
const notepadContent = document.getElementById('notepad-content');
const emptyStateOverlay = document.getElementById('empty-state-overlay');
const notepadPanel = document.getElementById('notepad-panel');
const notepadExpand = document.getElementById('notepad-expand');
const notepadToggle = document.getElementById('notepad-toggle');

// Sidebar elements
const sidebar = document.getElementById('sidebar');
const sidebarExpand = document.getElementById('sidebar-expand');
const sidebarToggle = document.getElementById('sidebar-toggle');

// Modals
const modalOverlay = document.getElementById('modal-overlay');
const workspaceNameInput = document.getElementById('workspace-name-input');
const tabModalOverlay = document.getElementById('tab-modal-overlay');
const tabUrlInput = document.getElementById('tab-url-input');
const profileModalOverlay = document.getElementById('profile-modal-overlay');

let pendingTabPaneId = 'topLeft';

const PANES = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

const PANE_LABELS = {
  topLeft: 'Top Left',
  topRight: 'Top Right',
  bottomLeft: 'Bottom Left',
  bottomRight: 'Bottom Right',
};

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  workspaces = await window.quartet.workspace.getAll();
  const active = await window.quartet.workspace.getActive();

  if (active) {
    activeWorkspace = workspaces.find(w => w.id === active.id);
  }

  profiles = await window.quartet.profiles.getAll();

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
  updateSidebar();
  updateEmptyState();
  setFocusedPane('topLeft');
  setupEventListeners();

  // Menu-driven DevTools work even when a webview has keyboard focus
  // (keydown events inside a webview don't bubble to document).
  window.quartet.onMenuToggleDevTools((event, pane) => {
    toggleWebviewDevTools(pane || focusedPane);
  });

  // Fire-and-forget — don't let sync errors block the rest of the UI.
  initSync().catch((err) => console.error('[sync] initSync failed:', err));
}

// ============================================
// WORKSPACE STRUCTURE MIGRATION
// ============================================

function emptyPaneShape() {
  return {
    activeProfileId: 'default',
    profiles: { 'default': { tabs: [], activeTabId: null } },
  };
}

function migrateWorkspaceStructure(workspace) {
  if (!workspace.panes) {
    workspace.panes = {
      topLeft: emptyPaneShape(),
      topRight: emptyPaneShape(),
      bottomLeft: emptyPaneShape(),
      bottomRight: emptyPaneShape(),
    };
    window.quartet.workspace.update(workspace);
    return;
  }

  if (workspace.panes.left && !workspace.panes.topLeft) {
    workspace.panes.topLeft = workspace.panes.left;
    delete workspace.panes.left;
  }
  if (workspace.panes.right && !workspace.panes.topRight) {
    workspace.panes.topRight = workspace.panes.right;
    delete workspace.panes.right;
  }

  PANES.forEach(paneId => {
    if (!workspace.panes[paneId]) {
      workspace.panes[paneId] = emptyPaneShape();
    }
    const pane = workspace.panes[paneId];
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

  window.quartet.workspace.update(workspace);
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
// SIDEBAR
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
    const result = await window.quartet.git.status(activeWorkspace.folderPath);
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
    const result = await window.quartet.git.push(activeWorkspace.folderPath, message);
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
    const result = await window.quartet.git.pull(activeWorkspace.folderPath);
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
  const folder = await window.quartet.project.browse();
  if (folder && activeWorkspace) {
    activeWorkspace.folderPath = folder;
    await window.quartet.workspace.update(activeWorkspace);
    updateSidebar();
  }
}

function toggleSidebar() {
  const isCollapsed = sidebar.classList.toggle('collapsed');
  sidebarExpand.classList.toggle('hidden', !isCollapsed);
}

function expandSidebar() {
  sidebar.classList.remove('collapsed');
  sidebarExpand.classList.add('hidden');
}

// ============================================
// CLOUD SYNC (renderer side)
// ============================================

function formatRelative(iso) {
  if (!iso) return 'Never synced';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.round((now - then) / 1000);
  if (sec < 60) return `Synced ${sec}s ago`;
  if (sec < 3600) return `Synced ${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `Synced ${Math.round(sec / 3600)}h ago`;
  return `Synced ${Math.round(sec / 86400)}d ago`;
}

function updateSyncUI(status) {
  const badge = document.getElementById('sync-status-badge');
  const signedOut = document.getElementById('sync-signed-out');
  const signedIn = document.getElementById('sync-signed-in');
  const accountName = document.getElementById('sync-account-name');
  const lastSyncedText = document.getElementById('sync-last-synced-text');
  const conflictBanner = document.getElementById('sync-conflict-banner');

  if (!badge || !signedOut || !signedIn) return; // sidebar DOM missing — bail

  badge.className = 'status-badge ' + (status.status || 'signed-out');
  const badgeText = {
    idle: 'Synced',
    pushing: 'Pushing',
    pulling: 'Pulling',
    conflict: 'Conflict',
    error: 'Error',
    'signed-out': 'Off',
  }[status.status] || '…';
  badge.textContent = badgeText;

  if (status.signedIn) {
    signedOut.classList.add('hidden');
    signedIn.classList.remove('hidden');
    if (accountName) accountName.textContent = '@' + (status.githubLogin || 'user');
    if (lastSyncedText) lastSyncedText.textContent = formatRelative(status.lastSyncedAt);
    if (conflictBanner) conflictBanner.classList.toggle('hidden', status.status !== 'conflict');
  } else {
    signedOut.classList.remove('hidden');
    signedIn.classList.add('hidden');
  }
}

async function reloadFromStore() {
  workspaces = await window.quartet.workspace.getAll();
  const active = await window.quartet.workspace.getActive();
  if (active) activeWorkspace = workspaces.find(w => w.id === active.id);
  profiles = await window.quartet.profiles.getAll();
  if (activeWorkspace) migrateWorkspaceStructure(activeWorkspace);

  document.querySelectorAll('.pane-webview-container webview').forEach(wv => wv.remove());
  createdWebviews.clear();

  updateProfileSelectors();
  renderWorkspaces();
  PANES.forEach(p => renderPane(p));
  updateNotepad();
  updateSidebar();
  updateEmptyState();
}

async function initSync() {
  const status = await window.quartet.sync.getStatus();
  updateSyncUI(status);

  window.quartet.sync.onStatus((status) => updateSyncUI(status));
  window.quartet.sync.onRemoteApplied(() => reloadFromStore());

  const signinBtn = document.getElementById('sync-signin-btn');
  if (signinBtn) signinBtn.addEventListener('click', async () => {
    signinBtn.disabled = true;
    signinBtn.innerHTML = '<span class="btn-icon">⏳</span> Waiting for browser…';
    try {
      const result = await window.quartet.sync.signIn();
      if (result.error) {
        alert('Sign-in failed: ' + result.error);
      } else if (result.ok || result.alreadySignedIn) {
        await reloadFromStore();
      }
    } catch (err) {
      alert('Sign-in error: ' + err.message);
    }
    signinBtn.disabled = false;
    signinBtn.innerHTML = '<span class="btn-icon">🔑</span> Sign in with GitHub';
  });

  const signoutBtn = document.getElementById('sync-signout-btn');
  if (signoutBtn) signoutBtn.addEventListener('click', async () => {
    if (!confirm('Sign out of cloud sync? Your local data stays, but will stop syncing.')) return;
    await window.quartet.sync.signOut();
  });

  const syncNowBtn = document.getElementById('sync-now-btn');
  if (syncNowBtn) syncNowBtn.addEventListener('click', async () => {
    syncNowBtn.disabled = true;
    const original = syncNowBtn.textContent;
    syncNowBtn.textContent = '⏳ Syncing…';
    try {
      await window.quartet.sync.syncNow({ direction: 'pull' });
      await window.quartet.sync.syncNow({});
    } catch (err) {
      console.error('[sync] syncNow failed', err);
    }
    syncNowBtn.disabled = false;
    syncNowBtn.textContent = original;
  });

  const pullForceBtn = document.getElementById('sync-pull-force-btn');
  if (pullForceBtn) pullForceBtn.addEventListener('click', async () => {
    if (!confirm('This will overwrite your local state with the cloud copy. Continue?')) return;
    await window.quartet.sync.pullForce();
    await reloadFromStore();
  });

  const pushForceBtn = document.getElementById('sync-push-force-btn');
  if (pushForceBtn) pushForceBtn.addEventListener('click', async () => {
    if (!confirm('This will overwrite the cloud copy with your local state. Continue?')) return;
    await window.quartet.sync.pushForce();
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

  const profile = await window.quartet.profiles.create(name);
  profiles.push(profile);

  input.value = '';
  renderProfileList();
  updateProfileSelectors();
}

async function deleteProfile(id) {
  await window.quartet.profiles.delete(id);
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
    await window.quartet.workspace.update(activeWorkspace);
  }

  renderProfileList();
  updateProfileSelectors();
  PANES.forEach(p => renderPane(p));
}

function getPartitionForProfile(profileId) {
  return profileId === 'default' ? 'persist:quartet' : `persist:profile-${profileId}`;
}

// ============================================
// RESIZERS — hardened cleanup
// ============================================

function startResize(type, e, extras = {}) {
  currentResizer = { type, startX: e.clientX, startY: e.clientY, ...extras };
  if (resizeOverlay) resizeOverlay.style.display = 'block';
  document.body.style.cursor = type === 'row' ? 'row-resize' : 'col-resize';
  document.body.style.userSelect = 'none';
}

// Force-clean resize state. Safe to call repeatedly — idempotent.
function stopResize() {
  currentResizer = null;
  if (resizeOverlay) resizeOverlay.style.display = 'none';
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

function handleMouseMove(e) {
  if (!currentResizer) return;

  const { type, startX, startY, startTopLeftWidth, startTopRightWidth, startTopRowHeight, startBottomRowHeight, startWidth } = currentResizer;

  if (type === 'vertical') {
    const topLeft = document.getElementById('topLeft-pane');
    const topRight = document.getElementById('topRight-pane');
    const bottomLeft = document.getElementById('bottomLeft-pane');
    const bottomRight = document.getElementById('bottomRight-pane');
    const delta = e.clientX - startX;
    const newLeft = startTopLeftWidth + delta;
    const newRight = startTopRightWidth - delta;

    if (newLeft >= 250 && newRight >= 250) {
      for (const el of [topLeft, bottomLeft]) {
        el.style.width = newLeft + 'px';
        el.style.flex = 'none';
      }
      for (const el of [topRight, bottomRight]) {
        el.style.width = newRight + 'px';
        el.style.flex = 'none';
      }
    }
  } else if (type === 'row') {
    const topRow = document.getElementById('top-row');
    const bottomRow = document.getElementById('bottom-row');
    const delta = e.clientY - startY;
    const newTop = startTopRowHeight + delta;
    const newBottom = startBottomRowHeight - delta;

    if (newTop >= 150 && newBottom >= 150) {
      topRow.style.height = newTop + 'px';
      topRow.style.flex = 'none';
      bottomRow.style.height = newBottom + 'px';
      bottomRow.style.flex = 'none';
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
    let menuItems = [];

    if (params.linkURL) {
      menuItems.push({ label: 'Open Link in New Tab', action: () => createTab(paneId, params.linkURL) });
      PANES.forEach(otherPane => {
        if (otherPane === paneId) return;
        menuItems.push({
          label: `Open Link in ${PANE_LABELS[otherPane]}`,
          action: () => createTab(otherPane, params.linkURL),
        });
      });
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
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--light-bg);border:1px solid var(--light-border);border-radius:8px;padding:4px 0;min-width:220px;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.15);`;

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
  const claudeTab = { id: uuidv4(), url: 'https://claude.ai', title: 'Loading...', createdAt: new Date().toISOString() };

  const workspace = {
    id: uuidv4(),
    name,
    panes: {
      topLeft: emptyPaneShape(),
      topRight: {
        activeProfileId: 'default',
        profiles: { 'default': { tabs: [claudeTab], activeTabId: claudeTab.id } }
      },
      bottomLeft: emptyPaneShape(),
      bottomRight: emptyPaneShape(),
    },
    notes: '',
    folderPath: '',
    createdAt: new Date().toISOString()
  };

  await window.quartet.workspace.create(workspace);
  workspaces.push(workspace);
  activeWorkspace = workspace;

  updateProfileSelectors();
  renderWorkspaces();
  PANES.forEach(p => renderPane(p));
  updateNotepad();
  updateSidebar();
  updateEmptyState();
}

async function switchWorkspace(workspaceId) {
  document.querySelectorAll('.pane-webview-container webview').forEach(wv => wv.remove());
  createdWebviews.clear();

  activeWorkspace = workspaces.find(w => w.id === workspaceId);
  await window.quartet.workspace.setActive(workspaceId);

  if (activeWorkspace) migrateWorkspaceStructure(activeWorkspace);

  updateProfileSelectors();
  renderWorkspaces();
  PANES.forEach(p => renderPane(p));
  updateNotepad();
  updateSidebar();
}

async function deleteWorkspace(workspaceId) {
  if (!confirm('Delete this workspace and all its tabs?')) return;

  workspaces = await window.quartet.workspace.delete(workspaceId);

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
  updateSidebar();
  updateEmptyState();
}

async function renameWorkspace(workspaceId, newName) {
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.name = newName;
    await window.quartet.workspace.update(workspace);
    renderWorkspaces();
    updateSidebar();
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

  await window.quartet.workspace.update(activeWorkspace);
  renderPane(paneId);
  setFocusedPane(paneId);
}

async function switchTab(paneId, tabId) {
  if (!activeWorkspace) return;

  const paneData = getPaneData(paneId);
  const profileId = getPaneProfileId(paneId);
  paneData.activeTabId = tabId;
  await window.quartet.workspace.update(activeWorkspace);

  document.querySelectorAll(`.pane-tab-list[data-pane="${paneId}"] .pane-tab-item`).forEach(item => {
    item.classList.toggle('active', item.dataset.id === tabId);
  });

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

  await window.quartet.workspace.update(activeWorkspace);
  renderPane(paneId);
}

async function updateTabTitle(paneId, tabId, title, profileId) {
  if (!activeWorkspace) return;

  const pane = activeWorkspace.panes[paneId];
  const profileData = pane?.profiles?.[profileId];
  const tab = profileData?.tabs.find(t => t.id === tabId);

  if (tab) {
    tab.title = title;
    await window.quartet.workspace.update(activeWorkspace);

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
    await window.quartet.workspace.update(activeWorkspace);

    if (profileId === pane.activeProfileId && profileData.activeTabId === tabId) {
      const navUrl = document.querySelector(`.nav-url[data-pane="${paneId}"]`);
      if (navUrl) navUrl.value = url;

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

  await window.quartet.workspace.update(activeWorkspace);
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
    await window.quartet.notes.update(activeWorkspace.id, notepadContent.value);
  }, 500);
}

function toggleNotepad() {
  const isCollapsed = notepadPanel.classList.toggle('collapsed');
  notepadToggle.textContent = isCollapsed ? '◀' : '▶';
  notepadExpand.classList.toggle('hidden', !isCollapsed);
}

function expandNotepad() {
  notepadPanel.classList.remove('collapsed');
  notepadToggle.textContent = '▶';
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
    title.textContent = `New Tab (${PANE_LABELS[paneId]})`;
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
  // Resize lifecycle — listen in capture phase so we don't miss events from
  // inside iframes or webviews, and bind multiple release points so the
  // overlay can never get stuck visible.
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', stopResize);
  document.addEventListener('mouseleave', stopResize);
  window.addEventListener('blur', stopResize);
  window.addEventListener('mouseup', stopResize, true);

  PANES.forEach(paneId => {
    const paneEl = document.getElementById(`${paneId}-pane`);
    if (paneEl) {
      paneEl.addEventListener('mousedown', () => setFocusedPane(paneId));
    }
  });

  // Sidebar
  document.getElementById('devtools-btn').addEventListener('click', () => toggleWebviewDevTools(focusedPane));
  document.getElementById('folder-browse-btn').addEventListener('click', browseFolder);
  document.getElementById('folder-path-input').addEventListener('click', browseFolder);
  document.getElementById('git-push-btn').addEventListener('click', gitPush);
  document.getElementById('git-pull-btn').addEventListener('click', gitPull);
  document.getElementById('git-refresh-btn').addEventListener('click', checkGitStatus);
  sidebarToggle.addEventListener('click', toggleSidebar);
  sidebarExpand.addEventListener('click', expandSidebar);

  // Workspace buttons
  document.getElementById('add-workspace').addEventListener('click', openCreateWorkspaceModal);
  document.getElementById('empty-create-workspace').addEventListener('click', openCreateWorkspaceModal);

  // Tab management — per pane
  document.querySelectorAll('.pane-add-tab').forEach(btn => {
    btn.addEventListener('click', () => {
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

  // Vertical resizers
  document.querySelectorAll('.pane-vertical-resizer').forEach(resizer => {
    resizer.addEventListener('mousedown', (e) => {
      startResize('vertical', e, {
        startTopLeftWidth: document.getElementById('topLeft-pane').offsetWidth,
        startTopRightWidth: document.getElementById('topRight-pane').offsetWidth,
      });
    });
  });

  // Row resizer
  document.getElementById('row-resizer').addEventListener('mousedown', (e) => {
    startResize('row', e, {
      startTopRowHeight: document.getElementById('top-row').offsetHeight,
      startBottomRowHeight: document.getElementById('bottom-row').offsetHeight,
    });
  });

  // Notepad resizer
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

  // Keyboard shortcuts — these only fire when the host document has focus
  // (not when a webview has keyboard focus). Menu accelerators in main.js
  // handle the always-on shortcuts like F12 and Cmd+Shift+1..4.
  document.addEventListener('keydown', (e) => {
    // Escape always releases a stuck resize, in addition to closing modals.
    if (e.key === 'Escape') {
      stopResize();
      closeWorkspaceModal();
      closeTabModal();
      closeProfileModal();
    }
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
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key) && !e.shiftKey) {
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
  });
}

document.addEventListener('DOMContentLoaded', init);
