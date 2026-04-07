# Lil-Agents (Windows / Electron 版)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.2-blue.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-28.0-47848F.svg?logo=electron)](httpshttps://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB.svg?logo=react)](httpshttps://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.0-646CFF.svg?logo=vite)](httpshttps://vitejs.dev/)

基于 Claude 的 AI 驱动桌面宠物，在你的 Windows 任务栏上自由漫步。

> 本项目参考了 [lil-agents](https://github.com/ryanstephen/lil-agents) 的设计理念。

## 项目概览

Lil-Agents for Windows 将 macOS 版 `lil-agents` 的体验带到了 Windows 桌面。角色会在你的屏幕上自由移动 —— 点击其中一个即可打开终端风格的聊天窗口，直接在桌面上与 Claude 进行对话。

**核心特性**
- **轻量级动画**：基于 CSS Sprite 的纯动画实现，极低的 GPU 占用。
- **点击穿透**：全屏透明覆盖层设计，确保不影响正常的桌面交互。
- **实时 AI 对话**：通过本地 Claude Code 子进程实现流式响应。
- **个性化人格**：角色的人格配置文件存储在 `personas/` 目录中。

## 项目架构

采用 Electron 主进程/渲染进程分离架构，使用 `vite-plugin-electron` 进行统一构建。

```
lil-agents-wincc/
├── electron/                     # Electron 主进程 (Node.js)
│   ├── main.ts                   # 透明全屏窗口、任务栏定位、IPC 通信
│   ├── preload.ts                # 上下文隔离桥接 (Window.electronAPI)
│   └── ClaudeSession.ts          # Claude Code 子进程管理：解析 stream-json 输出
│
├── src/                          # 渲染进程 (React / TypeScript)
│   ├── main.tsx                  # React 入口文件
│   ├── App.tsx                   # 场景管理器：协调多个角色实例
│   ├── components/
│   │   ├── WalkerCharacter.tsx   # 游戏循环：Sprite 动画、碰撞检测、状态管理
│   │   └── TerminalPopover.tsx   # AI 聊天 UI：Markdown 渲染、毛玻璃效果弹窗
│   └── index.css                 # 全局样式
│
├── public/assets/                # 角色 Sprite 表 (8 帧序列)
├── personas/                     # AI 人格配置文件 (CLAUDE.md)
├── vite.config.ts                # Vite + Electron 构建配置
├── package.json
└── tsconfig.json
```

## 技术亮点

### CSS Sprite 动画
角色使用纯 CSS `steps(8)` 帧动画，通过 `requestAnimationFrame` 以 60fps 驱动。无需 Canvas，仅在 X 轴进行平滑位移，极大地降低了 GPU 开销。行走循环会在鼠标悬停或聊天激活时优雅地中断。

### 点击穿透覆盖层
通过创建一个无边框、置顶的全屏窗口，并设置 `setIgnoreMouseEvents(pointer-events: none)`，实现了完整的桌面穿透效果。只有当鼠标点击到角色 DOM 节点或聊天气泡时，才会捕获事件。

### Claude IPC 通信
使用 Node.js `child_process` 启动本地 `@anthropic-ai/claude-code` 子进程，并通过流式 I/O 进行通信。解析 `--output-format stream-json` 以实现实时的 Token 流式输出。即使 UI 被最小化，角色依然可以持续“思考”并响应。

## 环境准备

- [Node.js](https://nodejs.org/) 18+
- 全局安装 [Claude Code](https://github.com/anthropics/claude-code) (`npm i -g @anthropic-ai/claude-code`)
- 已登录的 Claude 会话 (`claude auth login`)

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器 (支持热更新)
npm run dev

# 构建并打包 Windows 安装包
npm run build
```

## 开源协议

ISC
