# lil-agents Windows 复刻 — 技术方案

## 一、原项目深度拆解

### 1.1 项目概述

lil-agents 是一款 **macOS 桌面宠物 + AI 终端** 程序：两个像素风角色 Bruce（绿色）和 Jazz（橙色）在 Dock 上方左右游走，点击角色后弹出一个主题化终端，可接入 Claude / Codex / Copilot / Gemini 四大 AI CLI 进行对话。

---

### 1.2 源码模块拆解

| 文件 | 大小 | 职责 |
|---|---|---|
| `LilAgentsApp.swift` | 8KB | 应用入口 + Menu Bar 菜单（主题/Provider/显示器切换）|
| `LilAgentsController.swift` | 9KB | 主循环 (`CVDisplayLink`)、Dock 坐标计算、角色更新调度 |
| `WalkerCharacter.swift` | 31KB | **核心**：角色行走状态机 + Popover 管理 + 气泡提示 + 声音 |
| `TerminalView.swift` | 19KB | 终端 UI：滚动文本区 + 输入框 + Markdown 渲染 + 斜杠命令 |
| `AgentSession.swift` | 3KB | 协议定义：`AgentSession` Protocol + Provider 枚举 |
| `ClaudeSession.swift` | 9.6KB | Claude CLI 子进程管理 + JSON 流解析 |
| `CodexSession.swift` | 8.7KB | OpenAI Codex CLI 子进程管理 |
| `CopilotSession.swift` | 8.4KB | GitHub Copilot CLI 子进程管理 |
| `GeminiSession.swift` | 9.3KB | Gemini CLI 子进程管理 |
| `PopoverTheme.swift` | 11.6KB | 4 套主题（Peach / Midnight / Cloud / Moss）颜色/字体定义 |
| `ShellEnvironment.swift` | 3.8KB | Shell 环境变量加载（PATH / NVM / Homebrew 等）|
| `CharacterContentView.swift` | 2.4KB | 角色点击事件捕获视图 |
| `walk-bruce-01.mov` | 9.1MB | Bruce 行走 HEVC Alpha 透明视频（10秒循环）|
| `walk-jazz-01.mov` | 9.4MB | Jazz 行走 HEVC Alpha 透明视频（10秒循环）|

---

### 1.3 核心机制分析

#### 🎬 角色动画
- **技术**：HEVC with Alpha 透明通道视频（macOS 独有），通过 `AVQueuePlayer` + `AVPlayerLooper` 无缝循环
- **渲染**：`AVPlayerLayer` 叠加在无边框透明 `NSWindow` 上，`NSWindow.level = .statusBar` 悬浮于所有窗口之上
- **尺寸**：原始 1080×1920 视频，显示为 113×200px（保持竖向比例）

#### 🚶 行走状态机
- **驱动**：`CVDisplayLink`（与显示器刷新率同步，60fps）
- **运动曲线**：三段插值（加速 → 匀速 → 减速），对应视频的 3.0s→3.75s→7.5s→8.25s 时间节点
- **边界**：实时读取 macOS Dock 的 `com.apple.dock` plist（tilesize、icon count 等）计算 Dock 范围
- **多角色防碰撞**：两角色之间保持 12% 屏幕宽度间隔

#### 💬 AI 会话管理
- **模式**：启动 CLI 工具的**子进程**（`Process` / `Pipe`），读取 stdout/stderr 流
- **协议**：统一 `AgentSession` Protocol，各 CLI 有独立实现
- **流式输出**：Claude 解析 JSON SSE 事件（`content_block_delta`），Gemini/Codex/Copilot 解析各自格式

#### 🪟 Popover 终端
- 无边框 `NSWindow`，圆角+毛玻璃效果（通过 `NSVisualEffectView` 模拟）
- 内嵌 `NSTextView`（富文本）+ 自定义 `NSTextField`（输入）
- Markdown 实时渲染（粗体、代码块、标题、列表、链接）
- 斜杠命令：`/clear` `/copy` `/help`
- 点击气泡/完成音效：9 种随机 ping 音效（mp3/m4a）

#### 🎨 主题系统
4套主题 Peach / Midnight / Cloud / Moss，每套定义：背景色、标题栏、文字色、强调色、气泡色、字体、圆角半径

---

## 二、Windows 复刻技术方案

### 2.1 核心挑战与对应解法

