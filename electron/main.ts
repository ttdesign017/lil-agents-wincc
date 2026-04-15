import { app, BrowserWindow, dialog, ipcMain, screen, Tray, Menu, nativeImage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { setupClaudeSession } from './ClaudeSession';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable hardware acceleration for performance (GPU will handle transparency and blurs)
// Only disable if transparency issues occur on specific drivers.

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createTray() {
  // Use the icon we bundled in the build folder
  const iconPath = path.join(app.getAppPath(), 'build/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: '显示/隐藏 绿油油', 
      type: 'checkbox', 
      checked: true,
      click: (item) => {
        mainWindow?.webContents.send('toggle-visibility', '绿油油', item.checked);
      }
    },
    { 
      label: '显示/隐藏 刘小红', 
      type: 'checkbox', 
      checked: true,
      click: (item) => {
        mainWindow?.webContents.send('toggle-visibility', '刘小红', item.checked);
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
          click: () => mainWindow?.webContents.send('set-app-theme', 'neon')
        },
        {
          label: 'Corporate-Overlord (Default)',
          type: 'radio',
          checked: true,
          click: () => mainWindow?.webContents.send('set-app-theme', 'corporate')
        },
        { 
          label: 'Toxic-Greenhouse', 
          type: 'radio', 
          click: () => mainWindow?.webContents.send('set-app-theme', 'toxic') 
        }
      ]
    },
    { type: 'separator' },
    { label: '退出程序', click: () => app.quit() }
  ]);

  tray.setToolTip('Lil-Agents');
  tray.setContextMenu(contextMenu);
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const screenBounds = primaryDisplay.bounds;

  mainWindow = new BrowserWindow({
    x: screenBounds.x,
    y: screenBounds.y,
    width: screenBounds.width,
    height: screenBounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    type: 'toolbar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Enable click-through by default
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  // Ensure pointer events are forwarded through the transparent area
  mainWindow.setHasShadow(false);

  // Load the UI
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // DevTools: manually open via Ctrl+Shift+I or mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Security: Prevent in-app navigation to remote sites
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Only allow navigating to our own local app (file:// protocol)
    // Use case-insensitive check and block all non-file protocols (data:, blob:, about:, etc.)
    const lowerUrl = url.toLowerCase();
    const isLocalFile = lowerUrl.startsWith('file://');
    const currentUrl = mainWindow?.webContents.getURL();
    if (currentUrl && url !== currentUrl) {
      event.preventDefault();
      // Only open external URLs in the system browser (block file:// from being opened locally)
      if (!isLocalFile) {
        shell.openExternal(url);
      }
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  if (mainWindow) {
    setupClaudeSession(mainWindow);
  }

  // #12: Listen for display change event after app is ready
  screen.on('display-metrics-changed', (_event, _display, _changedMetrics) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Re-fetch primary display info and notify renderer
      mainWindow.webContents.send('display-metrics-changed');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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

// Taskbar position for primary display
ipcMain.handle('get-taskbar-info', () => {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const bounds = display.bounds;

  // workArea.y already represents the top of the usable area (accounts for top-positioned taskbar)
  // workArea.y + workArea.height is the bottom of the usable area
  return {
    dockX: bounds.x,
    dockWidth: bounds.width,
    dockTopY: workArea.y + workArea.height, // bottom of work area = taskbar top Y for bottom taskbar
    screenWidth: bounds.width
  };
});

ipcMain.on('open-external', (_event, url) => {
  shell.openExternal(url);
});

// Image picker: selects files, reads them, returns base64 data
ipcMain.handle('select-image', async () => {
  // The mainWindow is an alwaysOnTop toolbar window that covers the entire screen.
  // We must temporarily lower its Z-level so the dialog is visible.
  if (!mainWindow || mainWindow.isDestroyed()) return [];

  // Lower the window Z-level so the dialog can appear on top
  mainWindow.setAlwaysOnTop(false);
  // Add small delay to ensure Windows processes the Z-order change
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check if window was destroyed while waiting
  if (!mainWindow || mainWindow.isDestroyed()) return [];

  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });

  // Restore window Z-order
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  if (result.canceled || result.filePaths.length === 0) return [];

  const images: Array<{ mimeType: string; data: string }> = [];
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

  for (const filePath of result.filePaths) {
    try {
      // Check file size before reading
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
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  // Lower the window Z-level so the dialog can appear on top
  mainWindow.setAlwaysOnTop(false);
  // Add small delay to ensure Windows processes the Z-order change
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check if window was destroyed while waiting
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  const result = await dialog.showSaveDialog({
    defaultPath: filename,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });

  // Restore window Z-order
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  if (result.canceled || !result.filePath) return false;

  try {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return true;
  } catch (e) {
    console.error('[export-chat] failed to write:', e);
    return false;
  }
});
