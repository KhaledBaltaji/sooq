"use client";

import { useEffect, useRef, useCallback } from "react";
import { useThemeColors } from "@/hooks/use-theme-colors";

interface ConfettiProps {
  trigger: boolean;
  onComplete?: () => void;
  duration?: number;
  particleCount?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
}

export function Confetti({
  trigger,
  onComplete,
  duration = 600,
  particleCount = 30,
}: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = useThemeColors();
  const COLORS = [colors.yes, colors.no, colors.success, colors.text, colors.yes, colors.no];
  const animationRef = useRef<number>(0);

  const createParticles = useCallback((): Particle[] => {
    return Array.from({ length: particleCount }, () => ({
      x: 0.5, // normalized center
      y: 0.5,
      vx: (Math.random() - 0.5) * 0.04,
      vy: -(Math.random() * 0.03 + 0.01),
      size: Math.random() * 6 + 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 10,
      opacity: 1,
    }));
  }, [particleCount]);

  // Stabilize onComplete to prevent infinite re-renders from inline callbacks
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!trigger) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Match canvas to viewport
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = createParticles();
    const startTime = performance.now();
    const gravity = 0.001;

    const render = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p) => {
        // Physics
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.opacity = 1 - progress;

        // Draw
        const px = p.x * canvas.width;
        const py = p.y * canvas.height;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onCompleteRef.current?.();
      }
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [trigger, duration, createParticles]);

  if (!trigger) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-[999] pointer-events-none"
      aria-hidden="true"
    />
  );
}
