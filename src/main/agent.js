// src/main/agent.js
//
// Claude Agent SDK runner for Claude Commander.
//
// Design notes:
//   * Runs in the Electron main process so it can spawn the SDK subprocess
//     (the SDK spawns Node under the hood) and so the Anthropic API key
//     never lives in the renderer.
//   * Stateless from the main process's point of view: each `agent:start`
//     carries its own { apiKey, projectPath, sessionId } from the renderer,
//     which already tracks active chat/project. The SDK itself handles the
//     tool loop, context compaction, and budget limits.
//   * One active query per chatId at a time. The renderer sends chatId so
//     cancel can target the right chat even if the user has switched tabs.

const { ipcMain } = require('electron');
const fs = require('fs');

let querySdk = null;
try {
  // Lazy-require so the app can still boot and show a clear error if the
  // SDK isn't installed yet (e.g. the user forgot to `npm install`).
  ({ query: querySdk } = require('@anthropic-ai/claude-agent-sdk'));
} catch (err) {
  console.error('[agent] @anthropic-ai/claude-agent-sdk not installed:', err.message);
}

// chatId -> { q, abortController, webContents }
const activeQueries = new Map();

const COMMANDER_SYSTEM_PROMPT = `You are Claude Commander, an elite coding assistant embedded in Outer Rim — a workspace for parallel AI workstreams.

You have tools to read, search, and edit files in the user's current project directory. USE THEM. Don't guess at code — open the relevant files first.

Guidelines:
- Explore with Glob/Grep/Read before answering questions about the codebase.
- Prefer targeted reads over dumping whole trees.
- When you edit a file, say briefly what you changed after the edit lands.
- Be concise. The user already sees every tool call in the UI.`;

function sendIfAlive(webContents, channel, payload) {
  if (webContents && !webContents.isDestroyed()) {
    webContents.send(channel, payload);
  }
}

function registerAgentHandlers() {
  // ---- Start a turn --------------------------------------------------
  ipcMain.handle('agent:start', async (event, args) => {
    if (!querySdk) {
      return { ok: false, error: '@anthropic-ai/claude-agent-sdk is not installed. Run `npm install` in the project root.' };
    }

    const { chatId, prompt, sessionId, projectPath, apiKey, task } = args || {};

    if (!chatId)      return { ok: false, error: 'Missing chatId.' };
    if (!prompt)      return { ok: false, error: 'Missing prompt.' };
    if (!apiKey)      return { ok: false, error: 'No Anthropic API key configured.' };
    if (!projectPath) return { ok: false, error: 'No project selected. Pick a project with a local path.' };
    if (!fs.existsSync(projectPath)) {
      return { ok: false, error: `Project path does not exist: ${projectPath}` };
    }

    if (activeQueries.has(chatId)) {
      return { ok: false, error: 'A query is already running for this chat. Cancel it first.' };
    }

    const webContents = event.sender;
    const abortController = new AbortController();

    // Tack the current task description onto the system prompt so the
    // agent has per-chat context without our needing a custom prompt file.
    const systemPrompt = task
      ? `${COMMANDER_SYSTEM_PROMPT}\n\nCurrent task: ${task}`
      : COMMANDER_SYSTEM_PROMPT;

    let q;
    try {
      q = querySdk({
        prompt,
        options: {
          // Auth: pass API key via env so process.env stays untouched.
          env: { ...process.env, ANTHROPIC_API_KEY: apiKey },

          // Scope tools to the project directory.
          cwd: projectPath,

          // Custom system prompt — NOT the claude_code preset — so Commander
          // has its own voice and doesn't inherit Claude Code CLI instructions.
          systemPrompt,

          // Built-in file tools are enough; they're already scoped by cwd.
          // Bash is handy for quick greps/builds but costs more tokens, so
          // keep it off by default — add it back if you want shell access.
          allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],

          // Auto-accept edits so the user isn't prompted per-tool. The UI
          // surfaces every tool call anyway, which is the real safety net.
          permissionMode: 'acceptEdits',

          // The guardrails that solve the rate-limit problem.
          maxTurns: 20,
          maxBudgetUsd: 0.5,

          // Session continuity across turns in the same chat.
          ...(sessionId ? { resume: sessionId } : {}),

          abortController,
          // settingSources defaults to [] — we don't want ~/.claude/settings
          // from the user's machine leaking into the app.
        },
      });
    } catch (err) {
      return { ok: false, error: `Failed to start agent: ${err.message}` };
    }

    activeQueries.set(chatId, { q, abortController, webContents });

    // Fire-and-forget streaming loop. We return to the renderer immediately
    // so the UI can flip to "running" state; messages flow via agent:message.
    (async () => {
      try {
        for await (const msg of q) {
          sendIfAlive(webContents, 'agent:message', { chatId, msg });

          if (msg.type === 'result') {
            sendIfAlive(webContents, 'agent:done', {
              chatId,
              sessionId: msg.session_id,
              subtype: msg.subtype,
              totalCostUsd: msg.total_cost_usd,
              numTurns: msg.num_turns,
              // `result` is present only on the success branch; `errors` only on error branches.
              result:  'result' in msg ? msg.result : undefined,
              errors:  'errors' in msg ? msg.errors : undefined,
            });
          }
        }
      } catch (err) {
        sendIfAlive(webContents, 'agent:error', {
          chatId,
          message: err?.message || String(err),
        });
      } finally {
        activeQueries.delete(chatId);
      }
    })();

    return { ok: true };
  });

  // ---- Cancel a running turn ----------------------------------------
  ipcMain.handle('agent:cancel', async (_event, { chatId } = {}) => {
    const entry = activeQueries.get(chatId);
    if (!entry) return { ok: false, error: 'No active query for this chat.' };
    try {
      // interrupt() is the cooperative stop; AbortController is the hammer.
      try { await entry.q.interrupt(); } catch {}
      entry.abortController.abort();
      try { entry.q.close(); } catch {}
    } finally {
      activeQueries.delete(chatId);
    }
    return { ok: true };
  });

  // Expose a cleanup helper so main.js can abort everything on window close.
  return {
    cleanupAll() {
      for (const [chatId, entry] of activeQueries) {
        try { entry.abortController.abort(); } catch {}
        try { entry.q.close(); } catch {}
        activeQueries.delete(chatId);
      }
    },
  };
}

module.exports = { registerAgentHandlers };
