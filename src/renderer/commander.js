// ============================================
// CLAUDE COMMANDER - Left Pane Chat Interface
// Agent SDK edition — the SDK runs in the main process; this file
// only sends prompts and renders streamed SDKMessages.
// ============================================

let chats = {};
let projects = {};
let activeChatId = null;
let apiKey = null;
let saveTimeout = null;
let gitStatusInterval = null;

// Per-chat runtime state for an in-flight turn:
//   running: boolean — is a turn currently executing for this chat
//   loadingEl: HTMLElement | null — the "Thinking…" placeholder we swap out
//   toolCards: Map<tool_use_id, HTMLElement> — for matching tool_result → tool_use
const chatRuntime = new Map();

function getRuntime(chatId) {
  if (!chatRuntime.has(chatId)) {
    chatRuntime.set(chatId, { running: false, loadingEl: null, toolCards: new Map() });
  }
  return chatRuntime.get(chatId);
}

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
  setupAgentListeners();

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
    if (input.dataset.masked === 'true' && apiKey) input.value = apiKey;
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
    sessionId: null, // NEW: Agent SDK session continuity
    createdAt: Date.now(),
    updatedAt: Date.now(),
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
  checkGitStatus();
}

function deleteChat(chatId) {
  if (Object.keys(chats).length <= 1) { alert('Cannot delete the last chat'); return; }
  if (!confirm('Delete this chat?')) return;
  // If there's a running turn for this chat, try to cancel it first.
  const rt = chatRuntime.get(chatId);
  if (rt?.running) window.outerRim.agent.cancel(chatId).catch(() => {});
  chatRuntime.delete(chatId);
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
// GIT OPERATIONS (unchanged)
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
        indicator.textContent = '●';
        indicator.title = `${result.changes.length} uncommitted change(s)`;
        statusText.textContent = `${result.changes.length} file(s) changed`;
        statusText.className = 'git-status-text has-changes';
      } else {
        indicator.className = 'git-status clean';
        indicator.textContent = '✓';
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

// Commit message generation still calls the Anthropic API directly via
// the browser. It's a one-shot, non-agentic call with no tool loop, so the
// rate-limit concerns that drove this rewrite don't apply here.
async function generateCommitMessage(projectPath) {
  if (!apiKey) return null;

  try {
    const diffResult = await window.outerRim.terminal.run(
      `cd "${projectPath}" && git diff --stat HEAD 2>/dev/null || git diff --stat 2>/dev/null`
    );
    const diff = diffResult.stdout || '';

    if (!diff.trim()) {
      const stagedResult = await window.outerRim.terminal.run(
        `cd "${projectPath}" && git diff --stat --cached 2>/dev/null`
      );
      if (!stagedResult.stdout?.trim()) return 'Update files';
    }

    const fullDiffResult = await window.outerRim.terminal.run(
      `cd "${projectPath}" && git diff HEAD --no-color 2>/dev/null | head -200`
    );
    const fullDiff = fullDiffResult.stdout || '';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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

  if (!message) {
    pushBtn.textContent = 'Generating...';
    statusText.textContent = 'Generating commit message...';

    const generated = await generateCommitMessage(project.localPath);
    if (generated) {
      message = generated;
      messageInput.value = message;
    } else {
      message = 'Update from Outer Rim';
    }
  }

  pushBtn.textContent = 'Pushing...';
  statusText.textContent = 'Pushing...';

  try {
    const result = await window.outerRim.git.push(project.localPath, message);
    if (result.success) {
      statusText.textContent = '✓ Pushed!';
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
      statusText.textContent = '✓ Pulled!';
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
  checkGitStatus();

  // Reflect whether a turn is in flight for this chat.
  const rt = getRuntime(activeChatId);
  const sendBtn = document.getElementById('send-btn');
  sendBtn.textContent = rt.running ? 'Cancel' : 'Send';
}

function renderMessages() {
  const container = document.getElementById('commander-messages');
  const chat = chats[activeChatId];
  if (!chat) { container.innerHTML = ''; return; }

  container.innerHTML = '';

  if (chat.changelog.length > 0) {
    const logDiv = document.createElement('div');
    logDiv.className = 'commander-changelog';
    logDiv.innerHTML = '<div class="changelog-header">📜 Previous Work</div>';
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

    if (msg.role === 'assistant' && msg.toolCalls) {
      let html = '';
      msg.toolCalls.forEach(tc => {
        html += `<div class="tool-call"><span class="tool-name">🔧 ${escapeHtml(tc.name)}</span>`;
        if (tc.input?.file_path !== undefined) html += `<span class="tool-path">${escapeHtml(tc.input.file_path)}</span>`;
        else if (tc.input?.path !== undefined) html += `<span class="tool-path">${escapeHtml(tc.input.path || '.')}</span>`;
        else if (tc.input?.pattern !== undefined) html += `<span class="tool-path">${escapeHtml(tc.input.pattern)}</span>`;
        html += '</div>';
      });
      if (msg.content) {
        html += `<div class="message-content">${formatMessage(msg.content)}</div>`;
      }
      div.innerHTML = html;
    } else {
      const content = typeof msg.content === 'string'
        ? msg.content
        : (Array.isArray(msg.content) ? msg.content.map(b => b.type === 'text' ? b.text : '').join('\n') : '');
      div.innerHTML = `<div class="message-content">${formatMessage(content)}</div>`;
    }

    container.appendChild(div);
  });

  container.scrollTop = container.scrollHeight;
}

function formatMessage(text) {
  if (!text) return '';
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
// AUTO-EXPAND TEXTAREA
// ============================================

function autoExpandTextarea(textarea) {
  textarea.style.height = 'auto';
  const maxHeight = 200;
  const newHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = newHeight + 'px';
}

// ============================================
// AGENT INTERACTION (via IPC → main process SDK)
// ============================================

async function sendMessage() {
  const sendBtn = document.getElementById('send-btn');
  const rt = getRuntime(activeChatId);

  // Send button doubles as Cancel while a turn is running.
  if (rt.running) {
    await window.outerRim.agent.cancel(activeChatId);
    return;
  }

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

  const project = getActiveProject();
  if (!project?.localPath) {
    alert('Select a project with a local path first (⚙ next to project selector).');
    return;
  }

  // Add the user message locally and save.
  chat.messages.push({ role: 'user', content: message });
  chat.updatedAt = Date.now();
  input.value = '';
  input.style.height = 'auto';
  renderMessages();
  scheduleSave();

  // Drop a "Thinking..." placeholder we'll replace on first assistant message.
  const container = document.getElementById('commander-messages');
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'commander-message assistant loading';
  loadingDiv.innerHTML = '<div class="message-content">Thinking...</div>';
  container.appendChild(loadingDiv);
  container.scrollTop = container.scrollHeight;

  rt.running = true;
  rt.loadingEl = loadingDiv;
  rt.toolCards = new Map();
  sendBtn.textContent = 'Cancel';

  const res = await window.outerRim.agent.start({
    chatId: chat.id,
    prompt: message,
    sessionId: chat.sessionId || null,
    projectPath: project.localPath,
    apiKey,
    task: chat.task || '',
  });

  if (!res.ok) {
    loadingDiv.remove();
    chat.messages.push({ role: 'assistant', content: `Error: ${res.error}` });
    chat.updatedAt = Date.now();
    rt.running = false;
    rt.loadingEl = null;
    sendBtn.textContent = 'Send';
    scheduleSave();
    renderMessages();
  }
  // Otherwise messages flow in through setupAgentListeners().
}

// Translate streamed SDKMessages into our local chat.messages shape and
// update the DOM live.
function setupAgentListeners() {
  window.outerRim.agent.onMessage(({ chatId, msg }) => {
    const chat = chats[chatId];
    if (!chat) return;
    const rt = getRuntime(chatId);
    const isActive = chatId === activeChatId;

    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          // Capture the SDK session id so we can resume this chat later.
          chat.sessionId = msg.session_id;
          scheduleSave();
        } else if (msg.subtype === 'compact_boundary' && isActive) {
          const marker = document.createElement('div');
          marker.className = 'commander-message system';
          marker.innerHTML = '<div class="message-content" style="opacity:.6;font-style:italic">— earlier turns compacted —</div>';
          document.getElementById('commander-messages').appendChild(marker);
        }
        break;

      case 'assistant': {
        // Remove the "Thinking..." placeholder on the first assistant chunk.
        if (rt.loadingEl) { rt.loadingEl.remove(); rt.loadingEl = null; }

        // msg.message.content is an array of content blocks.
        const blocks = msg.message?.content || [];
        const textParts = [];
        const toolCalls = [];

        for (const block of blocks) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolCalls.push({ id: block.id, name: block.name, input: block.input });
          }
          // 'thinking' blocks are not rendered to keep the UI calm.
        }

        const assistantMsg = {
          role: 'assistant',
          content: textParts.join('\n'),
          toolCalls: toolCalls.length ? toolCalls.map(t => ({ name: t.name, input: t.input })) : undefined,
        };
        chat.messages.push(assistantMsg);
        chat.updatedAt = Date.now();
        scheduleSave();

        if (isActive) {
          renderMessages();

          // Track tool cards by id so a later tool_result can update them.
          // renderMessages() just rewrote the DOM, so we grab the new nodes.
          const messagesEl = document.getElementById('commander-messages');
          const lastMsg = messagesEl.lastElementChild;
          if (lastMsg && toolCalls.length) {
            const toolNodes = lastMsg.querySelectorAll('.tool-call');
            toolCalls.forEach((tc, i) => {
              if (toolNodes[i]) rt.toolCards.set(tc.id, toolNodes[i]);
            });
          }
        }
        break;
      }

      case 'user': {
        // Tool results come back as user messages in the SDK stream. We
        // use them to mark the matching tool card done (or errored).
        for (const block of msg.message?.content || []) {
          if (block.type === 'tool_result') {
            const card = rt.toolCards.get(block.tool_use_id);
            if (card) {
              card.classList.add(block.is_error ? 'tool-error' : 'tool-done');
            }
          }
        }
        break;
      }

      // result handled via onDone below.
      default:
        break;
    }
  });

  window.outerRim.agent.onDone(({ chatId, sessionId, subtype, totalCostUsd, numTurns, errors }) => {
    const chat = chats[chatId];
    if (!chat) return;
    const rt = getRuntime(chatId);

    chat.sessionId = sessionId || chat.sessionId;
    if (rt.loadingEl) { rt.loadingEl.remove(); rt.loadingEl = null; }

    if (subtype !== 'success') {
      // Non-success subtypes: error_max_turns, error_max_budget_usd, error_during_execution, error_max_structured_output_retries
      const reason = subtype.replace('error_', '').replace(/_/g, ' ');
      chat.messages.push({
        role: 'assistant',
        content: `⚠ Stopped: ${reason}${errors?.length ? '\n' + errors.join('\n') : ''} · $${(totalCostUsd ?? 0).toFixed(4)} · ${numTurns} turns`,
      });
    }
    chat.updatedAt = Date.now();
    scheduleSave();

    rt.running = false;
    if (chatId === activeChatId) {
      document.getElementById('send-btn').textContent = 'Send';
      renderMessages();
      setTimeout(checkGitStatus, 500); // pick up any file changes
    }
  });

  window.outerRim.agent.onError(({ chatId, message }) => {
    const chat = chats[chatId];
    if (!chat) return;
    const rt = getRuntime(chatId);

    if (rt.loadingEl) { rt.loadingEl.remove(); rt.loadingEl = null; }
    chat.messages.push({ role: 'assistant', content: `Error: ${message}` });
    chat.updatedAt = Date.now();
    scheduleSave();

    rt.running = false;
    if (chatId === activeChatId) {
      document.getElementById('send-btn').textContent = 'Send';
      renderMessages();
    }
  });
}

