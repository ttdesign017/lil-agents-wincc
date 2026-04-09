import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import TerminalPopover from './TerminalPopover';
import { useClaudeSession, ImageAttachment } from '../hooks/useClaudeSession';
import {
  CHAR_CONFIGS,
  CharSpriteConfig,
  BASE_STEP,
  FRAME_DURATION_MS,
  PROGRESS_MIN,
  PROGRESS_MAX,
  SAFE_BOUNDARY_MIN,
  SAFE_BOUNDARY_MAX,
  IDLE_BOUNDARY_MIN,
  IDLE_BOUNDARY_MAX,
  TARGET_PROXIMITY,
  LOOP_FRAMES_MIN,
  LOOP_FRAMES_MAX,
  PAUSED_CHECK_INTERVAL,
  EDGE_FLIP_DELAY_MIN,
  EDGE_FLIP_DELAY_MAX,
  IDLE_WAIT_MIN,
  IDLE_WAIT_MAX,
  POPOVER_TRACK_INTERVAL,
  TOOLTIP_DISPLAY_MS,
  WALK_DIST_MIN_FRAC,
  WALK_DIST_MAX_FRAC,
  WALK_DIST_THRESHOLD,
  Phase,
} from '../config';

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
  initialProgress: number;
  yOffset: number;
  visible?: boolean;
}

