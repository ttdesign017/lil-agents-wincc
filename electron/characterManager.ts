import { BrowserWindow, screen, ipcMain, app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CharacterConfig {
  name: string;
  sprite: string;
  initialProgress: number;
}

export interface CharacterWindowState {
  window: BrowserWindow;
  name: string;
  screenX: number;
  screenY: number;
  visible: boolean;
}

const characterWindows = new Map<string, CharacterWindowState>();
const windowToCharacter = new Map<number, string>();

const CHAR_WIN_WIDTH = 200;
const CHAR_WIN_HEIGHT = 200;
const CHAR_BOTTOM_OFFSET = 10;

function getPrimaryWorkAreaBottom(): number {
  const primary = screen.getPrimaryDisplay();
  return primary.workArea.y + primary.workArea.height;
}

function getWorkAreaBottomForX(screenX: number): number {
  const displays = screen.getAllDisplays();
  for (const d of displays) {
    if (screenX >= d.bounds.x && screenX < d.bounds.x + d.bounds.width) {
      return d.workArea.y + d.workArea.height;
    }
  }
  return getPrimaryWorkAreaBottom();
}

function createCharacterWindow(config: CharacterConfig): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const virtualX = primary.bounds.x;
  const bottomY = primary.workArea.y + primary.workArea.height;

  const initialScreenX = virtualX + config.initialProgress * primary.bounds.width;
  const initialScreenY = bottomY - CHAR_WIN_HEIGHT + CHAR_BOTTOM_OFFSET;

  const win = new BrowserWindow({
    x: Math.round(initialScreenX - CHAR_WIN_WIDTH / 2),
    y: Math.round(initialScreenY),
    width: CHAR_WIN_WIDTH,
    height: CHAR_WIN_HEIGHT,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  const params = new URLSearchParams({
    name: config.name,
    sprite: config.sprite,
  });

  const baseUrl = process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  const url = baseUrl.includes('?')
    ? `${baseUrl}&${params.toString()}`
    : `${baseUrl}?${params.toString()}`;

  win.loadURL(url);

  return win;
}

export function createCharacterWindows(configs: CharacterConfig[]) {
  for (const config of configs) {
    const win = createCharacterWindow(config);
    const state: CharacterWindowState = {
      window: win,
      name: config.name,
      screenX: 0,
      screenY: 0,
      visible: true,
    };
    characterWindows.set(config.name, state);
    windowToCharacter.set(win.id, config.name);
  }
}

export function getCharacterWindow(name: string): CharacterWindowState | undefined {
  return characterWindows.get(name);
}

export function getAllCharacterWindows(): CharacterWindowState[] {
  return Array.from(characterWindows.values());
}

export function setCharacterVisible(name: string, visible: boolean) {
  const state = characterWindows.get(name);
  if (!state) return;
  state.visible = visible;
  if (visible) {
    state.window.show();
  } else {
    state.window.hide();
  }
}

export function broadcastToAllCharacters(channel: string, ...args: any[]) {
  for (const state of characterWindows.values()) {
    if (!state.window.isDestroyed()) {
      state.window.webContents.send(channel, ...args);
    }
  }
}

ipcMain.handle('char-get-info', (event) => {
  const winId = event.sender.id;
  const name = windowToCharacter.get(winId);
  if (!name) return null;
  const state = characterWindows.get(name);
  if (!state) return null;
  const bounds = state.window.getBounds();
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
      bottomY: d.workArea.y + d.workArea.height,
    };
  });

  return {
    name,
    windowWidth: CHAR_WIN_WIDTH,
    windowHeight: CHAR_WIN_HEIGHT,
    virtualX: minX,
    virtualY: minY,
    virtualWidth: maxX - minX,
    virtualHeight: maxY - minY,
    displays,
    screenX: bounds.x + CHAR_WIN_WIDTH / 2,
    screenY: bounds.y + CHAR_WIN_HEIGHT - CHAR_BOTTOM_OFFSET,
  };
});

ipcMain.on('char-set-position', (event, screenX: number, screenY: number) => {
  const winId = event.sender.id;
  const name = windowToCharacter.get(winId);
  if (!name) return;
  const state = characterWindows.get(name);
  if (!state || state.window.isDestroyed()) return;

  state.screenX = screenX;
  state.screenY = screenY;

  const x = Math.round(screenX - CHAR_WIN_WIDTH / 2);
  const y = Math.round(screenY - CHAR_WIN_HEIGHT + CHAR_BOTTOM_OFFSET);

  state.window.setPosition(x, y);
});

ipcMain.on('char-set-ignore-mouse', (event, ignore: boolean, options?: { forward?: boolean }) => {
  const winId = event.sender.id;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, options);
  }
});

ipcMain.on('char-set-tray-visibility', (event, name: string, visible: boolean) => {
  const { setTrayVisibilityChecked } = require('./main');
  if (typeof setTrayVisibilityChecked === 'function') {
    setTrayVisibilityChecked(name, visible);
  }
});

screen.on('display-metrics-changed', () => {
  for (const state of characterWindows.values()) {
    if (!state.window.isDestroyed()) {
      state.window.webContents.send('display-metrics-changed');
    }
  }
});

setInterval(() => {
  for (const state of characterWindows.values()) {
    if (state.window.isDestroyed()) continue;
    state.window.setAlwaysOnTop(true, 'screen-saver');
    state.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
}, 2000);
