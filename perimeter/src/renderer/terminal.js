// ============================================
// PERIMETER - Terminal Pane (xterm.js + node-pty bridge)
// ============================================
//
// One Terminal instance per tab. Each tab has a hidden/visible xterm
// container in #terminal-container-wrapper and a tab pill in the tab bar.
// Data flows: keystroke → preload.terminal.write → main PTY.write → shell
//             shell stdout → main PTY.onData → preload.terminal.onData → xterm.write
//
// We track WHEN Claude Code is running in a terminal in two ways:
//  1. App.js calls markActiveAsClaudeCode() right after sending the launch
//     command — the Launch button knows it just started claude, no need to
//     wait for output detection.
//  2. The styler also detects marker chars (⏺⎿●) as a fallback for
//     terminals where the user typed `claude` themselves without using the
//     Launch button.

(function () {
  // State
  const terminals = new Map(); // termId -> { term, fitAddon, container, tabEl, cwd, label, styler, claudeActive }
  let activeTermId = null;
  let styleClaudeOutput = true;

  const stateListeners = new Set();
  function notifyStateChange() {
    const snapshot = getActiveState();
    for (const fn of stateListeners) {
      try { fn(snapshot); } catch (e) { console.error('[terminal] state listener error', e); }
    }
  }

  function getActiveState() {
    if (!activeTermId) {
      return { hasTerminal: false, termId: null, claudeActive: false };
    }
    const entry = terminals.get(activeTermId);
    return {
      hasTerminal: true,
      termId: activeTermId,
      claudeActive: !!entry?.claudeActive,
    };
  }

  // Flip the active terminal's claudeActive flag and update its tab icon.
  // Called by app.js right after the Launch button sends `claude\n`.
  function markActiveAsClaudeCode() {
    if (!activeTermId) return;
    const entry = terminals.get(activeTermId);
    if (!entry || entry.claudeActive) return;
    entry.claudeActive = true;
    const iconEl = entry.tabEl.querySelector('.terminal-tab-icon');
    if (iconEl) iconEl.textContent = '🤖';
    notifyStateChange();
  }

  // ---- Claude Code output styling ---------------------------------

  const MARKER_CHARS = '⏺⎿●';
  const MARKER_RE = new RegExp(`[${MARKER_CHARS}]`);

  function createClaudeStyler(onMarkerSeen) {
    let buffer = '';
    let markerEverSeen = false;

    return {
      process(data) {
        if (!markerEverSeen && MARKER_RE.test(data)) {
          markerEverSeen = true;
          if (typeof onMarkerSeen === 'function') {
            try { onMarkerSeen(); } catch (e) { console.error('[styler] onMarkerSeen error', e); }
          }
        }

        if (!styleClaudeOutput) return data;

        if (!buffer && !MARKER_RE.test(data) && !/\r?\n/.test(data)) {
          return data;
        }

        buffer += data;

        if (!MARKER_RE.test(buffer) && !/\r?\n/.test(buffer)) {
          const out = buffer;
          buffer = '';
          return out;
        }

        const lines = buffer.split(/(\r?\n)/);
        let completeCount = lines.length;
        if (!/\r?\n$/.test(buffer)) completeCount -= 1;

        let out = '';
        for (let i = 0; i < completeCount; i++) {
          out += styleLine(lines[i]);
        }

        const remainder = lines.slice(completeCount).join('');
        if (remainder && !MARKER_RE.test(remainder)) {
          out += remainder;
          buffer = '';
        } else {
          buffer = remainder;
        }
        return out;
      },
      flush() {
        if (!buffer) return '';
        const out = styleLine(buffer);
        buffer = '';
        return out;
      },
      reset() { buffer = ''; },
    };
  }

  function stripAnsi(s) {
    return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  }

  function styleLine(line) {
    const clean = stripAnsi(line).trimStart();
    if (clean.startsWith('⏺')) return `\x1b[38;5;110m${line}\x1b[0m`;
    if (clean.startsWith('⎿')) return `\x1b[2m\x1b[38;5;244m${line}\x1b[0m`;
    if (clean.startsWith('● ')) return `\x1b[0m${line}`;
    return line;
  }

  // ---- Terminal lifecycle -----------------------------------------

  function createTerminalTab(cwd) {
    const termId = crypto.randomUUID();
    const wrapper = document.getElementById('terminal-container-wrapper');
    const tabList = document.getElementById('terminal-tab-list');
    const emptyState = document.getElementById('terminal-empty');
    if (emptyState) emptyState.style.display = 'none';

    const container = document.createElement('div');
    container.className = 'terminal-instance';
    container.dataset.termId = termId;
    wrapper.appendChild(container);

    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: {
        background: '#0f1014', foreground: '#e2e2e8',
        cursor: '#a0a0a8', cursorAccent: '#0f1014',
        selectionBackground: 'rgba(59, 130, 246, 0.35)',
        black: '#1a1a1f', red: '#ef4444', green: '#22c55e',
        yellow: '#f59e0b', blue: '#3b82f6', magenta: '#8b5cf6',
        cyan: '#06b6d4', white: '#e2e2e8',
        brightBlack: '#6a6a75', brightRed: '#f87171',
        brightGreen: '#4ade80', brightYellow: '#fbbf24',
        brightBlue: '#60a5fa', brightMagenta: '#a78bfa',
        brightCyan: '#22d3ee', brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(webLinksAddon);
    term.open(container);

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch (e) {}
    });

    const tabEl = document.createElement('div');
    tabEl.className = 'pane-tab-item';
    tabEl.dataset.termId = termId;
    const labelBase = cwd ? truncatePath(cwd) : '~';
    tabEl.innerHTML = `
      <span class="terminal-tab-icon">⌨</span>
      <span class="pane-tab-title">${labelBase}</span>
      <button class="pane-tab-close" title="Close terminal">×</button>
    `;
    tabList.appendChild(tabEl);

    tabEl.addEventListener('click', (e) => {
      if (!e.target.classList.contains('pane-tab-close')) switchTo(termId);
    });
    tabEl.querySelector('.pane-tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTerminal(termId);
    });

    const styler = createClaudeStyler(() => {
      const e = terminals.get(termId);
      if (e && !e.claudeActive) {
        e.claudeActive = true;
        const iconEl = e.tabEl.querySelector('.terminal-tab-icon');
        if (iconEl) iconEl.textContent = '🤖';
        if (termId === activeTermId) notifyStateChange();
      }
    });

    terminals.set(termId, {
      term, fitAddon, container, tabEl,
      cwd, label: labelBase, styler,
      claudeActive: false,
    });

    window.perimeter.terminal.create({
      termId, cwd, cols: term.cols, rows: term.rows,
    }).then((res) => {
      if (!res.ok) {
        term.write(`\r\n\x1b[31m[Terminal failed to start: ${res.error}]\x1b[0m\r\n`);
        return;
      }
      term.onData((data) => window.perimeter.terminal.write(termId, data));
      term.onResize(({ cols, rows }) => window.perimeter.terminal.resize(termId, cols, rows));
    });

    switchTo(termId);
    return termId;
  }

  function switchTo(termId) {
    if (!terminals.has(termId)) return;
    activeTermId = termId;
    for (const [id, entry] of terminals) {
      const isActive = id === termId;
      entry.container.classList.toggle('active', isActive);
      entry.tabEl.classList.toggle('active', isActive);
    }
    const entry = terminals.get(termId);
    requestAnimationFrame(() => {
      try { entry.fitAddon.fit(); } catch (e) {}
      entry.term.focus();
    });
    notifyStateChange();
  }

  function closeTerminal(termId) {
    const entry = terminals.get(termId);
    if (!entry) return;
    window.perimeter.terminal.destroy(termId).catch(() => {});
    entry.term.dispose();
    entry.container.remove();
    entry.tabEl.remove();
    terminals.delete(termId);
    if (activeTermId === termId) {
      const next = terminals.keys().next().value;
      activeTermId = null;
      if (next) switchTo(next);
      else { showEmptyState(); notifyStateChange(); }
    }
  }

  function closeActiveTerminal() {
    if (activeTermId) closeTerminal(activeTermId);
  }

  function showEmptyState() {
    const emptyState = document.getElementById('terminal-empty');
    if (emptyState) emptyState.style.display = '';
  }

  function truncatePath(p) {
    if (!p) return '~';
    const parts = p.split('/').filter(Boolean);
    if (parts.length === 0) return '/';
    return parts[parts.length - 1] || '/';
  }

  function refitAll() {
    for (const entry of terminals.values()) {
      try { entry.fitAddon.fit(); } catch (e) {}
    }
  }

  function setStylingEnabled(enabled) {
    styleClaudeOutput = enabled;
    const btn = document.getElementById('terminal-claude-toggle');
    if (btn) btn.classList.toggle('active', enabled);
    for (const entry of terminals.values()) entry.styler.reset();
  }

  // ---- Public helpers used by app.js -----------------------------

  function sendToActive(text) {
    if (!activeTermId) return false;
    window.perimeter.terminal.write(activeTermId, text);
    return true;
  }

  function interruptActive() {
    if (!activeTermId) return false;
    window.perimeter.terminal.write(activeTermId, '\x1b');
    return true;
  }

  function init() {
    document.getElementById('terminal-add-tab').addEventListener('click', () => {
      const cwd = getCurrentProjectFolder();
      createTerminalTab(cwd);
    });

    document.getElementById('terminal-claude-toggle').addEventListener('click', () => {
      setStylingEnabled(!styleClaudeOutput);
    });

    window.perimeter.terminal.onData((_event, { termId, data }) => {
      const entry = terminals.get(termId);
      if (!entry) return;
      const styled = entry.styler.process(data);
      entry.term.write(styled);
    });

    window.perimeter.terminal.onExit((_event, { termId }) => {
      const entry = terminals.get(termId);
      if (entry) {
        entry.term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
      }
    });

    window.perimeter.onMenuNewTerminal(() => createTerminalTab(getCurrentProjectFolder()));
    window.perimeter.onMenuCloseTerminal(() => closeActiveTerminal());

    window.addEventListener('resize', () => requestAnimationFrame(refitAll));

    const termPane = document.getElementById('terminal-pane');
    if (termPane && window.ResizeObserver) {
      const ro = new ResizeObserver(() => requestAnimationFrame(refitAll));
      ro.observe(termPane);
    }

    notifyStateChange();
  }

  function getCurrentProjectFolder() {
    return window.__perimeterCurrentFolder || undefined;
  }

  window.PerimeterTerminals = {
    init,
    createTerminalTab,
    closeActiveTerminal,
    refitAll,
    getActiveTermId: () => activeTermId,
    hasTerminals: () => terminals.size > 0,
    setStylingEnabled,
    sendToActive,
    interruptActive,
    markActiveAsClaudeCode,
    getActiveState,
    onStateChange: (fn) => {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
  };
})();
