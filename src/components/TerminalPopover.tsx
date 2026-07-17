import React, { useState, useEffect, useRef, useCallback, forwardRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ImageAttachment, Message, VideoAttachment, ToolCallData } from '../hooks/useLMSession';

function formatMarkdown(history: Message[], personaName: string): string {
  const lines: string[] = [];
  for (const msg of history) {
    if (msg.type === 'user') {
      lines.push(`**User**: ${msg.text}`.trim());
    } else if (msg.type === 'output') {
      lines.push(`**${personaName}**: ${msg.text}`.trim());
    } else if (msg.type === 'error') {
      lines.push(`**Error**: ${msg.text}`);
    } else if (msg.type === 'thinking') {
      lines.push(`_${msg.text}_`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

interface TerminalPopoverProps {
  onClose: () => void;
  name: string;
  history: Message[];
  isThinking: boolean;
  onSubmitMessage: (text: string, images?: ImageAttachment[], videos?: VideoAttachment[]) => void;
  onClearHistory: () => void;
  popoverScreenX: number;
  characterScreenY: number;
  onPopoverMouseEnter?: () => void;
  onPopoverMouseLeave?: () => void;
  inputText: string;
  onInputTextChange: (text: string) => void;
  pendingImages: ImageAttachment[];
  onPendingImagesChange: (images: ImageAttachment[]) => void;
  deepThinking: boolean;
  onToggleDeepThinking: () => void;
  onStop: () => void;
  heightExpanded: boolean;
  onToggleHeightExpanded: () => void;
  prompts: string[];
  selectedPrompt: string | null;
  onSelectPrompt: (promptName: string) => void;
  currentModel: string;
  onSelectModel: (modelName: string) => void;
}

// 深度思考过程展示：
//  - 思考进行中：固定约 3 行高度的预览框（类似 markdown 引用样式），
//    内容流式追加并自动向上滚动，始终显示最新一行；
//  - 思考结束：自动折叠为一个小部件，点击可展开查看完整思考过程，
//    展开后下方提供"收起思考过程"小部件。
const ReasoningBlock: React.FC<{ reasoning: string; done: boolean }> = ({ reasoning, done }) => {
  const [expanded, setExpanded] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  // 思考结束后自动折叠（done 由 false→true 时收起展开态）
  const prevDone = useRef(done);
  useEffect(() => {
    if (done && !prevDone.current) setExpanded(false);
    prevDone.current = done;
  }, [done]);
  // 流式进行中，预览框始终滚动到底部显示最新一行
  useEffect(() => {
    if (!done && previewRef.current) {
      previewRef.current.scrollTop = previewRef.current.scrollHeight;
    }
  }, [reasoning, done]);

  const quoteStyle: React.CSSProperties = {
    borderLeft: '3px solid var(--border-color)',
    paddingLeft: '10px',
    color: 'var(--text-dim)',
    fontSize: '12px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };

  const widgetStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    fontSize: '11px', color: 'var(--text-dim)', cursor: 'pointer',
    padding: '2px 4px', borderRadius: '4px', userSelect: 'none',
  };

  // 进行中：显示全部思考内容
  if (!done) {
    return (
      <div style={{ marginBottom: '6px' }}>
        <div style={{ ...widgetStyle, cursor: 'default' }}>
          <span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>●</span> 思考中...
        </div>
        <div ref={previewRef} style={{
          ...quoteStyle,
          marginTop: '4px',
        }}>{reasoning}</div>
      </div>
    );
  }

  // 已结束：折叠 / 展开
  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={widgetStyle} onClick={() => setExpanded(e => !e)}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.15)'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        已深度思考
      </div>
      {expanded && (
        <>
          <div style={{ ...quoteStyle, marginTop: '4px' }}>{reasoning}</div>
          <div style={{ ...widgetStyle, marginTop: '4px' }} onClick={() => setExpanded(false)}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
              <polyline points="18 15 12 9 6 15"/>
            </svg>
            收起思考过程
          </div>
        </>
      )}
    </div>
  );
};

const ToolCallBlock: React.FC<{ toolCall: ToolCallData }> = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(true);
  const isRunning = toolCall.isRunning;

  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{
        padding: '10px 14px',
        backgroundColor: 'rgba(0,0,0,0.25)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        fontSize: '12px',
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        color: 'var(--text-color)',
        maxHeight: expanded ? 'none' : '4.8em',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {toolCall.output || (isRunning ? '执行中...' : '(no output)')}
      </div>
      {toolCall.output && toolCall.output.length > 200 && (
        <div
          style={{
            fontSize: '11px',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            marginTop: '4px',
            userSelect: 'none',
          }}
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? '收起 ↑' : '展开 ↓'}
        </div>
      )}
    </div>
  );
};

