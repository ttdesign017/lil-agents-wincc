# Lil-Agents (Windows / Electron)

这是一个基于 Electron、React (Vite) 和 Anthropic Claude CLI 构建的 Windows 桌面宠项目。设计灵感来源于 macOS 的 `lil-agents`。

角色小人会在你的屏幕任务栏上自由巡逻，你可以随时点击它们展开终端对话框，并与后台唤起的 Claude 大语言模型进行无缝对话。

---

## 📂 项目层级结构说明

项目采用典型的主进程 (Main Process) 与 渲染进程 (Renderer Process) 分离的 Electron 架构。

```text
WinCC/
├── electron/                 # ⚙️ Electron 核心后台服务 (Node.js)
│   ├── main.ts               # 项目总入口：管理透明主窗口生成、任务栏定位及统筹事件配置
│   ├── preload.ts            # Node.js 桥接层：提供上下文隔离的 API (Window.electronAPI) 给前端 React 调用
│   └── ClaudeSession.ts      # Claude 大脑：使用 child_process 与全局安装的 @anthropic-ai/claude-code 通信
│
├── src/                      # 🎨 前端界面逻辑 (React/TypeScript)
│   ├── main.tsx              # React 渲染顶层入口
│   ├── App.tsx               # 游戏场景主管理器：等待坐标测算后实例化并分配各个小人
│   ├── index.css             # 全局样式配置
│   │
│   └── components/           # 组件目录
│       ├── WalkerCharacter.tsx # 灵魂组件：控制游戏循环 (Game Loop)、自由行走动画、碰撞状态与历史数据管理
│       └── TerminalPopover.tsx # 终点站交互：只负责将 Claude 发来的对话数据渲染为酷炫的毛玻璃聊天弹窗
│
├── public/
│   └── assets/               # 存放角色的连续帧精灵图 (如 bruce.png/jazz.png)
│
├── vite.config.ts            # Vite 主构建配置文件：管理依赖及前端与 Electron 的联编路径
├── package.json              # 依赖管理与命令行脚本 (npm run dev 等)
└── tsconfig.json             # TypeScript 全局配置约束
```

---

## 🧩 核心功能与工作流解析

### 1. **动画系统 (`WalkerCharacter.tsx`)**
前端抛弃了消耗性能的 Canvas，转而采用了纯 CSS 的帧动画 `steps(8)` 配置，配合 `requestAnimationFrame` 以 60fps 驱动 X 轴平移，达到了显存开销非常低的平滑走动效果。遇到鼠标悬浮、聊天浮层被唤醒时都能够精准地打断行走。聊天状态等历史记录也在此组件内持久化维护。

### 2. **穿透交互窗 (`main.ts`)**
后端构建的一个全透明、无边框、不显示在任务栏且总置顶 `alwaysOnTop: true` 的全屏窗口。它自带针对鼠标事件击穿的钩子 `setIgnoreMouseEvents`，只有鼠标命中在小人和聊天气泡（React 中的实体 DOM ）上时才会拦截鼠标点击，真正做到了静默跟随并且不妨碍您对下层正常软件与桌面的操作。

### 3. **AI 通信通道 (`ClaudeSession.ts`)**
直接静默唤醒您本地电脑全局安装的 `claude` 工具 (Anthropic AI 原生高级命令行)。并且为了绕开不稳定的终端模拟（TTY）验证限制，底层深度使用了 `Node.js` 原生的长链接流进程。结合官方特供的 `--output-format stream-json` 进行解析：小人不仅可以瞬间流式回复对话，甚至当你把界面关掉后它还会在后台继续打字“思考”并在此后给出冒泡消息提示。

---

## 🚀 如何运行开发

1. 确保你的电脑中已全局装有 Claude Code (`npm install -g @anthropic-ai/claude-code`)，并且执行过 `claude auth` 以保证获得有效调用授权。
2. 安装环境依赖项：
   ```bash
   npm install
   ```
3. 启动开发环境热重载预览：
   ```bash
   npm run dev
   ```
4. 构建并打包用于分发的 Windows `.exe` 安装包：
   ```bash
   npm run build
   ```
