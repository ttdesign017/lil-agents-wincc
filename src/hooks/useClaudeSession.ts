import { useEffect, useRef, useState, useCallback } from 'react';

export interface ImageAttachment {
  mimeType: string;
  data: string; // base64
}

export interface VideoAttachment {
  path: string;
  thumbnail: string; // base64 首帧图片
}

export interface Message {
  type: 'output' | 'error' | 'user' | 'thinking';
  text: string;
  images?: ImageAttachment[];
  videos?: VideoAttachment[];
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

  // IPC listeners for Claude
  useEffect(() => {
    if (!(window as any).electronAPI) return;
    (window as any).electronAPI.startClaude(name);

    const flushChunk = (chunk: string) => {
      if (!chunk) return;
      setChatHistory(prev => {
        let updated = [...prev];
        const lastIndex = updated.length - 1;
        if (lastIndex >= 0 && updated[lastIndex].type === 'output') {
          // Append to existing output message (streaming)
          const last = updated[lastIndex];
          updated[lastIndex] = { ...last, text: last.text + chunk };
        } else {
          // Create new output message
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
      // Directly flush each IPC message (already line-separated from main process)
      flushChunk(data);
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
    };
  }, [name]); // chatLimitWarned read via functional updater, no need in deps

  const handleSubmitMessage = useCallback((text: string, images?: ImageAttachment[], videos?: VideoAttachment[]) => {
    // 把视频路径拼到文本前面
    let finalText = text;
    if (videos && videos.length > 0) {
      const videoPaths = videos.map(v => `"${v.path}"`).join(' ');
      finalText = videoPaths + (finalText ? ' ' + finalText : '');
    }

    setChatHistory(prev => [...prev, {
      type: 'user',
      text, // 界面只显示用户输入的提示词，不显示路径
      images: images && images.length > 0 ? images : undefined,
      videos: videos && videos.length > 0 ? videos : undefined
    }]);
    setIsThinking(true);
    setHasUnread(false);
    if ((window as any).electronAPI) {
      if (images && images.length > 0) {
        (window as any).electronAPI.sendClaudeInput(name, { text: finalText, images });
      } else {
        (window as any).electronAPI.sendClaudeInput(name, finalText);
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
