import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CHAR_CONFIGS, DEFAULT_SCALE } from '../config';

const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 256;

const SPRITES = Object.entries(CHAR_CONFIGS).map(([name, cfg]) => ({
  name,
  url: name === '绿油油' ? './assets/bruce.png' : './assets/jazz.png',
  frameCount: cfg.endMax + 1,
  cols: cfg.cols,
  rows: Math.ceil((cfg.endMax + 1) / cfg.cols),
}));

/* ──────────────────────────────────────────────
   Canvas-based sprite animation (simple cycle)
   ────────────────────────────────────────────── */
function CanvasSprite({
  spriteUrl,
  scale: animScale,
  cycleSpeed,
  isPlaying,
  frameCount,
  cols = 10,
  pixelate = true,
}: {
  spriteUrl: string;
  scale: number;
  cycleSpeed: number;
  isPlaying: boolean;
  frameCount: number;
  cols?: number;
  pixelate?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef(0);
  const lastRef = useRef(0);
  const speedRef = useRef(cycleSpeed);
  const playingRef = useRef(isPlaying);
  const pixelateRef = useRef(pixelate);

  useEffect(() => { speedRef.current = cycleSpeed; }, [cycleSpeed]);
  useEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { pixelateRef.current = pixelate; }, [pixelate]);
  useEffect(() => { frameRef.current = 0; lastRef.current = 0; }, [spriteUrl]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => { imgRef.current = img; };
    img.src = spriteUrl;
  }, [spriteUrl]);

  useEffect(() => {
    let raf: number;
    const loop = (time: number) => {
      if (!imgRef.current || !canvasRef.current) { raf = requestAnimationFrame(loop); return; }
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(loop); return; }

      if (playingRef.current && lastRef.current !== 0) {
        const elapsed = time - lastRef.current;
        const msPerFrame = (speedRef.current * 1000) / frameCount;
        if (elapsed >= msPerFrame) {
          frameRef.current = (frameRef.current + 1) % frameCount;
          lastRef.current = time - (elapsed % msPerFrame);
        }
        const w = Math.round(FRAME_WIDTH * animScale);
        const h = Math.round(FRAME_HEIGHT * animScale);
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = pixelateRef.current;
        const col = frameRef.current % cols;
        const row = Math.floor(frameRef.current / cols);
        ctx.drawImage(imgRef.current, col * FRAME_WIDTH, row * FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT, 0, 0, w, h);
      }
      if (playingRef.current && lastRef.current === 0) lastRef.current = time;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animScale, frameCount]);

  const w = Math.round(FRAME_WIDTH * animScale);
  const h = Math.round(FRAME_HEIGHT * animScale);
  return <canvas ref={canvasRef} width={w} height={h} style={{ width: w, height: h, imageRendering: pixelate ? 'pixelated' : 'auto' }} />;
}

/* ── Spritesheet with frame grid ── */
function SpritesheetPreview({ name, url, frameCount, rows = 1 }: { name: string; url: string; frameCount: number; rows?: number }) {
  const [natW, setNatW] = useState(0);
  const [natH, setNatH] = useState(0);
  useEffect(() => {
    const img = new Image();
    img.onload = () => { setNatW(img.naturalWidth); setNatH(img.naturalHeight); };
    img.src = url;
  }, [url]);
  return (
    <div className="dbg-sheet-card">
      <h3>{name}</h3>
      <div className="dbg-sheet-wrap">
        <img src={url} alt={name} className="dbg-sheet-img" style={{ imageRendering: 'pixelated' }} />
      </div>
      <span className="dbg-sheet-meta">
        {natW}x{natH}px · {frameCount} frames · {FRAME_WIDTH}x{FRAME_HEIGHT} per frame
        {rows > 1 && ` · ${rows} rows`}
      </span>
    </div>
  );
}

