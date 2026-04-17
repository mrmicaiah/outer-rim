// ============================================
// CLAUDE COMMANDER - Left Pane Chat Interface
// Persistent memory, multiple chats, projects
// Local file operations + Git push/pull
// Auto-generates commit messages from diff
// ============================================

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

let chats = {};
let projects = {};
let activeChatId = null;
let apiKey = null;
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
  
  checkGitStatus();
  gitStatusInterval = setInterval(checkGitStatus, 10000);
}

// ============================================
// API KEY MANAGEMENT
// ============================================

function updateApiKeyStatus() {
  const status = document.getElementById('api-key-status');
  const input = document.getElementById('api-key-input');
  
  if (apiKey) {
    status.textContent = '\u2713 API key saved';
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
    btn.textContent = '\ud83d\ude48';
    if (input.dataset.masked === 'true' && apiKey) input.value = apiKey;
  } else {
    input.type = 'password';
    btn.textContent = '\ud83d\udc41';
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
  const chat = { id, label: 'new', projectId: null, task: '', messages: [], changelog: [], createdAt: Date.now(), updatedAt: Date.now() };
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
  checkGitStatus();
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
  }
}

function deleteProject(id) {
  delete projects[id];
  Object.values(chats).forEach(chat => { if (chat.projectId === id) chat.projectId = null; });
  scheduleSave();
  renderProjectSelect();
  loadActiveChat();
}

function getActiveProject() {
  const chat = chats[activeChatId];
  return chat?.projectId ? projects[chat.projectId] : null;
}

// ============================================
// GIT OPERATIONS
// ============================================

async function checkGitStatus() {
  const project = getActiveProject();
  const indicator = document.getElementById('git-status-indicator');
  const controls = document.getElementById('git-controls');
  const statusText = document.getElementById('git-status-text');
  
  if (!project?.localPath) {
    indicator.className = 'git-status';
    indicator.textContent = '';
    indicator.title = 'No project';
    controls.classList.add('hidden');
    return;
  }
  
  controls.classList.remove('hidden');
  
  try {
    const result = await window.outerRim.git.status(project.localPath);
    if (result.success) {
      if (result.hasChanges) {
        indicator.className = 'git-status has-changes';
        indicator.textContent = '\u25cf';
        indicator.title = `${result.changes.length} uncommitted change(s)`;
        statusText.textContent = `${result.changes.length} file(s) changed`;
        statusText.className = 'git-status-text has-changes';
      } else {
        indicator.className = 'git-status clean';
        indicator.textContent = '\u2713';
        indicator.title = 'Working tree clean';
        statusText.textContent = 'Clean';
        statusText.className = 'git-status-text clean';
      }
    } else {
      indicator.className = 'git-status error';
      indicator.textContent = '!';
      indicator.title = result.error;
      statusText.textContent = 'Not a git repo';
      statusText.className = 'git-status-text error';
    }
  } catch (err) {
    indicator.className = 'git-status error';
    indicator.textContent = '!';
    indicator.title = err.message;
  }
}

async function generateCommitMessage(projectPath) {
  if (!apiKey) return null;
  
  try {
    // Get git diff --stat for a summary of changes
    const diffResult = await window.outerRim.terminal.run(`cd "${projectPath}" && git diff --stat HEAD 2>/dev/null || git diff --stat 2>/dev/null`);
    const diff = diffResult.stdout || '';
    
    if (!diff.trim()) {
      // Try staged changes
      const stagedResult = await window.outerRim.terminal.run(`cd "${projectPath}" && git diff --stat --cached 2>/dev/null`);
      if (!stagedResult.stdout?.trim()) return 'Update files';
    }
    
    // Also get the actual diff for context (limited)
    const fullDiffResult = await window.outerRim.terminal.run(`cd "${projectPath}" && git diff HEAD --no-color 2>/dev/null | head -200`);
    const fullDiff = fullDiffResult.stdout || '';
    
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
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `Generate a concise git commit message (max 72 chars) for these changes. Use conventional commit format (feat:, fix:, refactor:, style:, docs:, etc). No quotes, no explanation, just the message.

Diff summary:
${diff}

Changes:
${fullDiff.slice(0, 3000)}`
        }]
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      let message = data.content?.[0]?.text?.trim() || 'Update files';
      // Clean up the message
      message = message.replace(/^["']|["']$/g, '').trim();
      if (message.length > 72) message = message.slice(0, 69) + '...';
      return message;
    }
  } catch (err) {
    console.error('Failed to generate commit message:', err);
  }
  
  return null;
}

async function gitPush() {
  const project = getActiveProject();
  if (!project?.localPath) return;
  
  const messageInput = document.getElementById('commit-message');
  let message = messageInput.value.trim();
  const pushBtn = document.getElementById('git-push-btn');
  const statusText = document.getElementById('git-status-text');
  
  pushBtn.disabled = true;
  
  // If no message, auto-generate one
  if (!message) {
    pushBtn.textContent = 'Generating...';
    statusText.textContent = 'Generating commit message...';
    
    const generated = await generateCommitMessage(project.localPath);
    if (generated) {
      message = generated;
      messageInput.value = message; // Show what we generated
    } else {
      message = 'Update from Outer Rim';
    }
  }
  
  pushBtn.textContent = 'Pushing...';
  statusText.textContent = 'Pushing...';
  
  try {
    const result = await window.outerRim.git.push(project.localPath, message);
    if (result.success) {
      statusText.textContent = '\u2713 Pushed!';
      statusText.className = 'git-status-text clean';
      messageInput.value = '';
      setTimeout(checkGitStatus, 1000);
    } else {
      statusText.textContent = 'Push failed';
      statusText.className = 'git-status-text error';
      alert('Push failed: ' + result.error);
    }
  } catch (err) {
    statusText.textContent = 'Push failed';
    alert('Push error: ' + err.message);
  } finally {
    pushBtn.disabled = false;
    pushBtn.textContent = 'Push';
  }
}

