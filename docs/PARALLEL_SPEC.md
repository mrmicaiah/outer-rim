# Parallel - Build Specification

## Overview
**Parallel** is a dual-pane browser for parallel workstreams. It lives in the `parallel/` folder within the `outer-rim` repo.

**Core concept:** Two browser panes side-by-side — research on the left, Claude (or anything) on the right. Same workspace/profile architecture as Outer Rim, but no git integration.

---

## Architecture

```
outer-rim/
├── src/                    # Outer Rim (existing)
│   ├── main/
│   ├── preload/
│   └── renderer/
├── parallel/               # NEW - Parallel app
│   ├── package.json
│   ├── src/
│   │   ├── main/
│   │   │   ├── main.js
│   │   │   └── store.js
│   │   ├── preload/
│   │   │   └── preload.js
│   │   └── renderer/
│   │       ├── index.html
│   │       ├── app.js
│   │       └── styles.css
│   └── README.md
```

---

## Layout Specification

```
┌─────────────────────────────────────────────────────────────────┐
│                        Title Bar                                │
│                        "Parallel"                               │
├─────────────────────────────┬───────────────────────────────────┤
│     LEFT PANE               │          RIGHT PANE               │
│  ┌─────────────────────┐    │   ┌─────────────────────┐         │
│  │ Tab Bar + Profile   │    │   │ Tab Bar + Profile   │         │
│  ├─────────────────────┤    │   ├─────────────────────┤         │
│  │ Nav: ◀ ▶ ↻ [URL]    │    │   │ Nav: ◀ ▶ ↻ [URL]    │         │
│  ├─────────────────────┤    │   ├─────────────────────┤         │
│  │                     │    │   │                     │         │
│  │     WEBVIEW         │    │   │     WEBVIEW         │ NOTEPAD │
│  │   (white bg)        │    │   │   (white bg)        │  panel  │
│  │                     │    │   │                     │         │
│  │                     │    │   │                     │         │
│  └─────────────────────┘    │   └─────────────────────┘         │
├─────────────────────────────┴───────────────────────────────────┤
│  Workspace Bar: [Workspace 1] [Workspace 2] [+ New Workspace]   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Layout Differences from Outer Rim:
- **No left sidebar** (no git controls, no folder picker)
- **Two browser panes** instead of sidebar + one browser pane
- **Resizable divider** between left and right panes
- **Notepad** still on far right
- **Workspace bar** still at bottom

---

## Theme (Hybrid - same as Outer Rim)

### Dark Areas:
- Title bar
- Tab bars (both panes)
- Navigation bars (both panes)

### Light Areas:
- Webview content areas (white background)
- Notepad panel
- Workspace bar

### Accent Colors:
- Blue: `#3b82f6` (nav buttons hover, active tabs)
- Purple: `#8b5cf6` (+ new tab button)
- Orange: `#f97316` (profile manager button)
- Green: `#22c55e` (success states)

---

## Data Model