// 已发送的用户气泡：悬停时左侧出现极简复制按钮（两个叠加的方块），
// 移开后延迟 50ms 消失；点击复制该条文本。
// 文本超过两行时自动折叠，提供极简箭头展开/收起。
const UserBubble: React.FC<{ text: string }> = ({ text }) => {
  const [showCopy, setShowCopy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  // 检测文本是否超过两行（折叠态高度 vs 实际内容高度）
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 18;
    setOverflowing(el.scrollHeight > lineHeight * 2 + 2);
  }, [text]);

  const onEnter = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    setShowCopy(true);
  };
  const onLeave = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowCopy(false), 50);
  };
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const doCopy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const collapsed = overflowing && !expanded;

  return (
    <div style={{ textAlign: 'right' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {/* alignItems: flex-end 让复制按钮与气泡底端对齐 */}
      <div style={{ display: 'inline-flex', alignItems: 'flex-end', gap: '6px', maxWidth: '100%' }}>
        {/* 复制按钮：位于气泡左侧，底端对齐 */}
        <button onClick={doCopy} title={copied ? '已复制' : '复制'}
          style={{
            flexShrink: 0, width: '22px', height: '22px', padding: 0, border: 'none', borderRadius: '4px',
            background: 'none', color: 'var(--text-dim)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: showCopy ? 1 : 0, pointerEvents: showCopy ? 'auto' : 'none',
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-color)'; e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.2)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          {copied ? (
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            // 两个叠加的方块
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
        <div style={{
          position: 'relative',
          display: 'inline-block',
          backgroundColor: 'var(--chat-bubble-bg)',
          borderRadius: '14px 3px 14px 14px',
          padding: '8px 12px',
          boxShadow: 'var(--chat-bubble-shadow)',
          wordBreak: 'break-word',
          textAlign: 'left',
        }}>
          <span ref={textRef} style={{
            color: 'var(--chat-bubble-text)', whiteSpace: 'pre-wrap', display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: collapsed ? 2 : 'unset',
            overflow: collapsed ? 'hidden' : 'visible',
            // 折叠态给右侧留出箭头空间，避免文字与箭头重叠
            paddingRight: overflowing ? '18px' : 0,
          }}>{text}</span>
          {overflowing && (
            <div onClick={() => setExpanded(e => !e)}
              style={{ position: 'absolute', top: '7px', right: '8px', display: 'flex', cursor: 'pointer', color: 'var(--chat-bubble-text)', opacity: 0.55 }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.55'; }}
              title={expanded ? '收起' : '展开'}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const TerminalPopover = forwardRef<HTMLDivElement, TerminalPopoverProps>(({
  onClose, name, history, isThinking, onSubmitMessage, onClearHistory,
  popoverScreenX, characterScreenY, onPopoverMouseEnter, onPopoverMouseLeave,
  inputText, onInputTextChange, pendingImages, onPendingImagesChange,
  deepThinking, onToggleDeepThinking, onStop, heightExpanded, onToggleHeightExpanded,
  prompts, selectedPrompt, onSelectPrompt,
  currentModel, onSelectModel,
}, ref) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [pendingVideos, setPendingVideos] = useState<VideoAttachment[]>([]);
  // 对话框高度扩展：false=默认 320px，true=两倍 640px。状态由父组件持有以便关闭后保留。
  // 高度用 CSS transition + ease 缓动动画，向上扩展由父组件按 offsetHeight 锚定底部实现。
  const expanded = heightExpanded;
  const BASE_HEIGHT = 320;
  // 系统提示词下拉菜单
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const promptMenuRef = useRef<HTMLDivElement>(null);
  const promptPanelRef = useRef<HTMLDivElement>(null);
  const promptItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [promptSliderStyle, setPromptSliderStyle] = useState({ top: 0, height: 0, opacity: 0 });
  const promptCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPromptCloseTimer = () => {
    if (promptCloseTimerRef.current) {
      clearTimeout(promptCloseTimerRef.current);
      promptCloseTimerRef.current = null;
    }
  };

  const schedulePromptClose = () => {
    clearPromptCloseTimer();
    promptCloseTimerRef.current = setTimeout(() => {
      setPromptMenuOpen(false);
    }, 100);
  };

  const updatePromptSlider = useCallback((promptName: string) => {
    const el = promptItemRefs.current[promptName];
    const panel = promptPanelRef.current;
    if (!el || !panel) return;
    const panelRect = panel.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    setPromptSliderStyle({
      top: elRect.top - panelRect.top,
      height: elRect.height,
      opacity: 1,
    });
  }, []);

  useEffect(() => {
    if (promptMenuOpen && selectedPrompt) {
      requestAnimationFrame(() => updatePromptSlider(selectedPrompt));
    }
  }, [promptMenuOpen, selectedPrompt, updatePromptSlider]);

  useEffect(() => {
    if (!promptMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (promptMenuRef.current && !promptMenuRef.current.contains(e.target as Node)) {
        setPromptMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      clearPromptCloseTimer();
    };
  }, [promptMenuOpen]);

  // 模型切换按钮
  const MODELS = ['Claude', 'Codex', 'LM Studio'];
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const modelItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [sliderStyle, setSliderStyle] = useState({ left: 0, width: 0, opacity: 0 });
  const [modelPanelPos, setModelPanelPos] = useState({ top: 0, left: 0 });
  const modelCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearModelCloseTimer = () => {
    if (modelCloseTimerRef.current) {
      clearTimeout(modelCloseTimerRef.current);
      modelCloseTimerRef.current = null;
    }
  };

  const scheduleModelClose = () => {
    clearModelCloseTimer();
    modelCloseTimerRef.current = setTimeout(() => {
      setModelMenuOpen(false);
    }, 100);
  };

  const updateSlider = useCallback((model: string) => {
    const el = modelItemRefs.current[model];
    const panel = modelPanelRef.current;
    if (!el || !panel) return;
    const panelRect = panel.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    setSliderStyle({
      left: elRect.left - panelRect.left,
      width: elRect.width,
      opacity: 1,
    });
  }, []);

  useLayoutEffect(() => {
    if (!modelMenuOpen) return;
    const btn = modelMenuRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setModelPanelPos({
      top: rect.top - 6,
      left: rect.left + rect.width / 2,
    });
  }, [modelMenuOpen]);

  useEffect(() => {
    if (modelMenuOpen && currentModel) {
      requestAnimationFrame(() => updateSlider(currentModel));
    }
  }, [modelMenuOpen, currentModel, updateSlider]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (modelMenuRef.current && !modelMenuRef.current.contains(target)
          && modelPanelRef.current && !modelPanelRef.current.contains(target)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      clearModelCloseTimer();
    };
  }, [modelMenuOpen]);

  // 读取视频首帧作为缩略图
  const getVideoThumbnail = useCallback((file: File): Promise<VideoAttachment> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = URL.createObjectURL(file);
      video.crossOrigin = 'anonymous';

      video.onloadeddata = () => {
        // seek到第0.1秒获取首帧
        video.currentTime = 0.1;
      };

      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.8);
        const commaIdx = thumbnail.indexOf(',');
        URL.revokeObjectURL(video.src);

        resolve({
          path: (file as any).path || file.name,
          thumbnail: thumbnail.slice(commaIdx + 1)
        });
      };

      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        reject(new Error('Failed to load video'));
      };
    });
  }, []);

  // Focus input when popover opens and move cursor to end
  useEffect(() => {
    const t = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        // Move cursor to end of input
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }, 50);
    return () => clearTimeout(t);
  }, []);

  // Auto-scroll：流式输出/内容变化时把滚动容器定位到底部，
  // 但仅在「用户停留在底部」时生效。用户一旦向上滚动浏览历史，
  // 就暂停自动贴底、跟随用户视角；滚回底部附近则恢复自动贴底。
  const stickToBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // 距底部 40px 内视为"在底部"，给一点容差应对取整与流式追加
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stickToBottomRef.current = atBottom;
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [history, isThinking]);

  // 每次重新打开/开始新一轮（提交后 isThinking 变 true）默认回到贴底
  useEffect(() => {
    if (isThinking) stickToBottomRef.current = true;
  }, [isThinking]);

  // 高度扩展/收起动画期间：持续把滚动容器钉在底部。
  // 否则收起时 scrollTop 保持旧值会显示中间内容；且动画每帧高度变化时
  // 底部内容若不同步贴底，会与父组件的 top 重定位叠加产生抖动。
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let raf = 0;
    let stopped = false;
    const pin = () => {
      if (stopped) return;
      el.scrollTop = el.scrollHeight;
      raf = requestAnimationFrame(pin);
    };
    raf = requestAnimationFrame(pin);
    // 动画结束后停止（容器 height transition 约 0.35s，留一点余量）
    const timer = setTimeout(() => { stopped = true; cancelAnimationFrame(raf); }, 420);
    return () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [expanded]);

  // Textarea auto-resize
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [inputText]);

  // Read image file as base64
  const readFileAsImage = useCallback((file: File): Promise<ImageAttachment> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const commaIdx = result.indexOf(',');
        resolve({ mimeType: file.type, data: result.slice(commaIdx + 1) });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  // File selection via attachment button
  const handleSelectFile = useCallback(async () => {
    if (!(window as any).electronAPI) return;
    const images: ImageAttachment[] = (await (window as any).electronAPI.selectImage()) || [];
    if (images.length === 0) return;
    onPendingImagesChange([...pendingImages, ...images]);
  }, [pendingImages, onPendingImagesChange]);

  // Paste handler — images from clipboard
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();
    const images: ImageAttachment[] = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) {
        try { images.push(await readFileAsImage(file)); } catch { /* skip */ }
      }
    }
    if (images.length > 0) {
      onPendingImagesChange([...pendingImages, ...images]);
    }
    const text = e.clipboardData.getData('text/plain');
    if (text) onInputTextChange(inputText + text);
  }, [readFileAsImage, pendingImages, onPendingImagesChange, inputText, onInputTextChange]);

  // Remove a pending image
  const removeImage = useCallback((index: number) => {
    onPendingImagesChange(pendingImages.filter((_, i) => i !== index));
  }, [pendingImages, onPendingImagesChange]);

  // Remove a pending video
  const removeVideo = useCallback((index: number) => {
    setPendingVideos(pendingVideos.filter((_, i) => i !== index));
  }, [pendingVideos]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!inputText.trim() && pendingImages.length === 0 && pendingVideos.length === 0) || isThinking) return;
    const userText = inputText.trim();
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;
    const videos = pendingVideos.length > 0 ? [...pendingVideos] : undefined;
    onInputTextChange('');
    onPendingImagesChange([]);
    setPendingVideos([]);
    if (userText === '/clear') { onClearHistory(); return; }
    onSubmitMessage(userText, images, videos);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter：仅在正在输出（stop 按钮出现）时生效，终止当前响应
    if (e.key === 'Enter' && e.ctrlKey) {
      if (isThinking) { e.preventDefault(); onStop(); }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const handleMouseEnter = () => onPopoverMouseEnter?.();
  const handleMouseLeave = () => onPopoverMouseLeave?.();
  const userColor = name === '刘小红' ? 'var(--accent-color)' : (name === '绿油油' ? '#808000' : 'var(--accent-color)');

  // Export handler
  const handleExport = useCallback(async () => {
    if (!(window as any).electronAPI) return;
    const md = formatMarkdown(history, name);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `chat-${name}-${timestamp}.md`;
    await (window as any).electronAPI.exportChat(filename, md);
  }, [history, name]);

  // ── Code block component ──
  const CodeBlock: React.FC<{ language: string; children: string }> = ({ language, children }) => {
    const [copied, setCopied] = useState(false);
    const [themeKey, setThemeKey] = useState(0);
    const doCopy = async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const text = String(children ?? '');
      let success = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          success = true;
        }
      } catch { /* fall through */ }
      if (!success) {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          ta.style.top = '-9999px';
          ta.style.opacity = '0';
          ta.readOnly = true;
          document.body.appendChild(ta);
          ta.select();
          ta.setSelectionRange(0, text.length);
          success = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch { /* ignore */ }
      }
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    useEffect(() => {
      const observer = new MutationObserver(() => setThemeKey(k => k + 1));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    }, []);

    const isDark = document.documentElement.classList.contains('theme-neon') || document.documentElement.classList.contains('theme-toxic');
    const highlighterStyle = isDark ? vscDarkPlus : vs;
    const bgColor = isDark ? '#1e1e1e' : '#eef1f5';
    const btnBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const btnBgHover = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
    const btnColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)';
    const btnColorHover = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)';

    return (
      <div style={{ position: 'relative', margin: '8px 0' }} key={themeKey}>
        <button onClick={doCopy} style={{
          position: 'absolute', top: '8px', right: '8px', width: '26px', height: '26px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: btnBg, color: btnColor,
          border: 'none', borderRadius: '4px', cursor: 'pointer', zIndex: 10, transition: 'all 0.2s',
          pointerEvents: 'auto',
        }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = btnBgHover; e.currentTarget.style.color = btnColorHover; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = btnBg; e.currentTarget.style.color = btnColor; }}
          title={copied ? '已复制!' : '复制代码'}
        >
          {copied
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          }
        </button>
        <SyntaxHighlighter language={language || 'text'} style={highlighterStyle} key={`hl-${themeKey}`}
          wrapLongLines={true}
          customStyle={{ borderRadius: '8px', padding: '16px', fontSize: '12px', lineHeight: 1.6, margin: 0, overflowX: 'auto', backgroundColor: bgColor, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          codeTagProps={{ style: { fontFamily: 'Consolas, Monaco, "Courier New", monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'none' } }}
          lineProps={{ style: { background: 'none', display: 'block' } }}
        >{children}</SyntaxHighlighter>
      </div>
    );
  };

  // Don't render until position is valid (prevents flash at 0,0)
  if (popoverScreenX === 0 && characterScreenY === 0) return null;

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', transform: 'translateX(-50%)',
        width: '420px', maxWidth: '90vw', pointerEvents: 'auto', zIndex: 10000,
      }}
      onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
    >
      <div style={{
        height: `${expanded ? BASE_HEIGHT * 2 : BASE_HEIGHT}px`, maxHeight: '90vh',
        backgroundColor: 'var(--bg-color)', backdropFilter: 'var(--bg-filter)',
        borderRadius: '14px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow)', overflow: 'hidden',
        transition: 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)', willChange: 'height',
        ['--user-color' as string]: userColor,
      }}>
      {/* Title bar：双击空白处扩展/收起高度 */}
      <div
        onDoubleClick={(e) => {
          // 仅在标题栏空白处双击才触发，避免与下拉菜单等交互冲突
          if (e.target === e.currentTarget) onToggleHeightExpanded();
        }}
        title="双击展开/收起对话框"
        style={{ height: '34px', backgroundColor: 'var(--title-bg)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', flexShrink: 0, userSelect: 'none' }}
      >
        {/* 系统提示词下拉选择器 */}
        <div
          ref={promptMenuRef}
          style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
          onMouseEnter={clearPromptCloseTimer}
          onMouseLeave={schedulePromptClose}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setPromptMenuOpen(o => !o); }}
            style={{
              background: promptMenuOpen ? 'rgba(255,255,255,0.5)' : 'none',
              border: 'none', color: 'var(--text-dim)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '4px 8px', borderRadius: '6px',
              maxWidth: '260px',
              transition: 'background-color 0.2s ease, color 0.2s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-color)'; e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.5)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; if (!promptMenuOpen) e.currentTarget.style.backgroundColor = 'transparent'; }}
            title="切换系统提示词"
          >
            <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedPrompt || name}
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"
              style={{ flexShrink: 0, transform: promptMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {promptMenuOpen && prompts.length > 0 && (
            <div
              ref={promptPanelRef}
              style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: '180px',
                backgroundColor: 'var(--panel-bg, var(--bg-color))', backdropFilter: 'var(--bg-filter)',
                border: '1px solid var(--panel-border, var(--border-color))', borderRadius: '10px',
                boxShadow: 'var(--panel-shadow, var(--shadow))',
                padding: '4px', zIndex: 10001, maxHeight: '280px', overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: '0px', userSelect: 'none',
              }}
              onMouseEnter={clearPromptCloseTimer}
              onMouseLeave={schedulePromptClose}
            >
              {/* 竖向滑块指示器 */}
              <div
                style={{
                  position: 'absolute', left: '4px', right: '4px',
                  top: promptSliderStyle.top, height: promptSliderStyle.height,
                  backgroundColor: 'var(--slider-bg, #ffffff)',
                  borderRadius: '7px',
                  boxShadow: 'var(--slider-shadow, 0 1px 3px rgba(0,0,0,0.08))',
                  transition: 'top 0.35s cubic-bezier(0.4, 0, 0.2, 1), height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease',
                  opacity: promptSliderStyle.opacity,
                  pointerEvents: 'none',
                }}
              />
              {prompts.map((p) => {
                const active = p === selectedPrompt;
                return (
                  <button
                    key={p}
                    ref={el => { promptItemRefs.current[p] = el; }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPrompt(p);
                    }}
                    style={{
                      position: 'relative', zIndex: 1,
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '7px 10px', fontSize: '12px', fontWeight: 500,
                      border: 'none', borderRadius: '7px', cursor: 'pointer',
                      color: active ? 'var(--text-color)' : 'var(--text-dim)',
                      backgroundColor: 'transparent',
                      transition: 'color 0.25s ease',
                      whiteSpace: 'nowrap', textAlign: 'left',
                      width: '100%',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = 'var(--text-color)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = active ? 'var(--text-color)' : 'var(--text-dim)';
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"
                      style={{ flexShrink: 0, opacity: active ? 1 : 0, transition: 'opacity 0.2s ease' }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {isThinking && (
            <span style={{ fontSize: '11px', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>●</span> thinking...
            </span>
          )}
          {/* 模型切换按钮 */}
          <div
            ref={modelMenuRef}
            style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
            onMouseEnter={clearModelCloseTimer}
            onMouseLeave={scheduleModelClose}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setModelMenuOpen(o => !o); }}
              style={{
                background: modelMenuOpen ? 'var(--btn-hover-bg, rgba(128,128,128,0.2))' : 'none',
                border: 'none', color: 'var(--text-dim)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '28px', height: '28px', borderRadius: '6px',
                transition: 'background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease',
                boxShadow: modelMenuOpen ? 'var(--btn-hover-shadow, none)' : 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-color)'; e.currentTarget.style.backgroundColor = 'var(--btn-hover-bg, rgba(128,128,128,0.2))'; e.currentTarget.style.boxShadow = 'var(--btn-hover-shadow, none)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; if (!modelMenuOpen) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.boxShadow = 'none'; } }}
              title="切换模型"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>
                <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>
                <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>
              </svg>
            </button>
          </div>
          {modelMenuOpen && createPortal(
            <div
              ref={modelPanelRef}
              style={{
                position: 'fixed', top: modelPanelPos.top, left: modelPanelPos.left,
                transform: 'translate(-50%, -100%)',
                backgroundColor: 'var(--panel-bg, var(--bg-color))', backdropFilter: 'var(--bg-filter)',
                border: '1px solid var(--panel-border, var(--border-color))', borderRadius: '10px',
                boxShadow: 'var(--panel-shadow, var(--shadow))', padding: '4px', zIndex: 10001,
                display: 'flex', gap: '0px', userSelect: 'none',
              }}
              onMouseEnter={clearModelCloseTimer}
              onMouseLeave={scheduleModelClose}
            >
                {/* 滑块指示器 */}
                <div
                  style={{
                    position: 'absolute', top: '4px', bottom: '4px',
                    left: sliderStyle.left, width: sliderStyle.width,
                    backgroundColor: 'var(--slider-bg, #ffffff)',
                    borderRadius: '7px',
                    boxShadow: 'var(--slider-shadow, 0 1px 3px rgba(0,0,0,0.08))',
                    transition: 'left 0.35s cubic-bezier(0.4, 0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease',
                    opacity: sliderStyle.opacity,
                    pointerEvents: 'none',
                  }}
                />
                {MODELS.map((m) => {
                  const active = m === currentModel;
                  return (
                    <button
                      key={m}
                      ref={el => { modelItemRefs.current[m] = el; }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectModel(m);
                      }}
                      style={{
                        position: 'relative', zIndex: 1,
                        padding: '5px 14px', fontSize: '12px', fontWeight: 500,
                        border: 'none', borderRadius: '7px', cursor: 'pointer',
                        color: active ? 'var(--text-color)' : 'var(--text-dim)',
                        backgroundColor: 'transparent',
                        transition: 'color 0.25s ease',
                        whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = 'var(--text-color)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = active ? 'var(--text-color)' : 'var(--text-dim)';
                      }}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
          , document.body)}
          <button onClick={onClearHistory}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px 5px', borderRadius: '6px', transition: 'background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-color)'; e.currentTarget.style.backgroundColor = 'var(--btn-hover-bg, rgba(128,128,128,0.2))'; e.currentTarget.style.boxShadow = 'var(--btn-hover-shadow, none)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}
            title="新对话（清空上下文）"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/>
              <path d="M21 3v5h-5"/>
            </svg>
          </button>
          <button onClick={onToggleDeepThinking}
            style={{ background: deepThinking ? 'var(--btn-hover-bg, rgba(128,128,128,0.2))' : 'none', border: 'none', color: deepThinking ? 'var(--accent-color)' : 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px 5px', borderRadius: '6px', transition: 'background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease', boxShadow: deepThinking ? 'var(--btn-hover-shadow, none)' : 'none' }}
            onMouseEnter={e => { e.currentTarget.style.color = deepThinking ? 'var(--accent-color)' : 'var(--text-color)'; e.currentTarget.style.backgroundColor = 'var(--btn-hover-bg, rgba(128,128,128,0.2))'; e.currentTarget.style.boxShadow = 'var(--btn-hover-shadow, none)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = deepThinking ? 'var(--accent-color)' : 'var(--text-dim)'; e.currentTarget.style.backgroundColor = deepThinking ? 'var(--btn-hover-bg, rgba(128,128,128,0.2))' : 'transparent'; e.currentTarget.style.boxShadow = deepThinking ? 'var(--btn-hover-shadow, none)' : 'none'; }}
            title={deepThinking ? '深度思考：开' : '深度思考：关'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <path d="M9 18h6"/>
              <path d="M10 22h4"/>
              <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1v.2h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>
            </svg>
          </button>
          <button onClick={handleExport}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px 5px', borderRadius: '6px', transition: 'background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-color)'; e.currentTarget.style.backgroundColor = 'var(--btn-hover-bg, rgba(128,128,128,0.2))'; e.currentTarget.style.boxShadow = 'var(--btn-hover-shadow, none)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}
            title="导出聊天记录"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px 5px', borderRadius: '6px', transition: 'background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-color)'; e.currentTarget.style.backgroundColor = 'var(--btn-hover-bg, rgba(128,128,128,0.2))'; e.currentTarget.style.boxShadow = 'var(--btn-hover-shadow, none)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}
            title="关闭"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Message log (scrollable) */}
      <div ref={scrollContainerRef} onScroll={handleScroll} style={{
        flex: 1, overflowY: 'auto', padding: '12px 14px', fontSize: '13px', lineHeight: 1.6,
        display: 'flex', flexDirection: 'column', gap: '4px',
        // 关键：把滚动容器的渲染、布局、绘制与外部隔离，避免每次流式追加时
        // 整页重新计算导致的滚动卡顿。
        contain: 'content',
        willChange: 'scroll-position',
        overscrollBehavior: 'contain',
      }}>
        {history.map((msg, i) => (
          /* User messages: right-aligned, images above text bubble */
          msg.type === 'user' ? (
            <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%' }}>
              {/* Images and Videos: plain, above bubble, no background/border/shadow */}
              {((msg.images && msg.images.length > 0) || (msg.videos && msg.videos.length > 0)) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: msg.text ? '6px' : 0, justifyContent: 'flex-end' }}>
                  {msg.images?.map((img, j) => (
                    <img key={`img-${j}`} src={`data:${img.mimeType};base64,${img.data}`} alt=""
                      style={{ maxWidth: '220px', maxHeight: '100px', borderRadius: '6px', objectFit: 'contain' }} />
                  ))}
                  {msg.videos?.map((video, j) => (
                    <div key={`video-${j}`} style={{ position: 'relative', height: '100px', maxWidth: '300px' }}>
                      <img src={`data:image/jpeg;base64,${video.thumbnail}`} alt="Video thumbnail"
                        style={{ height: '100%', width: 'auto', maxWidth: '100%', borderRadius: '6px', objectFit: 'contain' }} />
                      {/* 视频播放图标叠加 */}
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '6px' }}>
                        <svg viewBox="0 0 24 24" fill="white" stroke="none" width="32" height="32">
                          <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* Text bubble: only if there is text */}
              {msg.text && (
                <UserBubble text={msg.text} />
              )}
            </div>
          ) : (
            /* Output / error / thinking: left-aligned */
            <div key={i} style={{
              color: msg.type === 'error' ? 'var(--error-color)' : 'var(--text-color)',
              wordBreak: 'break-word',
              fontFamily: msg.type === 'error' ? 'monospace' : 'inherit',
            }}>
              {msg.type === 'output' ? (
                <>
                  {msg.reasoning && (
                    <ReasoningBlock reasoning={msg.reasoning} done={msg.reasoningDone === true} />
                  )}
                  <div className="markdown-container" style={{ lineHeight: 1.8 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]} rehypePlugins={[rehypeKatex]} components={{
                      code: ({ node, className, children, ...props }) => {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeText = String(children).replace(/\n$/, '');
                        const isBlock = codeText.includes('\n');
                        if (isBlock) {
                          return <CodeBlock language={match ? match[1] : ''}>{codeText}</CodeBlock>;
                        }
                        return <code className={className} style={{ backgroundColor: 'rgba(127,127,127,0.2)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '12px', color: 'var(--text-color)' }} {...props}>{children}</code>;
                      },
                      p: ({ children }) => <p style={{ margin: '0.8em 0', whiteSpace: 'pre-line' }}>{children}</p>,
                      a: ({ node, href, title, ...rest }) => (
                        <a href={href} title={title} {...rest} onClick={e => { e.preventDefault(); if (e.ctrlKey && href && (window as any).electronAPI) (window as any).electronAPI.openExternal(href); }} style={{ cursor: 'pointer' }} />
                      ),
                    }}>{msg.text.replace(/\r\n/g, '\n')}</ReactMarkdown>
                  </div>
                </>
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
              )}
            </div>
          )
        ))}
      </div>

      {/* Input area wrapper — relative for pending-images overlay */}
      <div style={{ position: 'relative', borderTop: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)', flexShrink: 0 }}>
        {/* Pending images and videos: floating on top of input area, shadow, no background bar */}
        {(pendingImages.length > 0 || pendingVideos.length > 0) && (
          <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, padding: '8px 14px 6px', display: 'flex', flexWrap: 'wrap', gap: '6px', pointerEvents: 'auto' }}>
            {pendingImages.map((img, idx) => (
              <div key={`img-${idx}`} style={{ position: 'relative', width: '52px', height: '52px', flexShrink: 0, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.25))' }}>
                <img src={`data:${img.mimeType};base64,${img.data}`} alt="" style={{ width: '100%', height: '100%', borderRadius: '6px', objectFit: 'cover', display: 'block' }} />
                <button onClick={() => removeImage(idx)} style={{
                  position: 'absolute', top: '-4px', right: '-4px', width: '16px', height: '16px', borderRadius: '50%',
                  backgroundColor: 'rgba(150, 150, 150, 0.65)', color: 'rgba(255,255,255,0.85)',
                  border: 'none', fontSize: '11px', lineHeight: 1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}>×</button>
              </div>
            ))}
            {pendingVideos.map((video, idx) => (
              <div key={`video-${idx}`} style={{ position: 'relative', width: '52px', height: '52px', flexShrink: 0, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.25))' }}>
                <img src={`data:image/jpeg;base64,${video.thumbnail}`} alt="Video thumbnail" style={{ width: '100%', height: '100%', borderRadius: '6px', objectFit: 'cover', display: 'block' }} />
                {/* 视频播放图标叠加 */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '6px' }}>
                  <svg viewBox="0 0 24 24" fill="white" stroke="none" width="16" height="16">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                </div>
                <button onClick={() => removeVideo(idx)} style={{
                  position: 'absolute', top: '-4px', right: '-4px', width: '16px', height: '16px', borderRadius: '50%',
                  backgroundColor: 'rgba(150, 150, 150, 0.65)', color: 'rgba(255,255,255,0.85)',
                  border: 'none', fontSize: '11px', lineHeight: 1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}>×</button>
              </div>
            ))}
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} onPaste={handlePaste}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={async (e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files);

            // 处理视频文件，读取首帧作为预览，不填入输入框
            const videoFiles = files.filter(file => file.type.startsWith('video/'));
            if (videoFiles.length > 0) {
              const newVideos: VideoAttachment[] = [];
              for (const file of videoFiles) {
                try {
                  const videoAttachment = await getVideoThumbnail(file);
                  newVideos.push(videoAttachment);
                } catch { /* skip */ }
              }
              if (newVideos.length > 0) {
                setPendingVideos([...pendingVideos, ...newVideos]);
              }
            }

            // 处理图片文件，保持原有逻辑
            const imageFiles = files.filter(file => file.type.startsWith('image/'));
            if (imageFiles.length > 0) {
              const images: ImageAttachment[] = [];
              for (const file of imageFiles) {
                try { images.push(await readFileAsImage(file)); } catch { /* skip */ }
              }
              if (images.length > 0) {
                onPendingImagesChange([...pendingImages, ...images]);
              }
            }

            // 移动光标到输入框末尾
            setTimeout(() => {
              if (inputRef.current) {
                const len = inputRef.current.value.length;
                inputRef.current.setSelectionRange(len, len);
                inputRef.current.focus();
              }
            }, 0);
          }}
          style={{ display: 'flex', alignItems: 'flex-start', padding: '6px 12px 6px 8px', gap: '4px' }}>
          {/* Attachment button */}
          <button type="button" onClick={handleSelectFile} disabled={isThinking}
            style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'transparent', color: 'var(--text-dim)', border: 'none', borderRadius: '4px',
              cursor: 'pointer', flexShrink: 0, opacity: isThinking ? 0.3 : 1, padding: 0 }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            title="添加图片"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path>
            </svg>
          </button>
          {/* Prompt arrow */}
          <span style={{ color: 'var(--accent-color)', fontSize: '14px', flexShrink: 0, lineHeight: '28px', marginLeft: '0px', paddingTop: '0px' }}>›</span>
          {/* Textarea */}
          <textarea ref={inputRef} value={inputText} onChange={e => onInputTextChange(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={isThinking ? 'Waiting for response...' : `Ask ${name}...`} readOnly={isThinking} rows={1}
            spellCheck={false} autoCorrect="off" autoCapitalize="off"
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-color)', outline: 'none',
              fontSize: '13px', lineHeight: '1.4', fontFamily: 'inherit', resize: 'none', padding: '5px 0', margin: 0,
              overflowY: 'auto', opacity: isThinking ? 0.5 : 1, cursor: isThinking ? 'not-allowed' : 'text' }} />
          {/* Send / Stop button — 圆形按钮：
              - 生成中：方形停止图标，点击终止当前响应；
              - 有内容：激活的向上箭头，点击发送；
              - 无内容：浅灰禁用，不可点击。 */}
          {(() => {
            const hasContent = inputText.trim().length > 0 || pendingImages.length > 0 || pendingVideos.length > 0;
            const active = isThinking || hasContent;
            return (
              <button type="button"
                onClick={() => { if (isThinking) onStop(); else handleSubmit(); }}
                disabled={!active}
                title={isThinking ? '停止' : '发送'}
                style={{
                  width: '28px', height: '28px', flexShrink: 0, alignSelf: 'flex-end',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                  borderRadius: '50%', border: 'none',
                  backgroundColor: active ? 'var(--accent-color)' : 'rgba(128,128,128,0.25)',
                  color: active ? '#fff' : 'var(--text-dim)',
                  cursor: active ? 'pointer' : 'not-allowed',
                  transition: 'background-color 0.15s, opacity 0.15s',
                  opacity: active ? 1 : 0.6,
                }}
                onMouseEnter={e => { if (active) e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = active ? '1' : '0.6'; }}
              >
                {isThinking ? (
                  // 停止：带轻微圆角的方块
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2.5" />
                  </svg>
                ) : (
                  // 发送：向上箭头
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="6 11 12 5 18 11" />
                  </svg>
                )}
              </button>
            );
          })()}
        </form>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
      </div>

      {/* 底部尖角：90度指向人物 */}
      <svg
        width="24" height="13" viewBox="0 0 24 13"
        style={{
          position: 'absolute', left: '50%', bottom: '-12px',
          transform: 'translateX(-50%)', pointerEvents: 'none',
          filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.04))',
        }}
      >
        <polygon points="0,0 12,12 24,0" fill="var(--border-color)" />
        <polygon points="1,0 12,11 23,0" fill="var(--bg-color)" />
      </svg>
    </div>
  );
});

TerminalPopover.displayName = 'TerminalPopover';

export default TerminalPopover;
