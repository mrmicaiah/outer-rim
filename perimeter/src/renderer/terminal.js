// ============================================
// PERIMETER - Terminal Pane (xterm.js + node-pty bridge)
// ============================================
//
// One Terminal instance per tab. Each tab has a hidden/visible xterm
// container in #terminal-container-wrapper and a tab pill in the tab bar.
// Data flows: keystroke → preload.terminal.write → main PTY.write → shell
//             shell stdout → main PTY.onData → preload.terminal.onData → xterm.write
//
// The optional "Claude styling" middleware intercepts PTY data before it
// reaches xterm and annotates Claude Code's tool-call blocks with ANSI dim
// sequences so conversation stands out from tool execution.

(function () {
  // State
  const terminals = new Map(); // termId -> { term, fitAddon, container, tabEl, cwd, label, styler }
  let activeTermId = null;
  let styleClaudeOutput = true;

  // ---- Claude Code output styling ---------------------------------
  // Claude Code's TUI uses these markers:
  //   "⏺ ToolName(...)"  start of a tool call header
  //   "⎿ ..."            indented tool result / continuation
  //   "● ..."            assistant prose marker (newer versions)
  //
  // Strategy: wrap those lines with dim ANSI + a subtle color. When the
  // markers aren't detected, raw data passes through unchanged so any
  // non-Claude command behaves exactly as in a normal terminal.
  //
  // ANSI codes used:
  //   \x1b[2m  = dim/faint
  //   \x1b[0m  = reset
  //   \x1b[38;5;244m = mid-gray (256-color)
  //   \x1b[38;5;110m = soft blue
  //
  // Note: Claude Code already uses ANSI extensively, so we only wrap lines
  // that START at a line boundary with a known marker. Partial chunks get
  // buffered until we see a newline.

  function createClaudeStyler() {
    let buffer = '';

    return {
      process(data) {
        if (!styleClaudeOutput) return data;

        buffer += data;

        // Split into full lines; keep the trailing partial line in buffer
        const lines = buffer.split(/(\r?\n)/);
        // If buffer ends with a newline, all lines are complete. Otherwise
        // the last element is an incomplete line we hold onto.
        let completeCount = lines.length;
        if (!/\r?\n$/.test(buffer)) completeCount -= 1;

        let out = '';
        for (let i = 0; i < completeCount; i++) {
          out += styleLine(lines[i]);
        }

        // Retain whatever is left (partial line or nothing)
        buffer = lines.slice(completeCount).join('');
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

  // Strip ANSI escape sequences just for the detection check; we then apply
  // our own styling around the ORIGINAL line (to preserve any existing
  // colors Claude Code has already emitted).
  function stripAnsi(s) {
    return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  }

  function styleLine(line) {
    // line may or may not include a trailing \r\n
    const clean = stripAnsi(line).trimStart();

    // Tool call header: "⏺ ToolName(...)"
    if (clean.startsWith('⏺')) {
      return `\x1b[38;5;110m${line}\x1b[0m`;
    }
    // Tool result / continuation: "⎿ ..."
    if (clean.startsWith('⎿')) {
      return `\x1b[2m\x1b[38;5;244m${line}\x1b[0m`;
    }
    // Newer assistant-prose marker: "● ..." at column 0
    if (clean.startsWith('● ')) {
      // Leave bright — this is the assistant speaking. Just ensure it
      // isn't in a lingering dim state from a previous line.
      return `\x1b[0m${line}`;
    }
    // Everything else passes through unchanged
    return line;
  }

  // ---- Terminal lifecycle -----------------------------------------

  function createTerminalTab(cwd) {
    const termId = crypto.randomUUID();
    const wrapper = document.getElementById('terminal-container-wrapper');
    const tabList = document.getElementById('terminal-tab-list');
    const emptyState = document.getElementById('terminal-empty');
    if (emptyState) emptyState.style.display = 'none';

    // Container for this terminal's DOM
    const container = document.createElement('div');
    container.className = 'terminal-instance';
    container.dataset.termId = termId;
    wrapper.appendChild(container);

    // xterm.js instance — uses our theme
    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: {
        background: '#0f1014',
        foreground: '#e2e2e8',
        cursor: '#a0a0a8',
        cursorAccent: '#0f1014',
        selectionBackground: 'rgba(59, 130, 246, 0.35)',
        black: '#1a1a1f',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#e2e2e8',
        brightBlack: '#6a6a75',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#a78bfa',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(webLinksAddon);

    term.open(container);

    // Give the DOM a beat before calling fit() — otherwise the container
    // has zero size and fit gets it wrong.
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch (e) {}
    });

    const styler = createClaudeStyler();

    // Tab pill
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

    terminals.set(termId, { term, fitAddon, container, tabEl, cwd, label: labelBase, styler });

    // Main process spawns the PTY
    window.perimeter.terminal.create({
      termId,
      cwd,
      cols: term.cols,
      rows: term.rows,
    }).then((res) => {
      if (!res.ok) {
        term.write(`\r\n\x1b[31m[Terminal failed to start: ${res.error}]\x1b[0m\r\n`);
        return;
      }
      // Wire data bidirectionally
      term.onData((data) => window.perimeter.terminal.write(termId, data));
      term.onResize(({ cols, rows }) => window.perimeter.terminal.resize(termId, cols, rows));
    });

    switchTo(termId);
    return termId;
  }

  function switchTo(termId) {
    if (!terminals.has(termId)) return;
    activeTermId = termId;

    // Hide all terminal containers, show the target one
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
      else showEmptyState();
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
    const home = '/Users/';
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
    // Reset stylers so partial buffers don't leak styled/unstyled mixes
    for (const entry of terminals.values()) entry.styler.reset();
  }

  // ---- Global setup -----------------------------------------------

  function init() {
    document.getElementById('terminal-add-tab').addEventListener('click', () => {
      const cwd = getCurrentProjectFolder();
      createTerminalTab(cwd);
    });

    document.getElementById('terminal-claude-toggle').addEventListener('click', (e) => {
      setStylingEnabled(!styleClaudeOutput);
    });

    // Main-process data arriving for any terminal
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

    // Menu-triggered actions from main
    window.perimeter.onMenuNewTerminal(() => {
      createTerminalTab(getCurrentProjectFolder());
    });
    window.perimeter.onMenuCloseTerminal(() => closeActiveTerminal());

    // Refit terminals when the window resizes or panes get dragged
    window.addEventListener('resize', () => requestAnimationFrame(refitAll));

    // Observe the terminal-pane size changes (pane resizer)
    const termPane = document.getElementById('terminal-pane');
    if (termPane && window.ResizeObserver) {
      const ro = new ResizeObserver(() => requestAnimationFrame(refitAll));
      ro.observe(termPane);
    }
  }

  // Exposed helpers — app.js calls these when creating workspaces etc.
  function getCurrentProjectFolder() {
    // app.js sets window.__perimeterCurrentFolder whenever the active
    // workspace's folder changes. This avoids tight coupling.
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
  };
})();
