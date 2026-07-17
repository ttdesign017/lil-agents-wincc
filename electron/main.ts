import { app, BrowserWindow, dialog, ipcMain, screen, Tray, Menu, nativeImage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { setupLMStudioSession } from './LMStudioSession';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 让 Chromium 启用平滑滚动（鼠标滚轮过渡更丝滑）
app.commandLine.appendSwitch('enable-smooth-scrolling');

const rendererWindows: BrowserWindow[] = [];
let tray: Tray | null = null;
let trayContextMenu: Menu | null = null;
let suppressKeepOnTop = false;

function createTray() {
  const iconPath = path.join(app.getAppPath(), 'build/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: '显示/隐藏 绿油油', 
      type: 'checkbox', 
      checked: true,
      click: (item) => {
        broadcastToAll('toggle-visibility', '绿油油', item.checked);
      }
    },
    { 
      label: '显示/隐藏 刘小红', 
      type: 'checkbox', 
      checked: true,
      click: (item) => {
        broadcastToAll('toggle-visibility', '刘小红', item.checked);
      }
    },
    { type: 'separator' },
    {
      label: '切换主题 (Themes)',
      submenu: [
        {
          label: 'Neon-Noodle',
          type: 'radio',
          checked: false,
          click: () => broadcastToAll('set-app-theme', 'neon')
        },
        {
          label: 'Corporate-Overlord (Default)',
          type: 'radio',
          checked: true,
          click: () => broadcastToAll('set-app-theme', 'corporate')
        },
        { 
          label: 'Toxic-Greenhouse', 
          type: 'radio', 
          click: () => broadcastToAll('set-app-theme', 'toxic') 
        },
        { 
          label: 'Glass-Frosted', 
          type: 'radio', 
          click: () => broadcastToAll('set-app-theme', 'glass') 
        }
      ]
    },
    { type: 'separator' },
    { label: '退出程序', click: () => app.quit() }
  ]);

  tray.setToolTip('Lil-Agents');
  tray.setContextMenu(contextMenu);
  trayContextMenu = contextMenu;
}

function setTrayVisibilityChecked(name: string, visible: boolean) {
  if (!trayContextMenu) return;
  const item = trayContextMenu.items.find(
    (m) => m.type === 'checkbox' && typeof m.label === 'string' && m.label.includes(name)
  );
  if (item) item.checked = visible;
  if (tray) tray.setContextMenu(trayContextMenu);
}

function broadcastToAll(channel: string, ...args: any[]) {
  for (const win of rendererWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

function createDisplayWindow(display: Electron.Display, displayIndex: number): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setHasShadow(false);

  const params = new URLSearchParams({ displayIndex: String(displayIndex) });
  const baseUrl = process.env.VITE_DEV_SERVER_URL;

  if (baseUrl) {
    win.loadURL(`${baseUrl}?${params.toString()}`);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: { displayIndex: String(displayIndex) },
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const lowerUrl = url.toLowerCase();
    const isLocalFile = lowerUrl.startsWith('file://');
    const currentUrl = win.webContents.getURL();
    if (currentUrl && url !== currentUrl) {
      event.preventDefault();
      if (!isLocalFile) {
        shell.openExternal(url);
      }
    }
  });

  win.on('closed', () => {
    const idx = rendererWindows.indexOf(win);
    if (idx >= 0) rendererWindows.splice(idx, 1);
  });

  return win;
}

