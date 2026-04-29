// ============================================
// PERIMETER - Workspace + Browser + Git + Cloud Sync + Claude Code UI
// ============================================

function uuidv4() { return crypto.randomUUID(); }

let workspaces = [];
let activeWorkspace = null;
let profiles = [];

const createdWebviews = new Set();

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

// Clone dialog DOM
const cloneModalOverlay = document.getElementById('clone-modal-overlay');
const cloneUrlInput = document.getElementById('clone-url-input');
const clonePreviewPath = document.getElementById('clone-preview-path');
const cloneStatusEl = document.getElementById('clone-status');
const cloneConfirmBtn = document.getElementById('clone-modal-confirm');
const cloneCancelBtn = document.getElementById('clone-modal-cancel');
const cloneRepoSearch = document.getElementById('clone-repo-search');
const cloneRepoList = document.getElementById('clone-repo-list');
const cloneSignedOutHint = document.getElementById('clone-signed-out-hint');
const clonePaneMyRepos = document.getElementById('clone-pane-my-repos');
const clonePanePasteUrl = document.getElementById('clone-pane-paste-url');

let cloneTab = 'my-repos';
let cachedRepos = null;
let selectedRepoUrl = null;
let selectedRepoName = null;

// Claude Code DOM
const claudeLaunchBtn = document.getElementById('claude-launch-btn');
const claudeLaunchSkipBtn = document.getElementById('claude-launch-skip-btn');
const claudeStatusBadge = document.getElementById('claude-status-badge');
const claudeSectionHint = document.getElementById('claude-section-hint');
const claudeChatInput = document.getElementById('claude-chat-input');
const claudeChatSend = document.getElementById('claude-chat-send');
const claudeChatStop = document.getElementById('claude-chat-stop');

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

  if (window.PerimeterTerminals) {
    window.PerimeterTerminals.init();
    // Subscribe to terminal-state changes so we can enable/disable the Claude
    // Code Launch buttons + chat input as terminals open/close + Claude
    // Code activates.
    window.PerimeterTerminals.onStateChange((state) => updateClaudeUI(state));
  }

  // Initial render based on whatever the terminal state is right now (probably no terminal yet).
  updateClaudeUI(window.PerimeterTerminals?.getActiveState() || { hasTerminal: false, claudeActive: false });

  window.perimeter.onMenuToggleDevTools(() => toggleActiveWebviewDevTools());

  initSync().catch((err) => console.error('[sync] initSync failed:', err));
}

// ============================================
// CLAUDE CODE (Launch buttons + chat input + interrupt)
// ============================================

// Update everything Claude-Code-related based on:
//   - whether there's an active terminal
//   - whether Claude Code is detected as running in it
//   - whether the workspace has a Project Folder set
function updateClaudeUI(state) {
  const hasTerminal = !!state?.hasTerminal;
  const claudeActive = !!state?.claudeActive;
  const hasFolder = !!(activeWorkspace?.folderPath);

  // Status badge
  if (claudeActive) {
    claudeStatusBadge.className = 'status-badge running';
    claudeStatusBadge.textContent = 'Running';
  } else if (hasTerminal) {
    claudeStatusBadge.className = 'status-badge signed-out';
    claudeStatusBadge.textContent = 'Idle';
  } else {
    claudeStatusBadge.className = 'status-badge signed-out';
    claudeStatusBadge.textContent = 'Idle';
  }

  // Hint text under the section title.
  if (!hasFolder) {
    claudeSectionHint.textContent = 'Set or clone a Project Folder first to enable Claude Code.';
  } else if (!hasTerminal) {
    claudeSectionHint.textContent = 'Open a terminal (click + above the terminal pane) to launch Claude Code.';
  } else if (claudeActive) {
    claudeSectionHint.textContent = 'Claude Code is running. Use the chat box at the bottom of the terminal pane.';
  } else {
    claudeSectionHint.textContent = 'Press ▶ Launch to start Claude Code in the active terminal.';
  }

  // Buttons:
  //   disabled if no folder OR no terminal OR claude already running
  const canLaunch = hasFolder && hasTerminal && !claudeActive;
  claudeLaunchBtn.disabled = !canLaunch;
  claudeLaunchSkipBtn.disabled = !canLaunch;

  // If there's no folder, clicking a disabled launch button should open the
  // clone dialog (UX shortcut). We attach a special class so the click
  // handler knows what to do.
  claudeLaunchBtn.dataset.disabledReason = !hasFolder ? 'no-folder'
    : !hasTerminal ? 'no-terminal'
    : claudeActive ? 'already-running'
    : '';
  claudeLaunchSkipBtn.dataset.disabledReason = claudeLaunchBtn.dataset.disabledReason;

  // Chat input + buttons
  if (!hasFolder) {
    claudeChatInput.disabled = true;
    claudeChatInput.placeholder = 'Set a Project Folder, open a terminal, and click ▶ Launch to chat…';
  } else if (!hasTerminal) {
    claudeChatInput.disabled = true;
    claudeChatInput.placeholder = 'Open a terminal to chat with Claude Code…';
  } else if (!claudeActive) {
    claudeChatInput.disabled = true;
    claudeChatInput.placeholder = 'Click ▶ Launch to start Claude Code, then chat here…';
  } else {
    claudeChatInput.disabled = false;
    claudeChatInput.placeholder = 'Type to Claude Code…  (Enter sends, Shift+Enter newline)';
  }
  claudeChatSend.disabled = claudeChatInput.disabled;
  claudeChatStop.disabled = !hasTerminal; // stop is useful even before claude is detected,
                                          // so user can Esc out of any prompt that's stuck
}

