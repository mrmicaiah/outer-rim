// ============================================
// CLAUDE COMMANDER - Left Pane Chat Interface
// Persistent memory, multiple chats, projects
// Local file operations + Git integration
// ============================================

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

// In-memory state
let chats = {};
let projects = {};
let activeChatId = null;
let apiKey = null;

// Debounce timer
let saveTimeout = null;
let gitStatusInterval = null;

// ============================================
// INITIALIZATION
// ============================================

async function initCommander() {
  const data = await window.outerRim.commander.load();
  chats = data.chats || {};
  projects = data.projects || {};
  activeChatId = data.activeChatId || null;
  apiKey = data.apiKey || null;
  
  if (Object.keys(chats).length === 0) {
    createNewChat();
  } else if (!activeChatId || !chats[activeChatId]) {
    activeChatId = Object.keys(chats)[0];
  }
  
  renderChatTabs();
  renderProjectSelect();
  loadActiveChat();
  updateApiKeyStatus();
  setupCommanderListeners();
  
  // Start git status polling
  updateGitStatus();
  gitStatusInterval = setInterval(updateGitStatus, 10000); // Every 10s
}

// ============================================
// API KEY MANAGEMENT
// ============================================

function updateApiKeyStatus() {
  const status = document.getElementById('api-key-status');
  const input = document.getElementById('api-key-input');
  
  if (apiKey) {
    status.textContent = '✓ API key saved';
    status.className = 'api-key-status success';
    input.value = apiKey.slice(0, 10) + '...' + apiKey.slice(-4);
    input.dataset.masked = 'true';
  } else {
    status.textContent = 'No API key set';
    status.className = 'api-key-status';
    input.value = '';
    input.dataset.masked = 'false';
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('api-key-input');
  const btn = document.getElementById('api-key-toggle');
  
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
    if (input.dataset.masked === 'true' && apiKey) {
      input.value = apiKey;
    }
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
}

function handleApiKeyInput(e) {
  const value = e.target.value.trim();
  if (e.target.dataset.masked === 'true' && value.includes('...')) return;
  e.target.dataset.masked = 'false';
  
  if (value.startsWith('sk-ant-')) {
    apiKey = value;
    scheduleSave();
    updateApiKeyStatus();
  } else if (value === '') {
    apiKey = null;
    scheduleSave();
    updateApiKeyStatus();
  }
}

function toggleSettings() {
  document.getElementById('commander-settings').classList.toggle('hidden');
}

// ============================================
// CHAT MANAGEMENT
// ============================================

function createNewChat() {
  const id = crypto.randomUUID();
  const chat = {
    id,
    label: 'new',
    projectId: null,
    task: '',
    messages: [],
    changelog: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  chats[id] = chat;
  activeChatId = id;
  scheduleSave();
  renderChatTabs();
  loadActiveChat();
  
  setTimeout(() => {
    const labelInput = document.getElementById('chat-label-input');
    if (labelInput) { labelInput.focus(); labelInput.select(); }
  }, 50);
  
  return chat;
}

function switchChat(chatId) {
  if (!chats[chatId]) return;
  activeChatId = chatId;
  scheduleSave();
  renderChatTabs();
  loadActiveChat();
}

function deleteChat(chatId) {
  if (Object.keys(chats).length <= 1) { alert('Cannot delete the last chat'); return; }
  if (!confirm('Delete this chat?')) return;
  
  delete chats[chatId];
  if (activeChatId === chatId) activeChatId = Object.keys(chats)[0];
  scheduleSave();
  renderChatTabs();
  loadActiveChat();
}

// ============================================
// PROJECT MANAGEMENT
// ============================================

function createProject(config) {
  const id = crypto.randomUUID();
  projects[id] = { id, ...config };
  scheduleSave();
  renderProjectSelect();
  return projects[id];
}

function updateProject(id, config) {
  if (projects[id]) {
    projects[id] = { ...projects[id], ...config };
    scheduleSave();
    renderProjectSelect();
    updateGitUI();
  }
}

function deleteProject(id) {
  delete projects[id];
  Object.values(chats).forEach(chat => {
    if (chat.projectId === id) chat.projectId = null;
  });
  scheduleSave();
  renderProjectSelect();
  loadActiveChat();
}

function getCurrentProject() {
  const chat = chats[activeChatId];
  return chat?.projectId ? projects[chat.projectId] : null;
}

// ============================================
// GIT OPERATIONS
// ============================================

async function updateGitStatus() {
  const project = getCurrentProject();
  const indicator = document.getElementById('git-status-indicator');
  
  if (!project?.localPath) {
    indicator.classList.add('hidden');
    return;
  }
  
  try {
    const result = await window.outerRim.git.status(project.localPath);
    indicator.classList.remove('hidden');
    
    if (result.success) {
      if (result.hasChanges) {
        indicator.className = 'git-status has-changes';
        indicator.textContent = `● ${result.changes.length}`;
        indicator.title = `${result.changes.length} uncommitted changes`;
      } else {
        indicator.className = 'git-status clean';
        indicator.textContent = '✓';
        indicator.title = 'Working tree clean';
      }
    } else {
      indicator.className = 'git-status error';
      indicator.textContent = '!';
      indicator.title = result.error || 'Git error';
    }
  } catch (err) {
    indicator.classList.add('hidden');
  }
}

function updateGitUI() {
  const project = getCurrentProject();
  const gitActions = document.getElementById('git-actions');
  
  if (project?.localPath) {
    gitActions.classList.remove('hidden');
    updateGitStatus();
  } else {
    gitActions.classList.add('hidden');
    document.getElementById('git-status-indicator').classList.add('hidden');
  }
}

async function gitPull() {
  const project = getCurrentProject();
  if (!project?.localPath) return;
  
  const btn = document.getElementById('git-pull-btn');
  btn.disabled = true;
  btn.textContent = '↻ Pulling...';
  
  try {
    const result = await window.outerRim.git.pull(project.localPath);
    if (result.success) {
      showGitToast('✓ Pulled successfully');
    } else {
      showGitToast('✗ Pull failed: ' + result.error, true);
    }
  } catch (err) {
    showGitToast('✗ Pull error: ' + err.message, true);
  }
  
  btn.disabled = false;
  btn.textContent = '⬇ Pull';
  updateGitStatus();
}

async function gitPush() {
  const project = getCurrentProject();
  if (!project?.localPath) return;
  
  const btn = document.getElementById('git-push-btn');
  const msgInput = document.getElementById('commit-message');
  const message = msgInput.value.trim() || `Update from Outer Rim`;
  
  btn.disabled = true;
  btn.textContent = '↻ Pushing...';
  
  try {
    const result = await window.outerRim.git.push(project.localPath, message);
    if (result.success) {
      showGitToast('✓ Pushed successfully');
      msgInput.value = '';
    } else {
      showGitToast('✗ Push failed: ' + result.error, true);
    }
  } catch (err) {
    showGitToast('✗ Push error: ' + err.message, true);
  }
  
  btn.disabled = false;
  btn.textContent = '⬆ Push';
  updateGitStatus();
}

function showGitToast(message, isError = false) {
  // Simple toast notification
  const existing = document.querySelector('.git-toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `git-toast ${isError ? 'error' : 'success'}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================
// PERSISTENCE
// ============================================

function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    window.outerRim.commander.save({ chats, projects, activeChatId, apiKey });
  }, 1000);
}

// ============================================
// UI RENDERING
// ============================================

function renderChatTabs() {
  const container = document.getElementById('chat-tabs');
  container.innerHTML = '';
  
  Object.values(chats).sort((a, b) => b.updatedAt - a.updatedAt).forEach(chat => {
    const tab = document.createElement('div');
    tab.className = `chat-tab ${chat.id === activeChatId ? 'active' : ''}`;
    tab.dataset.id = chat.id;
    
    const label = document.createElement('span');
    label.className = 'chat-tab-label';
    label.textContent = chat.label || 'new';
    
    const close = document.createElement('button');
    close.className = 'chat-tab-close';
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(chat.id); });
    
    tab.appendChild(label);
    tab.appendChild(close);
    tab.addEventListener('click', () => switchChat(chat.id));
    container.appendChild(tab);
  });
}

