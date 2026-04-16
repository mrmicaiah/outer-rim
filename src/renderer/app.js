// ============================================
// OUTER RIM - Renderer Application
// ============================================

// Browser-native UUID generator
function uuidv4() {
  return crypto.randomUUID();
}

// State
let workspaces = [];
let activeWorkspace = null;

// DOM Elements
const workspaceList = document.getElementById('workspace-list');
const tabList = document.getElementById('tab-list');
const webviewContainer = document.getElementById('webview-container');
const notepadContent = document.getElementById('notepad-content');
const emptyState = document.getElementById('empty-state');

// Modals
const modalOverlay = document.getElementById('modal-overlay');
const workspaceNameInput = document.getElementById('workspace-name-input');
const tabModalOverlay = document.getElementById('tab-modal-overlay');
const tabUrlInput = document.getElementById('tab-url-input');

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  // Load workspaces from store
  workspaces = await window.outerRim.workspace.getAll();
  const active = await window.outerRim.workspace.getActive();
  
  if (active) {
    activeWorkspace = workspaces.find(w => w.id === active.id);
  }
  
  renderWorkspaces();
  renderTabs();
  renderWebviews();
  updateNotepad();
  updateEmptyState();
  
  // Set up event listeners
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
    
    // Click to switch workspace
    item.addEventListener('click', (e) => {
      if (!e.target.classList.contains('workspace-action-btn')) {
        switchWorkspace(workspace.id);
      }
    });
    
    // Edit button
    item.querySelector('.edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openRenameModal(workspace);
    });
    
    // Delete button
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
    tabs: [],
    activeTabId: null,
    notes: '',
    createdAt: new Date().toISOString()
  };
  
  await window.outerRim.workspace.create(workspace);
  workspaces.push(workspace);
  activeWorkspace = workspace;
  
  renderWorkspaces();
  renderTabs();
  renderWebviews();
  updateNotepad();
  updateEmptyState();
}

async function switchWorkspace(workspaceId) {
  activeWorkspace = workspaces.find(w => w.id === workspaceId);
  await window.outerRim.workspace.setActive(workspaceId);
  
  renderWorkspaces();
  renderTabs();
  renderWebviews();
  updateNotepad();
}

async function deleteWorkspace(workspaceId) {
  if (!confirm('Delete this workspace and all its tabs?')) return;
  
  workspaces = await window.outerRim.workspace.delete(workspaceId);
  
  if (activeWorkspace?.id === workspaceId) {
    activeWorkspace = workspaces[0] || null;
  }
  
  renderWorkspaces();
  renderTabs();
  renderWebviews();
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
// TAB MANAGEMENT
// ============================================

function renderTabs() {
  tabList.innerHTML = '';
  
  if (!activeWorkspace) return;
  
  activeWorkspace.tabs.forEach(tab => {
    const item = document.createElement('div');
    item.className = `tab-item ${activeWorkspace.activeTabId === tab.id ? 'active' : ''}`;
    item.dataset.id = tab.id;
    
    const favicon = getFaviconUrl(tab.url);
    
    item.innerHTML = `
      <img class="tab-favicon" src="${favicon}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23666%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'">
      <span class="tab-title">${escapeHtml(tab.title || 'New Tab')}</span>
      <button class="tab-close" title="Close tab">×</button>
    `;
    
    item.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        switchTab(tab.id);
      }
    });
    
    item.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    
    tabList.appendChild(item);
  });
}

function renderWebviews() {
  // Remove all existing webviews
  webviewContainer.querySelectorAll('webview').forEach(wv => wv.remove());
  
  if (!activeWorkspace) return;
  
  activeWorkspace.tabs.forEach(tab => {
    const webview = document.createElement('webview');
    webview.id = `webview-${tab.id}`;
    webview.src = tab.url;
    webview.className = activeWorkspace.activeTabId === tab.id ? 'active' : '';
    
    // Handle title updates
    webview.addEventListener('page-title-updated', (e) => {
      updateTabTitle(tab.id, e.title);
    });
    
    // Handle URL changes (navigation)
    webview.addEventListener('did-navigate', (e) => {
      updateTabUrl(tab.id, e.url);
    });
    
    webview.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        updateTabUrl(tab.id, e.url);
      }
    });
    
    webviewContainer.appendChild(webview);
  });
}

