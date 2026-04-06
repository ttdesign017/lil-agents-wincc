/* ═══════════════════════════════════════════════════
 * Shared configuration for character sprites and walk engine.
 * All motion/sprite parameters live here.
 *
 * Walk cycle: START → LOOP (N times) → END
 * ═══════════════════════════════════════════════════ */

export type Phase = 'idle' | 'start' | 'loop' | 'end';

/* ── Global engine constants ── */
export const BASE_STEP = 0.8;            // pixels/frame at full speed
export const FRAME_DURATION_MS = 50;   // sprite frame advances every 50ms

/* ── Movement boundaries (0–1 fraction of dock width) ── */
export const PROGRESS_MIN = 0.005;
export const PROGRESS_MAX = 0.995;
export const SAFE_BOUNDARY_MIN = 0.01;
export const SAFE_BOUNDARY_MAX = 0.99;
export const IDLE_BOUNDARY_MIN = 0.02;
export const IDLE_BOUNDARY_MAX = 0.98;

/* ── Walk target proximity ── */
export const TARGET_PROXIMITY = 0.002;

/* ── Walk target planning ── */
export const WALK_DIST_MIN_FRAC = 0.1;   // 10% of screen
export const WALK_DIST_MAX_FRAC = 0.2;   // 30% of screen
export const WALK_DIST_THRESHOLD = 0.01; // minimum displacement to attempt walk
export const LOOP_FRAMES_MIN = 3;        // min loop cycles
export const LOOP_FRAMES_MAX = 12;       // max loop cycles

/* ── Idle behavior delays ── */
export const PAUSED_CHECK_INTERVAL = 500;
export const EDGE_FLIP_DELAY_MIN = 4000;
export const EDGE_FLIP_DELAY_MAX = 8000;
export const IDLE_WAIT_MIN = 8000;
export const IDLE_WAIT_MAX = 40000;

/* ── Tooltip display ── */
export const TOOLTIP_DISPLAY_MS = 800;

/* ── Popover positioning ── */
export const POPOVER_OFFSET_Y = 340;   // pixels above character top
export const POPOVER_TOP_CLAMP = 20;     // minimum Y from screen top
export const POPOVER_TRACK_INTERVAL = 50; // ms for position tracking

/* ── Per-character sprite + walk configs ── */
export interface CharSpriteConfig {
  frameWidth: number;   // single frame pixel width
  frameHeight: number;  // single frame pixel height
  scale: number;
  cols: number;         // columns in the sprite sheet
  startMin: number;     // Walk phase frame ranges (inclusive)
  startMax: number;
  loopMin: number;
  loopMax: number;
  endMin: number;
  endMax: number;
  walkProb: number;     // 0–1 likelihood of walking vs idle
  yOffset: number;      // Y-axis offset (px positive = down)
}

export const DEFAULT_SCALE = 0.6;

export const CHAR_CONFIGS: Record<string, CharSpriteConfig> = {
  '绿油油': {
    frameWidth: 192,
    frameHeight: 256,
    scale: 0.6,
    cols: 10,
    startMin: 0,  startMax: 22,
    loopMin: 23,  loopMax: 51,
    endMin: 52,   endMax: 82,
    walkProb: 0.75,
    yOffset: 2,
  },
  '刘小红': {
    frameWidth: 192,
    frameHeight: 256,
    scale: 0.6,
    cols: 10,
    startMin: 0,  startMax: 17,
    loopMin: 18,  loopMax: 43,
    endMin: 44,   endMax: 80,
    walkProb: 0.40,
    yOffset: 5,
  },
};