/* ── Cut frame strip ── */
function FrameStrip({ name, url, frameCount, rows = 1, cols = 10, scale }: { name: string; url: string; frameCount: number; rows?: number; cols?: number; scale: number }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { const img = new Image(); img.onload = () => setLoaded(true); img.src = url; }, [url]);
  if (!loaded) return <div className="dbg-strip-group"><h3>{name}</h3><span>Loading...</span></div>;
  return (
    <div className="dbg-strip-group">
      <h3>{name}</h3>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="dbg-strip-row">
          {Array.from({ length: cols }).map((_, col) => {
            const fi = row * cols + col;
            if (fi >= frameCount) return null;
            return (
              <div
                key={fi}
                className="dbg-strip-cell"
                style={{
                  width: Math.round(FRAME_WIDTH * scale),
                  height: Math.round(FRAME_HEIGHT * scale),
                  backgroundImage: `url(${url})`,
                  backgroundSize: `${cols * FRAME_WIDTH * scale}px ${ FRAME_HEIGHT * scale}px`,
                  backgroundPosition: `-${col * FRAME_WIDTH * scale}px ${-row * FRAME_HEIGHT * scale}px`,
                  imageRendering: 'pixelated',
                }}
              />
            );
          })}
          <span className="dbg-strip-label">
            Row {row + 1}: col 0–{cols - 1}
          </span>
        </div>
      ))}
      <span className="dbg-strip-label">
        {rows} rows × {cols} cols = {frameCount} frames · at {scale}x
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Main debugger
   ────────────────────────────────────────────── */
interface CharConfig {
  cycleSpeed: number;
  walking: boolean;
  scale: number;
  frameCount: number;
  rows: number;
  cols: number;
  pixelate: boolean;
  walkProb: number;
}