### Workspace Structure:
```javascript
{
  id: uuid,
  name: string,
  panes: {
    left: {
      activeProfileId: string,
      profiles: {
        [profileId]: {
          tabs: [{ id, url, title, createdAt }],
          activeTabId: string | null
        }
      }
    },
    right: {
      activeProfileId: string,
      profiles: {
        [profileId]: {
          tabs: [{ id, url, title, createdAt }],
          activeTabId: string | null
        }
      }
    }
  },
  notes: string,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Profiles (shared across panes):
```javascript
[
  { id: 'default', name: 'Default' },
  { id: 'uuid', name: 'Work Account' },
  { id: 'uuid', name: 'Personal' }
]
```

---

## IPC Bridge (preload.js)

```javascript
window.parallel = {
  workspace: {
    getAll: () => ipcRenderer.invoke('workspace:getAll'),
    getActive: () => ipcRenderer.invoke('workspace:getActive'),
    setActive: (id) => ipcRenderer.invoke('workspace:setActive', id),
    create: (workspace) => ipcRenderer.invoke('workspace:create', workspace),
    update: (workspace) => ipcRenderer.invoke('workspace:update', workspace),
    delete: (id) => ipcRenderer.invoke('workspace:delete', id)
  },
  notes: {
    update: (workspaceId, notes) => ipcRenderer.invoke('notes:update', workspaceId, notes)
  },
  profiles: {
    getAll: () => ipcRenderer.invoke('profiles:getAll'),
    create: (name) => ipcRenderer.invoke('profiles:create', name),
    delete: (id) => ipcRenderer.invoke('profiles:delete', id),
    rename: (id, name) => ipcRenderer.invoke('profiles:rename', id, name)
  },
  devtools: {
    toggle: () => ipcRenderer.invoke('devtools:toggle'),
    openWebview: (partition) => ipcRenderer.invoke('devtools:openWebview', partition)
  },
  onMenuToggleDevTools: (callback) => ipcRenderer.on('menu:toggle-devtools', callback)
}
```

**Note:** No git, no project folder, no screenshots — just workspaces, notes, and profiles.

---

## Main Process (main.js)

### IPC Handlers to implement:
- `workspace:getAll`
- `workspace:getActive`
- `workspace:setActive`
- `workspace:create`
- `workspace:update`
- `workspace:delete`
- `notes:update`
- `profiles:getAll`
- `profiles:create`
- `profiles:delete`
- `profiles:rename`
- `devtools:toggle`
- `devtools:openWebview`

### Store (electron-store):
```javascript
const store = new Store({
  name: 'parallel-data',  // Different from outer-rim!
  defaults: {
    workspaces: [],
    activeWorkspaceId: null,
    profiles: [{ id: 'default', name: 'Default' }]
  }
});
```

### Menu:
- View → Toggle Left DevTools (F12 or custom)
- View → Toggle Right DevTools
- View → Toggle App DevTools (Alt+Cmd+I)

---

## Renderer (app.js) Key Functions

### Pane Management:
```javascript
// Each pane (left, right) needs:
renderPane(paneId)           // 'left' or 'right'
createTab(paneId, url)
switchTab(paneId, tabId)
closeTab(paneId, tabId)
navigateBack(paneId)
navigateForward(paneId)
refreshTab(paneId)
navigateToUrl(paneId, url)
changeProfile(paneId, profileId)
```

### Shared:
```javascript
renderWorkspaces()
createWorkspace(name)
switchWorkspace(id)
deleteWorkspace(id)
renameWorkspace(id, name)

updateNotepad()
saveNotes()
toggleNotepad()

updateProfileSelectors()  // Update both panes
openProfileModal()
addProfile()
deleteProfile(id)
```

### DevTools Fix:
Include the `devtools-closed` repaint fix from Outer Rim:
```javascript
function setupWebviewDevToolsHandler(webview) {
  webview.addEventListener('devtools-closed', () => {
    webview.style.visibility = 'hidden';
    void webview.offsetHeight;
    requestAnimationFrame(() => {
      webview.style.visibility = 'visible';
    });
  });
}
```

---

## HTML Structure (index.html)

```html
<div id="app">
  <!-- Title Bar -->
  <div id="title-bar">Parallel</div>

  <!-- Main Content -->
  <div id="main-content">
    <div id="upper-section">
      <div id="dual-pane-container">
        
        <!-- LEFT PANE -->
        <div id="left-pane" class="browser-pane">
          <div class="pane-tab-bar" data-pane="left">
            <div class="pane-tab-list" data-pane="left"></div>
            <button class="pane-add-tab" data-pane="left">+</button>
            <div class="pane-profile-selector">
              <select class="profile-select" data-pane="left"></select>
              <button class="profile-manage-btn">⚙</button>
            </div>
          </div>
          <div class="pane-nav-bar" data-pane="left">
            <button class="nav-btn nav-back" data-pane="left">◀</button>
            <button class="nav-btn nav-forward" data-pane="left">▶</button>
            <button class="nav-btn nav-refresh" data-pane="left">↻</button>
            <input class="nav-url" data-pane="left" placeholder="Enter URL...">
          </div>
          <div class="pane-webview-container" data-pane="left">
            <div class="pane-empty-state">Click + to open a tab</div>
          </div>
        </div>

        <!-- PANE RESIZER -->
        <div id="pane-resizer"></div>

        <!-- RIGHT PANE -->
        <div id="right-pane" class="browser-pane">
          <!-- Same structure as left pane with data-pane="right" -->
        </div>

        <!-- NOTEPAD RESIZER -->
        <div id="notepad-resizer"></div>

        <!-- NOTEPAD PANEL -->
        <div id="notepad-panel">
          <div class="notepad-header">
            <span class="notepad-title">📝 Notes</span>
            <button id="notepad-toggle">◀</button>
          </div>
          <textarea id="notepad-content"></textarea>
        </div>

        <button id="notepad-expand" class="hidden">📝</button>
      </div>
    </div>

    <!-- Workspace Bar -->
    <div id="workspace-bar">
      <div id="workspace-list"></div>
      <button id="add-workspace">+ New Workspace</button>
    </div>
  </div>

  <!-- Modals: workspace, tab, profile (same as Outer Rim) -->
