// ============================================
// CLAUDE COMMANDER - AI Chat Panel
// Persistent memory, multiple chats, tool use
// ============================================

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

// In-memory state (fast access)
let chats = {};           // chatId -> chat object
let projects = {};        // projectId -> project config
let activeChatId = null;
let apiKey = null;

// Debounce timer for auto-save
let saveTimeout = null;

// ============================================
// INITIALIZATION
// ============================================

async function initCommander() {
  // Load from disk via IPC
  const data = await window.outerRim.commander.load();
  chats = data.chats || {};
  projects = data.projects || {};
  activeChatId = data.activeChatId || null;
  apiKey = data.apiKey || null;
  
  // If no chats, create a default one
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
    // Show masked version
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
    // If showing masked, show full key
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
  
  // Ignore if it's the masked value
  if (e.target.dataset.masked === 'true' && value.includes('...')) {
    return;
  }
  
  // Clear masking state on real input
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
  const settings = document.getElementById('commander-settings');
  settings.classList.toggle('hidden');
}

// ============================================
// DATA STRUCTURES
// ============================================

// Chat structure:
// {
//   id: string,
//   name: string,
//   projectId: string | null,
//   task: string,
//   messages: [{ role: 'user'|'assistant', content: string }],
//   changelog: [{ ts: number, summary: string }],
//   createdAt: number,
//   updatedAt: number
// }

// Project structure:
// {
//   id: string,
//   name: string,
//   repo: string,
//   stack: string,
//   keyFiles: string
// }

// ============================================
// CHAT MANAGEMENT
// ============================================

function createNewChat() {
  const id = crypto.randomUUID();
  const chat = {
    id,
    name: 'New Chat',
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
  if (!confirm('Delete this chat?')) return;
  delete chats[chatId];
  
  if (activeChatId === chatId) {
    const remaining = Object.keys(chats);
    activeChatId = remaining[0] || null;
    if (!activeChatId) createNewChat();
  }
  
  scheduleSave();
  renderChatTabs();
  loadActiveChat();
}

function renameChat(chatId, name) {
  if (chats[chatId]) {
    chats[chatId].name = name;
    chats[chatId].updatedAt = Date.now();
    scheduleSave();
    renderChatTabs();
  }
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
  }
}

function deleteProject(id) {
  delete projects[id];
  // Clear project from any chats using it
  Object.values(chats).forEach(chat => {
    if (chat.projectId === id) chat.projectId = null;
  });
  scheduleSave();
  renderProjectSelect();
  loadActiveChat();
}

// ============================================
// PERSISTENCE
// ============================================

function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    window.outerRim.commander.save({
      chats,
      projects,
      activeChatId,
      apiKey
    });
  }, 1000);
}

function saveNow() {
  clearTimeout(saveTimeout);
  window.outerRim.commander.save({
    chats,
    projects,
    activeChatId,
    apiKey
  });
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
    
    const name = document.createElement('span');
    name.className = 'chat-tab-name';
    name.textContent = chat.name || 'Untitled';
    name.addEventListener('dblclick', () => {
      const newName = prompt('Rename chat:', chat.name);
      if (newName) renameChat(chat.id, newName);
    });
    
    const close = document.createElement('button');
    close.className = 'chat-tab-close';
    close.textContent = '×';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    });
    
    tab.appendChild(name);
    tab.appendChild(close);
    tab.addEventListener('click', () => switchChat(chat.id));
    container.appendChild(tab);
  });
}

function renderProjectSelect() {
  const select = document.getElementById('project-select');
  const currentValue = select.value;
  
  select.innerHTML = '<option value="">Select Project...</option>';
  Object.values(projects).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  select.innerHTML += '<option value="__new__">+ New Project...</option>';
  
  // Restore selection
  const chat = chats[activeChatId];
  if (chat?.projectId && projects[chat.projectId]) {
    select.value = chat.projectId;
  } else {
    select.value = '';
  }
}

function loadActiveChat() {
  const chat = chats[activeChatId];
  if (!chat) return;
  
  // Update task input
  document.getElementById('task-input').value = chat.task || '';
  
  // Update project select
  const select = document.getElementById('project-select');
  select.value = chat.projectId || '';
  
  // Render messages
  renderMessages();
}

