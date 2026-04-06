import React, { useEffect, useRef, useCallback } from 'react';

interface SpriteAnimatorProps {
  spriteUrl: string;
  frameWidth: number;
  frameHeight: number;
  totalFrames: number;
  scale: number;
  speed: number;
  isPlaying: boolean;
  flipped: boolean;
  pixelated: boolean;
}

export default function SpriteAnimator({
  spriteUrl,
  frameWidth,
  frameHeight,
  totalFrames,
  scale,
  speed,
  isPlaying,
  flipped,
  pixelated,
}: SpriteAnimatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const lastTimeRef = useRef(0);
  const rafRef = useRef(0);

  const animate = useCallback(
    (time: number) => {
      if (!containerRef.current) return;

      if (lastTimeRef.current === 0) lastTimeRef.current = time;
      const elapsed = time - lastTimeRef.current;
      const frameDuration = (speed * 1000) / totalFrames;

      if (elapsed >= frameDuration) {
        frameRef.current = (frameRef.current + 1) % totalFrames;
        lastTimeRef.current = time;

        const w = frameWidth * scale;
        containerRef.current.style.backgroundPosition = `-${frameRef.current * w}px 0`;
      }

      rafRef.current = requestAnimationFrame(animate);
    },
    [frameWidth, scale, totalFrames, speed],
  );

  useEffect(() => {
    if (isPlaying) {
      frameRef.current = 0;
      lastTimeRef.current = 0;
      rafRef.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(rafRef.current);
      if (containerRef.current) {
        containerRef.current.style.backgroundPosition = '0 0';
      }
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, animate]);

  useEffect(() => {
    if (!isPlaying && containerRef.current) {
      containerRef.current.style.backgroundPosition = '0 0';
    }
  }, [isPlaying, scale, frameWidth]);

  return (
    <div
      ref={containerRef}
      style={{
        width: Math.round(frameWidth * scale),
        height: Math.round(frameHeight * scale),
        backgroundImage: `url(${spriteUrl})`,
        backgroundSize: `${frameWidth * totalFrames * scale}px ${frameHeight * scale}px`,
        backgroundPosition: '0 0',
        imageRendering: pixelated ? 'pixelated' : 'auto',
        transform: `scaleX(${flipped ? -1 : 1})`,
      }}
    />
  );
}