function renderProjectSelect() {
  const select = document.getElementById('project-select');
  select.innerHTML = '<option value="">No Project</option>';
  Object.values(projects).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  select.innerHTML += '<option value="__new__">+ New Project...</option>';
  
  const chat = chats[activeChatId];
  select.value = chat?.projectId || '';
}

function loadActiveChat() {
  const chat = chats[activeChatId];
  if (!chat) return;
  
  document.getElementById('chat-label-input').value = chat.label || '';
  document.getElementById('task-input').value = chat.task || '';
  document.getElementById('project-select').value = chat.projectId || '';
  renderMessages();
  updateGitUI();
}

function renderMessages() {
  const container = document.getElementById('commander-messages');
  const chat = chats[activeChatId];
  if (!chat) { container.innerHTML = ''; return; }
  
  container.innerHTML = '';
  
  // Changelog
  if (chat.changelog.length > 0) {
    const logDiv = document.createElement('div');
    logDiv.className = 'commander-changelog';
    logDiv.innerHTML = '<div class="changelog-header">📜 Previous Work</div>';
    chat.changelog.slice(0, 10).forEach(entry => {
      const item = document.createElement('div');
      item.className = 'changelog-item';
      const date = new Date(entry.ts).toLocaleString();
      item.innerHTML = `<span class="changelog-time">${date}</span> ${escapeHtml(entry.summary)}`;
      logDiv.appendChild(item);
    });
    container.appendChild(logDiv);
  }
  
  // Messages
  chat.messages.forEach(msg => {
    const div = document.createElement('div');
    div.className = `commander-message ${msg.role}`;
    let content = typeof msg.content === 'string' ? msg.content : 
      msg.content.map(b => b.type === 'text' ? b.text : '').join('\n');
    div.innerHTML = `<div class="message-content">${formatMessage(content)}</div>`;
    container.appendChild(div);
  });
  
  container.scrollTop = container.scrollHeight;
}