const WalkerCharacter: React.FC<WalkerProps> = ({
  name, sprite, taskbarInfo, initialProgress, yOffset, visible,
}) => {
  const {
    chatHistory, isThinking, hasUnread, popoverRef, setHasUnread, setIsThinking,
    handleSubmitMessage, handleClearHistory,
  } = useClaudeSession(name);

  const cfg = CHAR_CONFIGS[name];
  if (!cfg) throw new Error(`No sprite config for character "${name}"`);
  const effectiveYOffset = yOffset + (cfg.yOffset ?? 0);

  const progressRef = useRef(initialProgress);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [goingRight, setGoingRight] = useState(true);
  const goingRightRef = useRef(true);
  useEffect(() => { goingRightRef.current = goingRight; }, [goingRight]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const gracefulExitRef = useRef(false);
  const [showPopover, setShowPopover] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const isDraggingRef = useRef(false);
  const imageReadyRef = useRef(false);
  const [dragPositionState, setDragPositionState] = useState<number | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [popoverX, setPopoverX] = useState(0);
  const [popoverY, setPopoverY] = useState(0);
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);

  // Animation state
  const rafRef = useRef(0);
  const animPhaseRef = useRef<Phase>('idle');
  const animFrameRef = useRef(0);
  const lastAnimTimeRef = useRef(0);
  const loopCountTargetRef = useRef(0);
  const loopCountDoneRef = useRef(0);
  const walkStartP = useRef(0);
  const walkEndP = useRef(0);

  const dragState = useRef({ startX: 0, startProgress: 0, hasDragged: false });
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimeRef = useRef(0);

  // ── Centralized mouse-ignore state machine ──
  const mouseOverCharacterRef = useRef(false);
  const mouseOverPopoverRef = useRef(false);
  const showPopoverRef = useRef(showPopover);

  const updateMouseIgnore = useCallback(() => {
    const shouldIgnore = !mouseOverCharacterRef.current && !mouseOverPopoverRef.current;
    if ((window as any).electronAPI) {
      (window as any).electronAPI.setIgnoreMouseEvents(shouldIgnore, { forward: true });
    }
  }, []);

  const displayW = Math.round(cfg.frameWidth * cfg.scale);
  const displayH = Math.round(cfg.frameHeight * cfg.scale);

  // ── Load sprite image ──
  useEffect(() => {
    const img = new Image();
    img.src = sprite;
    img.onload = () => {
      imgRef.current = img;
      imageReadyRef.current = true;
      // Paint initial idle frame
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const col = cfg.startMin % cfg.cols;
      const row = Math.floor(cfg.startMin / cfg.cols);
      ctx.clearRect(0, 0, cfg.frameWidth, cfg.frameHeight);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        img, col * cfg.frameWidth, row * cfg.frameHeight, cfg.frameWidth, cfg.frameHeight,
        0, 0, cfg.frameWidth, cfg.frameHeight,
      );
      animFrameRef.current = cfg.startMin;
    };
    return () => cancelAnimationFrame(rafRef.current);
  }, [sprite]);

  // ── Canvas frame renderer ──
  const renderFrame = useCallback((frame: number) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx || !imageReadyRef.current || !imgRef.current) return;
    const col = frame % cfg.cols;
    const row = Math.floor(frame / cfg.cols);
    ctx.clearRect(0, 0, cfg.frameWidth, cfg.frameHeight);
    ctx.imageSmoothingEnabled = false; // keep pixel-art crisp
    ctx.drawImage(
      imgRef.current,
      col * cfg.frameWidth, row * cfg.frameHeight,
      cfg.frameWidth, cfg.frameHeight,
      0, 0, cfg.frameWidth, cfg.frameHeight,
    );
  }, [cfg.cols, cfg.frameWidth, cfg.frameHeight]);

  // ── Position update (direct DOM transform, no CSS transition) ──
  const updateDOMPosition = useCallback(() => {
    if (!containerRef.current) return;
    const x = progressRef.current * (taskbarInfo.dockWidth || 1920);
    containerRef.current.style.transition = 'none';
    containerRef.current.style.transform = `translate3d(${x}px, ${window.innerHeight - displayH + effectiveYOffset}px, 0)`;
  }, [taskbarInfo.dockWidth, yOffset, displayH]);

  useEffect(() => { updateDOMPosition(); }, [updateDOMPosition, taskbarInfo.dockWidth, taskbarInfo.dockTopY]);

  // no-op removed — progressRef always tracks logical position

  useEffect(() => { popoverRef.current = showPopover; }, [showPopover, popoverRef]);
  useEffect(() => { showPopoverRef.current = showPopover; }, [showPopover]);
  // ── rAF loop: frames + eased position ──
  const animTick = useCallback((time: number) => {
    if (lastAnimTimeRef.current === 0) lastAnimTimeRef.current = time;
    const elapsed = time - lastAnimTimeRef.current;

    const phase = animPhaseRef.current;
    const direction = goingRightRef.current ? 1 : -1;
    const baseStep = BASE_STEP / (taskbarInfo.dockWidth || 1920);

    // Position always updates every rAF for smooth interpolation
    if (!isDraggingRef.current && phase !== 'idle') {
      const endFrames = cfg.endMax - cfg.endMin + 1;

      if (phase === 'start') {
        const t = (animFrameRef.current - cfg.startMin) / (cfg.startMax - cfg.startMin + 1);
        const easeCoeff = t * t;
        progressRef.current += baseStep * direction * easeCoeff * elapsed / FRAME_DURATION_MS;
        progressRef.current = Math.max(PROGRESS_MIN, Math.min(PROGRESS_MAX, progressRef.current));
      } else if (phase === 'loop') {
        const newProgress = progressRef.current + baseStep * direction * elapsed / FRAME_DURATION_MS;

        // Check if we've reached the walk target or screen edge
        const nearTarget = (direction > 0 && newProgress >= walkEndP.current - TARGET_PROXIMITY)
          || (direction < 0 && newProgress <= walkEndP.current + TARGET_PROXIMITY);
        const nearEdge = newProgress <= PROGRESS_MIN || newProgress >= PROGRESS_MAX;

        if (nearTarget || nearEdge) {
          progressRef.current = Math.max(PROGRESS_MIN, Math.min(PROGRESS_MAX, newProgress));
          walkEndP.current = progressRef.current;
          loopCountTargetRef.current = 0;
          loopCountDoneRef.current = 0;
          animFrameRef.current = cfg.endMin;
          animPhaseRef.current = 'end';
          if (nearEdge) {
            goingRightRef.current = !goingRightRef.current;
            setGoingRight(goingRightRef.current);
          }
        } else {
          progressRef.current = Math.max(PROGRESS_MIN, Math.min(PROGRESS_MAX, newProgress));
        }
      } else if (phase === 'end') {
        // Quadratic ease-out deceleration: full speed at start, ramps to zero by endMax
        const tEnd = Math.min(1, (animFrameRef.current - cfg.endMin) / (endFrames - 1));
        const easeCoeff = (1 - tEnd) * (1 - tEnd);
        progressRef.current += baseStep * direction * easeCoeff * elapsed / FRAME_DURATION_MS;
        progressRef.current = Math.max(PROGRESS_MIN, Math.min(PROGRESS_MAX, progressRef.current));
      }
      updateDOMPosition();
    }

    // Sprite frame changes at fixed 50ms intervals
    if (elapsed >= FRAME_DURATION_MS && !isDraggingRef.current) {
      lastAnimTimeRef.current = time - (elapsed % FRAME_DURATION_MS);

      if (phase === 'start') {
        animFrameRef.current++;
        if (animFrameRef.current > cfg.startMax) {
          animFrameRef.current = cfg.loopMin;
          animPhaseRef.current = 'loop';
          loopCountDoneRef.current = 0;
          walkStartP.current = progressRef.current;
        }
        renderFrame(animFrameRef.current);
      } else if (phase === 'loop') {
        animFrameRef.current++;
        if (animFrameRef.current > cfg.loopMax) {
          animFrameRef.current = cfg.loopMin;
          loopCountDoneRef.current++;
          if (loopCountDoneRef.current >= loopCountTargetRef.current) {
            walkStartP.current = progressRef.current;
            animFrameRef.current = cfg.endMin;
            animPhaseRef.current = 'end';
          }
        }
        renderFrame(animFrameRef.current);
      } else if (phase === 'end') {
        animFrameRef.current++;
        const arrived = animFrameRef.current > cfg.endMax;
        if (arrived) {
          // position already reflects END phase movement; no snap-back needed
          animPhaseRef.current = 'idle';
          setIsAnimating(false);
        } else {
          renderFrame(animFrameRef.current);
        }
      }
    }

    rafRef.current = requestAnimationFrame(animTick);
  }, [cfg, renderFrame, updateDOMPosition, taskbarInfo.dockWidth]);

  // ── Start walk ──
  const startWalk = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    gracefulExitRef.current = false;
    animPhaseRef.current = 'start';
    animFrameRef.current = cfg.startMin;
    loopCountTargetRef.current = LOOP_FRAMES_MIN + Math.floor(Math.random() * (LOOP_FRAMES_MAX - LOOP_FRAMES_MIN + 1));
    loopCountDoneRef.current = 0;
    lastAnimTimeRef.current = 0;
    renderFrame(animFrameRef.current);
    rafRef.current = requestAnimationFrame(animTick);
  }, [cfg, animTick, renderFrame]);

  // ── Stop ──
  const stopWalk = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    animPhaseRef.current = 'idle';
  }, []);

  // ── Graceful walk finish ──
  const gracefulEndWalk = useCallback(() => {
    if (animPhaseRef.current === 'idle') return;
    gracefulExitRef.current = true;
    if (animPhaseRef.current === 'start' || animPhaseRef.current === 'loop') {
      walkStartP.current = progressRef.current;
      // The END phase adds incremental deceleration; walkEndP is where we'll finally land
      const endFrames = cfg.endMax - cfg.endMin + 1;
      walkEndP.current = progressRef.current; // will stay put since decel starts here
      loopCountTargetRef.current = 0;
      loopCountDoneRef.current = 0;
      animFrameRef.current = cfg.endMin;
      animPhaseRef.current = 'end';
    }
  }, [cfg.endMin]);

  // ── Sync isAnimating with animPhaseRef ──
  useEffect(() => {
    if (isAnimating && animPhaseRef.current === 'idle') {
      startWalk();
    } else if (!isAnimating && animPhaseRef.current !== 'idle' && !gracefulExitRef.current) {
      stopWalk();
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isAnimating, startWalk, stopWalk]);

  // ── Track character screen position for popover ──
  useEffect(() => {
    if (!isPopoverOpen) return;
    // Immediately sync position before first render of popover
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setPopoverX(Math.floor(rect.left + rect.width / 2));
      setPopoverY(Math.floor(rect.top));
    }
    const update = () => {
      const r = containerRef.current?.getBoundingClientRect();
      if (r) {
        setPopoverX(Math.floor(r.left + r.width / 2));
        setPopoverY(Math.floor(r.top));
      }
    };
    const id = setInterval(update, POPOVER_TRACK_INTERVAL);
    return () => clearInterval(id);
  }, [isPopoverOpen]);

  // ── Personality / idle engine ──
  useEffect(() => {
    // Mark ready immediately if dock info is available
    if (!taskbarInfo.dockWidth || !taskbarInfo.dockTopY) return;
    setIsReady(true);

    let timeoutId: ReturnType<typeof setTimeout>;

    const planNextAction = () => {
      if (showPopover || isDraggingRef.current || isAnimating) return;
      // Clear stale exit flag so idle characters don't stay blocked
      if (gracefulExitRef.current) gracefulExitRef.current = false;
      if (isPaused) {
        timeoutId = setTimeout(planNextAction, PAUSED_CHECK_INTERVAL);
        return;
      }

      const rand = Math.random();
      if (rand < cfg.walkProb) {
        initiateWalk();
      } else {
        timeoutId = setTimeout(planNextAction, IDLE_WAIT_MIN + Math.random() * (IDLE_WAIT_MAX - IDLE_WAIT_MIN));
      }
    };

    const initiateWalk = () => {
      const currentP = Math.max(IDLE_BOUNDARY_MIN, Math.min(IDLE_BOUNDARY_MAX, progressRef.current));
      let direction = goingRightRef.current ? 1 : -1;
      // Random destination: 10%~30% of screen width in current direction
      const walkDist = WALK_DIST_MIN_FRAC + Math.random() * (WALK_DIST_MAX_FRAC - WALK_DIST_MIN_FRAC);
      let targetP = currentP + direction * walkDist;

      // If target would go beyond edge, flip direction
      if (targetP < 0.02 || targetP > 0.98) {
        direction = -direction;
        targetP = currentP + direction * walkDist;
        goingRightRef.current = direction === 1;
        setGoingRight(goingRightRef.current);
      }

      // Final clamp; if still at edge (both directions blocked), don't walk
      targetP = Math.max(IDLE_BOUNDARY_MIN, Math.min(IDLE_BOUNDARY_MAX, targetP));
      if (Math.abs(targetP - currentP) < 0.01) {
        // Nowhere to go — flip facing and wait
        goingRightRef.current = !goingRightRef.current;
        setGoingRight(goingRightRef.current);
        const delay = EDGE_FLIP_DELAY_MIN + Math.random() * (EDGE_FLIP_DELAY_MAX - EDGE_FLIP_DELAY_MIN);
        timeoutId = setTimeout(planNextAction, delay);
        return;
      }
      walkStartP.current = currentP;
      walkEndP.current = targetP;
      setIsAnimating(true);
    };

    if (showPopover || isDraggingRef.current || isAnimating) {
      // don't initiate — wait
    } else if (isPaused) {
      // paused — wait
    } else {
      planNextAction();
    }

    return () => { if (timeoutId) clearTimeout(timeoutId); };
  }, [showPopover, isPaused, isAnimating, name, isReady, taskbarInfo.dockTopY, taskbarInfo.dockWidth, cfg.walkProb]);

  // ── Cancel animation on layout change ──
  useEffect(() => {
    if (animPhaseRef.current !== 'idle' && !gracefulExitRef.current) {
      gracefulExitRef.current = true;
      walkStartP.current = progressRef.current;
      walkEndP.current = progressRef.current;
      loopCountTargetRef.current = 0;
      loopCountDoneRef.current = 0;
      animFrameRef.current = cfg.endMin;
      animPhaseRef.current = 'end';
    }
  }, [taskbarInfo.dockWidth, taskbarInfo.dockTopY, cfg.endMin]);

  // ── Drag ──
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDraggingRef.current = true;
    setIsPaused(true);
    dragState.current = { startX: e.clientX, startProgress: progressRef.current, hasDragged: false };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - dragState.current.startX;
      if (Math.abs(dx) > 3) dragState.current.hasDragged = true;
      let np = dragState.current.startProgress + dx / (taskbarInfo.dockWidth || 1);
      np = Math.max(SAFE_BOUNDARY_MIN, Math.min(SAFE_BOUNDARY_MAX, isNaN(np) ? progressRef.current : np));
      progressRef.current = np;
      updateDOMPosition();
      if (showPopover) setDragPositionState(np);
    };

    const onUp = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const wasDragging = dragState.current.hasDragged;
      isDraggingRef.current = false;
      setDragPositionState(null);

      if (!wasDragging) {
        handleClick();
      } else if (!popoverRef.current) {
        setIsPaused(false);
        // After drag, check if pointer is over character element.
        // Use the unscaled container rect (getBoundingClientRect already returns scaled rect).
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom;
          if (!inside) {
            mouseOverCharacterRef.current = false;
            updateMouseIgnore();
          }
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [taskbarInfo.dockWidth, updateDOMPosition, popoverRef, showPopover]);

  const handleClick = () => {
    if (!showPopover) {
      setIsPaused(true);
      setHasUnread(false);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setPopoverX(Math.floor(rect.left + rect.width / 2));
        setPopoverY(Math.floor(rect.top));
      }
      setIsPopoverOpen(true);
      setShowPopover(true);
    } else {
      setIsPaused(false);
      setShowPopover(false);
      setIsPopoverOpen(false);
    }
  };

  // ── Mouse enter / leave ──
  const handleMouseEnter = () => {
    if (isDraggingRef.current) return;
    mouseOverCharacterRef.current = true;
    updateMouseIgnore();
    setShowTooltip(true);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = setTimeout(() => setShowTooltip(false), TOOLTIP_DISPLAY_MS);
    if (animPhaseRef.current !== 'idle') {
      gracefulEndWalk();
    } else {
      setIsPaused(true);
    }
  };

  const handleMouseLeave = () => {
    if (isDraggingRef.current) return;
    mouseOverCharacterRef.current = false;
    updateMouseIgnore();
    gracefulExitRef.current = false;
    if (!showPopover) setIsPaused(false);
    setShowTooltip(false);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
  };

  return (
    <>
      <style>{`
        @keyframes tooltipFadeIn { from { opacity: 0; transform: translate(-50%, 5px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      `}</style>
      <div
        ref={containerRef}
        style={{
          position: 'absolute', left: 0, top: 0,
          width: displayW, height: displayH,
          pointerEvents: 'auto', cursor: 'pointer', zIndex: 10,
          display: (visible === false) ? 'none' : 'block',
          opacity: isReady ? 1 : 0,
          backfaceVisibility: 'hidden',
        }}
      >
        <div
          style={{ width: '100%', height: '100%', transform: `scaleX(${goingRight ? 1 : -1})`, position: 'relative' }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
        >
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', imageRendering: 'auto' }}
            width={cfg.frameWidth}
            height={cfg.frameHeight}
          />
        </div>

        {showTooltip && (
          <div style={{
            position: 'absolute', bottom: '105%', left: '50%', transform: 'translateX(-50%)',
            backgroundColor: 'rgba(20,20,28,0.88)', color: '#ddd', fontSize: '11px', padding: '3px 8px',
            borderRadius: '6px', whiteSpace: 'nowrap', pointerEvents: 'none',
            border: '1px solid rgba(255,255,255,0.1)', animation: 'tooltipFadeIn 0.15s ease',
          }}>{name}</div>
        )}

        {hasUnread && !showPopover && (
          <div style={{
            position: 'absolute', bottom: '90%', left: goingRight ? '70%' : '10%',
            backgroundColor: 'rgba(255,255,255,0.95)', color: '#333', fontSize: '14px', fontWeight: 'bold',
            padding: '4px 8px', borderRadius: '12px',
            borderBottomLeftRadius: goingRight ? '0' : '12px',
            borderBottomRightRadius: goingRight ? '12px' : '0',
            whiteSpace: 'nowrap', pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)', animation: 'bounce 2s infinite ease-in-out', zIndex: 20,
          }}>···</div>
        )}

        {isPopoverOpen && createPortal(
          <TerminalPopover
            name={name}
            history={chatHistory}
            isThinking={isThinking}
            onSubmitMessage={handleSubmitMessage}
            onClearHistory={handleClearHistory}
            popoverScreenX={popoverX}
            characterScreenY={popoverY}
            onClose={() => {
              setShowPopover(false);
              setIsPaused(false);
              setIsPopoverOpen(false);
              setDragPositionState(null);
              mouseOverPopoverRef.current = false;
              updateMouseIgnore();
            }}
            onPopoverMouseEnter={() => { mouseOverPopoverRef.current = true; updateMouseIgnore(); }}
            onPopoverMouseLeave={() => { mouseOverPopoverRef.current = false; updateMouseIgnore(); }}
            inputText={inputText}
            onInputTextChange={setInputText}
            pendingImages={pendingImages}
            onPendingImagesChange={setPendingImages}
          />,
          document.body
        )}
      </div>
    </>
  );
};

export default WalkerCharacter;