async function clearChat() {
  const chat = chats[activeChatId];
  if (!chat || chat.messages.length === 0) return;

  if (apiKey && chat.messages.length > 1) {
    const container = document.getElementById('commander-messages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'commander-message assistant loading';
    loadingDiv.innerHTML = '<div class="message-content">Summarizing...</div>';
    container.appendChild(loadingDiv);

    try {
      const textMessages = chat.messages
        .filter(m => m.content && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: m.content }));

      if (textMessages.length > 0) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 200,
            messages: [
              ...textMessages,
              { role: 'user', content: 'Summarize what was accomplished in 1-2 sentences. Be specific about files changed. No preamble.' }
            ]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const summary = data.content?.[0]?.text || 'Work completed';
          chat.changelog.unshift({ ts: Date.now(), summary: summary.trim() });
          chat.changelog = chat.changelog.slice(0, 20);
        }
      }
    } catch (e) { console.error('Summary error:', e); }

    loadingDiv.remove();
  }

  chat.messages = [];
  chat.sessionId = null; // new conversation, no SDK session to resume
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

  const commanderInput = document.getElementById('commander-input');

  commanderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        return;
      } else {
        e.preventDefault();
        sendMessage();
      }
    }
  });

  commanderInput.addEventListener('input', () => {
    autoExpandTextarea(commanderInput);
  });

  document.getElementById('clear-chat-btn').addEventListener('click', clearChat);

  document.getElementById('git-push-btn').addEventListener('click', gitPush);
  document.getElementById('git-pull-btn').addEventListener('click', gitPull);

  document.getElementById('project-modal-save').addEventListener('click', saveProjectModal);
  document.getElementById('project-modal-cancel').addEventListener('click', closeProjectModal);
  document.getElementById('project-modal-delete').addEventListener('click', deleteProjectModal);
  document.getElementById('project-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'project-modal-overlay') closeProjectModal();
  });

  document.getElementById('project-browse-btn').addEventListener('click', async () => {
    try {
      const selectedPath = await window.outerRim.project.browse();
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
// PROJECT MODAL (unchanged)
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