async function createTab(url) {
  if (!activeWorkspace) return;
  
  // Ensure URL has protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    // Check if it looks like a URL or a search query
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
  
  activeWorkspace = await window.outerRim.tab.add(activeWorkspace.id, tab);
  const idx = workspaces.findIndex(w => w.id === activeWorkspace.id);
  workspaces[idx] = activeWorkspace;
  
  renderTabs();
  renderWebviews();
  updateEmptyState();
}

async function switchTab(tabId) {
  if (!activeWorkspace) return;
  
  activeWorkspace = await window.outerRim.tab.setActive(activeWorkspace.id, tabId);
  const idx = workspaces.findIndex(w => w.id === activeWorkspace.id);
  workspaces[idx] = activeWorkspace;
  
  renderTabs();
  
  // Show/hide webviews
  webviewContainer.querySelectorAll('webview').forEach(wv => {
    wv.className = wv.id === `webview-${tabId}` ? 'active' : '';
  });
}

async function closeTab(tabId) {
  if (!activeWorkspace) return;
  
  activeWorkspace = await window.outerRim.tab.remove(activeWorkspace.id, tabId);
  const idx = workspaces.findIndex(w => w.id === activeWorkspace.id);
  workspaces[idx] = activeWorkspace;
  
  renderTabs();
  renderWebviews();
  updateEmptyState();
}

async function updateTabTitle(tabId, title) {
  if (!activeWorkspace) return;
  
  const tab = activeWorkspace.tabs.find(t => t.id === tabId);
  if (tab) {
    tab.title = title;
    await window.outerRim.tab.update(activeWorkspace.id, tab);
    
    // Update DOM directly for performance
    const tabEl = tabList.querySelector(`[data-id="${tabId}"] .tab-title`);
    if (tabEl) {
      tabEl.textContent = title;
    }
  }
}

async function updateTabUrl(tabId, url) {
  if (!activeWorkspace) return;
  
  const tab = activeWorkspace.tabs.find(t => t.id === tabId);
  if (tab) {
    tab.url = url;
    await window.outerRim.tab.update(activeWorkspace.id, tab);
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
  
  // Debounce saves
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
  if (workspaces.length === 0 || (activeWorkspace && activeWorkspace.tabs.length === 0)) {
    emptyState.style.display = 'block';
    if (workspaces.length === 0) {
      emptyState.querySelector('p').textContent = 'Create a workspace to get started';
    } else {
      emptyState.querySelector('p').textContent = 'Add a tab to start browsing';
    }
  } else {
    emptyState.style.display = 'none';
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

function openTabModal() {
  if (!activeWorkspace) {
    alert('Create a workspace first');
    return;
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
  
  createTab(url);
  closeTabModal();
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  // Add workspace button
  document.getElementById('add-workspace').addEventListener('click', openCreateWorkspaceModal);
  document.getElementById('empty-create-workspace').addEventListener('click', openCreateWorkspaceModal);
  
  // Add tab button
  document.getElementById('add-tab').addEventListener('click', openTabModal);
  
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
  
  // Quick links in tab modal
  document.querySelectorAll('.quick-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      createTab(url);
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
    btn.textContent = panel.classList.contains('collapsed') ? '▶' : '◀';
  });
  
  // Notepad resizer
  setupNotepadResizer();
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + T: New tab
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      e.preventDefault();
      openTabModal();
    }
    // Cmd/Ctrl + W: Close tab
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      if (activeWorkspace?.activeTabId) {
        closeTab(activeWorkspace.activeTabId);
      }
    }
    // Cmd/Ctrl + N: New workspace
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      openCreateWorkspaceModal();
    }
    // Escape: Close modals
    if (e.key === 'Escape') {
      closeWorkspaceModal();
      closeTabModal();
    }
  });
}

function setupNotepadResizer() {
  const resizer = document.getElementById('notepad-resizer');
  const panel = document.getElementById('notepad-panel');
  let isResizing = false;
  
  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const containerWidth = document.getElementById('content-area').offsetWidth;
    const newWidth = containerWidth - e.clientX + document.getElementById('workspace-sidebar').offsetWidth;
    
    if (newWidth > 200 && newWidth < 600) {
      panel.style.width = newWidth + 'px';
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