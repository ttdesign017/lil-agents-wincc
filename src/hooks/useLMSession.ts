import { useEffect, useRef, useState, useCallback } from 'react';

export interface ImageAttachment {
  mimeType: string;
  data: string; // base64
}

export interface VideoAttachment {
  path: string;
  thumbnail: string; // base64 首帧图片
}

export interface ToolCallData {
  tool: string;
  command: string;
  output: string;
  exitCode: number;
  isRunning?: boolean;
}

export interface Message {
  type: 'output' | 'error' | 'user' | 'thinking';
  text: string;
  images?: ImageAttachment[];
  videos?: VideoAttachment[];
  reasoning?: string;
  reasoningDone?: boolean;
  lastReasoningItem?: string;
  toolCalls?: ToolCallData[];
}

interface ChatMLCleaner {
  inUserBlock: boolean;
  inSystemBlock: boolean;
  inAssistantBlock: boolean;
  buffer: string;
}

function createChatMLCleaner(): ChatMLCleaner {
  return { inUserBlock: false, inSystemBlock: false, inAssistantBlock: true, buffer: '' };
}

function cleanChatMLIncremental(state: ChatMLCleaner, chunk: string): string {
  if (!chunk) return '';
  state.buffer += chunk;
  let result = '';
  let searchFrom = 0;
  while (true) {
    const remaining = state.buffer.slice(searchFrom);
    if (!remaining) break;
    const imStart = remaining.indexOf('<|im_start|>');
    const imEnd = remaining.indexOf('<|im_end|>');
    if (imStart === -1 && imEnd === -1) {
      const lastNewline = remaining.lastIndexOf('\n');
      const keepStart = lastNewline >= 0 ? searchFrom + lastNewline + 1 : searchFrom;
      const candidate = state.buffer.slice(searchFrom, keepStart);
      const rest = state.buffer.slice(keepStart);
      if (state.inAssistantBlock && candidate) result += candidate;
      state.buffer = rest;
      break;
    }
    if (imStart !== -1 && (imEnd === -1 || imStart < imEnd)) {
      const before = remaining.slice(0, imStart);
      if (state.inAssistantBlock && before) result += before;
      const after = remaining.slice(imStart + '<|im_start|>'.length);
      const roleMatch = after.match(/^(user|assistant|system)\s*\n?/);
      if (roleMatch) {
        const role = roleMatch[1];
        state.inUserBlock = role === 'user';
        state.inSystemBlock = role === 'system';
        state.inAssistantBlock = role === 'assistant';
        searchFrom += imStart + '<|im_start|>'.length + roleMatch[0].length;
      } else {
        state.buffer = remaining;
        break;
      }
    } else {
      const before = remaining.slice(0, imEnd);
      if (state.inAssistantBlock && before) result += before;
      state.inUserBlock = false;
      state.inSystemBlock = false;
      state.inAssistantBlock = true;
      searchFrom += imEnd + '<|im_end|>'.length;
    }
  }
  return result;
}

function finalizeChatMLClean(state: ChatMLCleaner): string {
  let result = '';
  if (state.inAssistantBlock && state.buffer) result = state.buffer;
  state.buffer = '';
  return result;
}

interface LLMSyncState {
  chatHistory: Message[];
  isThinking: boolean;
  hasUnread: boolean;
  deepThinking: boolean;
  currentModel: string;
  selectedPrompt: string | null;
  prompts: string[];
  chatLimitWarned: boolean;
}

type LLMCommand =
  | { type: 'submit'; text: string; images?: ImageAttachment[]; videos?: VideoAttachment[] }
  | { type: 'clear' }
  | { type: 'stop' }
  | { type: 'select-prompt'; promptName: string }
  | { type: 'select-model'; modelName: string }
  | { type: 'set-deep-thinking'; value: boolean }
  | { type: 'request-sync' }
  | { type: 'set-has-unread'; value: boolean }
  | { type: 'set-is-thinking'; value: boolean };