function formatMessage(text) {
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// API INTERACTION
// ============================================

function buildSystemPrompt() {
  const chat = chats[activeChatId];
  if (!chat) return '';
  
  let prompt = '';
  const project = projects[chat.projectId];
  if (project) {
    prompt += `## Project: ${project.name}\n`;
    if (project.localPath) prompt += `Local: ${project.localPath}\n`;
    if (project.repo) prompt += `Repo: ${project.repo}\n`;
    if (project.stack) prompt += `Stack: ${project.stack}\n`;
    if (project.keyFiles) prompt += `Key files:\n${project.keyFiles}\n`;
    prompt += '\n';
  }
  
  if (chat.changelog.length > 0) {
    prompt += '## Recent Work\n';
    chat.changelog.slice(0, 10).forEach(entry => {
      prompt += `- [${new Date(entry.ts).toLocaleDateString()}] ${entry.summary}\n`;
    });
    prompt += '\n';
  }
  
  if (chat.task) {
    prompt += `## Current Task\n${chat.task}\n\n`;
  }
  
  prompt += 'You are Claude, helping with software development. Be concise and direct.';
  return prompt;
}

async function sendMessage() {
  const input = document.getElementById('commander-input');
  const message = input.value.trim();
  if (!message) return;
  
  if (!apiKey) {
    document.getElementById('commander-settings').classList.remove('hidden');
    document.getElementById('api-key-input').focus();
    return;
  }
  
  const chat = chats[activeChatId];
  if (!chat) return;
  
  chat.messages.push({ role: 'user', content: message });
  chat.updatedAt = Date.now();
  input.value = '';
  renderMessages();
  scheduleSave();
  
  const container = document.getElementById('commander-messages');
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'commander-message assistant loading';
  loadingDiv.innerHTML = '<div class="message-content">Thinking...</div>';
  container.appendChild(loadingDiv);
  container.scrollTop = container.scrollHeight;
  
  try {
    const response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8096,
        system: buildSystemPrompt(),
        messages: chat.messages.map(m => ({ role: m.role, content: m.content }))
      })
    });
    
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    const assistantContent = data.content?.map(b => b.type === 'text' ? b.text : '').join('') || '';
    chat.messages.push({ role: 'assistant', content: assistantContent });
    chat.updatedAt = Date.now();
    scheduleSave();
  } catch (error) {
    chat.messages.push({ role: 'assistant', content: `Error: ${error.message}` });
  }
  
  loadingDiv.remove();
  renderMessages();
}