// Send the launch command to the active terminal.
function launchClaudeCode({ skipPermissions = false } = {}) {
  const reason = (skipPermissions ? claudeLaunchSkipBtn : claudeLaunchBtn).dataset.disabledReason;
  if (reason === 'no-folder') {
    // Convenience: clicking a disabled launch button when no folder is set
    // shortcuts to the clone dialog.
    openCloneModal();
    return;
  }
  if (reason) return; // shouldn't happen since button is disabled, but be safe

  if (!activeWorkspace?.folderPath) return;
  const folder = activeWorkspace.folderPath;

  // Build the command. We cd first so claude opens with the right cwd even if
  // the terminal was started elsewhere. Quote the folder in case of spaces.
  const escaped = folder.replace(/"/g, '\\"');
  const cmd = skipPermissions
    ? `cd "${escaped}" && claude --dangerously-skip-permissions\n`
    : `cd "${escaped}" && claude\n`;

  if (window.PerimeterTerminals) {
    window.PerimeterTerminals.sendToActive(cmd);
  }
}

function sendChatMessage() {
  if (claudeChatInput.disabled) return;
  const text = claudeChatInput.value;
  if (!text.trim()) return;

  // Send the message + Enter so Claude Code receives it as a complete line.
  if (window.PerimeterTerminals) {
    window.PerimeterTerminals.sendToActive(text + '\n');
  }

  // Clear the box and reset its height
  claudeChatInput.value = '';
  claudeChatInput.style.height = '';
}

function interruptClaudeCode() {
  if (window.PerimeterTerminals) {
    window.PerimeterTerminals.interruptActive();
  }
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

  // Folder change can flip the Claude Code section state.
  if (window.PerimeterTerminals) {
    updateClaudeUI(window.PerimeterTerminals.getActiveState());
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
// CLOUD SYNC (renderer)
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

let currentSyncStatus = { signedIn: false };

function updateSyncUI(status) {
  currentSyncStatus = status || { signedIn: false };
  const badge = document.getElementById('sync-status-badge');
  const signedOut = document.getElementById('sync-signed-out');
  const signedIn = document.getElementById('sync-signed-in');
  const accountName = document.getElementById('sync-account-name');
  const lastSyncedText = document.getElementById('sync-last-synced-text');
  const conflictBanner = document.getElementById('sync-conflict-banner');

  if (!badge || !signedOut || !signedIn) return;

  badge.className = 'status-badge ' + (status.status || 'signed-out');
  const badgeText = {
    idle: 'Synced', pushing: 'Pushing', pulling: 'Pulling',
    conflict: 'Conflict', error: 'Error', 'signed-out': 'Off',
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

  if (cloneSignedOutHint) {
    cloneSignedOutHint.classList.toggle('hidden', !!status.signedIn);
  }
}

async function reloadFromStore() {
  workspaces = await window.perimeter.workspace.getAll();
  const active = await window.perimeter.workspace.getActive();
  if (active) activeWorkspace = workspaces.find(w => w.id === active.id);
  profiles = await window.perimeter.profiles.getAll();
  if (activeWorkspace) migrateWorkspaceStructure(activeWorkspace);
  document.querySelectorAll('.pane-webview-container webview').forEach(wv => wv.remove());
  createdWebviews.clear();
  updateProfileSelectors();
  renderWorkspaces();
  renderBrowserPane();
  updateNotepad();
  updateSidebar();
  updateEmptyState();
}

async function initSync() {
  const status = await window.perimeter.sync.getStatus();
  updateSyncUI(status);

  window.perimeter.sync.onStatus((status) => updateSyncUI(status));
  window.perimeter.sync.onRemoteApplied(() => reloadFromStore());

  const signinBtn = document.getElementById('sync-signin-btn');
  if (signinBtn) signinBtn.addEventListener('click', async () => {
    signinBtn.disabled = true;
    signinBtn.innerHTML = '<span class="btn-icon">⏳</span> Waiting for browser…';
    try {
      const result = await window.perimeter.sync.signIn();
      if (result.error) alert('Sign-in failed: ' + result.error);
      else if (result.ok || result.alreadySignedIn) await reloadFromStore();
    } catch (err) {
      alert('Sign-in error: ' + err.message);
    }
    signinBtn.disabled = false;
    signinBtn.innerHTML = '<span class="btn-icon">🔑</span> Sign in with GitHub';
  });

  const signoutBtn = document.getElementById('sync-signout-btn');
  if (signoutBtn) signoutBtn.addEventListener('click', async () => {
    if (!confirm('Sign out of cloud sync? Your local data stays, but will stop syncing.')) return;
    await window.perimeter.sync.signOut();
    cachedRepos = null;
  });

  const syncNowBtn = document.getElementById('sync-now-btn');
  if (syncNowBtn) syncNowBtn.addEventListener('click', async () => {
    syncNowBtn.disabled = true;
    const original = syncNowBtn.textContent;
    syncNowBtn.textContent = '⏳ Syncing…';
    try {
      await window.perimeter.sync.syncNow({ direction: 'pull' });
      await window.perimeter.sync.syncNow({});
    } catch (err) { console.error('[sync] syncNow failed', err); }
    syncNowBtn.disabled = false;
    syncNowBtn.textContent = original;
  });

  const pullForceBtn = document.getElementById('sync-pull-force-btn');
  if (pullForceBtn) pullForceBtn.addEventListener('click', async () => {
    if (!confirm('This will overwrite your local state with the cloud copy. Continue?')) return;
    await window.perimeter.sync.pullForce();
    await reloadFromStore();
  });

  const pushForceBtn = document.getElementById('sync-push-force-btn');
  if (pushForceBtn) pushForceBtn.addEventListener('click', async () => {
    if (!confirm('This will overwrite the cloud copy with your local state. Continue?')) return;
    await window.perimeter.sync.pushForce();
  });
}

// ============================================
// CLONE REPO (with My Repos browser)
// ============================================

function repoNameFromUrl(url) {
  if (!url) return null;
  let trimmed = url.trim();
  trimmed = trimmed.replace(/\.git$/i, '').replace(/\/$/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  const lastColon = trimmed.lastIndexOf(':');
  const cut = Math.max(lastSlash, lastColon);
  if (cut === -1) return null;
  const name = trimmed.substring(cut + 1);
  if (!name || /[^A-Za-z0-9._-]/.test(name)) return null;
  return name;
}

function resolveCloneParent() {
  const workspaceFolder = activeWorkspace?.folderPath?.trim();
  if (workspaceFolder) return workspaceFolder;
  return '~/Projects';
}

function openCloneModal() {
  cloneTab = 'my-repos';
  setCloneTab('my-repos');
  cloneUrlInput.value = '';
  cloneRepoSearch.value = '';
  selectedRepoUrl = null;
  selectedRepoName = null;
  cloneStatusEl.className = 'clone-status hidden';
  cloneStatusEl.textContent = '';
  cloneCancelBtn.disabled = false;
  cloneConfirmBtn.textContent = 'Clone';
  updateClonePreview();

  cloneModalOverlay.classList.remove('hidden');

  if (currentSyncStatus.signedIn) {
    if (!cachedRepos) loadMyRepos();
    else renderRepoList();
  } else {
    renderRepoList();
  }
}

function closeCloneModal() {
  cloneModalOverlay.classList.add('hidden');
}

function setCloneTab(tab) {
  cloneTab = tab;
  document.querySelectorAll('.clone-tab').forEach(b => b.classList.toggle('active', b.dataset.cloneTab === tab));
  clonePaneMyRepos.classList.toggle('hidden', tab !== 'my-repos');
  clonePanePasteUrl.classList.toggle('hidden', tab !== 'paste-url');
  updateClonePreview();
  if (tab === 'my-repos') cloneRepoSearch.focus();
  else cloneUrlInput.focus();
}

async function loadMyRepos() {
  cloneRepoList.innerHTML = '<div class="clone-repo-loading">Loading your repos…</div>';
  try {
    const result = await window.perimeter.github.listRepos();
    if (!result.success) {
      cloneRepoList.innerHTML = `<div class="clone-repo-empty">✗ ${escapeHtml(result.error)}</div>`;
      return;
    }
    cachedRepos = result.repos || [];
    renderRepoList();
  } catch (err) {
    cloneRepoList.innerHTML = `<div class="clone-repo-empty">✗ ${escapeHtml(err.message)}</div>`;
  }
}

function renderRepoList() {
  if (!currentSyncStatus.signedIn) {
    cloneRepoList.innerHTML = '<div class="clone-repo-empty">Sign in to see your repos.</div>';
    return;
  }
  if (!cachedRepos) {
    cloneRepoList.innerHTML = '<div class="clone-repo-loading">Loading your repos…</div>';
    return;
  }
  const q = (cloneRepoSearch.value || '').trim().toLowerCase();
  const filtered = q
    ? cachedRepos.filter(r => r.full_name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q))
    : cachedRepos;

  if (filtered.length === 0) {
    cloneRepoList.innerHTML = `<div class="clone-repo-empty">No matching repos.</div>`;
    return;
  }

  cloneRepoList.innerHTML = filtered.map(r => `
    <div class="clone-repo-item ${r.clone_url === selectedRepoUrl ? 'selected' : ''}" data-url="${escapeHtml(r.clone_url)}" data-name="${escapeHtml(r.name)}">
      <div class="clone-repo-name">
        ${escapeHtml(r.full_name)}
        ${r.private ? '<span class="clone-repo-private">private</span>' : ''}
      </div>
      ${r.description ? `<div class="clone-repo-desc">${escapeHtml(r.description)}</div>` : ''}
    </div>
  `).join('');

  cloneRepoList.querySelectorAll('.clone-repo-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedRepoUrl = el.dataset.url;
      selectedRepoName = el.dataset.name;
      cloneRepoList.querySelectorAll('.clone-repo-item').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      updateClonePreview();
    });
  });
}

function updateClonePreview() {
  const parent = resolveCloneParent();

  let url = '', repoName = null;
  if (cloneTab === 'my-repos') {
    url = selectedRepoUrl || '';
    repoName = selectedRepoName;
  } else {
    url = cloneUrlInput.value.trim();
    repoName = repoNameFromUrl(url);
  }

  if (!url) {
    clonePreviewPath.textContent = '—';
    cloneConfirmBtn.disabled = true;
  } else if (!repoName) {
    clonePreviewPath.textContent = '(could not parse repo name from URL)';
    cloneConfirmBtn.disabled = true;
  } else {
    clonePreviewPath.textContent = `${parent}/${repoName}`;
    cloneConfirmBtn.disabled = false;
  }
}

async function confirmClone() {
  let url = '';
  if (cloneTab === 'my-repos') url = selectedRepoUrl || '';
  else url = cloneUrlInput.value.trim();

  if (!url) return;

  cloneConfirmBtn.disabled = true;
  cloneCancelBtn.disabled = true;
  cloneConfirmBtn.textContent = 'Cloning…';
  cloneStatusEl.className = 'clone-status cloning';
  cloneStatusEl.textContent = 'Running git clone… (large repos may take a minute)';

  const parentPath = activeWorkspace?.folderPath || null;

  try {
    const result = await window.perimeter.git.clone({ url, parentPath });
    if (result.success) {
      cloneStatusEl.className = 'clone-status success';
      cloneStatusEl.textContent = `✓ Cloned to ${result.clonedPath}`;
      cloneConfirmBtn.textContent = 'Done';
      if (activeWorkspace && !activeWorkspace.folderPath) {
        activeWorkspace.folderPath = result.clonedPath;
        await window.perimeter.workspace.update(activeWorkspace);
        updateSidebar();
      } else {
        checkGitStatus();
      }
      setTimeout(() => closeCloneModal(), 1200);
    } else {
      cloneStatusEl.className = 'clone-status error';
      cloneStatusEl.textContent = result.error || 'Clone failed';
      cloneConfirmBtn.disabled = false;
      cloneCancelBtn.disabled = false;
      cloneConfirmBtn.textContent = 'Retry';
    }
  } catch (err) {
    cloneStatusEl.className = 'clone-status error';
    cloneStatusEl.textContent = err.message || 'Clone failed';
    cloneConfirmBtn.disabled = false;
    cloneCancelBtn.disabled = false;
    cloneConfirmBtn.textContent = 'Retry';
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
  if (resizeOverlay) resizeOverlay.style.display = 'none';
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
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
    id: uuidv4(), name,
    panes: { right: { activeProfileId: 'default', profiles: { 'default': { tabs: [], activeTabId: null } } } },
    notes: '', folderPath: '',
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
// BROWSER PANE
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
        webview.addEventListener('did-navigate', (e) => { updateTabUrl(tab.id, e.url, profileId); if (isActiveProfile) updateNavBar(); });
        webview.addEventListener('did-navigate-in-page', (e) => { updateTabUrl(tab.id, e.url, profileId); if (isActiveProfile) updateNavBar(); });
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
      navBack.disabled = true; navForward.disabled = true;
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
// HELPERS
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

function closeWorkspaceModal() { modalOverlay.classList.add('hidden'); editingWorkspaceId = null; }

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
  document.addEventListener('mouseleave', stopResize);
  window.addEventListener('blur', stopResize);

  document.getElementById('devtools-btn').addEventListener('click', toggleActiveWebviewDevTools);
  document.getElementById('add-workspace').addEventListener('click', openCreateWorkspaceModal);
  document.getElementById('empty-create-workspace').addEventListener('click', openCreateWorkspaceModal);
  document.getElementById('folder-browse-btn').addEventListener('click', browseFolder);
  document.getElementById('folder-path-input').addEventListener('click', browseFolder);
  document.getElementById('git-push-btn').addEventListener('click', gitPush);
  document.getElementById('git-pull-btn').addEventListener('click', gitPull);
  document.getElementById('git-refresh-btn').addEventListener('click', checkGitStatus);

  // Clone Repo
  document.getElementById('clone-repo-btn').addEventListener('click', openCloneModal);
  cloneCancelBtn.addEventListener('click', closeCloneModal);
  cloneConfirmBtn.addEventListener('click', confirmClone);
  cloneUrlInput.addEventListener('input', updateClonePreview);
  cloneUrlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !cloneConfirmBtn.disabled) confirmClone(); });
  cloneRepoSearch.addEventListener('input', renderRepoList);
  document.querySelectorAll('.clone-tab').forEach(b => {
    b.addEventListener('click', () => setCloneTab(b.dataset.cloneTab));
  });
  cloneModalOverlay.addEventListener('click', (e) => { if (e.target === cloneModalOverlay && !cloneCancelBtn.disabled) closeCloneModal(); });

  // Claude Code launch buttons.
  // Even when disabled, clicking the button can still run — we use
  // pointer-events on disabled buttons via a data-disabled-reason check.
  // The trick: disabled <button> doesn't fire click. So we attach click on
  // the parent so we still get the event when the button is disabled.
  claudeLaunchBtn.parentElement.addEventListener('click', (e) => {
    if (e.target.closest('#claude-launch-btn')) {
      // Only trigger when the button is the target. If button is disabled
      // and reason is 'no-folder', open clone modal.
      const btn = claudeLaunchBtn;
      if (btn.disabled && btn.dataset.disabledReason === 'no-folder') {
        openCloneModal();
      } else if (!btn.disabled) {
        launchClaudeCode({ skipPermissions: false });
      }
      return;
    }
    if (e.target.closest('#claude-launch-skip-btn')) {
      const btn = claudeLaunchSkipBtn;
      if (btn.disabled && btn.dataset.disabledReason === 'no-folder') {
        openCloneModal();
      } else if (!btn.disabled) {
        launchClaudeCode({ skipPermissions: true });
      }
    }
  });
  // Disabled buttons don't fire clicks in Chromium — work around so the
  // "open clone dialog when no folder" shortcut still works.
  [claudeLaunchBtn, claudeLaunchSkipBtn].forEach(btn => {
    btn.style.pointerEvents = 'auto';
  });

  // Claude chat input
  claudeChatInput.addEventListener('input', () => {
    // Auto-grow up to max-height (CSS handles the cap with overflow)
    claudeChatInput.style.height = 'auto';
    claudeChatInput.style.height = Math.min(claudeChatInput.scrollHeight, 160) + 'px';
  });
  claudeChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  claudeChatSend.addEventListener('click', sendChatMessage);
  claudeChatStop.addEventListener('click', interruptClaudeCode);

  document.querySelector('.pane-add-tab[data-pane="right"]').addEventListener('click', openTabModal);

  document.querySelectorAll('.profile-select').forEach(select => {
    select.addEventListener('change', (e) => changeProfile(e.target.value));
  });
  document.querySelectorAll('.profile-manage-btn').forEach(btn => btn.addEventListener('click', openProfileModal));
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

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); openCreateWorkspaceModal(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
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
    if (e.key === 'Escape') {
      stopResize();
      closeWorkspaceModal();
      closeTabModal();
      closeProfileModal();
      if (!cloneCancelBtn.disabled) closeCloneModal();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