</div>
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+T | New tab (in focused pane) |
| Cmd+W | Close active tab |
| Cmd+N | New workspace |
| Cmd+R | Refresh active tab |
| Cmd+L | Focus URL bar |
| Cmd+1-9 | Switch tabs |
| F12 | Toggle DevTools (active webview) |
| Escape | Close modals |

**Pane Focus:** Need to track which pane is "focused" (last clicked) for Cmd+T, Cmd+W, etc.

---

## Files to Create

### 1. `parallel/package.json`
```json
{
  "name": "parallel",
  "version": "1.0.0",
  "description": "Dual-pane browser for parallel workstreams",
  "main": "src/main/main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron . --enable-logging"
  },
  "dependencies": {
    "electron-store": "^8.1.0"
  },
  "devDependencies": {
    "electron": "^29.0.0"
  }
}
```

### 2. `parallel/src/main/main.js`
- Copy from Outer Rim's main.js
- Remove: git handlers, project handlers, screenshot handlers
- Keep: workspace, notes, profiles, devtools handlers
- Update: window title to "Parallel"
- Update: store name to "parallel-data"

### 3. `parallel/src/main/store.js`
- Copy from Outer Rim
- Change store name to "parallel-data"

### 4. `parallel/src/preload/preload.js`
- Simplified version without git/project/screenshots
- Expose as `window.parallel` instead of `window.outerRim`

### 5. `parallel/src/renderer/index.html`
- Dual-pane layout as specified above
- Both panes have identical structure with different `data-pane` attributes

### 6. `parallel/src/renderer/styles.css`
- Copy hybrid theme from Outer Rim
- Remove sidebar styles
- Add `.browser-pane` styles (replaces sidebar-pane)
- Both panes should be `flex: 1` by default

### 7. `parallel/src/renderer/app.js`
- Adapt from Outer Rim
- All tab/nav functions take `paneId` parameter ('left' or 'right')
- Track `focusedPane` for keyboard shortcuts
- Remove git/folder/screenshot code

---

## Testing Checklist

- [ ] App launches with title "Parallel"
- [ ] Both panes render with tab bars
- [ ] Can add tabs to left pane
- [ ] Can add tabs to right pane
- [ ] Tabs navigate independently
- [ ] Pane resizer works
- [ ] Profile selector works for each pane independently
- [ ] Workspaces save/restore both panes
- [ ] Switching workspaces loads correct tabs in both panes
- [ ] Notes persist per workspace
- [ ] DevTools opens without leaving black area on close
- [ ] Keyboard shortcuts work (respecting focused pane)

---

## Implementation Order

1. **Scaffold files** — Create folder structure and package.json
2. **Main process** — Copy and simplify from Outer Rim
3. **Preload** — Simplify IPC bridge
4. **HTML** — Build dual-pane layout
5. **CSS** — Adapt hybrid theme
6. **JS** — Implement dual-pane logic
7. **Test** — Run through checklist
8. **Polish** — Fix any visual/UX issues

---

## Reference Files

Copy and adapt from:
- `outer-rim/src/main/main.js` → Remove git, simplify
- `outer-rim/src/main/store.js` → Change store name
- `outer-rim/src/preload/preload.js` → Remove git/project/screenshots
- `outer-rim/src/renderer/styles.css` → Keep theme, adapt layout
- `outer-rim/src/renderer/app.js` → Add paneId parameter to functions

---

## Notes for Builder

1. **Webview partitions:** Each pane can have different profiles, so webview IDs should be `webview-{pane}-{profileId}-{tabId}`

2. **Focus tracking:** Add click listeners to pane containers to track `focusedPane = 'left' | 'right'`

3. **Profile selectors:** Each pane has its own profile dropdown, but they share the same profile list. Changing profile in left pane only affects left pane tabs.

4. **Context menu:** Should work in both panes — "Open in Other Pane" could be a nice addition

5. **Default tabs:** Consider opening claude.ai by default in the right pane for new workspaces
