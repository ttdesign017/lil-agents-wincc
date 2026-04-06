import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
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
          label: 'Neon-Noodle (Default)', 
          type: 'radio', 
          checked: true, 
          click: () => mainWindow?.webContents.send('set-app-theme', 'neon') 
        },
        { 
          label: 'Corporate-Overlord', 
          type: 'radio', 
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
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Security: Prevent in-app navigation to remote sites
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const { shell } = require('electron');
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Only allow navigating to our own local app
    const currentUrl = mainWindow?.webContents.getURL();
    if (currentUrl && url !== currentUrl && !url.startsWith('file://')) {
      event.preventDefault();
      const { shell } = require('electron');
      shell.openExternal(url);
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
  if (win) {
    win.setIgnoreMouseEvents(ignore, options);
  }
});

// Taskbar position for primary display
ipcMain.handle('get-taskbar-info', () => {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const bounds = display.bounds;

  let dockTopY = bounds.height - (bounds.height - workArea.height);
  if (workArea.y > bounds.y) {
    dockTopY = workArea.y;
  }

  return {
    dockX: bounds.x,
    dockWidth: bounds.width,
    dockTopY: dockTopY,
    screenWidth: bounds.width
  };
});

ipcMain.on('open-external', (_event, url) => {
  const { shell } = require('electron');
  shell.openExternal(url);
});