| macOS 特性 | Windows 等价方案 |
|---|---|
| HEVC Alpha 透明视频 | **WebM VP9 Alpha** 或精灵图（Sprite Sheet）动画 |
| `CVDisplayLink` 60fps 游戏循环 | **Win32 `SetTimer` / `timeSetEvent`** 或 Electron `requestAnimationFrame` |
| `NSWindow` 无边框透明悬浮 | **WS_EX_LAYERED + WS_EX_TRANSPARENT** 透明窗口（Win32）|
| `.statusBar` 窗口层级 | `HWND_TOPMOST` + `SetWindowPos` |
| Dock 区域计算 | **Windows 任务栏 API**（`SHAppBarMessage` / `FindWindow("Shell_TrayWnd")`）|
| `NSVisualEffectView` 毛玻璃 | **DwmEnableBlurBehindWindow** 或 Mica/Acrylic 效果（Win11）|
| `Process` 子进程 + Pipe | `child_process.spawn` (Node) 或 Win32 `CreateProcess` |
| CLI 工具路径 | Windows PATH + `%APPDATA%` + npm/winget 安装路径探测 |

---

### 2.2 技术栈选型

经综合评估，推荐 **Electron + React** 方案：

#### 选型理由

```
方案 A：Electron + React（推荐 ✅）
  优点：
  - 透明无边框窗口 API 完善（BrowserWindow transparent + frameless）
  - 子进程管理：Node.js child_process 天然支持
  - 动画：Canvas/WebGL/CSS Animation 丰富生态
  - 毛玻璃效果：vibrancy API（Win11 Mica/Acrylic）
  - 跨平台开发效率高，UI 层灵活
  - 打包简单：electron-builder 生成 .exe 安装包
  缺点：
  - 内存占用略高（~80MB）
  - 需要 Chromium runtime

方案 B：C++ + Win32/Qt（性能最优但开发成本极高）
方案 C：.NET WPF（Windows Only，生态好但 UI 灵活性差）
方案 D：Tauri + Rust（轻量，但 WebView 透明窗口在 Windows 上限制多）
```

**最终选型：Electron v33 + React 18 + TypeScript**

---

### 2.3 角色动画方案（重点）

由于 Windows 不原生支持 HEVC Alpha 透明视频，采用 **精灵图帧动画** 方案：

```
动画渲染方案：Canvas 2D + Sprite Sheet
- 提取原视频关键帧 → 生成透明 PNG 精灵图
- 或：重新绘制像素风角色（手绘 or AI 生成 SVG/PNG 序列帧）
- 通过 Canvas requestAnimationFrame 按帧播放
- 角色贴图包含：walk-right（8帧）、walk-left（8帧）、idle（4帧）
- Canvas 所在 BrowserWindow 设置 transparent + 点击穿透
```

**备选**：使用 WebM with Alpha（Chrome 88+ 支持），直接 `<video>` 标签 + CSS `mix-blend-mode`

---

### 2.4 项目结构规划

```
WinCC/                          ← 项目根目录
├── package.json
├── electron-builder.config.js
├── tsconfig.json
│
├── electron/                   ← 主进程（Node.js）
│   ├── main.ts                 ← 应用入口、窗口管理
│   ├── CharacterWindow.ts      ← 角色透明窗口管理
│   ├── PopoverWindow.ts        ← 终端 Popover 窗口管理
│   ├── TrayManager.ts          ← 系统托盘图标与菜单
│   ├── TaskbarHelper.ts        ← 读取任务栏位置/大小
│   ├── GameLoop.ts             ← 60fps 主循环
│   ├── sessions/
│   │   ├── AgentSession.ts     ← 统一 Protocol
│   │   ├── ClaudeSession.ts    ← Claude CLI 子进程
│   │   ├── GeminiSession.ts    ← Gemini CLI 子进程
│   │   ├── CodexSession.ts     ← Codex CLI 子进程
│   │   └── CopilotSession.ts   ← Copilot CLI 子进程
│   └── ShellEnv.ts             ← Windows PATH / 环境变量探测
│
├── src/                        ← 渲染进程（React）
│   ├── character/
│   │   ├── CharacterApp.tsx    ← 角色画布主组件
│   │   ├── WalkerSprite.tsx    ← 精灵图帧动画
│   │   └── ThinkingBubble.tsx  ← 思考气泡
│   ├── popover/
│   │   ├── PopoverApp.tsx      ← Popover 根组件
│   │   ├── TerminalView.tsx    ← 终端输出区
│   │   ├── InputField.tsx      ← 输入框 + 斜杠命令
│   │   └── MarkdownRenderer.tsx← Markdown 渲染
│   ├── themes/
│   │   └── themes.ts           ← 4 套主题定义（Peach/Midnight/Cloud/Moss）
│   └── assets/
│       ├── sprites/            ← 角色精灵图
│       └── sounds/             ← 完成音效（ping-*.mp3）
│
└── scripts/
    └── extract-frames.js       ← 从原视频提取帧工具
```

