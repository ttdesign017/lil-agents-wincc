import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ImageAttachment, Message } from '../hooks/useClaudeSession';

interface TerminalPopoverProps {
  onClose: () => void;
  name: string;
  history: Message[];
  isThinking: boolean;
  onSubmitMessage: (text: string, images?: ImageAttachment[]) => void;
  onClearHistory: () => void;
  popoverScreenX: number;
  characterScreenY: number;
  onPopoverMouseEnter?: () => void;
  onPopoverMouseLeave?: () => void;
  inputText: string;
  onInputTextChange: (text: string) => void;
  pendingImages: ImageAttachment[];
  onPendingImagesChange: (images: ImageAttachment[]) => void;
}

const TerminalPopover: React.FC<TerminalPopoverProps> = ({
  onClose, name, history, isThinking, onSubmitMessage, onClearHistory,
  popoverScreenX, characterScreenY, onPopoverMouseEnter, onPopoverMouseLeave,
  inputText, onInputTextChange, pendingImages, onPendingImagesChange,
}) => {
  const endOfLogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Focus input when popover opens
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // Auto-scroll
  const isFirstScroll = useRef(true);
  useEffect(() => {
    endOfLogRef.current?.scrollIntoView({ behavior: isFirstScroll.current ? 'auto' : 'smooth' });
    if (isFirstScroll.current) isFirstScroll.current = false;
  }, [history]);

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

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!inputText.trim() && pendingImages.length === 0) || isThinking) return;
    const userText = inputText.trim();
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;
    onInputTextChange('');
    onPendingImagesChange([]);
    if (userText === '/clear') { onClearHistory(); return; }
    onSubmitMessage(userText, images);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const handleMouseEnter = () => onPopoverMouseEnter?.();
  const handleMouseLeave = () => onPopoverMouseLeave?.();
  const userColor = name === '刘小红' ? 'var(--accent-color)' : (name === '绿油油' ? '#808000' : 'var(--accent-color)');

  // ── Code block component ──
  const CodeBlock: React.FC<{ language: string; children: string }> = ({ language, children }) => {
    const [copied, setCopied] = useState(false);
    const doCopy = async () => { await navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 2000); };

    return (
      <div style={{ position: 'relative', margin: '8px 0' }}>
        <button onClick={doCopy} style={{
          position: 'absolute', top: '8px', right: '8px', width: '26px', height: '26px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)',
          border: 'none', borderRadius: '4px', cursor: 'pointer', zIndex: 1, transition: 'all 0.2s',
        }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = 'rgba(255,255,255,0.9)'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
          title={copied ? '已复制!' : '复制代码'}
        >
          {copied
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          }
        </button>
        <SyntaxHighlighter language={language || 'text'} style={vscDarkPlus}
          customStyle={{ borderRadius: '8px', padding: '16px', fontSize: '12px', lineHeight: 1.6, margin: 0, overflowX: 'auto', backgroundColor: '#1e1e1e' }}
          codeTagProps={{ style: { fontFamily: 'Consolas, Monaco, "Courier New", monospace' } }}
        >{children}</SyntaxHighlighter>
      </div>
    );
  };

  return (
    <div
      style={{ position: 'fixed', top: Math.max(20, characterScreenY - 340), left: popoverScreenX, transform: 'translateX(-50%)',
        width: '420px', maxWidth: '90vw', height: '320px', backgroundColor: 'var(--bg-color)', backdropFilter: 'blur(var(--bg-blur))',
        borderRadius: '14px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow)', pointerEvents: 'auto', overflow: 'hidden', zIndex: 10000, ['--user-color' as string]: userColor,
      }}
      onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
    >
      {/* Title bar */}
      <div style={{ height: '34px', backgroundColor: 'var(--title-bg)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', flexShrink: 0 }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.5px' }}>{name} · Claude</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {isThinking && (
            <span style={{ fontSize: '11px', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>●</span> thinking...
            </span>
          )}
          <button style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px 4px' }} onClick={onClose}>×</button>
        </div>
      </div>

      {/* Message log (scrollable) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', fontSize: '13px', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {history.map((msg, i) => (
          /* User messages: right-aligned, images above text bubble */
          msg.type === 'user' ? (
            <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%' }}>
              {/* Images: plain, above bubble, no background/border/shadow */}
              {msg.images && msg.images.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: msg.text ? '6px' : 0, justifyContent: 'flex-end' }}>
                  {msg.images.map((img, j) => (
                    <img key={j} src={`data:${img.mimeType};base64,${img.data}`} alt=""
                      style={{ maxWidth: '220px', maxHeight: '160px', borderRadius: '6px', objectFit: 'contain' }} />
                  ))}
                </div>
              )}
              {/* Text bubble: only if there is text */}
              {msg.text && (
                <div style={{
                  backgroundColor: 'var(--chat-bubble-bg)',
                  borderRadius: 'var(--chat-bubble-radius)',
                  padding: '8px 12px',
                  boxShadow: 'var(--chat-bubble-shadow)',
                  wordBreak: 'break-word',
                }}>
                  <span style={{ color: 'var(--chat-bubble-text)', whiteSpace: 'pre-wrap' }}>{msg.text}</span>
                </div>
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
                <div className="markdown-container">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
                    code: ({ node, className, children, ...props }) => {
                      const match = /language-(\w+)/.exec(className || '');
                      if (className) return <CodeBlock language={match ? match[1] : ''}>{String(children).replace(/\n$/, '')}</CodeBlock>;
                      return <code className={className} style={{ backgroundColor: 'rgba(127,127,127,0.2)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '12px', color: 'var(--text-color)' }} {...props}>{children}</code>;
                    },
                    a: ({ node, href, title, ...rest }) => (
                      <a href={href} title={title} {...rest} onClick={e => { e.preventDefault(); if (e.ctrlKey && href && (window as any).electronAPI) (window as any).electronAPI.openExternal(href); }} style={{ cursor: 'pointer' }} />
                    ),
                  }}>{msg.text}</ReactMarkdown>
                </div>
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
              )}
            </div>
          )
        ))}
        <div ref={endOfLogRef} />
      </div>

      {/* Input area wrapper — relative for pending-images overlay */}
      <div style={{ position: 'relative', borderTop: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)', flexShrink: 0 }}>
        {/* Pending images: floating on top of input area, shadow, no background bar */}
        {pendingImages.length > 0 && (
          <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, padding: '8px 14px 6px', display: 'flex', flexWrap: 'wrap', gap: '6px', pointerEvents: 'auto' }}>
            {pendingImages.map((img, idx) => (
              <div key={idx} style={{ position: 'relative', width: '52px', height: '52px', flexShrink: 0, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.25))' }}>
                <img src={`data:${img.mimeType};base64,${img.data}`} alt="" style={{ width: '100%', height: '100%', borderRadius: '6px', objectFit: 'cover', display: 'block' }} />
                <button onClick={() => removeImage(idx)} style={{
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
          style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', gap: '6px' }}>
          {/* Attachment button */}
          <button type="button" onClick={handleSelectFile} disabled={isThinking}
            style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'transparent', color: 'var(--text-dim)', border: 'none', borderRadius: '4px',
              cursor: 'pointer', flexShrink: 0, opacity: isThinking ? 0.3 : 1, padding: 0 }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            title="添加图片"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path>
            </svg>
          </button>
          {/* Prompt arrow */}
          <span style={{ color: 'var(--accent-color)', fontSize: '14px', flexShrink: 0, lineHeight: '28px', marginLeft: '2px' }}>›</span>
          {/* Textarea */}
          <textarea ref={inputRef} value={inputText} onChange={e => onInputTextChange(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={isThinking ? 'Waiting for response...' : 'Ask Claude...'} readOnly={isThinking} rows={1}
            spellCheck={false} autoCorrect="off" autoCapitalize="off"
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-color)', outline: 'none',
              fontSize: '13px', lineHeight: '1.4', fontFamily: 'inherit', resize: 'none', padding: 0, margin: 0,
              overflowY: 'auto', opacity: isThinking ? 0.5 : 1, cursor: isThinking ? 'not-allowed' : 'text' }} />
        </form>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
};

export default TerminalPopover;
