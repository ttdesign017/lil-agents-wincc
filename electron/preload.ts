import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) =>
    ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  getCursorPos: () => ipcRenderer.invoke('get-cursor-pos'),
  getTaskbarInfo: () => ipcRenderer.invoke('get-taskbar-info'),
  startLLM: (sessionId: string) => ipcRenderer.send('start-llm', sessionId),
  sendLLMInput: (sessionId: string, input: string | { text: string; images?: Array<{ mimeType: string; data: string }>; deepThinking?: boolean }) => ipcRenderer.send('send-llm-input', sessionId, input),
  killLLM: (sessionId: string) => ipcRenderer.send('kill-llm', sessionId),
  stopLLM: (sessionId: string) => ipcRenderer.send('stop-llm', sessionId),
  clearLLM: (sessionId: string) => ipcRenderer.send('clear-llm', sessionId),
  listPrompts: (sessionId: string) => ipcRenderer.invoke('list-prompts', sessionId),
  setPrompt: (sessionId: string, promptName: string) => ipcRenderer.send('set-prompt', sessionId, promptName),
  setProvider: (sessionId: string, provider: string, modelName?: string) => ipcRenderer.send('set-provider', sessionId, provider, modelName),
  onLLMData: (id: string, callback: (data: string) => void) => {
    const handler = (_event: any, respId: string, data: string) => { if (id === respId) callback(data); };
    ipcRenderer.on('llm-data', handler);
    return () => ipcRenderer.off('llm-data', handler);
  },
  onLLMReasoning: (id: string, callback: (data: string) => void) => {
    const handler = (_event: any, respId: string, data: string) => { if (id === respId) callback(data); };
    ipcRenderer.on('llm-reasoning', handler);
    return () => ipcRenderer.off('llm-reasoning', handler);
  },
  onLLMReasoningEnd: (id: string, callback: () => void) => {
    const handler = (_event: any, respId: string) => { if (id === respId) callback(); };
    ipcRenderer.on('llm-reasoning-end', handler);
    return () => ipcRenderer.off('llm-reasoning-end', handler);
  },
  onLLMReasoningItem: (id: string, callback: (data: string) => void) => {
    const handler = (_event: any, respId: string, data: string) => { if (id === respId) callback(data); };
    ipcRenderer.on('llm-reasoning-item', handler);
    return () => ipcRenderer.off('llm-reasoning-item', handler);
  },
  onLLMError: (id: string, callback: (data: string) => void) => {
    const handler = (_event: any, respId: string, data: string) => { if (id === respId) callback(data); };
    ipcRenderer.on('llm-error', handler);
    return () => ipcRenderer.off('llm-error', handler);
  },
  onLLMTurnComplete: (id: string, callback: () => void) => {
    const handler = (_event: any, respId: string) => { if (id === respId) callback(); };
    ipcRenderer.on('llm-turn-complete', handler);
    return () => ipcRenderer.off('llm-turn-complete', handler);
  },
  onLLMToolCall: (id: string, callback: (data: { tool: string; command: string; output: string; exitCode: number }) => void) => {
    const handler = (_event: any, respId: string, data: any) => { if (id === respId) callback(data); };
    ipcRenderer.on('llm-tool-call', handler);
    return () => ipcRenderer.off('llm-tool-call', handler);
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
  onDisplayChange: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on('display-metrics-changed', handler);
    return () => ipcRenderer.off('display-metrics-changed', handler);
  },
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  setTrayVisibility: (name: string, visible: boolean) => ipcRenderer.send('set-tray-visibility', name, visible),
  selectImage: () => ipcRenderer.invoke('select-image'),
  exportChat: (filename: string, content: string) => ipcRenderer.invoke('export-chat', filename, content),
});