---

### 2.5 分阶段实施路线图

#### Phase 1：基础框架 + 透明窗口（1-2天）
- [ ] 初始化 Electron + React + TypeScript 项目
- [ ] 创建透明无边框角色窗口（`transparent: true, frame: false`）
- [ ] 实现 `HWND_TOPMOST` 置顶 + 点击穿透 + 任务栏隐藏
- [ ] 系统托盘图标 + 基础菜单

#### Phase 2：角色动画 + 行走逻辑（2-3天）
- [ ] 设计/生成角色精灵图（Bruce & Jazz）
- [ ] Canvas 精灵帧动画渲染器
- [ ] 任务栏位置/大小读取（`node-ffi-napi` 调用 `SHAppBarMessage`）
- [ ] 行走状态机（加速/匀速/减速 + 左右翻转 + 防碰撞）
- [ ] `requestAnimationFrame` 60fps 游戏循环

#### Phase 3：AI 会话管理（2-3天）
- [ ] `AgentSession` 统一接口
- [ ] Claude CLI 子进程 + JSON 流解析
- [ ] Gemini CLI 子进程
- [ ] Codex / Copilot CLI 子进程
- [ ] Windows PATH + npm global 路径探测

#### Phase 4：终端 Popover UI（2-3天）
- [ ] 毛玻璃效果 Popover 窗口（Electron `vibrancy` / Win11 Mica）
- [ ] 滚动文本区 + 实时流式渲染
- [ ] Markdown 渲染（code / bold / heading / list / link）
- [ ] 输入框 + 斜杠命令 `/clear` `/copy` `/help`
- [ ] 思考气泡 + 完成音效 + 完成气泡

#### Phase 5：主题系统 + 首次引导（1天）
- [ ] 4套主题实现（Peach / Midnight / Cloud / Moss）
- [ ] 托盘菜单：主题切换 / Provider 切换 / 角色显隐 / 声音开关
- [ ] 首次运行引导动画

#### Phase 6：打包发布（1天）
- [ ] `electron-builder` 打包为 `.exe` NSIS 安装包
- [ ] 自动更新（`electron-updater`）

---

### 2.6 关键技术细节

#### 透明窗口 + 置顶
```typescript
// CharacterWindow.ts
new BrowserWindow({
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  focusable: false,       // 点击穿透到桌面
  webPreferences: { ... }
})
win.setAlwaysOnTop(true, 'screen-saver') // 最高层级
```

#### 任务栏区域计算（Windows）
```typescript
// 使用 node-ffi-napi 调用 Win32 API
// SHAppBarMessage(ABM_GETTASKBARPOS) → RECT
// 或 FindWindow("Shell_TrayWnd") + GetWindowRect()
```

#### AI CLI 子进程
```typescript
// 与原版完全一致的模式
const proc = spawn('claude', ['--output-format', 'stream-json', '--verbose'], {
  env: { ...process.env, ...shellEnv }
})
proc.stdout.on('data', (chunk) => parseJsonStream(chunk))
```

#### 毛玻璃效果
```typescript
// Win11 Acrylic / Mica
win.setVibrancy('acrylic') // Electron 支持
// 或通过 DWM API (node-ffi)
```

---

## 三、开放问题（请确认）

> [!IMPORTANT]
> **角色素材来源**：原版使用透明 HEVC 视频（macOS 专有），Windows 复刻需要选择以下之一：
> - **方案 A（推荐）**：我来生成新的像素风角色精灵图（PNG 序列帧），保持与原版相近的卡通美感
> - **方案 B**：尝试从原版 .mov 提取帧（需 ffmpeg），但 Windows 可能无法解码 HEVC Alpha

> [!IMPORTANT]
> **AI Provider 范围**：是否需要支持全部 4 个（Claude + Gemini + Codex + Copilot），还是先实现 1-2 个核心的？

> [!IMPORTANT]
> **打包方式**：是否需要最终生成可分发的 `.exe` 安装包？还是先做开发版本可以直接运行即可？