export function useLMSession(name: string, isMaster: boolean, llmChannel: BroadcastChannel | null) {
  const [chatHistory, setChatHistory] = useState<Message[]>([
    { type: 'output', text: `Hi, I'm ${name}. Ask me anything!` }
  ]);
  const [chatLimitWarned, setChatLimitWarned] = useState(false);
  const chatLimitWarnedRef = useRef(false);
  const [isThinking, setIsThinking] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const popoverRef = useRef(false);
  const [deepThinking, setDeepThinking] = useState(false);
  const deepThinkingRef = useRef(false);
  useEffect(() => { deepThinkingRef.current = deepThinking; }, [deepThinking]);

  const [currentModel, setCurrentModel] = useState('Codex');
  const currentModelRef = useRef('Codex');
  useEffect(() => { currentModelRef.current = currentModel; }, [currentModel]);

  const getProviderForModel = (model: string): 'lmstudio' | 'codex' | 'claude' => {
    if (model === 'Codex') return 'codex';
    if (model === 'Claude') return 'claude';
    return 'lmstudio';
  };

  const [prompts, setPrompts] = useState<string[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);

  const chatHistoryRef = useRef(chatHistory);
  const isThinkingRef = useRef(isThinking);
  const hasUnreadRef = useRef(hasUnread);
  const selectedPromptRef = useRef<string | null>(selectedPrompt);
  const promptsRef = useRef<string[]>(prompts);
  const chatLimitWarnedStateRef = useRef(chatLimitWarned);

  useEffect(() => { chatHistoryRef.current = chatHistory; }, [chatHistory]);
  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);
  useEffect(() => { hasUnreadRef.current = hasUnread; }, [hasUnread]);
  useEffect(() => { selectedPromptRef.current = selectedPrompt; }, [selectedPrompt]);
  useEffect(() => { promptsRef.current = prompts; }, [prompts]);
  useEffect(() => { chatLimitWarnedStateRef.current = chatLimitWarned; }, [chatLimitWarned]);

  const buildSyncState = useCallback((): LLMSyncState => ({
    chatHistory: chatHistoryRef.current,
    isThinking: isThinkingRef.current,
    hasUnread: hasUnreadRef.current,
    deepThinking: deepThinkingRef.current,
    currentModel: currentModelRef.current,
    selectedPrompt: selectedPromptRef.current,
    prompts: promptsRef.current,
    chatLimitWarned: chatLimitWarnedStateRef.current,
  }), []);

  const broadcastState = useCallback(() => {
    if (!llmChannel) return;
    llmChannel.postMessage({
      type: 'llm-state',
      name,
      state: buildSyncState(),
    });
  }, [llmChannel, name, buildSyncState]);

  const broadcastStateThrottledRef = useRef(false);
  const scheduleBroadcast = useCallback(() => {
    if (!llmChannel) return;
    if (broadcastStateThrottledRef.current) return;
    broadcastStateThrottledRef.current = true;
    requestAnimationFrame(() => {
      broadcastStateThrottledRef.current = false;
      broadcastState();
    });
  }, [llmChannel, broadcastState]);

  useEffect(() => {
    if (!isMaster) return;
    if (!llmChannel) return;

    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.name !== name) return;

      switch (data.type) {
        case 'llm-command': {
          const cmd: LLMCommand = data.command;
          switch (cmd.type) {
            case 'submit':
              handleSubmitMessageLocal(cmd.text, cmd.images, cmd.videos);
              break;
            case 'clear':
              handleClearHistoryLocal();
              break;
            case 'stop':
              handleStopLocal();
              break;
            case 'select-prompt':
              handleSelectPromptLocal(cmd.promptName);
              break;
            case 'select-model':
              handleSelectModelLocal(cmd.modelName);
              break;
            case 'set-deep-thinking':
              setDeepThinking(cmd.value);
              deepThinkingRef.current = cmd.value;
              scheduleBroadcast();
              break;
            case 'set-has-unread':
              setHasUnread(cmd.value);
              hasUnreadRef.current = cmd.value;
              scheduleBroadcast();
              break;
            case 'set-is-thinking':
              setIsThinking(cmd.value);
              isThinkingRef.current = cmd.value;
              scheduleBroadcast();
              break;
          }
          break;
        }
        case 'request-sync': {
          scheduleBroadcast();
          break;
        }
      }
    };

    llmChannel.addEventListener('message', handleMessage);
    return () => llmChannel.removeEventListener('message', handleMessage);
  }, [isMaster, llmChannel, name]);

  useEffect(() => {
    if (isMaster) return;
    if (!llmChannel) return;

    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.name !== name) return;
      if (data.type !== 'llm-state') return;

      const state: LLMSyncState = data.state;
      setChatHistory(state.chatHistory);
      setIsThinking(state.isThinking);
      setHasUnread(state.hasUnread);
      setDeepThinking(state.deepThinking);
      deepThinkingRef.current = state.deepThinking;
      setCurrentModel(state.currentModel);
      currentModelRef.current = state.currentModel;
      setSelectedPrompt(state.selectedPrompt);
      setPrompts(state.prompts);
      setChatLimitWarned(state.chatLimitWarned);
      chatLimitWarnedRef.current = state.chatLimitWarned;
    };

    llmChannel.addEventListener('message', handleMessage);

    llmChannel.postMessage({ type: 'request-sync', name });

    return () => llmChannel.removeEventListener('message', handleMessage);
  }, [isMaster, llmChannel, name]);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.listPrompts) return;
    if (!isMaster) return;
    api.listPrompts(name).then((res: { prompts: string[]; selected: string | null }) => {
      setPrompts(res.prompts || []);
      setSelectedPrompt(res.selected ?? null);
      setTimeout(() => scheduleBroadcast(), 0);
    }).catch(() => { /* ignore */ });
  }, [name, isMaster, scheduleBroadcast]);

  const handleSubmitMessageLocal = useCallback((text: string, images?: ImageAttachment[], videos?: VideoAttachment[]) => {
    let finalText = text;
    if (videos && videos.length > 0) {
      const videoPaths = videos.map(v => `"${v.path}"`).join(' ');
      finalText = videoPaths + (finalText ? ' ' + finalText : '');
    }

    setChatHistory(prev => [...prev, {
      type: 'user',
      text,
      images: images && images.length > 0 ? images : undefined,
      videos: videos && videos.length > 0 ? videos : undefined
    }]);
    setIsThinking(true);
    setHasUnread(false);
    if ((window as any).electronAPI) {
      const dt = deepThinkingRef.current;
      if (images && images.length > 0) {
        (window as any).electronAPI.sendLLMInput(name, { text: finalText, images, deepThinking: dt });
      } else {
        (window as any).electronAPI.sendLLMInput(name, { text: finalText, deepThinking: dt });
      }
    }
    scheduleBroadcast();
  }, [name, scheduleBroadcast]);

  const handleClearHistoryLocal = useCallback(() => {
    setChatHistory([{ type: 'output', text: `History cleared!` }]);
    chatLimitWarnedRef.current = false;
    setChatLimitWarned(false);
    if ((window as any).electronAPI) {
      (window as any).electronAPI.clearLLM(name);
    }
    scheduleBroadcast();
  }, [name, scheduleBroadcast]);

  const handleSelectPromptLocal = useCallback((promptName: string) => {
    if (promptName === selectedPromptRef.current) return;
    setSelectedPrompt(promptName);
    selectedPromptRef.current = promptName;
    if ((window as any).electronAPI?.setPrompt) {
      (window as any).electronAPI.setPrompt(name, promptName);
    }
    setChatHistory([{ type: 'output', text: `已切换到「${promptName}」` }]);
    chatLimitWarnedRef.current = false;
    setChatLimitWarned(false);
    setIsThinking(false);
    scheduleBroadcast();
  }, [name, scheduleBroadcast]);

  const handleSelectModelLocal = useCallback((modelName: string) => {
    if (modelName === currentModelRef.current) return;
    setCurrentModel(modelName);
    currentModelRef.current = modelName;
    const provider = getProviderForModel(modelName);
    if ((window as any).electronAPI?.setProvider) {
      (window as any).electronAPI.setProvider(name, provider, modelName);
    }
    setChatHistory([{ type: 'output', text: `已切换到「${modelName}」` }]);
    chatLimitWarnedRef.current = false;
    setChatLimitWarned(false);
    setIsThinking(false);
    scheduleBroadcast();
  }, [name, scheduleBroadcast]);

  const handleStopLocal = useCallback(() => {
    if ((window as any).electronAPI?.stopLLM) {
      (window as any).electronAPI.stopLLM(name);
    }
    setIsThinking(false);
    scheduleBroadcast();
  }, [name, scheduleBroadcast]);

  useEffect(() => {
    if (!isMaster) return;
    if (!(window as any).electronAPI) return;
    (window as any).electronAPI.startLLM(name);
    const defaultProvider = getProviderForModel(currentModelRef.current);
    if ((window as any).electronAPI?.setProvider) {
      (window as any).electronAPI.setProvider(name, defaultProvider, currentModelRef.current);
    }

    const contentCleaner = createChatMLCleaner();
    const reasoningCleaner = createChatMLCleaner();

    let pendingChunk = '';
    let pendingReasoning = '';
    let rafScheduled = false;

    const flushAll = () => {
      const chunk = pendingChunk; pendingChunk = '';
      const reasoning = pendingReasoning; pendingReasoning = '';
      if (!chunk && !reasoning) return;
      setChatHistory(prev => {
        let updated = [...prev];
        const lastIndex = updated.length - 1;
        if (lastIndex >= 0 && updated[lastIndex].type === 'output') {
          const last = updated[lastIndex];
          updated[lastIndex] = {
            ...last,
            text: last.text + chunk,
            reasoning: reasoning ? (last.reasoning || '') + reasoning : last.reasoning,
          };
        } else {
          updated.push({ type: 'output', text: chunk, reasoning: reasoning || undefined });
        }
        if (updated.length > 180 && !chatLimitWarnedRef.current) {
          chatLimitWarnedRef.current = true;
          setChatLimitWarned(true);
          if (updated[updated.length - 1].type !== 'thinking') {
            updated.push({ type: 'thinking', text: '⚠️ Chat nearing capacity (200 msgs). Older messages will be trimmed.' });
          }
        }
        if (updated.length > 200) updated = updated.slice(-200);
        return updated;
      });
      scheduleBroadcast();
    };

    const scheduleFlush = () => {
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        flushAll();
      });
    };

    const offData = (window as any).electronAPI.onLLMData(name, (data: string) => {
      const cleaned = cleanChatMLIncremental(contentCleaner, data);
      if (cleaned) {
        pendingChunk += cleaned;
        scheduleFlush();
      }
    });

    const offReasoning = (window as any).electronAPI.onLLMReasoning?.(name, (data: string) => {
      const cleaned = cleanChatMLIncremental(reasoningCleaner, data);
      if (cleaned) {
        pendingReasoning += cleaned;
        scheduleFlush();
      }
    });

    const offReasoningEnd = (window as any).electronAPI.onLLMReasoningEnd?.(name, () => {
      const tail = finalizeChatMLClean(contentCleaner);
      if (tail) pendingChunk += tail;
      const rtail = finalizeChatMLClean(reasoningCleaner);
      if (rtail) pendingReasoning += rtail;
      flushAll();
      setChatHistory(prev => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        if (lastIndex >= 0 && updated[lastIndex].type === 'output' && updated[lastIndex].reasoning) {
          updated[lastIndex] = { ...updated[lastIndex], reasoningDone: true };
        }
        return updated;
      });
      scheduleBroadcast();
    });

    const offReasoningItem = (window as any).electronAPI.onLLMReasoningItem?.(name, (data: string) => {
      const item = data.trim();
      if (!item) return;
      setChatHistory(prev => {
        let updated = [...prev];
        let lastIndex = updated.length - 1;
        // 始终合并到当前这轮的 output 消息，保证只有一个"已深度思考"块
        if (lastIndex < 0 || updated[lastIndex].type !== 'output') {
          updated.push({ type: 'output', text: '', reasoning: '', reasoningDone: false });
          lastIndex = updated.length - 1;
        }
        const last = updated[lastIndex];
        const merged = last.reasoning ? `${last.reasoning}\n\n${item}` : item;
        updated[lastIndex] = { ...last, reasoning: merged, reasoningDone: false, lastReasoningItem: item };
        if (updated.length > 200) updated = updated.slice(-200);
        return updated;
      });
      scheduleBroadcast();
    });

    const offError = (window as any).electronAPI.onLLMError(name, (data: string) => {
      const tail = finalizeChatMLClean(contentCleaner);
      if (tail) pendingChunk += tail;
      const rtail = finalizeChatMLClean(reasoningCleaner);
      if (rtail) pendingReasoning += rtail;
      flushAll();
      setChatHistory(prev => [...prev, { type: 'error', text: data }]);
      setIsThinking(false);
      scheduleBroadcast();
    });

    const offTurn = (window as any).electronAPI.onLLMTurnComplete?.(name, () => {
      const tail = finalizeChatMLClean(contentCleaner);
      if (tail) pendingChunk += tail;
      const rtail = finalizeChatMLClean(reasoningCleaner);
      if (rtail) pendingReasoning += rtail;
      flushAll();
      setChatHistory(prev => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        if (lastIndex >= 0 && updated[lastIndex].type === 'output' && updated[lastIndex].reasoning && !updated[lastIndex].reasoningDone) {
          updated[lastIndex] = { ...updated[lastIndex], reasoningDone: true };
        }
        return updated;
      });
      setIsThinking(v => {
        if (v) {
          if (!popoverRef.current) setHasUnread(true);
          return false;
        }
        return v;
      });
      scheduleBroadcast();
    });

    const offToolCall = (window as any).electronAPI.onLLMToolCall?.(name, (data: ToolCallData) => {
      setChatHistory(prev => {
        const updated = [...prev];
        let lastIndex = updated.length - 1;
        if (lastIndex < 0 || updated[lastIndex].type !== 'output') {
          updated.push({ type: 'output', text: '', toolCalls: [] });
          lastIndex = updated.length - 1;
        }
        const last = updated[lastIndex];
        const toolCalls = last.toolCalls ? [...last.toolCalls] : [];

        if (data.isRunning) {
          toolCalls.push(data);
        } else {
          let matched = false;
          for (let i = toolCalls.length - 1; i >= 0; i--) {
            if (toolCalls[i].command === data.command && toolCalls[i].isRunning) {
              toolCalls[i] = data;
              matched = true;
              break;
            }
          }
          if (!matched) {
            toolCalls.push(data);
          }
        }

        updated[lastIndex] = { ...last, toolCalls };
        return updated;
      });
      scheduleBroadcast();
    });

    return () => {
      offData(); offReasoning?.(); offReasoningEnd?.(); offReasoningItem?.(); offError(); offTurn?.(); offToolCall?.();
    };
  }, [name, isMaster, scheduleBroadcast]);

  const handleSubmitMessage = useCallback((text: string, images?: ImageAttachment[], videos?: VideoAttachment[]) => {
    if (isMaster) {
      handleSubmitMessageLocal(text, images, videos);
    } else if (llmChannel) {
      llmChannel.postMessage({ type: 'llm-command', name, command: { type: 'submit', text, images, videos } });
    }
  }, [isMaster, llmChannel, name, handleSubmitMessageLocal]);

  const handleClearHistory = useCallback(() => {
    if (isMaster) {
      handleClearHistoryLocal();
    } else if (llmChannel) {
      llmChannel.postMessage({ type: 'llm-command', name, command: { type: 'clear' } });
    }
  }, [isMaster, llmChannel, name, handleClearHistoryLocal]);

  const handleSelectPrompt = useCallback((promptName: string) => {
    if (isMaster) {
      handleSelectPromptLocal(promptName);
    } else if (llmChannel) {
      llmChannel.postMessage({ type: 'llm-command', name, command: { type: 'select-prompt', promptName } });
    }
  }, [isMaster, llmChannel, name, handleSelectPromptLocal]);

  const handleSelectModel = useCallback((modelName: string) => {
    if (isMaster) {
      handleSelectModelLocal(modelName);
    } else if (llmChannel) {
      llmChannel.postMessage({ type: 'llm-command', name, command: { type: 'select-model', modelName } });
    }
  }, [isMaster, llmChannel, name, handleSelectModelLocal]);

  const handleStop = useCallback(() => {
    if (isMaster) {
      handleStopLocal();
    } else if (llmChannel) {
      llmChannel.postMessage({ type: 'llm-command', name, command: { type: 'stop' } });
    }
  }, [isMaster, llmChannel, name, handleStopLocal]);

  const setDeepThinkingSync = useCallback((v: boolean) => {
    if (isMaster) {
      setDeepThinking(v);
      deepThinkingRef.current = v;
      scheduleBroadcast();
    } else if (llmChannel) {
      llmChannel.postMessage({ type: 'llm-command', name, command: { type: 'set-deep-thinking', value: v } });
    }
  }, [isMaster, llmChannel, name, scheduleBroadcast]);

  const setHasUnreadSync = useCallback((v: boolean) => {
    if (isMaster) {
      setHasUnread(v);
      hasUnreadRef.current = v;
      scheduleBroadcast();
    } else if (llmChannel) {
      llmChannel.postMessage({ type: 'llm-command', name, command: { type: 'set-has-unread', value: v } });
    }
  }, [isMaster, llmChannel, name, scheduleBroadcast]);

  const setIsThinkingSync = useCallback((v: boolean) => {
    if (isMaster) {
      setIsThinking(v);
      isThinkingRef.current = v;
      scheduleBroadcast();
    } else if (llmChannel) {
      llmChannel.postMessage({ type: 'llm-command', name, command: { type: 'set-is-thinking', value: v } });
    }
  }, [isMaster, llmChannel, name, scheduleBroadcast]);

  return {
    chatHistory, isThinking, hasUnread, popoverRef,
    setHasUnread: setHasUnreadSync,
    setIsThinking: setIsThinkingSync,
    setChatHistory, setChatLimitWarned,
    handleSubmitMessage, handleClearHistory, handleStop,
    deepThinking, setDeepThinking: setDeepThinkingSync,
    prompts, selectedPrompt, handleSelectPrompt,
    currentModel, handleSelectModel,
  };
}
