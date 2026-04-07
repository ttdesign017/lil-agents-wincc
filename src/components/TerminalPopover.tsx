import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  type: 'output' | 'error' | 'user' | 'thinking';
  text: string;
}

interface TerminalPopoverProps {
  onClose: () => void;
  name: string;
  history: Message[];
  isThinking: boolean;
  onSubmitMessage: (text: string) => void;
  onClearHistory: () => void;
  popoverScreenX: number; // center X in screen coords
  characterScreenY: number; // top Y of character in screen coords
  onPopoverMouseEnter?: () => void;
  onPopoverMouseLeave?: () => void;
}

const TerminalPopover: React.FC<TerminalPopoverProps> = ({
  onClose, name, history, isThinking, onSubmitMessage, onClearHistory,
  popoverScreenX, characterScreenY, onPopoverMouseEnter, onPopoverMouseLeave,
}) => {
  const [input, setInput] = useState('');
  const endOfLogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus input when popover opens
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const isFirstScroll = useRef(true);

  useEffect(() => {
    // Scroll logic: Auto (instant) for the first time, Smooth thereafter
    endOfLogRef.current?.scrollIntoView({ 
      behavior: isFirstScroll.current ? 'auto' : 'smooth' 
    });
    if (isFirstScroll.current) isFirstScroll.current = false;
  }, [history]);

  // Handle textarea auto-resize
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'; // Reset to auto to calculate scroll height properly
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px'; // Max 120px height
    }
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isThinking) return;

    const userText = input.trim();
    setInput('');

    if (userText === '/clear') {
      onClearHistory();
      return;
    }

    onSubmitMessage(userText);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Prevent new line
      handleSubmit();
    }
  };

  const handleMouseEnter = () => {
    onPopoverMouseEnter?.();
  };

  const handleMouseLeave = () => {
    onPopoverMouseLeave?.();
  };

  const userColor = name === '刘小红' ? 'var(--accent-color)' : (name === '绿油油' ? '#808000' : 'var(--accent-color)');

  return (
    <div
      style={{
        position: 'fixed',
         top: Math.max(20, characterScreenY - 340), // above character, clamped to stay on screen
        left: popoverScreenX,
        transform: 'translateX(-50%)',
        width: '420px',
        maxWidth: '90vw',
        height: '320px',
        backgroundColor: 'var(--bg-color)',
        backdropFilter: 'blur(var(--bg-blur))',
        borderRadius: '14px',
        border: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'var(--shadow)',
        pointerEvents: 'auto',
        overflow: 'hidden',
        zIndex: 10000,
        ['--user-color' as any]: userColor,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Title bar */}
      <div style={{
        height: '34px',
        backgroundColor: 'var(--title-bg)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.5px' }}>
          {name} · Claude
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {isThinking && (
            <span style={{ fontSize: '11px', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>●</span> thinking...
            </span>
          )}
          <button
            style={{
              background: 'none', border: 'none', color: 'var(--text-dim)',
              cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px 4px'
            }}
            onClick={onClose}
          >×</button>
        </div>
      </div>

      {/* Message log */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 14px',
        fontSize: '13px', lineHeight: 1.6,
        display: 'flex', flexDirection: 'column', gap: '4px',
      }}>
        {history.map((msg, i) => (
          <div key={i} style={{
            color: msg.type === 'error' ? 'var(--error-color)'
              : msg.type === 'user' ? 'var(--user-color)'
              : 'var(--text-color)',
            wordBreak: 'break-word',
            fontFamily: msg.type === 'error' ? 'monospace' : 'inherit',
          }}>
            {msg.type === 'user' && (
              <span style={{ color: 'var(--accent-color)', marginRight: '6px' }}>›</span>
            )}
            
            {msg.type === 'output' ? (
              <div className="markdown-container">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ node, href, title, ...rest }) => (
                      <a
                        href={href}
                        title={title}
                        {...rest}
                        onClick={(e) => {
                          e.preventDefault();
                          if (e.ctrlKey && href && (window as any).electronAPI) {
                            (window as any).electronAPI.openExternal(href);
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                    )
                  }}
                >
                  {msg.text}
                </ReactMarkdown>
              </div>
            ) : (
              <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
            )}
          </div>
        ))}
        <div ref={endOfLogRef} />
      </div>

      {/* Input form */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border-color)',
          backgroundColor: 'rgba(255,255,255,0.03)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--accent-color)', fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>›</span>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isThinking ? 'Waiting for response...' : 'Ask Claude...'}
          readOnly={isThinking}
          rows={1}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-color)',
            outline: 'none',
            fontSize: '13px',
            lineHeight: '1.4',
            fontFamily: 'inherit',
            resize: 'none',
            padding: 0,
            margin: 0,
            overflowY: 'auto',
            opacity: isThinking ? 0.5 : 1,
            cursor: isThinking ? 'not-allowed' : 'text',
          }}
        />
      </form>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};

export default TerminalPopover;
