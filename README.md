# Lil-Agents (Windows / Electron)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.2-blue.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-28.0-47848F.svg?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB.svg?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.0-646CFF.svg?logo=vite)](https://vitejs.dev/)

AI-powered desktop pets that patrol your Windows taskbar, powered by Claude.

## Overview

Lil-Agents for Windows brings the macOS `lil-agents` experience to the Windows desktop. Characters roam your screen freely — click one to open a terminal-style chat window and converse with Claude directly from your desktop.

**Key Features**
- Pure CSS sprite-based animation, low GPU footprint
- Click-through fullscreen overlay for seamless desktop interaction
- Streaming AI responses via local Claude Code process
- Personality profiles stored in `personas/` directory

## Architecture

Electron main/renderer separation with `vite-plugin-electron` for unified builds.

```
lil-agents-wincc/
├── electron/                     # Electron main process (Node.js)
│   ├── main.ts                   # Transparent fullscreen window, taskbar positioning, IPC
│   ├── preload.ts                # Context-isolated bridge (Window.electronAPI)
│   └── ClaudeSession.ts          # Claude Code subprocess: stream-json output parsing
│
├── src/                          # Renderer process (React / TypeScript)
│   ├── main.tsx                  # React root entry
│   ├── App.tsx                   # Scene manager: coordinates character instances
│   ├── components/
│   │   ├── WalkerCharacter.tsx   # Game loop: sprite animation, collision, state management
│   │   └── TerminalPopover.tsx   # AI chat UI: markdown rendering, glassmorphic popover
│   └── index.css                 # Global styles
│
├── public/assets/                # Character sprite sheets (8-frame sprites)
├── personas/                     # AI personality profiles (CLAUDE.md)
├── vite.config.ts                # Vite + Electron build config
├── package.json
└── tsconfig.json
```

## Technical Highlights

### CSS Sprite Animation

Characters use pure CSS `steps(8)` frame animation driven by `requestAnimationFrame` at 60fps. No Canvas — minimal GPU overhead, smooth horizontal translation on the X-axis. Walk cycles are cleanly interrupted on hover or chat activation.

### Click-Through Overlay

A borderless, always-on-top fullscreen window with `setIgnoreMouseEvents(pointer-events: none)` enables full desktop passthrough. Mouse events are only captured when hitting character DOM nodes or chat bubbles.

### Claude IPC Communication

Spawns a local `@anthropic-ai/claude-code` subprocess using Node.js `child_process` with stream-based I/O. Parses `--output-format stream-json` for real-time token streaming. Characters continue "thinking" and respond even when the UI is minimized.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude Code](https://github.com/anthropics/claude-code) installed globally (`npm i -g @anthropic-ai/claude-code`)
- Authenticated Claude session (`claude auth login`)

## Getting Started

```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev

# Build and package distributable (Windows)
npm run build
```

## License

ISC
