# Quartet

**Four-pane browser for parallel workstreams.**

Four independent browser panes in a 2×2 grid — each with its own tabs, navigation, and session profile. Workspaces save the state of all four panes together, so switching contexts switches everything at once.

Sister app to [Outer Rim](../), [Parallel](../parallel), and [Perimeter](../perimeter). Fully independent codebase and data.

## Features

- **Four browser panes** in a 2×2 grid, each fully functional
- **Resizable rows and columns** — drag the center cross to reshape the grid
- **Workspaces** at the bottom — each one remembers all four panes' tabs
- **Session profiles** with isolated cookies/storage, shared across panes but selectable per pane
- **Context menu "Open in …"** — open a link in any of the other three panes
- **Per-pane DevTools** — Cmd+Shift+1/2/3/4 for each pane, F12 for the focused one
- **Keyboard shortcuts** routed to the last-clicked (focused) pane

## Install & Run

```bash
cd quartet
npm install
npm start
```

For development with DevTools open on launch:

```bash
npm run dev
```

### Building a Mac .app

```bash
cd quartet
npm run build:mac
rm -rf /Applications/Quartet.app
cp -r dist/mac/Quartet.app /Applications/       # Intel
# or
cp -r dist/mac-arm64/Quartet.app /Applications/ # Apple Silicon
```

## Layout

```
┌────────────────────────────────────────────────────┐
│                      Quartet                       │
├────────────────────────┬───────────────────────────┤
│                        │                           │
│       Top Left         │       Top Right           │
│                        │                           │
├────────────────────────┼───────────────────────────┤  ← row resizer
│                        │                           │
│      Bottom Left       │      Bottom Right         │
│                        │                           │
├────────────────────────┴───────────────────────────┤
│  [ Workspace 1 ] [ Workspace 2 ] [ + New Workspace ]│
└────────────────────────────────────────────────────┘
                         ↑
                 column resizer
                 (mirrors top & bottom)
```

The vertical column resizer moves in sync for both rows — top-left and bottom-left always have the same width. If you want independent column widths per row, let me know; it's a small change.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + T` | New tab (in focused pane) |
| `Cmd/Ctrl + W` | Close active tab (in focused pane) |
| `Cmd/Ctrl + N` | New workspace |
| `Cmd/Ctrl + R` | Refresh active tab |
| `Cmd/Ctrl + L` | Focus URL bar |
| `Cmd/Ctrl + 1-9` | Switch to tab N (in focused pane) |
| `F12` | Toggle DevTools (active webview in focused pane) |
| `Cmd/Ctrl + Shift + 1` | Toggle Top-Left DevTools |
| `Cmd/Ctrl + Shift + 2` | Toggle Top-Right DevTools |
| `Cmd/Ctrl + Shift + 3` | Toggle Bottom-Left DevTools |
| `Cmd/Ctrl + Shift + 4` | Toggle Bottom-Right DevTools |
| `Alt + Cmd/Ctrl + I` | Toggle App DevTools |
| `Escape` | Close modals |

Click anywhere in a pane to make it the focused pane — focused pane gets a blue highlight bar along its top edge.

## Data Storage

Quartet stores its data in `quartet-data.json` inside Electron's user data directory. This is separate from Outer Rim, Parallel, and Perimeter, so all four apps can coexist on the same machine without interfering with each other.

Each workspace looks like:

```js
{
  id, name, notes, createdAt, updatedAt,
  panes: {
    topLeft:     { activeProfileId, profiles: { [id]: { tabs, activeTabId } } },
    topRight:    { activeProfileId, profiles: { [id]: { tabs, activeTabId } } },
    bottomLeft:  { activeProfileId, profiles: { [id]: { tabs, activeTabId } } },
    bottomRight: { activeProfileId, profiles: { [id]: { tabs, activeTabId } } }
  }
}
```

If you previously had a Parallel-style workspace with `{left, right}`, Quartet auto-migrates it to `{topLeft, topRight, bottomLeft, bottomRight}` with the bottom row empty on first run.

## Architecture

- `src/main/main.js` — Electron main process, IPC handlers, per-pane DevTools menu
- `src/main/store.js` — JSON file persistence (`quartet-data.json`)
- `src/preload/preload.js` — context bridge exposing `window.quartet`
- `src/renderer/index.html` — four-pane 2×2 grid layout
- `src/renderer/styles.css` — hybrid theme, compact since panes share the window
- `src/renderer/app.js` — renderer logic; every tab/nav function takes a `paneId` of `'topLeft'`, `'topRight'`, `'bottomLeft'`, or `'bottomRight'`

No sidebar, no notepad — the grid needs the screen real estate. If you want a notepad back, it can be added as a collapsible overlay.

## Why four apps?

Each one solves a different problem:

- **Outer Rim** — workspace browser with git integration
- **Parallel** — two browser panes, research + Claude side by side
- **Perimeter** — terminal + browser for running Claude Code
- **Quartet** — four browser panes for dense multi-context work

They all share the same workspace/profile concept but have completely separate codebases and storage, so you can work on them independently.
