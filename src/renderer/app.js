// ============================================
// OUTER RIM - Renderer Application
// Dual-Pane Architecture
// ============================================

// Browser-native UUID generator
function uuidv4() {
  return crypto.randomUUID();
}

// State
let workspaces = [];
let activeWorkspace = null;
let activePane = 'left'; // Which pane the next tab will open in

// DOM Elements
const workspaceList = document.getElementById('workspace-list');
const notepadContent = document.getElementById('notepad-content');
const emptyStateOverlay = document.getElementById('empty-state-overlay');

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
  
  renderWorkspaces();
  renderPanes();
  updateNotepad();
  updateEmptyState();
  setupEventListeners();
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
  
  // Clear existing
  tabList.innerHTML = '';
  webviewContainer.querySelectorAll('webview').forEach(wv => wv.remove());
  
  if (!activeWorkspace) {
    webviewContainer.querySelector('.pane-empty-state').style.display = 'block';
    return;
  }
  
  // Migrate old workspace format if needed
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
  
  // Show/hide empty state
  const emptyState = webviewContainer.querySelector('.pane-empty-state');
  emptyState.style.display = pane.tabs.length === 0 ? 'block' : 'none';
  
  // Render tabs
  pane.tabs.forEach(tab => {
    // Tab item
    const item = document.createElement('div');
    item.className = `pane-tab-item ${pane.activeTabId === tab.id ? 'active' : ''}`;
    item.dataset.id = tab.id;
    item.dataset.pane = paneName;
    
    const favicon = getFaviconUrl(tab.url);
    
    item.innerHTML = `
      <img class="pane-tab-favicon" src="${favicon}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23666%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'">
      <span class="pane-tab-title">${escapeHtml(tab.title || 'New Tab')}</span>
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
    
    // Webview
    const webview = document.createElement('webview');
    webview.id = `webview-${paneName}-${tab.id}`;
    webview.src = tab.url;
    webview.className = pane.activeTabId === tab.id ? 'active' : '';
    
    webview.addEventListener('page-title-updated', (e) => {
      updateTabTitle(paneName, tab.id, e.title);
    });
    
    webview.addEventListener('did-navigate', (e) => {
      updateTabUrl(paneName, tab.id, e.url);
    });
    
    webview.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        updateTabUrl(paneName, tab.id, e.url);
      }
    });
    
    webviewContainer.appendChild(webview);
  });
}

async function createTab(paneName, url) {
  if (!activeWorkspace) return;
  
  // Ensure URL has protocol
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
  
  // Update tab UI
  const tabList = document.querySelector(`.pane-tab-list[data-pane="${paneName}"]`);
  tabList.querySelectorAll('.pane-tab-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === tabId);
  });
  
  // Update webview visibility
  const container = document.querySelector(`.pane-webview-container[data-pane="${paneName}"]`);
  container.querySelectorAll('webview').forEach(wv => {
    wv.classList.toggle('active', wv.id === `webview-${paneName}-${tabId}`);
  });
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
      tabEl.textContent = title;
    }
  }
}

async function updateTabUrl(paneName, tabId, url) {
  if (!activeWorkspace) return;
  
  const tab = activeWorkspace.panes[paneName].tabs.find(t => t.id === tabId);
  if (tab) {
    tab.url = url;
    await window.outerRim.workspace.update(activeWorkspace);
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
  // Add workspace buttons
  document.getElementById('add-workspace').addEventListener('click', openCreateWorkspaceModal);
  document.getElementById('empty-create-workspace').addEventListener('click', openCreateWorkspaceModal);
  
  // Add tab buttons (for each pane)
  document.querySelectorAll('.pane-add-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      openTabModal(btn.dataset.pane);
    });
  });
  
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
  
  // Quick links
  document.querySelectorAll('.quick-link').forEach(btn => {
    btn.addEventListener('click', () => {
      createTab(activePane, btn.dataset.url);
      closeTabModal();
    });
  });
  
  // Notepad
  notepadContent.addEventListener('input', saveNotes);
  
  // Notepad toggle
  document.getElementById('notepad-toggle').addEventListener('click', () => {
    const panel = document.getElementById('notepad-panel');
    const btn = document.getElementById('notepad-toggle');
    panel.classList.toggle('collapsed');
    btn.textContent = panel.classList.contains('collapsed') ? '▲' : '▼';
  });
  
  // Pane resizer
  setupPaneResizer();
  
  // Notepad resizer
  setupNotepadResizer();
  
  // Keyboard shortcuts
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
    // Switch pane focus with Cmd+1 and Cmd+2
    if ((e.metaKey || e.ctrlKey) && e.key === '1') {
      e.preventDefault();
      activePane = 'left';
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '2') {
      e.preventDefault();
      activePane = 'right';
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
    const newLeftWidth = e.clientX - containerRect.left;
    const totalWidth = containerRect.width - 6; // minus resizer width
    
    const leftPercent = (newLeftWidth / totalWidth) * 100;
    
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
  const resizer = document.getElementById('notepad-resizer-horizontal');
  const panel = document.getElementById('notepad-panel');
  let isResizing = false;
  
  resizer.addEventListener('mousedown', () => {
    isResizing = true;
    document.body.style.cursor = 'row-resize';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const mainContent = document.getElementById('main-content');
    const mainRect = mainContent.getBoundingClientRect();
    const newHeight = mainRect.bottom - e.clientY;
    
    if (newHeight > 50 && newHeight < 400) {
      panel.style.height = newHeight + 'px';
    }
  });
  
  document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = '';
  });
}

// ============================================
// BOOTSTRAP
// ============================================

document.addEventListener('DOMContentLoaded', init);