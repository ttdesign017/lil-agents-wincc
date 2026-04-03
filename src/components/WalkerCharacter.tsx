import React, { useEffect, useState, useRef, useCallback } from 'react';
import TerminalPopover from './TerminalPopover';

// Character Constants based on 1024x164 image (8 frames of 128x164)
const FRAME_WIDTH = 128;
const FRAME_HEIGHT = 164;
const SCALE = 0.6;
const DISPLAY_WIDTH = FRAME_WIDTH * SCALE;
const DISPLAY_HEIGHT = FRAME_HEIGHT * SCALE;

interface TaskbarInfo {
  dockX: number;
  dockWidth: number;
  dockTopY: number;
  screenWidth: number;
}

interface WalkerProps {
  name: string;
  sprite: string;
  taskbarInfo: TaskbarInfo;
  positionProgress: number;
  yOffset: number;
  visible?: boolean;
}

interface Message {
  type: 'output' | 'error' | 'user' | 'thinking';
  text: string;
}

const WalkerCharacter: React.FC<WalkerProps> = ({
  name, sprite, taskbarInfo, positionProgress, yOffset, visible
}) => {
  const progressRef = useRef(positionProgress);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [goingRight, setGoingRight] = useState(true);
  const [isWalking, setIsWalking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showPopover, setShowPopover] = useState(false);

  // Persistent interaction states
  const [chatHistory, setChatHistory] = useState<Message[]>([
    { type: 'output', text: `Hi, I'm ${name}. Ask me anything!` }
  ]);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragState = useRef({ startX: 0, startProgress: 0, hasDragged: false });
  const isDraggingRef = useRef(false);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);

  // Need a ref for showPopover to use inside IPC callbacks safely
  const popoverRef = useRef(showPopover);
  useEffect(() => { popoverRef.current = showPopover; }, [showPopover]);

  // Efficient Direct DOM update helper
  const updateDOMPosition = useCallback(() => {
    if (containerRef.current) {
      const x = progressRef.current * (taskbarInfo.dockWidth || 1920);
      const y = Math.max(0, taskbarInfo.dockTopY - DISPLAY_HEIGHT + yOffset);
      // Use translate3d for GPU acceleration and zero React re-renders for movement
      containerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, [taskbarInfo.dockWidth, taskbarInfo.dockTopY, yOffset]);

  // Initialize position and handle resize
  useEffect(() => {
    updateDOMPosition();
  }, [updateDOMPosition]);

  // Global IPC Listeners for Claude
  useEffect(() => {
    if (!(window as any).electronAPI) return;

    // Start session if not started
    (window as any).electronAPI.startClaude(name);

    const offData = (window as any).electronAPI.onClaudeData(name, (data: string) => {
      setChatHistory(prev => {
        let updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].type === 'output') {
          const lastMsg = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...lastMsg,
            text: lastMsg.text + (lastMsg.text ? '\n' : '') + data
          };
        } else {
          updated.push({ type: 'output', text: data });
        }
        if (updated.length > 200) updated = updated.slice(-200);
        return updated;
      });
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

    const offTurnComplete = (window as any).electronAPI.onClaudeTurnComplete?.(name, () => {
      setIsThinking(v => {
        if (v) {
          if (!popoverRef.current) setHasUnread(true);
          return false;
        }
        return v;
      });
    });

    return () => {
      offData(); offError(); offExit(); offTurnComplete?.();
    };
  }, []);

  const handleSubmitMessage = useCallback((text: string) => {
    setChatHistory(prev => [...prev, { type: 'user', text }]);
    setIsThinking(true);
    setHasUnread(false);
    
    if ((window as any).electronAPI) {
      (window as any).electronAPI.sendClaudeInput(name, text);
    }
  }, []);

  const handleClearHistory = useCallback(() => {
    setChatHistory([{ type: 'output', text: `History cleared!` }]);
  }, []);

  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (isDraggingRef.current) return;
    syncLogicalPosition(); // Capture current spot
    setIsPaused(true);
    setShowTooltip(true);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = setTimeout(() => setShowTooltip(false), 800);
    if ((window as any).electronAPI) {
      (window as any).electronAPI.setIgnoreMouseEvents(false);
    }
  };

  const handleMouseLeave = () => {
    if (isDraggingRef.current) return;
    if (!showPopover) {
      setIsPaused(false);
    }
    setShowTooltip(false);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    if ((window as any).electronAPI && !showPopover) {
      (window as any).electronAPI.setIgnoreMouseEvents(true, { forward: true });
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    syncLogicalPosition(); // Capture current spot before drag starts
    setIsDragging(true);
    setIsPaused(true);
    dragState.current = { startX: e.clientX, startProgress: progressRef.current, hasDragged: false };
  };

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragState.current.startX;
      if (Math.abs(deltaX) > 3) {
        dragState.current.hasDragged = true;
      }
      let newProgress = dragState.current.startProgress + deltaX / (taskbarInfo.dockWidth || 1);
      if (isNaN(newProgress)) newProgress = progressRef.current;
      newProgress = Math.max(0.01, Math.min(0.99, newProgress));
      progressRef.current = newProgress;
      updateDOMPosition(); // Zero re-render move during drag
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDragging) return;
      setIsDragging(false);

      if (!dragState.current.hasDragged) {
        handleCharacterClick();
      } else {
        if (!popoverRef.current) {
          setIsPaused(false);
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect && (window as any).electronAPI) {
            const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                           e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (!inside) {
              (window as any).electronAPI.setIgnoreMouseEvents(true, { forward: true });
            }
          }
        }
      }
    };

    if (isDragging) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, taskbarInfo.dockWidth, updateDOMPosition]);

  const handleCharacterClick = () => {
    syncLogicalPosition(); // Ensure goal is cancelled exactly here
    setShowPopover(v => {
      const nextState = !v;
      if (nextState) {
        setIsPaused(true);
        setHasUnread(false);
      } else {
        setIsPaused(false);
        if ((window as any).electronAPI) {
          (window as any).electronAPI.setIgnoreMouseEvents(true, { forward: true });
        }
      }
      return nextState;
    });
  };

  const [walkGoal, setWalkGoal] = useState<{ progress: number; duration: number } | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Sync logical position (stops jumping)
  const syncLogicalPosition = useCallback(() => {
    if (containerRef.current) {
      const style = window.getComputedStyle(containerRef.current);
      const matrix = new DOMMatrixReadOnly(style.transform);
      const currentX = matrix.m41; 
      const width = taskbarInfo.dockWidth || window.innerWidth;
      if (width > 0) {
        progressRef.current = currentX / width;
      }
    }
  }, [taskbarInfo.dockWidth]);

  const readyTimeRef = useRef<number>(0);

  // Optimized Personality Engine (V3.1 Enhanced Randomness)
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const planNextAction = () => {
      if (!taskbarInfo.dockWidth || !taskbarInfo.dockTopY) {
        timeoutId = setTimeout(planNextAction, 500);
        return;
      }

      if (!isReady) {
        setIsReady(true);
        readyTimeRef.current = Date.now();
        timeoutId = setTimeout(planNextAction, 1000); // Wait 1s after flipping ready
        return;
      }

      // Safeguard: Wait at least 1s after first appearances
      if (Date.now() - readyTimeRef.current < 1000) {
        timeoutId = setTimeout(planNextAction, 500);
        return;
      }

      // Only plan if we are not already busy or walking
      if (showPopover || isPaused || isDragging || walkGoal) {
        return;
      }

      // Personality Weights
      const isLvyoyo = name === '绿油油';
      const rand = Math.random();

      if (isLvyoyo) {
        // Hyperactive: 85% Walk, 10% Glance, 5% Stay Still
        if (rand < 0.1) {
          // Glance
          setGoingRight(prev => !prev);
          timeoutId = setTimeout(planNextAction, 800 + Math.random() * 1200);
        } else if (rand < 0.95) {
          // Walk
          initiateWalk();
        } else {
          // Stay Still (short rest)
          setIsWalking(false);
          setWalkGoal(null);
          timeoutId = setTimeout(planNextAction, 1000 + Math.random() * 9000); // 1-10s
        }
      } else {
        // Calm (刘小红): 45% Walk, 55% Stay Still (Still No Glance)
        if (rand < 0.45) {
          initiateWalk();
        } else {
          // Stay Still (moderate rest)
          setIsWalking(false);
          setWalkGoal(null);
          // 8s to 40s
          timeoutId = setTimeout(planNextAction, 8000 + Math.random() * 32000);
        }
      }
    };

    const initiateWalk = () => {
      const currentP = progressRef.current;
      let targetP;
      
      const isLongWalk = Math.random() < 0.3;
      // Minimum distance check to prevent marching in place
      const walkDistance = isLongWalk ? (0.2 + Math.random() * 0.4) : (0.08 + Math.random() * 0.12);

      if (currentP > 0.8) targetP = currentP - walkDistance;
      else if (currentP < 0.2) targetP = currentP + walkDistance;
      else targetP = Math.random() < 0.5 ? currentP + walkDistance : currentP - walkDistance;

      // Ensure targetP is valid and not exactly currentP
      targetP = Math.max(0.05, Math.min(0.95, targetP));
      if (Math.abs(targetP - currentP) < 0.04) {
        // If too close, try opposite direction
        targetP = currentP > 0.5 ? currentP - 0.15 : currentP + 0.15;
      }

      setGoingRight(targetP > currentP);

      const baseSpeed = 0.0125;
      const speedVar = 0.8 + Math.random() * 0.4; 
      const duration = (Math.abs(targetP - currentP) / (baseSpeed * speedVar)) * 1000; 

      setIsWalking(true);
      setWalkGoal({ progress: targetP, duration });
    };

    if (!showPopover && !isPaused && !isDragging && !walkGoal) {
      planNextAction();
    } else if (showPopover || isPaused || isDragging) {
      setIsWalking(false);
      setWalkGoal(null);
    }
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [showPopover, isPaused, isDragging, taskbarInfo.dockWidth, taskbarInfo.dockTopY, isReady, walkGoal, name]);

  const handleTransitionEnd = () => {
    if (isWalking && walkGoal && !isDragging) {
      progressRef.current = walkGoal.progress;
      setIsWalking(false);
      setWalkGoal(null);
      // Planning restarts naturally because walkGoal is null now
    }
  };

  const lastLayoutRef = useRef<{ width: number; top: number }>({ width: 0, top: 0 });

  // Sync DOM position & transitions with zero clobbering
  useEffect(() => {
    if (containerRef.current) {
      // If layout changed significantally (e.g. monitor resize), cancel active walk
      const widthChanged = taskbarInfo.dockWidth !== lastLayoutRef.current.width;
      const topChanged = taskbarInfo.dockTopY !== lastLayoutRef.current.top;
      
      if (widthChanged || topChanged) {
        if (walkGoal) {
          syncLogicalPosition(); // Capture current spot
          setIsWalking(false);
          setWalkGoal(null);
        }
        lastLayoutRef.current = { width: taskbarInfo.dockWidth || 0, top: taskbarInfo.dockTopY || 0 };
      }

      if (walkGoal && !isDragging) {
        const x = walkGoal.progress * (taskbarInfo.dockWidth || 1);
        const y = Math.max(0, taskbarInfo.dockTopY - DISPLAY_HEIGHT + yOffset);
        // Explicitly set BOTH transition and transform in one tick
        containerRef.current.style.transition = `transform ${walkGoal.duration}ms linear, opacity 0.2s ease-in`;
        containerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      } else {
        containerRef.current.style.transition = 'opacity 0.2s ease-in, transform 0s';
        updateDOMPosition();
      }
    }
  }, [walkGoal, isDragging, updateDOMPosition, taskbarInfo.dockWidth, taskbarInfo.dockTopY, yOffset]);

  return (
    <>
      <style>{`
        @keyframes walk {
          from { background-position: 0 0; }
          to { background-position: -800% 0; }
        }
        @keyframes tooltipFadeIn {
          from { opacity: 0; transform: translate(-50%, 5px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
      <div 
        ref={containerRef}
        onTransitionEnd={handleTransitionEnd}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: DISPLAY_WIDTH,
          height: DISPLAY_HEIGHT,
          pointerEvents: 'auto',
          cursor: 'pointer',
          zIndex: 10,
          display: (visible === false) ? 'none' : 'block',
          opacity: isReady ? 1 : 0, 
          // COMPOSITE PERFORMANCE & STABILITY
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          transformStyle: 'preserve-3d',
          willChange: 'transform, opacity', 
        }}
      >
        <div
          style={{ width: '100%', height: '100%', transform: `scaleX(${goingRight ? 1 : -1})`, position: 'relative' }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
        >
          <div style={{
            width: '100%',
            height: '100%',
            backgroundImage: "url('" + sprite + "')",
            backgroundSize: '800% 100%',
            imageRendering: 'pixelated',
            animation: isWalking ? 'walk 0.8s steps(8) infinite' : 'none',
            backgroundPosition: '0 0',
          }} />
        </div>

        {/* Custom tooltip — auto-hides after 800ms */}
        {showTooltip && (
          <div style={{
            position: 'absolute',
            bottom: '105%',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(20,20,28,0.88)',
            color: '#ddd',
            fontSize: '11px',
            padding: '3px 8px',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            border: '1px solid rgba(255,255,255,0.1)',
            animation: 'tooltipFadeIn 0.15s ease',
          }}>{name}</div>
        )}

        {/* Unread Bubble */}
        {hasUnread && !showPopover && (
          <div style={{
            position: 'absolute',
            bottom: '90%',
            left: goingRight ? '70%' : '10%',
            backgroundColor: 'rgba(255,255,255,0.95)',
            color: '#333',
            fontSize: '14px',
            fontWeight: 'bold',
            padding: '4px 8px',
            borderRadius: '12px',
            borderBottomLeftRadius: goingRight ? '0' : '12px',
            borderBottomRightRadius: goingRight ? '12px' : '0',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            animation: 'bounce 2s infinite ease-in-out',
            zIndex: 20
          }}>···</div>
        )}

        {/* Popover */}
        {showPopover && (
          <TerminalPopover
            name={name}
            history={chatHistory}
            isThinking={isThinking}
            onSubmitMessage={handleSubmitMessage}
            onClearHistory={handleClearHistory}
            onClose={() => {
              setShowPopover(false);
              setIsPaused(false);
              if ((window as any).electronAPI) {
                (window as any).electronAPI.setIgnoreMouseEvents(true, { forward: true });
              }
            }}
          />
        )}
      </div>
    </>
  );
};

export default WalkerCharacter;