export default function ArtDebugger() {
  const [chars, setChars] = useState<CharConfig[]>(
    SPRITES.map(s => ({
      cycleSpeed: 0.8, walking: true, scale: DEFAULT_SCALE,
      frameCount: s.frameCount, rows: s.rows, cols: s.cols || 10,
      pixelate: true, walkProb: 0.85,
    }))
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(900);
  const positionsRef = useRef([0.1, 0.4]);
  const directionsRef = useRef<('left' | 'right')[]>(['right', 'right']);
  const [, setPxDisplay] = useState<[number, number]>([0.1, 0.4]);

  useEffect(() => {
    const onResize = () => stageRef.current && setStageWidth(stageRef.current.clientWidth);
    onResize(); window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let last = 0; let raf: number;
    const tick = (now: number) => {
      if (!last) last = now;
      const dt = now - last; last = now;
      for (let i = 0; i < 2; i++) {
        if (!chars[i].walking) continue;
        const dir = directionsRef.current[i] === 'right' ? 1 : -1;
        const pps = (1 / 2000) * dir; // rough bounce speed
        positionsRef.current[i] += pps * dt;
        if (positionsRef.current[i] >= 1) { positionsRef.current[i] = 1; directionsRef.current[i] = 'left'; }
        if (positionsRef.current[i] <= 0) { positionsRef.current[i] = 0; directionsRef.current[i] = 'right'; }
      }
      setPxDisplay([positionsRef.current[0], positionsRef.current[1]]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chars, stageWidth]);

  const update = useCallback((i: number, patch: Partial<CharConfig>) => {
    setChars(prev => {
      const n = [...prev];
      n[i] = { ...n[i], ...patch };
      // cycleSpeed & scale sync to other char
      if ('cycleSpeed' in patch) { const o = i === 0 ? 1 : 0; n[o] = { ...n[o], cycleSpeed: patch.cycleSpeed! }; }
      if ('scale' in patch) { const o = i === 0 ? 1 : 0; n[o] = { ...n[o], scale: patch.scale! }; }
      return n;
    });
  }, []);

  const [, setApplied] = useState(false);
  const applyToCode = useCallback(async () => {
    try {
      const resp = await fetch('/__patch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: 'src/components/WalkerCharacter.tsx',
          chars: chars.map((c, i) => ({ name: SPRITES[i].name, scale: c.scale, walkProb: c.walkProb })),
        }),
      });
      if (resp.ok) { setApplied(true); setTimeout(() => setApplied(false), 2000); }
    } catch { /* noop */ }
  }, [chars]);

  return (
    <div className="dbg">
      <header className="dbg-header"><h1>Art Resource Visual Debugger</h1></header>

      {/* ── A: Raw spritesheets ── */}
      <section className="dbg-section">
        <h2>Original Spritesheets</h2>
        <div className="dbg-sheets">
          {SPRITES.map((s, i) => <SpritesheetPreview key={s.url} name={s.name} url={s.url} frameCount={chars[i].frameCount} rows={chars[i].rows} />)}
        </div>
      </section>

      {/* ── B: Cut frame strips ── */}
      <section className="dbg-section">
        <h2>Cut Frames</h2>
        <div className="dbg-sheets">
          {SPRITES.map((s, i) => (
            <FrameStrip key={s.url} name={s.name} url={s.url} frameCount={chars[i].frameCount} rows={chars[i].rows} cols={chars[i].cols} scale={DEFAULT_SCALE} />
          ))}
        </div>
      </section>

      {/* ── C: Walk Stage ── */}
      <section className="dbg-section">
        <h2>Walk Preview — Left ↔ Right Bounce</h2>
        <div className="dbg-stage" ref={stageRef}>
          {SPRITES.map((s, i) => {
            const w = Math.round(FRAME_WIDTH * chars[i].scale);
            const h = Math.round(FRAME_HEIGHT * chars[i].scale);
            return (
              <div key={s.url} className="dbg-walker" style={{
                left: positionsRef.current[i] * (stageWidth - w),
                bottom: 0,
                width: w, height: h,
                transform: directionsRef.current[i] === 'left' ? 'scaleX(-1)' : 'none',
              }}>
                <CanvasSprite
                  spriteUrl={s.url} scale={chars[i].scale} cycleSpeed={chars[i].cycleSpeed}
                  isPlaying={chars[i].walking} frameCount={chars[i].frameCount}
                  cols={chars[i].cols} pixelate={chars[i].pixelate}
                />
              </div>
            );
          })}
          <div className="dbg-ground" />
        </div>
      </section>

      {/* ── D: Per-character controls ── */}
      <section className="dbg-section">
        <h2>Character Controls</h2>
        <div className="dbg-char-grid">
          {SPRITES.map((s, i) => (
            <div key={i} className={`dbg-char-ctrl ${i === 0 ? 'ctrl-bruce' : 'ctrl-jazz'}`}>
              <div className="dbg-char-header">
                <h2>{s.name}</h2>
                <button className={chars[i].walking ? 'dbg-walk-btn walk' : 'dbg-walk-btn stop'}
                  onClick={() => update(i, { walking: !chars[i].walking })}>
                  {chars[i].walking ? 'Stop Walk' : 'Start Walk'}
                </button>
              </div>
              <label className="dbg-slider-group">
                <span>Frame Count: <b>{chars[i].frameCount}</b></span>
                <input type="range" min={2} max={100} step={1} value={chars[i].frameCount}
                  onChange={e => {
                    const v = +e.target.value;
                    const c = v > 32 ? 10 : 1;
                    const r = v > c ? Math.ceil(v / c) : 1;
                    update(i, { frameCount: v, cols: c, rows: r });
                  }} />
                <small>总帧数（{'>'}32 自动多行布局）</small>
              </label>
              <label className="dbg-slider-group">
                <span>Pixelate: <b>{chars[i].pixelate ? 'ON' : 'OFF'}</b></span>
                <button className="dbg-pixelate-btn" onClick={() => update(i, { pixelate: !chars[i].pixelate })} style={{ marginTop: 4 }}>
                  {chars[i].pixelate ? '关闭平滑' : '开启平滑'}
                </button>
                <small>关闭后图像会被模糊处理，便于对比</small>
              </label>
              <label className="dbg-slider-group">
                <span>Frame Cycle: <b>{chars[i].cycleSpeed.toFixed(1)}s</b></span>
                <input type="range" min={0.2} max={2.0} step={0.1} value={chars[i].cycleSpeed}
                  onChange={e => update(i, { cycleSpeed: +e.target.value })} />
                <small>动画周期（{chars[i].frameCount} 帧循环用时）</small>
              </label>
              <label className="dbg-slider-group">
                <span>Walk Probability: <b>{(chars[i].walkProb * 100).toFixed(0)}%</b></span>
                <input type="range" min={0.1} max={0.95} step={0.05} value={chars[i].walkProb}
                  onChange={e => update(i, { walkProb: +e.target.value })} />
                <small>角色处于 idle 状态时走路概率</small>
              </label>
              <label className="dbg-slider-group">
                <span>Scale: <b>{chars[i].scale.toFixed(2)}x</b> ({Math.round(FRAME_WIDTH * chars[i].scale)}x{Math.round(FRAME_HEIGHT * chars[i].scale)}px)</span>
                <input type="range" min={0.2} max={2.0} step={0.05} value={chars[i].scale}
                  onChange={e => update(i, { scale: +e.target.value })} />
              </label>
              <div className="dbg-char-info">
                {chars[i].walking ? 'Walking' : 'Stopped'}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── E: Apply ── */}
      <section className="dbg-section">
        <h2>Apply to Code</h2>
        <p className="dbg-apply-desc">将参数写入 <code>src/components/WalkerCharacter.tsx</code></p>
        <button className="dbg-btn-submit" onClick={applyToCode}>Apply to WalkerCharacter.tsx</button>
      </section>
    </div>
  );
}
