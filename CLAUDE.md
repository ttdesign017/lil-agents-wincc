# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**lil-agents-wincc** is an Electron desktop pet app for Windows. Two AI-powered 2D characters roam the taskbar; clicking one opens a terminal-style chat bubble powered by a local `@anthropic-ai/claude-code` subprocess. A click-through fullscreen overlay lets characters float above the desktop without blocking normal interaction.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Electron 28 (main + renderer) |
| Frontend | React 18.2, TypeScript 5.2 |
| Build | Vite 5 + `vite-plugin-electron` |
| Packaging | electron-builder (Windows, `dir` target) |
| AI | `@anthropic-ai/claude-code` CLI subprocess (stream-json I/O) |

## Key Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server + Electron with hot reload
npm run build        # tsc + vite build + electron-builder (produces dist-build/)
```

## Architecture

### Electron Main/Renderer Separation

- **electron/main.ts** — Creates a transparent, borderless, always-on-top fullscreen window at screen-saver z-level (`type: 'toolbar'`) with `setIgnoreMouseEvents(true, { forward: true })` for click-through. System tray provides menus for per-character visibility toggle (绿油油/刘小红), themes (neon/corporate/toxic), and quit. The default theme (`neon`) starts as checked (checkbox) in the tray submenu.
- **electron/preload.ts** — Context-isolated bridge exposing `Window.electronAPI` for IPC: mouse forwarding, taskbar info, Claude session management (start/send/kill), visibility/themes, display changes, external URL opening.
- **electron/ClaudeSession.ts** — Spawns `node cli.js --output-format stream-json --input-format stream-json --verbose --dangerously-skip-permissions` per persona. Resolves CLI path from global npm or local. Finds template CLAUDE.md from packaged resources. Atomic copy to session data dir. Parses JSON lines from stdout, extracts `assistant` messages and `result` turn-complete events. Session limit: MAX_SESSIONS=2 (oldest killed if exceeded). Stdout line buffering for partial reads. Stderr filtered to real errors only.

### React Renderer

- **src/main.tsx** — React root entry; conditional `?debug=art` route loads ArtDebugger via dynamic import.
- **src/App.tsx** — Scene manager: coordinates 2 `WalkerCharacter` instances (绿油油 + 刘小红) + theme. Handles IPC visibility toggles, theme changes, display metrics changes. Theme class applied to `document.documentElement` for proper cascade to `createPortal` elements. Theme sync applied via `useEffect` on theme state change.
- **src/config.ts** — **Shared configuration file**. All motion parameters (BASE_STEP, FRAME_DURATION_MS, boundaries, walk distances, delays), tooltip/popover timing, and per-character sprite configs (CHAR_CONFIGS) live here. `DEFAULT_SCALE` also defined. Character configs include `yOffset` for per-character Y-axis offset.
- **src/components/WalkerCharacter.tsx** — Core game logic. **Unified canvas rAF** for both characters via `CHAR_CONFIGS` map from config.ts (frameWidth, frameHeight, scale, cols, walkProb, yOffset, phase frame ranges).
  - Walk phases: START → LOOP (3–12 cycles) → END with quadratic easing.
  - Incremental movement: `progress += (BASE_STEP/dockWidth) * easeCoeff * (elapsed/FRAME_DURATION_MS)` per rAF tick.
  - Sprite frame changes locked to 50ms intervals, position updates every rAF frame for smooth interpolation.
  - Direction reversal: only when hitting screen edges (detected in LOOP phase `nearEdge` check); NOT on every walk completion. This means characters walk in the same direction until they hit a boundary.
  - Screen-edge boundary: `PROGRESS_MIN` to `PROGRESS_MAX` (0.5%–99.5%).
  - `initiateWalk`: 10–30% screen walk distance, clamped to `IDLE_BOUNDARY_MIN/MAX`. Auto-flips direction if near edge.
  - `effectiveYOffset`: combined prop `yOffset` + config `cfg.yOffset` for per-character vertical offset.
  - END phase: no position snap-back on completion; position reflects accumulated movement.
  - Shared: drag-to-reposition (pauses animation), hover pause/tooltip, click-to-toggle chat popover, unread badge, graceful walk finish on hover (`gracefulEndWalk`).
- **src/components/TerminalPopover.tsx** — Chat UI via `createPortal`. `position: fixed` panel attached to character. Markdown rendering via `react-markdown` + `remark-gfm`. Auto-scroll to bottom. Ctrl+click links to open in browser. Textarea auto-resize up to 120px. `/clear` command clears history. Thinking indicator in title bar. Popover position captured synchronously before opening to prevent initial rendering at wrong position.
- **src/components/SpriteAnimator.tsx** — rAF-based canvas sprite animator with multi-row support. Used by ArtDebugger.
- **src/components/ArtDebugger.tsx** — Dev tool (accessible via `?debug=art`). Sprite sheet preview, walk preview stage, per-character controls (frame count, cycle speed, scale, walkProb). "Apply to Code" POSTs to Vite `/__patch` middleware to live-patch constants in WalkerCharacter.tsx. Imports `CHAR_CONFIGS` and `DEFAULT_SCALE` from shared config.
- **src/hooks/useClaudeSession.ts** — Custom hook managing Claude IPC communication. State: `chatHistory` (max 200 messages, capacity warning at 195), `isThinking`, `hasUnread`. Starts session on mount, cleans up listeners on unmount. `maxHistoryMessages` is configurable (default: 200).

### Canvas rAF Animation

Both characters use unified canvas-based rendering via `requestAnimationFrame`:
- `renderFrame`: Canvas 2D draw with `imageSmoothingEnabled = false`. Multi-row sprite sheet support (10 cols, frame = col + row * cols).
- `animTick` (rAF loop): Position updates every frame (time-based interpolation using `elapsed / FRAME_DURATION_MS`), sprite frames advance every 50ms.
- Walk pipeline: START (ease-in t²) → LOOP (constant speed, 3-12 cycles) → END (ease-out (1-t)² → idle).
- `isDraggingRef.current` guards prevent animation during drag; position frozen until pointer release.
- `imageRendering: 'auto'` on canvas element.
- `translate3d` for GPU compositing, `transition: 'none'` on every position update to prevent CSS interference.

### Theme System

Three CSS themes via custom properties in `src/index.css`: `theme-neon` (default dark, cyan accent), `theme-corporate` (light, blue), `theme-toxic` (matrix green). Theme class applied to `document.documentElement` for proper cascade to `createPortal` elements. Switched via IPC from tray menu.

## Important Patterns

- **IPC Communication**: One-way `ipcRenderer.send` for commands, `ipcRenderer.on` listeners for events. All bridged through `Window.electronAPI`.
- **Shared Config**: All magic numbers and parameters live in `src/config.ts`. No inline constants in components.
- **Claude Subprocess**: One session per character, persistent across UI state.
- **Performance**: Direct DOM manipulation for positioning (CSS transforms + rAF), not React state-driven re-renders.
- **Personas**: `personas/` directory contains CLAUDE.md files per character. Bundled as `extraResources` in electron-builder config.
- **Vite `__patch` Middleware**: Custom `debugger-patch` middleware exposes POST `/__patch` for live-patching `CHAR_CONFIGS` entries (scale, walkProb) in WalkerCharacter.tsx source.
- **Stale Closure Pattern**: Use refs (`progressRef`, `goingRightRef`, `animPhaseRef`) inside rAF callbacks — never capture React state in closures.
- **Ref Sync Pattern**: State → ref sync via `useEffect(() => { ref.current = state; }, [state])`.
- **Time-Based Movement**: Position scales by `elapsed / FRAME_DURATION_MS` ratio, enabling smooth sub-frame interpolation across variable rAF rates (~60fps).

## Project Structure

```
├── .claude/
│   └── settings.local.json      # Claude Code agent permissions
├── electron/                     # Main process (Node.js)
│   ├── main.ts                   # Window, tray, IPC
│   ├── preload.ts                # Context bridge
│   └── ClaudeSession.ts          # Claude subprocess lifecycle
├── src/                          # Renderer (React/TypeScript)
│   ├── main.tsx                  # React entry (?debug=art → ArtDebugger)
│   ├── App.tsx                   # Scene manager
│   ├── config.ts                 # All motion/sprite parameters + per-character configs
│   ├── index.css                 # Styles + themes
│   ├── components/
│   │   ├── WalkerCharacter.tsx   # Core character (canvas rAF walk engine, unified)
│   │   ├── TerminalPopover.tsx   # Chat UI (markdown rendering, createPortal)
│   │   ├── SpriteAnimator.tsx    # rAF canvas animator (multi-row)
│   │   └── ArtDebugger.tsx       # Dev tool (?debug=art, hot-patch parameters)
│   └── hooks/
│       └── useClaudeSession.ts   # Claude IPC hook
├── public/assets/                # Sprite sheets (bruce.png, jazz.png, bruce2.png, jazz3.png)
├── personas/                     # AI personality profiles (CLAUDE.md per character)
│   ├── 刘小红/CLAUDE.md
│   └── 绿油油/CLAUDE.md
├── vite.config.ts                # Vite + Electron + debugger-patch middleware
├── package.json
├── tsconfig.json
├── build.bat / run.bat           # Windows helper scripts
├── build/icon.png                # Tray/app icon
└── dist-electron/                # Compiled Electron output (generated)
```