async function clearChat() {
  const chat = chats[activeChatId];
  if (!chat || chat.messages.length === 0) return;
  
  if (apiKey) {
    const container = document.getElementById('commander-messages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'commander-message assistant loading';
    loadingDiv.innerHTML = '<div class="message-content">Summarizing...</div>';
    container.appendChild(loadingDiv);
    
    try {
      const response = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 200,
          messages: [
            ...chat.messages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: 'Summarize what was accomplished in 1-2 sentences. Be specific about files/functions. No preamble.' }
          ]
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const summary = data.content?.[0]?.text || 'Work completed';
        chat.changelog.unshift({ ts: Date.now(), summary: summary.trim() });
        chat.changelog = chat.changelog.slice(0, 20);
      }
    } catch (e) { console.error('Summary error:', e); }
    
    loadingDiv.remove();
  }
  
  chat.messages = [];
  chat.updatedAt = Date.now();
  scheduleSave();
  renderMessages();
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupCommanderListeners() {
  // Settings
  document.getElementById('commander-settings-btn').addEventListener('click', toggleSettings);
  document.getElementById('api-key-input').addEventListener('input', handleApiKeyInput);
  document.getElementById('api-key-input').addEventListener('focus', (e) => {
    if (e.target.dataset.masked === 'true') {
      e.target.value = '';
      e.target.dataset.masked = 'false';
    }
  });
  document.getElementById('api-key-toggle').addEventListener('click', toggleApiKeyVisibility);
  
  // Chat management
  document.getElementById('new-chat-btn').addEventListener('click', createNewChat);
  
  // Label input
  document.getElementById('chat-label-input').addEventListener('input', (e) => {
    const chat = chats[activeChatId];
    if (chat) {
      chat.label = e.target.value.trim() || 'new';
      chat.updatedAt = Date.now();
      scheduleSave();
      renderChatTabs();
    }
  });
  
  // Task input
  document.getElementById('task-input').addEventListener('input', (e) => {
    const chat = chats[activeChatId];
    if (chat) {
      chat.task = e.target.value;
      chat.updatedAt = Date.now();
      scheduleSave();
    }
  });
  
  // Project select
  document.getElementById('project-select').addEventListener('change', (e) => {
    if (e.target.value === '__new__') {
      openProjectModal();
      e.target.value = chats[activeChatId]?.projectId || '';
      return;
    }
    const chat = chats[activeChatId];
    if (chat) {
      chat.projectId = e.target.value || null;
      chat.updatedAt = Date.now();
      scheduleSave();
      updateGitUI();
    }
  });
  
  document.getElementById('edit-project-btn').addEventListener('click', () => {
    const chat = chats[activeChatId];
    if (chat?.projectId && projects[chat.projectId]) {
      openProjectModal(chat.projectId);
    } else {
      openProjectModal();
    }
  });
  
  // Git actions
  document.getElementById('git-pull-btn').addEventListener('click', gitPull);
  document.getElementById('git-push-btn').addEventListener('click', gitPush);
  
  // Send / Clear
  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('commander-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  });
  document.getElementById('clear-chat-btn').addEventListener('click', clearChat);
  
  // Project modal
  document.getElementById('project-modal-save').addEventListener('click', saveProjectModal);
  document.getElementById('project-modal-cancel').addEventListener('click', closeProjectModal);
  document.getElementById('project-modal-delete').addEventListener('click', deleteProjectModal);
  document.getElementById('project-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'project-modal-overlay') closeProjectModal();
  });
  document.getElementById('project-browse-btn').addEventListener('click', browseProjectFolder);
}

// ============================================
// PROJECT MODAL
// ============================================

let editingProjectId = null;

function openProjectModal(projectId = null) {
  editingProjectId = projectId;
  const modal = document.getElementById('project-modal-overlay');
  const title = document.getElementById('project-modal-title');
  const deleteBtn = document.getElementById('project-modal-delete');
  
  if (projectId && projects[projectId]) {
    const p = projects[projectId];
    title.textContent = 'Edit Project';
    document.getElementById('project-name-input').value = p.name || '';
    document.getElementById('project-path-input').value = p.localPath || '';
    document.getElementById('project-repo-input').value = p.repo || '';
    document.getElementById('project-stack-input').value = p.stack || '';
    document.getElementById('project-files-input').value = p.keyFiles || '';
    deleteBtn.style.display = 'block';
  } else {
    title.textContent = 'New Project';
    document.getElementById('project-name-input').value = '';
    document.getElementById('project-path-input').value = '';
    document.getElementById('project-repo-input').value = '';
    document.getElementById('project-stack-input').value = '';
    document.getElementById('project-files-input').value = '';
    deleteBtn.style.display = 'none';
  }
  
  modal.classList.remove('hidden');
  document.getElementById('project-name-input').focus();
}

function closeProjectModal() {
  document.getElementById('project-modal-overlay').classList.add('hidden');
  editingProjectId = null;
}

async function browseProjectFolder() {
  const path = await window.outerRim.project.browse();
  if (path) {
    document.getElementById('project-path-input').value = path;
  }
}

function saveProjectModal() {
  const config = {
    name: document.getElementById('project-name-input').value.trim(),
    localPath: document.getElementById('project-path-input').value.trim(),
    repo: document.getElementById('project-repo-input').value.trim(),
    stack: document.getElementById('project-stack-input').value.trim(),
    keyFiles: document.getElementById('project-files-input').value.trim()
  };
  
  if (!config.name) { alert('Project name is required'); return; }
  
  if (editingProjectId) {
    updateProject(editingProjectId, config);
  } else {
    const project = createProject(config);
    const chat = chats[activeChatId];
    if (chat) {
      chat.projectId = project.id;
      scheduleSave();
    }
  }
  
  closeProjectModal();
  loadActiveChat();
}

function deleteProjectModal() {
  if (!editingProjectId) return;
  if (!confirm('Delete this project?')) return;
  deleteProject(editingProjectId);
  closeProjectModal();
}

// ============================================
// INIT
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initCommander, 100);
});
