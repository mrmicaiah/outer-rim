# Parallel

**Dual-pane browser for parallel workstreams.**

Two independent browser panes side-by-side — research on the left, Claude (or anything else) on the right. Workspaces save the state of both panes together, so switching contexts switches both sides at once.

Sister app to [Outer Rim](../). Same workspace and profile architecture, no git integration.

## Features

- **Two browser panes** side-by-side, each with its own tabs, navigation, and session profile
- **Resizable divider** between the panes
- **Notepad** on the far right, persisted per workspace
- **Workspaces** at the bottom — each one remembers both panes' tabs and notes
- **Session profiles** with isolated cookies/storage, shared across panes but selectable per pane (use a work profile in one pane and personal in the other)
- **Per-pane DevTools** — F12 opens DevTools for the focused pane's active webview
- **Keyboard shortcuts** routed to the last-clicked (focused) pane

## Install & Run

```bash
cd parallel
npm install
npm start
```

For development with DevTools open on launch:

```bash
npm run dev
```

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│                       Parallel                                │
├──────────────────────────────┬────────────────────────────────┤
│   LEFT PANE                  │   RIGHT PANE                   │
│  ┌──────────────────────┐    │  ┌──────────────────────┐  ┌──┐│
│  │ Tabs + Profile       │    │  │ Tabs + Profile       │  │N ││
│  ├──────────────────────┤    │  ├──────────────────────┤  │o ││
│  │ ◀ ▶ ↻ [URL]          │    │  │ ◀ ▶ ↻ [URL]          │  │t ││
│  ├──────────────────────┤    │  ├──────────────────────┤  │e ││
│  │                      │    │  │                      │  │s ││
│  │      webview         │    │  │      webview         │  │  ││
│  │                      │    │  │                      │  │  ││
│  └──────────────────────┘    │  └──────────────────────┘  └──┘│
├──────────────────────────────┴────────────────────────────────┤
│  [ Workspace 1 ] [ Workspace 2 ] [ + New Workspace ]          │
└───────────────────────────────────────────────────────────────┘
```

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
| `Cmd/Ctrl + Shift + Left` | Toggle Left DevTools |
| `Cmd/Ctrl + Shift + Right` | Toggle Right DevTools |
| `Alt + Cmd/Ctrl + I` | Toggle App DevTools |
| `Escape` | Close modals |

Click anywhere in a pane to make it the focused pane; the focused pane gets a blue highlight bar at the top.

## Data Storage

Parallel stores its data in `parallel-data.json` inside Electron's user data directory. This is separate from Outer Rim's data file, so the two apps can coexist on the same machine without interfering with each other.

Each workspace looks like:

```js
{
  id, name, notes, createdAt, updatedAt,
  panes: {
    left:  { activeProfileId, profiles: { [id]: { tabs, activeTabId } } },
    right: { activeProfileId, profiles: { [id]: { tabs, activeTabId } } }
  }
}
```

Session profiles are stored at the top level and shared across panes — each pane picks which profile to use, so you could run the left pane as "Work" and the right pane as "Personal" within the same workspace.

## Architecture

- `src/main/main.js` — Electron main process, IPC handlers for workspaces/notes/profiles/devtools
- `src/main/store.js` — JSON file persistence (`parallel-data.json`)
- `src/preload/preload.js` — context bridge exposing `window.parallel`
- `src/renderer/index.html` — dual-pane layout
- `src/renderer/styles.css` — hybrid theme (dark chrome, light content)
- `src/renderer/app.js` — renderer logic; every tab/nav function takes a `paneId` of `'left'` or `'right'`

No git, no project folder, no screenshot integration — those live in Outer Rim.
