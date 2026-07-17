import React, { useEffect, useState, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import TerminalPopover from './TerminalPopover';
import { useLMSession, ImageAttachment } from '../hooks/useLMSession';
import {
  registerCharacterOver,
  unregisterCharacterOver,
  registerPopoverOver,
  unregisterPopoverOver,
  subscribe as subscribeMouseState,
} from '../utils/mouseStateManager';
import {
  registerCharacter,
  unregisterCharacter,
  updateCharacterPosition,
  checkCollision,
  wouldCollide,
} from '../utils/characterPositionManager';
import {
  CHAR_CONFIGS,
  CharSpriteConfig,
  BASE_STEP,
  FRAME_DURATION_MS,
  TARGET_PROXIMITY_PX,
  LOOP_FRAMES_MIN,
  LOOP_FRAMES_MAX,
  PAUSED_CHECK_INTERVAL,
  EDGE_FLIP_DELAY_MIN,
  EDGE_FLIP_DELAY_MAX,
  IDLE_WAIT_MIN,
  IDLE_WAIT_MAX,
  POPOVER_TRACK_INTERVAL,
  TOOLTIP_DISPLAY_MS,
  WALK_DIST_MIN_PX,
  WALK_DIST_MAX_PX,
  WALK_DIST_THRESHOLD_PX,
  Phase,
} from '../config';

interface DisplayInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  workAreaX: number;
  workAreaY: number;
  workAreaWidth: number;
  workAreaHeight: number;
  bottomY: number;
}

interface TaskbarInfo {
  dockX: number;
  dockWidth: number;
  dockTopY: number;
  screenWidth: number;
  virtualX: number;
  virtualY: number;
  virtualWidth: number;
  virtualHeight: number;
  displays: DisplayInfo[];
}

interface WalkerProps {
  name: string;
  sprite: string;
  taskbarInfo: TaskbarInfo;
  initialProgress: number;
  yOffset: number;
  visible?: boolean;
  onHide?: () => void;
  isMaster?: boolean;
  displayIndex?: number;
  positionChannel?: BroadcastChannel | null;
  dragChannel?: BroadcastChannel | null;
  popoverChannel?: BroadcastChannel | null;
  llmChannel?: BroadcastChannel | null;
}

const ThinkingBubble: React.FC<{ text: string }> = ({ text }) => {
  const lineHeight = 18;
  const fontSize = 13;
  const isThinking = text === 'Thinking...';
  const paddingY = 10;
  const paddingX = isThinking ? 12 : 16;

  const [current, setCurrent] = useState(text);
  const [prev, setPrev] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const prevRef = useRef(text);

  useEffect(() => {
    if (text !== prevRef.current) {
      setPrev(prevRef.current);
      prevRef.current = text;
      setCurrent(text);
      setAnimKey(k => k + 1);
      const t = setTimeout(() => setPrev(null), 520);
      return () => clearTimeout(t);
    }
  }, [text]);

  const spanStyle: React.CSSProperties = isThinking
    ? {
        display: 'block',
        lineHeight: `${lineHeight}px`,
        whiteSpace: 'nowrap',
      }
    : {
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        lineHeight: `${lineHeight}px`,
        width: '100%',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      };

  const bubbleBaseStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '92%',
    left: '50%',
    transform: 'translateX(-100%)',
    width: isThinking ? 'auto' : `${300}px`,
    transformOrigin: 'bottom right',
    pointerEvents: 'none',
    zIndex: 30,
  };

  const bubbleInnerStyle: React.CSSProperties = {
    position: 'relative',
    backgroundColor: 'rgba(255,255,255,0.95)',
    color: '#333',
    fontSize: `${fontSize}px`,
    lineHeight: `${lineHeight}px`,
    padding: `${paddingY}px ${paddingX}px`,
    borderRadius: '12px',
    borderBottomRightRadius: '0',
    boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    wordBreak: isThinking ? 'normal' : 'break-word',
    overflow: 'hidden',
    fontWeight: 500,
    minHeight: `${lineHeight + paddingY * 2}px`,
    transition: 'height 0.3s ease, width 0.2s ease',
  };

  const tailStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '-8px',
    right: '16px',
    width: 0,
    height: 0,
    borderLeft: '8px solid transparent',
    borderTop: '8px solid rgba(255,255,255,0.95)',
  };

  return (
    <>
      <div style={{ ...bubbleBaseStyle, zIndex: 29 }}>
        {prev !== null && prev !== current && (
          <div key={`prev-${animKey}`} style={{ ...bubbleInnerStyle, animation: 'bubbleFloatUp 0.5s cubic-bezier(0.7, 0, 0.84, 0) forwards', transformOrigin: 'bottom center' }}>
            <span style={spanStyle}>{prev.replace(/\r\n/g, '\n')}</span>
            <div style={tailStyle} />
          </div>
        )}
      </div>
      <div style={bubbleBaseStyle}>
        <div key={`cur-${animKey}`} style={{
          ...bubbleInnerStyle,
          animation: 'bubbleFloatIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          transformOrigin: 'bottom center',
        }}>
          <span style={spanStyle}>{current.replace(/\r\n/g, '\n')}</span>
          <div style={tailStyle} />
        </div>
      </div>
    </>
  );
};

