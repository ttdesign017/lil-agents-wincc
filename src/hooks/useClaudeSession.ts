import { useEffect, useRef, useState, useCallback } from 'react';

export interface ImageAttachment {
  mimeType: string;
  data: string; // base64
}

export interface Message {
  type: 'output' | 'error' | 'user' | 'thinking';
  text: string;
  images?: ImageAttachment[];
}

export function useClaudeSession(name: string) {
  const [chatHistory, setChatHistory] = useState<Message[]>([
    { type: 'output', text: `Hi, I'm ${name}. Ask me anything!` }
  ]);
  const [chatLimitWarned, setChatLimitWarned] = useState(false);
  const chatLimitWarnedRef = useRef(false);
  const [isThinking, setIsThinking] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const popoverRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // IPC listeners for Claude
  useEffect(() => {
    if (!(window as any).electronAPI) return;
    (window as any).electronAPI.startClaude(name);

    let chunkBuffer = '';
    const flushChunk = (chunk: string) => {
      if (!chunk) return;
      setChatHistory(prev => {
        let updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].type === 'output') {
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, text: last.text + (last.text ? '\n' : '') + chunk };
        } else {
          updated.push({ type: 'output', text: chunk });
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
    };

    const offData = (window as any).electronAPI.onClaudeData(name, (data: string) => {
      chunkBuffer += data;
      const idx = chunkBuffer.lastIndexOf('\n');
      if (idx !== -1) {
        const complete = chunkBuffer.slice(0, idx);
        chunkBuffer = chunkBuffer.slice(idx + 1);
        flushChunk(complete);
      }
      if (chunkBuffer) {
        clearTimeout(debounceTimerRef.current as any);
        debounceTimerRef.current = setTimeout(() => { flushChunk(chunkBuffer); chunkBuffer = ''; }, 200);
      }
    });

    const offError = (window as any).electronAPI.onClaudeError(name, (data: string) => {
      setChatHistory(prev => [...prev, { type: 'error', text: data }]);
    });

    const offExit = (window as any).electronAPI.onClaudeExit(name, (code: number) => {
      setIsThinking(v => {
        if (v) {
          if (code !== 0) setChatHistory(prev => [...prev, { type: 'error', text: `[Session ended, code ${code}]` }]);
          return false;
        }
        return v;
      });
    });

    const offTurn = (window as any).electronAPI.onClaudeTurnComplete?.(name, () => {
      setIsThinking(v => {
        if (v) {
          if (!popoverRef.current) setHasUnread(true);
          return false;
        }
        return v;
      });
    });

    return () => {
      offData(); offError(); offExit(); offTurn?.();
      clearTimeout(debounceTimerRef.current as any);
    };
  }, [name]); // chatLimitWarned read via functional updater, no need in deps

  const handleSubmitMessage = useCallback((text: string, images?: ImageAttachment[]) => {
    setChatHistory(prev => [...prev, { type: 'user', text, images: images && images.length > 0 ? images : undefined }]);
    setIsThinking(true);
    setHasUnread(false);
    if ((window as any).electronAPI) {
      if (images && images.length > 0) {
        (window as any).electronAPI.sendClaudeInput(name, { text, images });
      } else {
        (window as any).electronAPI.sendClaudeInput(name, text);
      }
    }
  }, [name]);

  const handleClearHistory = useCallback(() => {
    setChatHistory([{ type: 'output', text: `History cleared!` }]);
  }, []);

  return {
    chatHistory, isThinking, hasUnread, popoverRef,
    setHasUnread, setIsThinking, setChatHistory, setChatLimitWarned,
    handleSubmitMessage, handleClearHistory,
  };
}
