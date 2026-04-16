# Outer Rim 🌌

A workspace browser for parallel AI workstreams. Built for people who run multiple Claude conversations across different projects simultaneously.

## Features

- **Workspaces** — Organize your work into named collections of tabs
- **Persistent Tabs** — Your tabs and their URLs survive restarts
- **Built-in Notepad** — Each workspace has a notepad that auto-saves
- **Keyboard Shortcuts** — Power user friendly
- **Dark Theme** — Easy on the eyes for long sessions

## Quick Start

```bash
# Clone the repo
git clone https://github.com/micaiahbussey/outer-rim.git
cd outer-rim

# Install dependencies
npm install

# Run the app
npm start
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + N` | New workspace |
| `Cmd/Ctrl + T` | New tab |
| `Cmd/Ctrl + W` | Close current tab |
| `Esc` | Close modals |

## Project Structure

```
outer-rim/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.js     # App entry, window management
│   │   └── store.js    # Local data persistence
│   ├── preload/        # Bridge between main & renderer
│   │   └── preload.js  # Secure IPC exposure
│   └── renderer/       # Frontend UI
│       ├── index.html  # App shell
│       ├── styles.css  # Dark theme styles
│       └── app.js      # UI logic
├── assets/             # Icons and images
└── package.json
```

## Roadmap

### Phase 1 ✅ (Current)
- [x] Local workspaces with tabs
- [x] Per-workspace notepad
- [x] Persistent storage
- [x] Basic keyboard shortcuts

### Phase 2: Cloud Sync
- [ ] User authentication
- [ ] Backend API for workspace sync
- [ ] Real-time sync across machines

### Phase 3: Claude Manager
- [ ] Embedded Claude panel
- [ ] Context-aware assistance (reads your notes)
- [ ] Workspace suggestions

### Phase 4: Polish
- [ ] Custom themes
- [ ] Tab groups within workspaces
- [ ] Workspace templates
- [ ] Command palette

## Development

```bash
# Run in dev mode (opens DevTools)
npm run dev

# Build for macOS
npm run build:mac

# Build for Windows
npm run build:win

# Build for both
npm run build:all
```

## Tech Stack

- **Electron** — Cross-platform desktop app
- **Vanilla JS** — No framework bloat
- **electron-builder** — App packaging

## License

MIT

---

Built with ☕ and Claude