const WalkerCharacter: React.FC<WalkerProps> = ({
  name, sprite, taskbarInfo, initialProgress, yOffset, visible, onHide,
  isMaster = true, displayIndex = 0, positionChannel = null, dragChannel = null,
  popoverChannel = null, llmChannel = null,
}) => {
  const {
    chatHistory, isThinking, hasUnread, popoverRef, setHasUnread, setIsThinking,
    handleSubmitMessage, handleClearHistory, handleStop,
    deepThinking, setDeepThinking,
    prompts, selectedPrompt, handleSelectPrompt,
    currentModel, handleSelectModel,
  } = useLMSession(name, isMaster, llmChannel);

  const cfg = CHAR_CONFIGS[name];
  if (!cfg) throw new Error(`No sprite config for character "${name}"`);
  const effectiveYOffset = yOffset + (cfg.yOffset ?? 0);

  const displaysRef = useRef<DisplayInfo[]>(taskbarInfo.displays || []);
  const virtualXRef = useRef(taskbarInfo.virtualX ?? 0);
  const virtualYRef = useRef(taskbarInfo.virtualY ?? 0);
  const virtualWidthRef = useRef(taskbarInfo.virtualWidth || taskbarInfo.dockWidth || 1920);
  const virtualHeightRef = useRef(taskbarInfo.virtualHeight || 1080);

  const xRef = useRef(0);
  const xInitializedRef = useRef(false);
  const initXFromProgress = useCallback((progress: number) => {
    const vx = virtualXRef.current;
    const vw = virtualWidthRef.current;
    const displays = displaysRef.current;
    if (displays.length > 0 && vw > 0) {
      xRef.current = vx + progress * vw;
      xInitializedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (taskbarInfo.displays && taskbarInfo.displays.length > 0) {
      displaysRef.current = taskbarInfo.displays;
    }
    if (typeof taskbarInfo.virtualX === 'number') {
      virtualXRef.current = taskbarInfo.virtualX;
    }
    if (typeof taskbarInfo.virtualY === 'number') {
      virtualYRef.current = taskbarInfo.virtualY;
    }
    if (taskbarInfo.virtualWidth > 0) {
      virtualWidthRef.current = taskbarInfo.virtualWidth;
    }
    if (taskbarInfo.virtualHeight > 0) {
      virtualHeightRef.current = taskbarInfo.virtualHeight;
    }
    if (!xInitializedRef.current) {
      initXFromProgress(initialProgress);
    }
  }, [taskbarInfo.displays, taskbarInfo.virtualX, taskbarInfo.virtualY, taskbarInfo.virtualWidth, taskbarInfo.virtualHeight, initXFromProgress, initialProgress]);

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
  const lastRenderedFrameRef = useRef(0);
  const positionChannelRef = useRef<BroadcastChannel | null>(positionChannel);
  const dragChannelRef = useRef<BroadcastChannel | null>(dragChannel);
  const popoverChannelRef = useRef<BroadcastChannel | null>(popoverChannel);
  const isMasterRef = useRef(isMaster);
  const displayIndexRef = useRef(displayIndex);
  const isSyncingPopoverRef = useRef(false);

  useEffect(() => { positionChannelRef.current = positionChannel; }, [positionChannel]);
  useEffect(() => { dragChannelRef.current = dragChannel; }, [dragChannel]);
  useEffect(() => { popoverChannelRef.current = popoverChannel; }, [popoverChannel]);
  useEffect(() => { isMasterRef.current = isMaster; }, [isMaster]);
  useEffect(() => { displayIndexRef.current = displayIndex; }, [displayIndex]);
  const [dragPositionState, setDragPositionState] = useState<number | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [popoverX, setPopoverX] = useState(0);
  const [popoverY, setPopoverY] = useState(0);
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  // 对话框高度扩展状态提升到此处，关闭再打开时保留
  const [heightExpanded, setHeightExpanded] = useState(false);
  // 右键隐藏按钮是否显示
  const [showHideButton, setShowHideButton] = useState(false);
  const [showThemeButton, setShowThemeButton] = useState(false);
  const lastBubbleReasoningRef = useRef('');
  const lastBubbleTextRef = useRef('');
  const lastBubbleOutputRef = useRef('');
  const lastBubbleOutputTextRef = useRef('');
  const contextMenuHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextMenuThemeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Track when popover was last closed to delay walk resumption
  const popoverCloseTimeRef = useRef(0);
  
  // Unique drag ID to identify which character is being dragged
  // Prevents multiple characters from being dragged simultaneously when overlapping
  const dragIdRef = useRef<string>(`${name}-${Math.random().toString(36).slice(2)}`);
  const activeDragIdRef = useRef<string | null>(null);

  // Refs for values accessed in rAF loop (avoid stale closures)
  // (virtualWidthRef / displaysRef / virtualXRef defined above)

  // Animation state
  const rafRef = useRef(0);
  const animationCleanupRef = useRef<(() => void) | null>(null);
  const animPhaseRef = useRef<Phase>('idle');
  const animFrameRef = useRef(0);
  const lastAnimTimeRef = useRef(0);
  const loopCountTargetRef = useRef(0);
  const loopCountDoneRef = useRef(0);
  // Stop requests must wait for the loop boundary. Jumping from an arbitrary
  // loop frame straight to endMin creates a visible pose discontinuity.
  const endRequestedRef = useRef(false);
  const walkStartX = useRef(0);
  const walkEndX = useRef(0);

  const dragState = useRef({ startScreenX: 0, startPosX: 0, hasDragged: false });
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimeRef = useRef(0);

  // ── Centralized mouse-ignore state machine ──
  const mouseOverCharacterRef = useRef(false);
  const showPopoverRef = useRef(showPopover);

  const displayW = Math.round(cfg.frameWidth * cfg.scale);
  const displayH = Math.round(cfg.frameHeight * cfg.scale);

  // ── Load sprite image ──
  useEffect(() => {
    let mounted = true;
    const img = new Image();
    img.src = sprite;
    img.onload = () => {
      if (!mounted) return;
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
    return () => {
      mounted = false;
      animationCleanupRef.current?.();
      animationCleanupRef.current = null;
    };
  }, [sprite, cfg]);

  // ── Unified cleanup on unmount ──
  useEffect(() => {
    return () => {
      animationCleanupRef.current?.();
      animationCleanupRef.current = null;
      // Restore text selection on unmount
      document.body.style.userSelect = '';
    };
  }, []);

  // ── Register character with global managers on mount/unmount ──
  useEffect(() => {
    const charWidth = cfg.frameWidth * cfg.scale;
    registerCharacter(name, charWidth);
    return () => {
      unregisterCharacterOver(name);
      unregisterCharacter(name);
    };
  }, [name, cfg.frameWidth, cfg.scale]);

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
    lastRenderedFrameRef.current = frame;
  }, [cfg.cols, cfg.frameWidth, cfg.frameHeight]);

  // 根据 X 坐标找到对应显示器，返回该屏底部 Y（workArea 底 = 任务栏顶）
  const getBottomYForX = useCallback((screenX: number): number => {
    const displays = displaysRef.current;
    if (displays.length === 0) return window.innerHeight - 48;
    let bestDisplay: DisplayInfo | null = null;
    let bestDist = Infinity;
    for (const d of displays) {
      if (screenX >= d.x && screenX < d.x + d.width) {
        return d.bottomY;
      }
      const distLeft = Math.abs(screenX - d.x);
      const distRight = Math.abs(screenX - (d.x + d.width));
      const minDist = Math.min(distLeft, distRight);
      if (minDist < bestDist) {
        bestDist = minDist;
        bestDisplay = d;
      }
    }
    return bestDisplay ? bestDisplay.bottomY : displays[0].bottomY;
  }, []);

  // ── Position update (direct DOM transform, no CSS transition) ──
  const updateDOMPosition = useCallback(() => {
    if (!containerRef.current) return;
    const screenX = xRef.current;
    const bottomY = getBottomYForX(screenX);
    const displays = displaysRef.current;
    const thisDisplay = displays[displayIndexRef.current] || displays[0];
    const leftPx = screenX - (thisDisplay?.x ?? 0);
    const topPx = (bottomY - (thisDisplay?.y ?? 0)) + effectiveYOffset - displayH;
    containerRef.current.style.transition = 'none';
    containerRef.current.style.transform = `translate3d(${leftPx}px, ${topPx}px, 0)`;
  }, [effectiveYOffset, displayH, getBottomYForX]);

  useEffect(() => { updateDOMPosition(); }, [updateDOMPosition, taskbarInfo.virtualWidth, taskbarInfo.displays]);

  // no-op removed — progressRef always tracks logical position

  useEffect(() => { popoverRef.current = showPopover; }, [showPopover, popoverRef]);
  useEffect(() => { showPopoverRef.current = showPopover; }, [showPopover]);
  // ── rAF loop: frames + eased position ──
  const animTick = useCallback((time: number) => {
    if (lastAnimTimeRef.current === 0) lastAnimTimeRef.current = time;
    const elapsed = Math.min(time - lastAnimTimeRef.current, 200);

    const phase = animPhaseRef.current;
    const direction = goingRightRef.current ? 1 : -1;
    const baseStepPx = BASE_STEP;

    const vx = virtualXRef.current;
    const vw = virtualWidthRef.current;
    const minX = vx + 10;
    const maxX = vx + vw - 10;

    if (!isDraggingRef.current && phase !== 'idle') {
      const endFrames = cfg.endMax - cfg.endMin + 1;

      if (phase === 'start') {
        const t = (animFrameRef.current - cfg.startMin) / (cfg.startMax - cfg.startMin + 1);
        const easeCoeff = t * t;
        xRef.current += baseStepPx * direction * easeCoeff * elapsed / FRAME_DURATION_MS;
        xRef.current = Math.max(minX, Math.min(maxX, xRef.current));
      } else if (phase === 'loop') {
        const newX = xRef.current + baseStepPx * direction * elapsed / FRAME_DURATION_MS;

        // Request the exit early enough to finish the current loop and the
        // deceleration frames near the planned target. The actual phase
        // transition happens below only after loopMax has been rendered.
        const loopFramesRemaining = Math.max(0, cfg.loopMax - animFrameRef.current);
        const endTravelFrameEquivalents = endFrames <= 1
          ? 0
          : (endFrames * (2 * endFrames - 1)) / (6 * (endFrames - 1));
        const brakingDistance = baseStepPx * (loopFramesRemaining + endTravelFrameEquivalents);
        const distanceToTarget = direction > 0
          ? walkEndX.current - newX
          : newX - walkEndX.current;
        const nearTarget = distanceToTarget <= Math.max(TARGET_PROXIMITY_PX, brakingDistance);
        const nearEdge = newX <= minX || newX >= maxX;

        if ((nearTarget || nearEdge) && !endRequestedRef.current) {
          xRef.current = Math.max(minX, Math.min(maxX, newX));
          endRequestedRef.current = true;
          if (nearEdge) {
            goingRightRef.current = !goingRightRef.current;
            setGoingRight(goingRightRef.current);
          }
        } else {
          xRef.current = Math.max(minX, Math.min(maxX, newX));
        }
      } else if (phase === 'end') {
        const tEnd = Math.min(1, (animFrameRef.current - cfg.endMin) / (endFrames - 1));
        const easeCoeff = (1 - tEnd) * (1 - tEnd);
        xRef.current += baseStepPx * direction * easeCoeff * elapsed / FRAME_DURATION_MS;
        xRef.current = Math.max(minX, Math.min(maxX, xRef.current));
      }
      updateDOMPosition();
    }

    // ── Collision avoidance (master only) ──
    if (isMasterRef.current) {
      const charWidth = cfg.frameWidth * cfg.scale;
      const isMoving = phase !== 'idle' && !isDraggingRef.current;
      updateCharacterPosition(name, xRef.current, goingRightRef.current, isMoving);

      // Once an exit has been requested (or the end phase has started), do
      // not keep resetting the animation to endMin on every collision tick.
      const canRequestCollisionExit = (phase === 'start' || phase === 'loop')
        && !endRequestedRef.current;
      if (isMoving && canRequestCollisionExit && !isDraggingRef.current && !showPopover) {
        const { colliding, pushDir } = checkCollision(name, xRef.current, charWidth, 4);
        if (colliding) {
          xRef.current += pushDir * 1.5;
          xRef.current = Math.max(minX, Math.min(maxX, xRef.current));
          walkStartX.current = xRef.current;
          walkEndX.current = xRef.current;
          endRequestedRef.current = true;
          goingRightRef.current = pushDir > 0;
          setGoingRight(goingRightRef.current);
          updateDOMPosition();
        }
      }
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
          walkStartX.current = xRef.current;
        }
        renderFrame(animFrameRef.current);
      } else if (phase === 'loop') {
        animFrameRef.current++;
        if (animFrameRef.current > cfg.loopMax) {
          animFrameRef.current = cfg.loopMin;
          loopCountDoneRef.current++;
          if (endRequestedRef.current || loopCountDoneRef.current >= loopCountTargetRef.current) {
            walkStartX.current = xRef.current;
            animFrameRef.current = cfg.endMin;
            animPhaseRef.current = 'end';
            endRequestedRef.current = false;
          }
        }
        renderFrame(animFrameRef.current);
      } else if (phase === 'end') {
        animFrameRef.current++;
        const arrived = animFrameRef.current > cfg.endMax;
        if (arrived) {
          renderFrame(cfg.endMax);
          animPhaseRef.current = 'idle';
          endRequestedRef.current = false;
          setIsAnimating(false);
        } else {
          renderFrame(animFrameRef.current);
        }
      }
    }

    if (isMasterRef.current && positionChannelRef.current) {
      try {
        positionChannelRef.current.postMessage({
          name,
          x: xRef.current,
          frame: lastRenderedFrameRef.current,
          phase: animPhaseRef.current,
          goingRight: goingRightRef.current,
        });
      } catch (_e) { /* ignore */ }
    }

    rafRef.current = requestAnimationFrame(animTick);
  }, [cfg, renderFrame, updateDOMPosition, name]);

  // ── Unified animation starter: cleans up old rAF before starting new ──
  const startAnimation = useCallback(() => {
    animationCleanupRef.current?.();
    animationCleanupRef.current = null;
    rafRef.current = requestAnimationFrame(animTick);
    animationCleanupRef.current = () => cancelAnimationFrame(rafRef.current);
  }, [animTick]);

  // ── Start walk ──
  const startWalk = useCallback(() => {
    animationCleanupRef.current?.();
    animationCleanupRef.current = null;
    gracefulExitRef.current = false;
    endRequestedRef.current = false;
    animPhaseRef.current = 'start';
    animFrameRef.current = cfg.startMin;
    loopCountTargetRef.current = LOOP_FRAMES_MIN + Math.floor(Math.random() * (LOOP_FRAMES_MAX - LOOP_FRAMES_MIN + 1));
    loopCountDoneRef.current = 0;
    lastAnimTimeRef.current = 0;
    renderFrame(animFrameRef.current);
    startAnimation();
  }, [cfg, renderFrame, startAnimation]);

  // ── Stop ──
  const stopWalk = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    animPhaseRef.current = 'idle';
    endRequestedRef.current = false;
  }, []);

  // ── Graceful walk finish ──
  const gracefulEndWalk = useCallback(() => {
    if (animPhaseRef.current === 'idle') return;
    gracefulExitRef.current = true;
    if (animPhaseRef.current === 'start' || animPhaseRef.current === 'loop') {
      walkStartX.current = xRef.current;
      walkEndX.current = xRef.current;
      endRequestedRef.current = true;
    }
  }, []);

  // ── Sync isAnimating with animPhaseRef (master only) ──
  useEffect(() => {
    if (!isMaster) return;
    if (isAnimating && animPhaseRef.current === 'idle') {
      startWalk();
    } else if (!isAnimating && animPhaseRef.current !== 'idle' && !gracefulExitRef.current) {
      stopWalk();
    }
    return () => {
      animationCleanupRef.current?.();
      animationCleanupRef.current = null;
    };
  }, [isAnimating, startWalk, stopWalk, isMaster]);

  // ── Animation watchdog: ensures rAF stays alive when it should be running ──
  useEffect(() => {
    if (!isMaster) return;
    if (!isReady) return;

    const intervalId = setInterval(() => {
      if (!isAnimating || showPopover || isPaused || isDraggingRef.current) return;
      if (animPhaseRef.current === 'idle') return;
      if (rafRef.current) return;

      startWalk();
    }, 500);

    return () => clearInterval(intervalId);
  }, [isMaster, isReady, isAnimating, showPopover, isPaused, startWalk]);

  // ── Track character screen position for popover ──
  // Directly manipulate popover DOM element position on every rAF frame
  // This eliminates React state update lag and ensures zero-delay tracking
  const popoverDomRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!isPopoverOpen) return;

    const popoverEl = popoverDomRef.current;
    if (!popoverEl) return;

    // Use rAF for direct DOM position updates - zero lag
    let rafId: number;

    const update = () => {
      const r = containerRef.current?.getBoundingClientRect();
      if (r) {
        const newX = r.left + r.width / 2;
        const newY = r.top;
        // 用 CSS bottom 锚定弹窗底边（距人物顶部 20px），而非 top+translateY(-100%)。
        // translateY(-100%) 的百分比会随动画中的高度每帧重算，反而引入抖动；
        // 改用 bottom 钉死底边后，height 动画时弹窗纯粹向上生长，
        // JS 完全不读取/不依赖弹窗高度，消除双时钟竞争与亚像素抖动。
        popoverEl.style.left = `${newX}px`;
        popoverEl.style.bottom = `${window.innerHeight - newY + 20}px`;
      }
      rafId = requestAnimationFrame(update);
    };

    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, [isPopoverOpen]);

  // ── Personality / idle engine (master only) ──
  useEffect(() => {
    if (!isMaster) return;
    if (!taskbarInfo.virtualWidth || !taskbarInfo.displays || taskbarInfo.displays.length === 0) return;
    setIsReady(true);

    let timeoutId: ReturnType<typeof setTimeout>;

    const planNextAction = () => {
      if (showPopover || isDraggingRef.current) {
        timeoutId = setTimeout(planNextAction, PAUSED_CHECK_INTERVAL);
        return;
      }
      if (animPhaseRef.current !== 'idle') {
        timeoutId = setTimeout(planNextAction, PAUSED_CHECK_INTERVAL);
        return;
      }
      // Clear stale exit flag so idle characters don't stay blocked
      if (gracefulExitRef.current) gracefulExitRef.current = false;
      if (isPaused) {
        timeoutId = setTimeout(planNextAction, PAUSED_CHECK_INTERVAL);
        return;
      }
      
      // Delay walk resumption after popover close to prevent jump
      const timeSincePopoverClose = Date.now() - popoverCloseTimeRef.current;
      const MIN_DELAY_AFTER_POPOVER_CLOSE = 500; // 0.5 seconds - short delay to let rendering settle
      if (timeSincePopoverClose < MIN_DELAY_AFTER_POPOVER_CLOSE) {
        const remainingDelay = MIN_DELAY_AFTER_POPOVER_CLOSE - timeSincePopoverClose;
        timeoutId = setTimeout(planNextAction, remainingDelay);
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
      const vx = virtualXRef.current;
      const vw = virtualWidthRef.current;
      const minX = vx + 50;
      const maxX = vx + vw - 50;

      const currentX = Math.max(minX, Math.min(maxX, xRef.current));
      let direction = goingRightRef.current ? 1 : -1;
      const charWidth = cfg.frameWidth * cfg.scale;
      let walkDist = WALK_DIST_MIN_PX + Math.random() * (WALK_DIST_MAX_PX - WALK_DIST_MIN_PX);
      let targetX = currentX + direction * walkDist;

      if (targetX < minX || targetX > maxX) {
        direction = -direction;
        targetX = currentX + direction * walkDist;
        goingRightRef.current = direction === 1;
        setGoingRight(goingRightRef.current);
      }

      if (wouldCollide(name, targetX, charWidth, direction, 20)) {
        direction = -direction;
        targetX = currentX + direction * walkDist;
        goingRightRef.current = direction === 1;
        setGoingRight(goingRightRef.current);

        if (wouldCollide(name, targetX, charWidth, direction, 20) || targetX < minX || targetX > maxX) {
          walkDist = WALK_DIST_MIN_PX * 0.5;
          targetX = currentX + direction * walkDist;
        }
      }

      targetX = Math.max(minX, Math.min(maxX, targetX));
      if (Math.abs(targetX - currentX) < WALK_DIST_THRESHOLD_PX) {
        goingRightRef.current = !goingRightRef.current;
        setGoingRight(goingRightRef.current);
        const delay = EDGE_FLIP_DELAY_MIN + Math.random() * (EDGE_FLIP_DELAY_MAX - EDGE_FLIP_DELAY_MIN);
        timeoutId = setTimeout(planNextAction, delay);
        return;
      }
      walkStartX.current = currentX;
      walkEndX.current = targetX;
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
  }, [isMaster, showPopover, isPaused, isAnimating, name, isReady, taskbarInfo.virtualWidth, taskbarInfo.displays, cfg.walkProb]);

  // ── Slave mode: receive position updates from master ──
  useEffect(() => {
    if (isMaster) return;
    if (!positionChannel) return;
    if (!taskbarInfo.displays || taskbarInfo.displays.length === 0) return;

    setIsReady(true);

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.name !== name) return;
      const { x, frame, phase, goingRight } = e.data;
      if (typeof x === 'number') {
        xRef.current = x;
      }
      if (typeof frame === 'number') {
        animFrameRef.current = frame;
        renderFrame(frame);
      }
      if (typeof phase === 'string') {
        animPhaseRef.current = phase as Phase;
        setIsAnimating(phase !== 'idle');
      }
      if (typeof goingRight === 'boolean') {
        goingRightRef.current = goingRight;
        setGoingRight(goingRight);
      }
      updateDOMPosition();
    };

    positionChannel.addEventListener('message', handleMessage);
    return () => {
      positionChannel.removeEventListener('message', handleMessage);
    };
  }, [isMaster, positionChannel, name, taskbarInfo.displays, renderFrame, updateDOMPosition]);

  // ── Drag sync: broadcast drags from any window ──
  useEffect(() => {
    if (!dragChannel) return;

    let dragTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const resetDragTimeout = () => {
      if (dragTimeoutId) {
        clearTimeout(dragTimeoutId);
        dragTimeoutId = null;
      }
      dragTimeoutId = setTimeout(() => {
        isDraggingRef.current = false;
        dragTimeoutId = null;
      }, 500);
    };

    const handleDragMessage = (e: MessageEvent) => {
      if (e.data?.name !== name) return;
      if (e.data?.type === 'drag-move' && typeof e.data.x === 'number') {
        xRef.current = e.data.x;
        isDraggingRef.current = true;
        updateDOMPosition();
        if (dragPositionState !== xRef.current) {
          setDragPositionState(xRef.current);
        }
        resetDragTimeout();
      } else if (e.data?.type === 'drag-end') {
        isDraggingRef.current = false;
        if (dragTimeoutId) {
          clearTimeout(dragTimeoutId);
          dragTimeoutId = null;
        }
      }
    };

    dragChannel.addEventListener('message', handleDragMessage);
    return () => {
      dragChannel.removeEventListener('message', handleDragMessage);
      if (dragTimeoutId) clearTimeout(dragTimeoutId);
    };
  }, [dragChannel, name, updateDOMPosition, dragPositionState]);

  // ── Master: broadcast initial state when channel becomes ready ──
  useEffect(() => {
    if (!isMaster) return;
    if (!positionChannel) return;
    if (!xInitializedRef.current) return;
    try {
      positionChannel.postMessage({
        name,
        x: xRef.current,
        frame: lastRenderedFrameRef.current,
        phase: animPhaseRef.current,
        goingRight: goingRightRef.current,
      });
    } catch (_e) { /* ignore */ }
  }, [isMaster, positionChannel, name]);

  // ── Popover state sync across windows ──
  useEffect(() => {
    if (!popoverChannel) return;

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.name !== name) return;
      const type = e.data?.type;
      if (!type) return;

      isSyncingPopoverRef.current = true;
      try {
        switch (type) {
          case 'open': {
            if (!showPopoverRef.current) {
              if (animPhaseRef.current !== 'idle') {
                gracefulEndWalk();
              }
              setIsPaused(true);
              setHasUnread(false);
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                setPopoverX(Math.floor(rect.left + rect.width / 2));
                setPopoverY(Math.floor(rect.top));
              }
              requestAnimationFrame(() => {
                setIsPopoverOpen(true);
                setShowPopover(true);
              });
            }
            break;
          }
          case 'close': {
            if (showPopoverRef.current) {
              setShowPopover(false);
              setIsPaused(false);
              setIsPopoverOpen(false);
              setDragPositionState(null);
              setPendingImages([]);
              unregisterPopoverOver(name);
              popoverCloseTimeRef.current = Date.now();
            }
            break;
          }
          case 'input': {
            if (typeof e.data.text === 'string') {
              setInputText(e.data.text);
            }
            break;
          }
          case 'images': {
            if (Array.isArray(e.data.images)) {
              setPendingImages(e.data.images);
            }
            break;
          }
          case 'expand': {
            if (typeof e.data.expanded === 'boolean') {
              setHeightExpanded(e.data.expanded);
            }
            break;
          }
          case 'deepThinking': {
            if (typeof e.data.value === 'boolean') {
              setDeepThinking(e.data.value);
            }
            break;
          }
        }
      } finally {
        setTimeout(() => { isSyncingPopoverRef.current = false; }, 0);
      }
    };

    popoverChannel.addEventListener('message', handleMessage);
    return () => {
      popoverChannel.removeEventListener('message', handleMessage);
    };
  }, [popoverChannel, name, gracefulEndWalk, setHasUnread, setDeepThinking, unregisterPopoverOver]);

  // ── Broadcast popover state changes ──
  useEffect(() => {
    if (!popoverChannel) return;
    if (isSyncingPopoverRef.current) return;
    try {
      popoverChannel.postMessage({
        name,
        type: showPopover ? 'open' : 'close',
      });
    } catch (_e) { /* ignore */ }
  }, [showPopover, name, popoverChannel]);

  useEffect(() => {
    if (!popoverChannelRef.current) return;
    if (isSyncingPopoverRef.current) return;
    try {
      popoverChannelRef.current.postMessage({
        name, type: 'input', text: inputText,
      });
    } catch (_e) { /* ignore */ }
  }, [inputText, name]);

  useEffect(() => {
    if (!popoverChannelRef.current) return;
    if (isSyncingPopoverRef.current) return;
    try {
      popoverChannelRef.current.postMessage({
        name, type: 'images', images: pendingImages,
      });
    } catch (_e) { /* ignore */ }
  }, [pendingImages, name]);

  useEffect(() => {
    if (!popoverChannelRef.current) return;
    if (isSyncingPopoverRef.current) return;
    try {
      popoverChannelRef.current.postMessage({
        name, type: 'expand', expanded: heightExpanded,
      });
    } catch (_e) { /* ignore */ }
  }, [heightExpanded, name]);

  useEffect(() => {
    if (!popoverChannelRef.current) return;
    if (isSyncingPopoverRef.current) return;
    try {
      popoverChannelRef.current.postMessage({
        name, type: 'deepThinking', value: deepThinking,
      });
    } catch (_e) { /* ignore */ }
  }, [deepThinking, name]);

  // ── Cancel animation on layout change ──
  useEffect(() => {
    if (animPhaseRef.current !== 'idle' && !gracefulExitRef.current) {
      gracefulEndWalk();
    }
  }, [taskbarInfo.virtualWidth, taskbarInfo.displays, gracefulEndWalk]);

  // ── Click handler (stable via ref-based reads) ──
  const handleClick = useCallback(() => {
    // Only respond if the mouse is actually over THIS character instance
    if (!mouseOverCharacterRef.current) return;

    if (!showPopoverRef.current) {
      // Gracefully end walk: let animation transition to end phase and stop smoothly
      if (animPhaseRef.current !== 'idle') {
        gracefulEndWalk();
      }
      setIsPaused(true);
      setHasUnread(false);
      
      // Get current position and set it BEFORE opening popover
      // This prevents the popover from rendering at (0,0) initially
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const popoverX = Math.floor(rect.left + rect.width / 2);
        const popoverY = Math.floor(rect.top);
        setPopoverX(popoverX);
        setPopoverY(popoverY);
      }
      
      // Wait for next frame to ensure position state is applied before popover opens
      requestAnimationFrame(() => {
        setIsPopoverOpen(true);
        setShowPopover(true);
      });
    } else {
      // Close popover first
      setShowPopover(false);
      setIsPopoverOpen(false);
      // Record close time to delay walk resumption
      popoverCloseTimeRef.current = Date.now();
      // Resume idle behavior
      setIsPaused(false);
    }
  }, []);

  // ── OS cursor position polling for hover detection ──
  // setIgnoreMouseEvents(true, {forward: true}) sends ALL mouse events through
  // to the window beneath in Z-order — the page receives nothing.
  // Solution: poll the real OS cursor position from main process, detect when
  // it's over the character, then disable ignore mode so DOM events fire normally.
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    const checkCursor = async () => {
      if (isDraggingRef.current) return;

      try {
        const pos = await electronAPI.getCursorPos();
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();

        // Convert client coordinates to screen coordinates.
        // getBoundingClientRect() returns coordinates relative to the viewport,
        // but screen.getCursorScreenPoint() returns absolute screen coordinates.
        // We must add the window's screen offset to get comparable coordinates.
        const screenX = rect.left + window.screenX;
        const screenY = rect.top + window.screenY;
        const screenRight = rect.right + window.screenX;
        const screenBottom = rect.bottom + window.screenY;

        const isOverRect = pos.x >= screenX && pos.x <= screenRight &&
                           pos.y >= screenY && pos.y <= screenBottom;

        // When characters overlap, use elementFromPoint to ensure only the topmost character responds
        // This is the key fix for overlapping characters
        const isTopmost = isOverRect ? (() => {
          // Check if the character's canvas/div is actually under the cursor
          // elementFromPoint returns the topmost element at given coordinates
          const topEl = document.elementFromPoint(pos.x - window.screenX, pos.y - window.screenY);
          if (!topEl) return false;
          // Check if the topEl is this character or a child of this character
          return el === topEl || el.contains(topEl);
        })() : false;

        // 如果鼠标在本角色的主题面板/按钮上，也视为在小人上（防止菜单消失）
        const isOverUi = (() => {
          const topEl = document.elementFromPoint(pos.x - window.screenX, pos.y - window.screenY);
          if (!topEl) return false;
          const htmlEl = topEl as HTMLElement;
          if (!htmlEl.closest) return false;
          const uiEl = htmlEl.closest('[data-theme-panel], [data-theme-btn], [data-hide-btn]');
          if (!uiEl) return false;
          // 确保这个 UI 元素属于本角色
          return el.contains(uiEl);
        })();

        const effectiveTopmost = isTopmost || isOverUi;

        if (effectiveTopmost && !mouseOverCharacterRef.current) {
          mouseOverCharacterRef.current = true;
          registerCharacterOver(name);
          // 600ms 悬停延迟后才显示 tooltip
          if (tooltipShowTimerRef.current) clearTimeout(tooltipShowTimerRef.current);
          tooltipShowTimerRef.current = setTimeout(() => {
            setShowTooltip(true);
            if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
            tooltipTimerRef.current = setTimeout(() => setShowTooltip(false), TOOLTIP_DISPLAY_MS);
          }, 600);
          if (animPhaseRef.current !== 'idle') {
            gracefulEndWalk();
          } else {
            setIsPaused(true);
          }
        } else if (!effectiveTopmost && mouseOverCharacterRef.current) {
          mouseOverCharacterRef.current = false;
          gracefulExitRef.current = false;
          unregisterCharacterOver(name);
          // 离开时清除出现延迟和已显示的 tooltip
          if (tooltipShowTimerRef.current) {
            clearTimeout(tooltipShowTimerRef.current);
            tooltipShowTimerRef.current = null;
          }
          if (!showPopoverRef.current) {
            setIsPaused(false);
          }
          setShowTooltip(false);
          if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
        }
      } catch { /* ignore */ }
    };

    const id = setInterval(checkCursor, 100);
    return () => clearInterval(id);
  }, [gracefulEndWalk]);

  // ── Mouse events (only fire when ignore mode is disabled, i.e. cursor is over character) ──
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (activeDragIdRef.current !== dragIdRef.current) return;

      if (isDraggingRef.current) {
        const dx = Math.abs(e.screenX - dragState.current.startScreenX);
        if (dx > 3) dragState.current.hasDragged = true;
        const delta = e.screenX - dragState.current.startScreenX;
        const vx = virtualXRef.current;
        const vw = virtualWidthRef.current;
        const minX = vx + 20;
        const maxX = vx + vw - 20;
        const newX = dragState.current.startPosX + delta;
        const clampedX = Math.max(minX, Math.min(maxX, isNaN(newX) ? xRef.current : newX));
        xRef.current = clampedX;
        updateDOMPosition();
        updateCharacterPosition(name, clampedX, goingRightRef.current, false);
        if (showPopoverRef.current) setDragPositionState(clampedX);

        if (dragChannelRef.current) {
          try {
            dragChannelRef.current.postMessage({ name, type: 'drag-move', x: clampedX });
          } catch (_e) { /* ignore */ }
        }
      }

      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = setTimeout(() => setShowTooltip(false), TOOLTIP_DISPLAY_MS);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!mouseOverCharacterRef.current) return;
      // 点击在主题面板或按钮上时，不触发拖拽
      const target = e.target as HTMLElement;
      if (target.closest('[data-theme-panel]') || target.closest('[data-theme-btn]') || target.closest('[data-hide-btn]')) return;
      activeDragIdRef.current = dragIdRef.current;
      isDraggingRef.current = true;
      setIsPaused(true);
      dragState.current = { startScreenX: e.screenX, startPosX: xRef.current, hasDragged: false };
      document.body.style.userSelect = 'none';
    };

    const onMouseUp = (e: MouseEvent) => {
      if (activeDragIdRef.current !== dragIdRef.current) return;

      // 点击在主题面板或按钮上时，不触发点击（不打开对话框）
      const target = e.target as HTMLElement;
      if (target.closest('[data-theme-panel]') || target.closest('[data-theme-btn]') || target.closest('[data-hide-btn]')) {
        isDraggingRef.current = false;
        activeDragIdRef.current = null;
        setDragPositionState(null);
        document.body.style.userSelect = '';
        return;
      }

      const wasDragging = dragState.current.hasDragged;
      isDraggingRef.current = false;
      activeDragIdRef.current = null;
      setDragPositionState(null);
      document.body.style.userSelect = '';

      if (dragChannelRef.current) {
        try {
          dragChannelRef.current.postMessage({ name, type: 'drag-end' });
        } catch (_e) { /* ignore */ }
      }

      if (!wasDragging) {
        handleClick();
      } else if (!showPopoverRef.current) {
        setIsPaused(false);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [handleClick]);

  // ── 右键菜单按钮：显示 / 离开小人后自动关闭 ──
  useEffect(() => {
    if (!showHideButton && !showThemeButton) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 点击在主题面板/按钮上不关闭菜单
      if (target.closest && (
        target.closest('[data-theme-panel]') ||
        target.closest('[data-theme-btn]') ||
        target.closest('[data-hide-btn]')
      )) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowHideButton(false);
        setShowThemeButton(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [showHideButton, showThemeButton]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setShowHideButton(true);
    setShowThemeButton(true);
    if (contextMenuHideTimerRef.current) { clearTimeout(contextMenuHideTimerRef.current); contextMenuHideTimerRef.current = null; }
    if (contextMenuThemeTimerRef.current) { clearTimeout(contextMenuThemeTimerRef.current); contextMenuThemeTimerRef.current = null; }
  }, []);

  const handleHideClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowHideButton(false);
    setShowThemeButton(false);
    onHide?.();
  }, [onHide]);

  const handleCharacterMouseLeave = useCallback(() => {
    if (contextMenuHideTimerRef.current) clearTimeout(contextMenuHideTimerRef.current);
    if (contextMenuThemeTimerRef.current) clearTimeout(contextMenuThemeTimerRef.current);
    contextMenuHideTimerRef.current = setTimeout(() => setShowHideButton(false), 100);
    contextMenuThemeTimerRef.current = setTimeout(() => setShowThemeButton(false), 100);
  }, []);

  const handleCharacterMouseEnter = useCallback(() => {
    if (contextMenuHideTimerRef.current) { clearTimeout(contextMenuHideTimerRef.current); contextMenuHideTimerRef.current = null; }
    if (contextMenuThemeTimerRef.current) { clearTimeout(contextMenuThemeTimerRef.current); contextMenuThemeTimerRef.current = null; }
  }, []);

  // ── 主题切换 ──
  const THEMES = [
    { key: 'corporate', name: 'Corporate', color: '#2980b9' },
    { key: 'neon', name: 'Neon', color: '#56b6c2' },
    { key: 'toxic', name: 'Toxic', color: '#00ff41' },
    { key: 'glass', name: 'Glass', color: '#007aff' },
  ];
  const [themePopOpen, setThemePopOpen] = useState(false);
  const themeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const themePanelRef = useRef<HTMLDivElement>(null);
  const themeItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [sliderStyle, setSliderStyle] = useState({ top: 0, height: 0, opacity: 0 });
  const [currentTheme, setCurrentTheme] = useState('corporate');

  useEffect(() => {
    const cls = document.documentElement.className;
    const match = cls.match(/theme-(\w+)/);
    if (match) setCurrentTheme(match[1]);
  }, []);

  const updateThemeSlider = useCallback((themeKey: string) => {
    const el = themeItemRefs.current[themeKey];
    const panel = themePanelRef.current;
    if (!el || !panel) return;
    const panelRect = panel.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    setSliderStyle({
      top: elRect.top - panelRect.top,
      height: elRect.height,
      opacity: 1,
    });
  }, []);

  const openThemePop = useCallback(() => {
    if (themeTimerRef.current) { clearTimeout(themeTimerRef.current); themeTimerRef.current = null; }
    setThemePopOpen(true);
    requestAnimationFrame(() => updateThemeSlider(currentTheme));
  }, [currentTheme, updateThemeSlider]);

  const closeThemePopDelayed = useCallback(() => {
    if (themeTimerRef.current) clearTimeout(themeTimerRef.current);
    themeTimerRef.current = setTimeout(() => setThemePopOpen(false), 100);
  }, []);

  const switchTheme = useCallback((themeKey: string) => {
    document.documentElement.className = `theme-${themeKey}`;
    setCurrentTheme(themeKey);
    updateThemeSlider(themeKey);
  }, [updateThemeSlider]);

  return (
    <>
      <style>{`
        @keyframes tooltipFadeIn { from { opacity: 0; transform: translate(-50%, 5px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes bubbleFloatUp {
          from { opacity: 1; transform: translateY(0) scaleX(1); }
          to { opacity: 0; transform: translateY(-48px) scaleX(0.9); }
        }
        @keyframes bubbleFloatIn {
          from { opacity: 0; transform: translateY(48px) scaleX(0.9); }
          to { opacity: 1; transform: translateY(0) scaleX(1); }
        }
        @keyframes popFadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
      <div
        ref={containerRef}
        onContextMenu={handleContextMenu}
        onMouseEnter={handleCharacterMouseEnter}
        onMouseLeave={handleCharacterMouseLeave}
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
        >
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', imageRendering: 'auto' }}
            width={cfg.frameWidth}
            height={cfg.frameHeight}
          />
        </div>

        {/* Pie menu：以头部右上方为中心，按钮沿圆弧排列 */}
        <button
          data-hide-btn
          onClick={handleHideClick}
          onContextMenu={(e) => e.preventDefault()}
          title="隐藏"
          style={{
            position: 'absolute',
            top: '-6px',
            right: '-6px',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            border: '1px solid rgba(0,0,0,0.12)',
            backgroundColor: '#f1f1f1d3',
            color: '#111111',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
            zIndex: 20,
            opacity: showHideButton ? 1 : 0,
            transform: `scale(${showHideButton ? 1 : 0.6})`,
            pointerEvents: showHideButton ? 'auto' : 'none',
            transition: 'opacity 0.15s ease, transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
          onMouseEnter={(e) => { if (showHideButton) e.currentTarget.style.transform = 'scale(1.1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = `scale(${showHideButton ? 1 : 0.6})`; }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>

        <div
          data-theme-btn
          style={{
            position: 'absolute',
            top: '26px',
            right: '-10px',
            opacity: showThemeButton ? 1 : 0,
            transform: `scale(${showThemeButton ? 1 : 0.6})`,
            pointerEvents: showThemeButton ? 'auto' : 'none',
            transition: 'opacity 0.15s ease, transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)',
            zIndex: 20,
          }}
          onMouseEnter={openThemePop}
          onMouseLeave={closeThemePopDelayed}
        >
          <button
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            title="切换主题"
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              border: '1px solid rgba(0,0,0,0.12)',
              backgroundColor: '#f1f1f1d3',
              color: '#111111',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>
            </svg>
          </button>
          {themePopOpen && (
            <div
              data-theme-panel
              ref={themePanelRef}
              style={{
                position: 'absolute',
                top: '0',
                left: 'calc(100% + 8px)',
                backgroundColor: '#f1f1f1d3',
                border: '1px solid rgba(0,0,0,0.12)',
                borderRadius: '8px',
                padding: '3px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0',
                zIndex: 30,
                animation: 'popFadeIn 0.15s ease',
                minWidth: '72px',
              }}
              onMouseEnter={openThemePop}
              onMouseLeave={closeThemePopDelayed}
            >
              {/* 滑块指示器 */}
              <div style={{
                position: 'absolute',
                left: '3px',
                right: '3px',
                top: sliderStyle.top,
                height: sliderStyle.height,
                backgroundColor: '#ffffffff',
                borderRadius: '6px',
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
                transition: 'top 0.35s cubic-bezier(0.4, 0, 0.2, 1), height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease',
                opacity: sliderStyle.opacity,
                pointerEvents: 'none',
              }} />
              {THEMES.map(t => {
                const active = t.key === currentTheme;
                return (
                  <button
                    key={t.key}
                    ref={el => { themeItemRefs.current[t.key] = el; }}
                    onClick={(e) => { e.stopPropagation(); switchTheme(t.key); }}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      padding: '4px 10px',
                      border: 'none',
                      borderRadius: '6px',
                      backgroundColor: 'transparent',
                      color: active ? '#111111' : '#6b7280',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: active ? 520 : 500,
                      textAlign: 'left',
                      transition: 'color 0.2s ease, background-color 0.15s ease',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)';
                      e.currentTarget.style.color = '#111111';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = active ? '#111111' : '#6b7280';
                    }}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {showTooltip && (
          <div style={{
            position: 'absolute', bottom: '105%', left: '50%', transform: 'translateX(-50%)',
            backgroundColor: 'rgba(20,20,28,0.88)', color: '#ddd', fontSize: '11px', padding: '3px 8px',
            borderRadius: '6px', whiteSpace: 'nowrap', pointerEvents: 'none',
            border: '1px solid rgba(255,255,255,0.1)', animation: 'tooltipFadeIn 0.15s ease',
          }}>{name}</div>
        )}

        {hasUnread && !showPopover && !isThinking && (
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

        {!isPopoverOpen && isThinking && chatHistory.length > 0 && (() => {
          let lastUserIndex = -1;
          for (let i = chatHistory.length - 1; i >= 0; i--) {
            if (chatHistory[i].type === 'user') { lastUserIndex = i; break; }
          }
          const turnMessages = chatHistory.slice(lastUserIndex + 1);
          let text = '';
          const lastOutput = [...turnMessages].reverse().find(m => m.type === 'output');
          if (lastOutput) {
            if (lastOutput.text && lastOutput.text.trim()) {
              const fullText = lastOutput.text.trim();
              const lastText = lastBubbleOutputRef.current;
              if (fullText !== lastText) {
                let newBubbleText = '';
                let shouldUpdate = false;
                if (fullText.startsWith(lastText) && lastText.length > 0) {
                  const delta = fullText.slice(lastText.length).trim();
                  if (delta.length >= 24) {
                    const deltaLines = delta.split('\n').filter(l => l.trim());
                    newBubbleText = deltaLines.slice(-2).join('\n');
                    shouldUpdate = true;
                  }
                } else {
                  const lines = fullText.split('\n').filter(l => l.trim());
                  newBubbleText = lines.slice(0, 2).join('\n');
                  shouldUpdate = true;
                }
                if (shouldUpdate && newBubbleText !== lastBubbleOutputTextRef.current) {
                  lastBubbleOutputRef.current = fullText;
                  lastBubbleOutputTextRef.current = newBubbleText;
                }
                text = lastBubbleOutputTextRef.current;
              } else {
                text = lastBubbleOutputTextRef.current;
              }
            }
            if (!text && lastOutput.lastReasoningItem && lastOutput.lastReasoningItem.trim()) {
              text = lastOutput.lastReasoningItem.trim();
            }
            if (!text && lastOutput.reasoning && lastOutput.reasoning.trim()) {
              const fullReasoning = lastOutput.reasoning.trim();
              const lastReasoning = lastBubbleReasoningRef.current;
              if (fullReasoning !== lastReasoning) {
                let newBubbleText = '';
                let shouldUpdate = false;
                if (fullReasoning.startsWith(lastReasoning) && lastReasoning.length > 0) {
                  const delta = fullReasoning.slice(lastReasoning.length).trim();
                  if (delta.length >= 24) {
                    const deltaLines = delta.split('\n').filter(l => l.trim());
                    newBubbleText = deltaLines.slice(-2).join('\n');
                    shouldUpdate = true;
                  }
                } else {
                  const lines = fullReasoning.split('\n').filter(l => l.trim());
                  newBubbleText = lines.slice(-2).join('\n');
                  shouldUpdate = true;
                }
                if (shouldUpdate && newBubbleText !== lastBubbleTextRef.current) {
                  lastBubbleReasoningRef.current = fullReasoning;
                  lastBubbleTextRef.current = newBubbleText;
                }
                text = lastBubbleTextRef.current;
              } else {
                text = lastBubbleTextRef.current;
              }
            }
            if (!text && lastOutput.toolCalls && lastOutput.toolCalls.length > 0) {
              const lastToolCall = lastOutput.toolCalls[lastOutput.toolCalls.length - 1];
              if (lastToolCall.output) {
                text = lastToolCall.output.trim();
              }
            }
          }
          if (!text) text = 'Thinking...';
          return <ThinkingBubble text={text} />;
        })()}

        {isPopoverOpen && createPortal(
          <TerminalPopover
            ref={popoverDomRef}
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
              setPendingImages([]);
              unregisterPopoverOver(name);
            }}
            onPopoverMouseEnter={() => { registerPopoverOver(name); }}
            onPopoverMouseLeave={() => {
              unregisterPopoverOver(name);
            }}
            inputText={inputText}
            onInputTextChange={setInputText}
            pendingImages={pendingImages}
            onPendingImagesChange={setPendingImages}
            deepThinking={deepThinking}
            onToggleDeepThinking={() => setDeepThinking(!deepThinking)}
            onStop={handleStop}
            heightExpanded={heightExpanded}
            onToggleHeightExpanded={() => setHeightExpanded(v => !v)}
            prompts={prompts}
            selectedPrompt={selectedPrompt}
            onSelectPrompt={handleSelectPrompt}
            currentModel={currentModel}
            onSelectModel={handleSelectModel}
          />,
          document.body
        )}
      </div>
    </>
  );
};

export default WalkerCharacter;