function renderMessages() {
  const container = document.getElementById('commander-messages');
  const chat = chats[activeChatId];
  if (!chat) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = '';
  
  // Show changelog at top if exists
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
  
  // Render messages
  chat.messages.forEach((msg, idx) => {
    const div = document.createElement('div');
    div.className = `commander-message ${msg.role}`;
    
    // Parse content - could be string or array
    let content = '';
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.map(block => {
        if (block.type === 'text') return block.text;
        if (block.type === 'tool_use') return `🔧 Using tool: ${block.name}`;
        if (block.type === 'tool_result') return `📋 Tool result`;
        return '';
      }).join('\n');
    }
    
    div.innerHTML = `<div class="message-content">${formatMessage(content)}</div>`;
    container.appendChild(div);
  });
  
  container.scrollTop = container.scrollHeight;
}

function formatMessage(text) {
  // Basic markdown-ish formatting
  let html = escapeHtml(text);
  
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
  
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Line breaks
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
  
  // Project context
  const project = projects[chat.projectId];
  if (project) {
    prompt += `## Project: ${project.name}\n`;
    if (project.repo) prompt += `Repo: ${project.repo}\n`;
    if (project.stack) prompt += `Stack: ${project.stack}\n`;
    if (project.keyFiles) prompt += `Key files:\n${project.keyFiles}\n`;
    prompt += '\n';
  }
  
  // Changelog
  if (chat.changelog.length > 0) {
    prompt += '## Recent Work\n';
    chat.changelog.slice(0, 10).forEach(entry => {
      const date = new Date(entry.ts).toLocaleDateString();
      prompt += `- [${date}] ${entry.summary}\n`;
    });
    prompt += '\n';
  }
  
  // Current task
  if (chat.task) {
    prompt += `## Current Task\n${chat.task}\n\n`;
  }
  
  prompt += `You are Claude, an AI assistant helping with software development. Be concise and direct. When reading files, request specific line ranges when possible to save context.`;
  
  return prompt;
}

async function sendMessage() {
  const input = document.getElementById('commander-input');
  const message = input.value.trim();
  if (!message) return;
  
  if (!apiKey) {
    // Open settings and focus the API key input
    document.getElementById('commander-settings').classList.remove('hidden');
    document.getElementById('api-key-input').focus();
    return;
  }
  
  const chat = chats[activeChatId];
  if (!chat) return;
  
  // Add user message
  chat.messages.push({ role: 'user', content: message });
  chat.updatedAt = Date.now();
  input.value = '';
  renderMessages();
  scheduleSave();
  
  // Auto-name chat from first message
  if (chat.name === 'New Chat' && chat.messages.length === 1) {
    chat.name = message.slice(0, 30) + (message.length > 30 ? '...' : '');
    renderChatTabs();
  }
  
  // Show loading
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
        messages: chat.messages.map(m => ({
          role: m.role,
          content: m.content
        }))
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    // Extract text content
    let assistantContent = '';
    if (data.content) {
      assistantContent = data.content.map(block => {
        if (block.type === 'text') return block.text;
        return '';
      }).join('');
    }
    
    // Add assistant message
    chat.messages.push({ role: 'assistant', content: assistantContent });
    chat.updatedAt = Date.now();
    scheduleSave();
    
  } catch (error) {
    console.error('API Error:', error);
    chat.messages.push({ 
      role: 'assistant', 
      content: `Error: ${error.message}` 
    });
  }
  
  loadingDiv.remove();
  renderMessages();
}

// ============================================
// CLEAR & SUMMARIZE
// ============================================