async function gitPull() {
  const project = getActiveProject();
  if (!project?.localPath) return;
  
  const pullBtn = document.getElementById('git-pull-btn');
  const statusText = document.getElementById('git-status-text');
  
  pullBtn.disabled = true;
  pullBtn.textContent = 'Pulling...';
  statusText.textContent = 'Pulling...';
  
  try {
    const result = await window.outerRim.git.pull(project.localPath);
    if (result.success) {
      statusText.textContent = '\u2713 Pulled!';
      statusText.className = 'git-status-text clean';
      setTimeout(checkGitStatus, 1000);
    } else {
      statusText.textContent = 'Pull failed';
      statusText.className = 'git-status-text error';
      alert('Pull failed: ' + result.error);
    }
  } catch (err) {
    statusText.textContent = 'Pull failed';
    alert('Pull error: ' + err.message);
  } finally {
    pullBtn.disabled = false;
    pullBtn.textContent = 'Pull';
  }
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
    close.textContent = '\u00d7';
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
  checkGitStatus();
}

function renderMessages() {
  const container = document.getElementById('commander-messages');
  const chat = chats[activeChatId];
  if (!chat) { container.innerHTML = ''; return; }
  
  container.innerHTML = '';
  
  if (chat.changelog.length > 0) {
    const logDiv = document.createElement('div');
    logDiv.className = 'commander-changelog';
    logDiv.innerHTML = '<div class="changelog-header">\ud83d\udcdc Previous Work</div>';
    chat.changelog.slice(0, 10).forEach(entry => {
      const item = document.createElement('div');
      item.className = 'changelog-item';
      item.innerHTML = `<span class="changelog-time">${new Date(entry.ts).toLocaleString()}</span> ${escapeHtml(entry.summary)}`;
      logDiv.appendChild(item);
    });
    container.appendChild(logDiv);
  }
  
  chat.messages.forEach(msg => {
    const div = document.createElement('div');
    div.className = `commander-message ${msg.role}`;
    let content = typeof msg.content === 'string' ? msg.content : msg.content.map(b => b.type === 'text' ? b.text : '').join('\n');
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
    if (project.localPath) prompt += `Path: ${project.localPath}\n`;
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
  
  if (chat.task) prompt += `## Current Task\n${chat.task}\n\n`;
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
  document.getElementById('commander-settings-btn').addEventListener('click', toggleSettings);
  document.getElementById('api-key-input').addEventListener('input', handleApiKeyInput);
  document.getElementById('api-key-input').addEventListener('focus', (e) => {
    if (e.target.dataset.masked === 'true') { e.target.value = ''; e.target.dataset.masked = 'false'; }
  });
  document.getElementById('api-key-toggle').addEventListener('click', toggleApiKeyVisibility);
  
  document.getElementById('new-chat-btn').addEventListener('click', createNewChat);
  
  document.getElementById('chat-label-input').addEventListener('input', (e) => {
    const chat = chats[activeChatId];
    if (chat) { chat.label = e.target.value.trim() || 'new'; chat.updatedAt = Date.now(); scheduleSave(); renderChatTabs(); }
  });
  
  document.getElementById('task-input').addEventListener('input', (e) => {
    const chat = chats[activeChatId];
    if (chat) { chat.task = e.target.value; chat.updatedAt = Date.now(); scheduleSave(); }
  });
  
  document.getElementById('project-select').addEventListener('change', (e) => {
    if (e.target.value === '__new__') { openProjectModal(); e.target.value = chats[activeChatId]?.projectId || ''; return; }
    const chat = chats[activeChatId];
    if (chat) { chat.projectId = e.target.value || null; chat.updatedAt = Date.now(); scheduleSave(); checkGitStatus(); }
  });
  
  document.getElementById('edit-project-btn').addEventListener('click', () => {
    const chat = chats[activeChatId];
    openProjectModal(chat?.projectId && projects[chat.projectId] ? chat.projectId : null);
  });
  
  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('commander-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage(); }
  });
  document.getElementById('clear-chat-btn').addEventListener('click', clearChat);
  
  // Git controls
  document.getElementById('git-push-btn').addEventListener('click', gitPush);
  document.getElementById('git-pull-btn').addEventListener('click', gitPull);
  
  // Project modal
  document.getElementById('project-modal-save').addEventListener('click', saveProjectModal);
  document.getElementById('project-modal-cancel').addEventListener('click', closeProjectModal);
  document.getElementById('project-modal-delete').addEventListener('click', deleteProjectModal);
  document.getElementById('project-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'project-modal-overlay') closeProjectModal();
  });
  
  // Browse button with error handling
  document.getElementById('project-browse-btn').addEventListener('click', async () => {
    try {
      console.log('Browse button clicked');
      const selectedPath = await window.outerRim.project.browse();
      console.log('Selected path:', selectedPath);
      if (selectedPath) {
        document.getElementById('project-path-input').value = selectedPath;
      }
    } catch (err) {
      console.error('Browse error:', err);
      alert('Failed to open folder picker: ' + err.message);
    }
  });
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
    if (chat) { chat.projectId = project.id; scheduleSave(); }
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

document.addEventListener('DOMContentLoaded', () => setTimeout(initCommander, 100));
