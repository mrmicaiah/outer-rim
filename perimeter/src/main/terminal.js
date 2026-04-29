// src/main/terminal.js
//
// PTY (pseudo-terminal) management for Perimeter's left pane.
//
// Spawns a shell per terminal tab using node-pty, forwards stdout to the
// renderer via IPC, and accepts keystrokes back. Each PTY is identified by
// a termId string chosen by the renderer so we can route I/O correctly even
// when multiple terminals are open at once.

const { ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

let pty = null;
try {
  pty = require('node-pty');
} catch (err) {
  console.error('[terminal] node-pty not loaded:', err.message);
}

// termId -> { ptyProc, webContents }
const terminals = new Map();

function getDefaultShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';
  // Prefer the user's login shell, fall back to zsh on mac / bash elsewhere
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

// Shell args matter: launching as interactive (-i) login (-l) puts zsh in
// the right mode for line-editing and character echo. Without these, you
// get a pty that only shows your keystrokes after Enter — because zsh
// hasn't initialized its zle (line editor) and falls back to canonical
// kernel-buffered input.
function getShellArgs(shell) {
  if (process.platform === 'win32') return [];
  // bash, zsh, fish, sh — all accept -l (login) and -i (interactive)
  return ['-l', '-i'];
}

// Make sure PATH picks up common binary locations. Electron apps launched
// from Finder have a stripped-down PATH, which means `claude`, `git`, `brew`,
// and homebrew-installed tools are invisible unless we splice them in.
function getShellEnv() {
  const extraPath = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
  ].filter(Boolean).join(':');

  return {
    ...process.env,
    PATH: `${extraPath}:${process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'}`,
    // TERM must be something modern; xterm-256color works well with Claude Code
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    // Tell apps we're in a real interactive terminal
    FORCE_COLOR: '1',
  };
}

function registerTerminalHandlers() {
  if (!pty) {
    // Register stubs so the renderer gets a clear error instead of silence.
    ipcMain.handle('terminal:create', () => ({
      ok: false,
      error: 'node-pty is not installed. Run `npm install` in the perimeter directory.',
    }));
    return { cleanupAll() {} };
  }

  // ---- Create a new PTY -------------------------------------------
  ipcMain.handle('terminal:create', (event, args = {}) => {
    const { termId, cwd, cols, rows } = args;

    if (!termId) return { ok: false, error: 'Missing termId' };
    if (terminals.has(termId)) return { ok: false, error: 'Terminal already exists' };

    // Resolve and validate cwd. Fall back to $HOME if the requested path
    // doesn't exist, so a bad workspace path doesn't kill the spawn.
    let resolvedCwd = cwd || os.homedir();
    if (resolvedCwd.startsWith('~')) {
      resolvedCwd = resolvedCwd.replace('~', os.homedir());
    }
    if (!fs.existsSync(resolvedCwd)) {
      resolvedCwd = os.homedir();
    }

    const shell = getDefaultShell();
    const shellArgs = getShellArgs(shell);
    let ptyProc;

    try {
      ptyProc = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: resolvedCwd,
        env: getShellEnv(),
      });
    } catch (err) {
      return { ok: false, error: `Failed to spawn shell: ${err.message}` };
    }

    const webContents = event.sender;
    terminals.set(termId, { ptyProc, webContents });

    // Forward PTY output to renderer. onData fires on every chunk.
    ptyProc.onData((data) => {
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('terminal:data', { termId, data });
      }
    });

    ptyProc.onExit(({ exitCode, signal }) => {
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('terminal:exit', { termId, exitCode, signal });
      }
      terminals.delete(termId);
    });

    return { ok: true, shell, cwd: resolvedCwd };
  });

  // ---- Write keystrokes to a PTY ---------------------------------
  ipcMain.on('terminal:write', (_event, { termId, data }) => {
    const entry = terminals.get(termId);
    if (entry?.ptyProc) {
      try { entry.ptyProc.write(data); } catch (err) {
        console.error('[terminal] write error:', err.message);
      }
    }
  });

  // ---- Resize a PTY (xterm.js fit addon calls this) --------------
  ipcMain.on('terminal:resize', (_event, { termId, cols, rows }) => {
    const entry = terminals.get(termId);
    if (entry?.ptyProc) {
      try { entry.ptyProc.resize(cols, rows); } catch (err) {
        // Resize can fail if the PTY just closed; ignore.
      }
    }
  });

  // ---- Destroy a PTY ---------------------------------------------
  ipcMain.handle('terminal:destroy', (_event, { termId }) => {
    const entry = terminals.get(termId);
    if (!entry) return { ok: true }; // already gone
    try { entry.ptyProc.kill(); } catch (err) {}
    terminals.delete(termId);
    return { ok: true };
  });

  return {
    cleanupAll() {
      for (const [termId, entry] of terminals) {
        try { entry.ptyProc.kill(); } catch {}
        terminals.delete(termId);
      }
    },
  };
}

module.exports = { registerTerminalHandlers };
