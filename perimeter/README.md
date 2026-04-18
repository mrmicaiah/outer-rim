# Perimeter

**Terminal + browser workspace for running Claude Code side-by-side with the web.**

Left pane is a real terminal — run `claude`, `git`, `npm`, whatever you want. Right pane is a browser for Claude.ai, docs, and anything else you need alongside your terminal work. Sidebar has workspace, project folder, and git controls (ported from Outer Rim). Data lives in its own file, so Perimeter doesn't interfere with Outer Rim or Parallel.

Sister app to [Outer Rim](../) and [Parallel](../parallel). Three independent Electron apps that share no code or data — but all live in the same repo so they're easy to work on in parallel.

## Features

- **Real terminal** on the left (node-pty + xterm.js). Run Claude Code, git, builds, anything. Multiple terminal tabs per workspace.
- **Browser** on the right with tabs and session profiles, same as Outer Rim / Parallel.
- **Smart Claude Code styling**: when Claude Code runs in the terminal, tool-call blocks (`⏺ Bash`, `⎿ result`) are rendered in a dim/gray accent so the conversation stands out from the work. Toggleable — turn it off if you don't like it, and it gracefully degrades to a plain terminal.
- **Sidebar** with workspace name, project folder picker, and git section (status + push + pull + commit message + refresh) — exactly like Outer Rim.
- **Terminal starts in the workspace's project folder** so `claude` and `git` are already scoped to your project.
- **Notepad** on the far right, persisted per workspace.
- **Workspaces bar** at the bottom — each workspace remembers its folder, browser tabs, and notes.

## Install & Run

```bash
cd perimeter
npm install     # installs Electron, xterm.js, node-pty; postinstall rebuilds node-pty for Electron
npm start
```

For development with app DevTools open:

```bash
npm run dev
```

The `postinstall` step is important — `node-pty` is a native C++ module that needs to be rebuilt against Electron's Node version, which is different from the system Node. `npm install` runs `electron-rebuild` automatically.

### Building a Mac .app

```bash
cd perimeter
npm run build:mac
rm -rf /Applications/Perimeter.app
cp -r dist/mac*/Perimeter.app /Applications/
```

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│                         Perimeter                            │
├───────────┬──────────────────┬───────────────────────┬───────┤
│ Workspace │  [term1] [term2] │  Tabs + Profile       │ Notes │
│ ────────  │  ┌──────────────┐│ ┌─────────────────────┐│       │
│ Folder 📁 │  │              ││ │ ◀ ▶ ↻ [URL]         ││       │
│ ────────  │  │              ││ ├─────────────────────┤│       │
│ Git       │  │   terminal   ││ │                     ││       │
│  ● 3 chg  │  │              ││ │      webview        ││       │
│  [pull]   │  │              ││ │                     ││       │
│  [push]   │  │              ││ │                     ││       │
│  [msg...] │  └──────────────┘│ └─────────────────────┘│       │
├───────────┴──────────────────┴───────────────────────┴───────┤
│  [ Workspace 1 ] [ Workspace 2 ] [ + New Workspace ]         │
└──────────────────────────────────────────────────────────────┘
```

## Claude Code output styling

When enabled (default), the styling pass watches PTY output line-by-line. Any line starting with:

- `⏺` (Claude Code's tool-call header) → styled with a soft blue accent
- `⎿` (tool result / continuation) → styled dim gray
- `●` (newer assistant-prose marker) → rendered bright (neutral)

Everything else — including regular shell output, compiler errors, program output — passes through unchanged and displays in xterm.js's normal colors. This means the styling only affects Claude Code's output and doesn't touch anything else you run.

If Claude Code's output format changes in a future release, the styling will degrade gracefully: the markers just won't match and everything renders as-is, same as a plain terminal. Click "✨ Claude styling" in the terminal tab bar to toggle it off if you want to compare.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + T` | New terminal tab |
| `Cmd/Ctrl + W` | Close active terminal tab |
| `Cmd/Ctrl + N` | New workspace |
| `Cmd/Ctrl + L` | Focus browser URL bar |
| `Cmd/Ctrl + R` | Refresh active browser tab (won't intercept when terminal is focused) |
| `F12` | Toggle webview DevTools |
| `Alt + Cmd/Ctrl + I` | Toggle app DevTools |

Keyboard input inside the terminal pane always goes to xterm.js — Cmd+C copies, Cmd+V pastes, arrow keys navigate history, etc.

## Data Storage

Perimeter stores data in `perimeter-data.json` inside Electron's user data directory. Completely separate from Outer Rim (`outer-rim-data.json`) and Parallel (`parallel-data.json`) — all three apps can coexist without interfering.

Each workspace:

```js
{
  id, name, notes, folderPath, createdAt, updatedAt,
  panes: {
    right: { activeProfileId, profiles: { [id]: { tabs, activeTabId } } }
  }
}
```

Terminal state (which tabs were open, what they were running) is not persisted — new terminals start fresh each time you open a workspace. This is intentional: PTY state can't be cleanly serialized, and having Claude Code pick up a partial session on restart would be confusing.

## Architecture

- `src/main/main.js` — Electron main process, IPC for workspace/notes/profile/git/project, menu wiring
- `src/main/store.js` — JSON file persistence (`perimeter-data.json`)
- `src/main/terminal.js` — PTY lifecycle: spawn shells, forward I/O, handle resize
- `src/preload/preload.js` — context bridge exposing `window.perimeter`
- `src/renderer/index.html` — layout (sidebar | terminal | browser | notepad)
- `src/renderer/styles.css` — hybrid theme (dark sidebar, terminal pane, light browser)
- `src/renderer/terminal.js` — xterm.js setup per tab, Claude Code styling middleware
- `src/renderer/app.js` — workspace/browser/git/notepad logic

The renderer is split across two files (`terminal.js` and `app.js`) because the terminal pane has enough logic of its own to warrant separation from the browser and sidebar concerns.

## Why three apps?

Each one solves a different problem:

- **Outer Rim** — workspace browser with git integration (original)
- **Parallel** — dual browser panes for research + Claude.ai side-by-side
- **Perimeter** — terminal + browser for running Claude Code while reading docs

They all share the same workspace/profile/notepad concept but have completely separate codebases and storage, so you can work on them independently without one breaking the other.
