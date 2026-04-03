import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => 
    ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  getTaskbarInfo: () => ipcRenderer.invoke('get-taskbar-info'),
  startClaude: (sessionId: string) => ipcRenderer.send('start-claude', sessionId),
  sendClaudeInput: (sessionId: string, input: string) => ipcRenderer.send('send-claude-input', sessionId, input),
  killClaude: (sessionId: string) => ipcRenderer.send('kill-claude', sessionId),
  onClaudeData: (id: string, callback: (data: string) => void) => {
    const handler = (_event: any, respId: string, data: string) => { if (id === respId) callback(data); };
    ipcRenderer.on('claude-data', handler);
    return () => ipcRenderer.off('claude-data', handler);
  },
  onClaudeError: (id: string, callback: (data: string) => void) => {
    const handler = (_event: any, respId: string, data: string) => { if (id === respId) callback(data); };
    ipcRenderer.on('claude-error', handler);
    return () => ipcRenderer.off('claude-error', handler);
  },
  onClaudeExit: (id: string, callback: (code: number) => void) => {
    const handler = (_event: any, respId: string, code: number) => { if (id === respId) callback(code); };
    ipcRenderer.on('claude-exit', handler);
    return () => ipcRenderer.off('claude-exit', handler);
  },
  onClaudeTurnComplete: (id: string, callback: () => void) => {
    const handler = (_event: any, respId: string) => { if (id === respId) callback(); };
    ipcRenderer.on('claude-turn-complete', handler);
    return () => ipcRenderer.off('claude-turn-complete', handler);
  },
  onToggleVisibility: (callback: (name: string, isVisible: boolean) => void) => {
    const handler = (_event: any, name: string, isVisible: boolean) => callback(name, isVisible);
    ipcRenderer.on('toggle-visibility', handler);
    return () => ipcRenderer.off('toggle-visibility', handler);
  },
  onThemeChange: (callback: (theme: string) => void) => {
    const handler = (_event: any, theme: string) => callback(theme);
    ipcRenderer.on('set-app-theme', handler);
    return () => ipcRenderer.off('set-app-theme', handler);
  },
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
});