async function clearChat() {
  const chat = chats[activeChatId];
  if (!chat || chat.messages.length === 0) return;
  
  if (!apiKey) {
    // Just clear without summary
    chat.messages = [];
    chat.updatedAt = Date.now();
    scheduleSave();
    renderMessages();
    return;
  }
  
  // Show loading
  const container = document.getElementById('commander-messages');
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'commander-message assistant loading';
  loadingDiv.innerHTML = '<div class="message-content">Summarizing...</div>';
  container.appendChild(loadingDiv);
  
  // Ask Claude to summarize
  const summaryPrompt = `Summarize what was accomplished in this conversation in 1-2 sentences. Focus on what was built, fixed, or changed. Be specific about file names and functions when relevant. Start directly with the summary, no preamble.`;
  
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
          { role: 'user', content: summaryPrompt }
        ]
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const summary = data.content?.[0]?.text || 'Work completed';
      
      // Add to changelog
      chat.changelog.unshift({
        ts: Date.now(),
        summary: summary.trim()
      });
      
      // Keep only last 20 entries
      chat.changelog = chat.changelog.slice(0, 20);
    }
  } catch (e) {
    console.error('Summary error:', e);
  }
  
  loadingDiv.remove();
  
  // Clear messages
  chat.messages = [];
  chat.updatedAt = Date.now();
  scheduleSave();
  renderMessages();
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupCommanderListeners() {
  // Toggle panel
  document.getElementById('commander-toggle').addEventListener('click', toggleCommander);
  document.getElementById('commander-close').addEventListener('click', toggleCommander);
  
  // Settings
  document.getElementById('commander-settings-btn').addEventListener('click', toggleSettings);
  document.getElementById('api-key-input').addEventListener('input', handleApiKeyInput);
  document.getElementById('api-key-input').addEventListener('focus', (e) => {
    // Clear masked value on focus so user can paste
    if (e.target.dataset.masked === 'true') {
      e.target.value = '';
      e.target.dataset.masked = 'false';
    }
  });
  document.getElementById('api-key-toggle').addEventListener('click', toggleApiKeyVisibility);
  
  // New chat
  document.getElementById('new-chat-btn').addEventListener('click', createNewChat);
  
  // Send message
  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('commander-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // Clear chat
  document.getElementById('clear-chat-btn').addEventListener('click', clearChat);
  
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
    const value = e.target.value;
    
    if (value === '__new__') {
      openProjectModal();
      e.target.value = chats[activeChatId]?.projectId || '';
      return;
    }
    
    const chat = chats[activeChatId];
    if (chat) {
      chat.projectId = value || null;
      chat.updatedAt = Date.now();
      scheduleSave();
    }
  });
  
  // Edit project button
  document.getElementById('edit-project-btn').addEventListener('click', () => {
    const chat = chats[activeChatId];
    if (chat?.projectId && projects[chat.projectId]) {
      openProjectModal(chat.projectId);
    } else {
      openProjectModal();
    }
  });
  
  // Project modal
  document.getElementById('project-modal-save').addEventListener('click', saveProjectModal);
  document.getElementById('project-modal-cancel').addEventListener('click', closeProjectModal);
  document.getElementById('project-modal-delete').addEventListener('click', deleteProjectModal);
  document.getElementById('project-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'project-modal-overlay') closeProjectModal();
  });
  
  // Keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      toggleCommander();
    }
  });
}

function toggleCommander() {
  const panel = document.getElementById('commander-panel');
  panel.classList.toggle('collapsed');
  
  if (!panel.classList.contains('collapsed')) {
    document.getElementById('commander-input').focus();
  }
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
    document.getElementById('project-repo-input').value = p.repo || '';
    document.getElementById('project-stack-input').value = p.stack || '';
    document.getElementById('project-files-input').value = p.keyFiles || '';
    deleteBtn.style.display = 'block';
  } else {
    title.textContent = 'New Project';
    document.getElementById('project-name-input').value = '';
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

function saveProjectModal() {
  const config = {
    name: document.getElementById('project-name-input').value.trim(),
    repo: document.getElementById('project-repo-input').value.trim(),
    stack: document.getElementById('project-stack-input').value.trim(),
    keyFiles: document.getElementById('project-files-input').value.trim()
  };
  
  if (!config.name) {
    alert('Project name is required');
    return;
  }
  
  if (editingProjectId) {
    updateProject(editingProjectId, config);
  } else {
    const project = createProject(config);
    // Assign to current chat
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
  if (!confirm('Delete this project? Chats will keep their changelog.')) return;
  
  deleteProject(editingProjectId);
  closeProjectModal();
}

// ============================================
// INIT ON LOAD
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Small delay to ensure main app initializes first
  setTimeout(initCommander, 100);
});