function createAllWindows() {
  const displays = screen.getAllDisplays();
  for (let i = 0; i < displays.length; i++) {
    const win = createDisplayWindow(displays[i], i);
    rendererWindows.push(win);
  }

  const keepOnTop = setInterval(() => {
    for (const win of rendererWindows) {
      if (win.isDestroyed()) continue;
      if (suppressKeepOnTop) continue;
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    if (rendererWindows.every(w => w.isDestroyed())) {
      clearInterval(keepOnTop);
    }
  }, 2000);

  for (const win of rendererWindows) {
    win.on('blur', () => {
      if (suppressKeepOnTop) return;
      if (win.isDestroyed()) return;
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    });
  }
}

app.whenReady().then(() => {
  createAllWindows();
  createTray();

  setupLMStudioSession(broadcastToAll);

  screen.on('display-metrics-changed', () => {
    for (const win of [...rendererWindows]) {
      if (!win.isDestroyed()) {
        win.close();
      }
    }
    rendererWindows.length = 0;
    createAllWindows();
    broadcastToAll('display-metrics-changed');
  });

  app.on('activate', () => {
    if (rendererWindows.length === 0) {
      createAllWindows();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handler to dynamically enable/disable click-through
// The renderer tells the main process if the mouse is over an interactive element (e.g. character)
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, options);
  }
});

// Get OS cursor position (screen coordinates)
ipcMain.handle('get-cursor-pos', () => screen.getCursorScreenPoint());

// Taskbar & display info for all connected monitors (supports multi-screen walking)
ipcMain.handle('get-taskbar-info', () => {
  const allDisplays = screen.getAllDisplays();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const displays = allDisplays.map((d) => {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
    return {
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      workAreaX: d.workArea.x,
      workAreaY: d.workArea.y,
      workAreaWidth: d.workArea.width,
      workAreaHeight: d.workArea.height,
      // bottom of work area = top of taskbar area (for bottom taskbar)
      bottomY: d.workArea.y + d.workArea.height,
    };
  });

  const virtualX = minX;
  const virtualY = minY;
  const virtualWidth = maxX - minX;
  const virtualHeight = maxY - minY;

  // For backward compatibility, also return the primary display info
  const primary = screen.getPrimaryDisplay();
  return {
    dockX: primary.bounds.x,
    dockWidth: primary.bounds.width,
    dockTopY: primary.workArea.y + primary.workArea.height,
    screenWidth: primary.bounds.width,
    // Multi-monitor support
    virtualX,
    virtualY,
    virtualWidth,
    virtualHeight,
    displays,
  };
});

ipcMain.on('open-external', (_event, url) => {
  shell.openExternal(url);
});

// 同步角色可见性到托盘菜单勾选状态（renderer → tray）
ipcMain.on('set-tray-visibility', (_event, name: string, visible: boolean) => {
  setTrayVisibilityChecked(name, visible);
});

// Image picker: selects files, reads them, returns base64 data
ipcMain.handle('select-image', async () => {
  const wins = rendererWindows.filter(w => !w.isDestroyed());
  if (wins.length === 0) return [];

  suppressKeepOnTop = true;
  for (const win of wins) win.setAlwaysOnTop(false);
  await new Promise(resolve => setTimeout(resolve, 100));

  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });

  for (const win of wins) {
    if (!win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver');
  }
  suppressKeepOnTop = false;

  if (result.canceled || result.filePaths.length === 0) return [];

  const images: Array<{ mimeType: string; data: string }> = [];
  const MAX_FILE_SIZE = 20 * 1024 * 1024;

  for (const filePath of result.filePaths) {
    try {
      const stats = await fs.promises.stat(filePath);
      if (stats.size > MAX_FILE_SIZE) {
        console.error(`[select-image] File too large: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        continue;
      }
      const ext = filePath.split('.').pop()?.toLowerCase();
      const mimeTypeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
      };
      const mimeType = mimeTypeMap[ext || ''] || 'image/png';
      const fileBuffer = await fs.promises.readFile(filePath);
      const base64 = fileBuffer.toString('base64');
      images.push({ mimeType, data: base64 });
    } catch (e) {
      console.error('[select-image] failed to read file:', filePath, e);
    }
  }
  return images;
});

// Export: save chat history to a markdown file
ipcMain.handle('export-chat', async (_event, filename: string, content: string) => {
  const wins = rendererWindows.filter(w => !w.isDestroyed());
  if (wins.length === 0) return false;

  suppressKeepOnTop = true;
  for (const win of wins) win.setAlwaysOnTop(false);
  await new Promise(resolve => setTimeout(resolve, 100));

  const aliveWins = wins.filter(w => !w.isDestroyed());
  if (aliveWins.length === 0) {
    suppressKeepOnTop = false;
    return false;
  }

  const result = await dialog.showSaveDialog({
    defaultPath: filename,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });

  for (const win of wins) {
    if (!win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver');
  }
  suppressKeepOnTop = false;

  if (result.canceled || !result.filePath) return false;

  try {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return true;
  } catch (e) {
    console.error('[export-chat] failed to write:', e);
    return false;
  }
});
