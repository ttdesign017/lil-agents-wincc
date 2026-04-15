/**
 * 全局鼠标状态管理器
 * 
 * 解决多个问题：
 * 1. 多个角色实例之间的状态同步
 * 2. 对话框和角色的状态协调
 * 3. 避免竞态条件导致的穿透问题
 */

type Listener = () => void;
const listeners: Listener[] = [];

interface MouseState {
  // 记录哪些个角色被hover
  overCharacters: Set<string>;
  // 记录哪些对话框被hover
  overPopovers: Set<string>;
}

const state: MouseState = {
  overCharacters: new Set(),
  overPopovers: new Set(),
};

/**
 * 注册角色被鼠标hover
 */
export function registerCharacterOver(id: string) {
  if (state.overCharacters.has(id)) return;
  state.overCharacters.add(id);
  updateMouseIgnore();
  notifyListeners();
}

/**
 * 取消注册角色被鼠标hover
 */
export function unregisterCharacterOver(id: string) {
  state.overCharacters.delete(id);
  updateMouseIgnore();
  notifyListeners();
}

/**
 * 注册对话框被鼠标hover
 */
export function registerPopoverOver(id: string) {
  if (state.overPopovers.has(id)) return;
  state.overPopovers.add(id);
  updateMouseIgnore();
  notifyListeners();
}

/**
 * 取消注册对话框被鼠标hover
 */
export function unregisterPopoverOver(id: string) {
  state.overPopovers.delete(id);
  updateMouseIgnore();
  notifyListeners();
}

/**
 * 获取当前状态（用于调试）
 */
export function getMouseState() {
  return {
    overCharacters: Array.from(state.overCharacters),
    overPopovers: Array.from(state.overPopovers),
    shouldIgnore: state.overCharacters.size === 0 && state.overPopovers.size === 0,
  };
}

/**
 * 更新鼠标穿透状态
 */
function updateMouseIgnore() {
  const shouldIgnore = state.overCharacters.size === 0 && state.overPopovers.size === 0;
  const electronAPI = (window as any).electronAPI;

  if (!electronAPI) return;

  if (shouldIgnore) {
    electronAPI.setIgnoreMouseEvents(true, { forward: true });
  } else {
    electronAPI.setIgnoreMouseEvents(false);
  }
}

/**
 * 通知所有订阅者
 */
function notifyListeners() {
  listeners.forEach(fn => fn());
}

/**
 * 订阅状态变化
 * @returns 取消订阅函数
 */
export function subscribe(fn: Listener) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * 清理所有状态（用于测试或重置）
 */
export function resetMouseState() {
  state.overCharacters.clear();
  state.overPopovers.clear();
  updateMouseIgnore();
  notifyListeners();
}
