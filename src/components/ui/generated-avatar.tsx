"use client";

import { useId } from "react";
import { getAvatarParams, type AvatarParams } from "@/lib/avatar-patterns";

interface GeneratedAvatarProps {
  seed: string;
  size: number;
  className?: string;
}

function gradientCoords(dir: AvatarParams["gradientDir"]) {
  switch (dir) {
    case "tl": return { x1: "0%", y1: "0%", x2: "100%", y2: "100%" };
    case "tr": return { x1: "100%", y1: "0%", x2: "0%", y2: "100%" };
    case "bl": return { x1: "0%", y1: "100%", x2: "100%", y2: "0%" };
    case "br": return { x1: "100%", y1: "100%", x2: "0%", y2: "0%" };
  }
}

function densityValue(d: AvatarParams["density"]): number {
  switch (d) {
    case "sparse": return 0;
    case "medium": return 1;
    case "dense": return 2;
  }
}

// Pattern 0: Halftone dots — grid of circles with size gradient
function Halftone({ params, uid }: { params: AvatarParams; uid: string }) {
  const d = densityValue(params.density);
  const cols = 6 + d * 2; // 6, 8, 10
  const step = 100 / cols;
  const gc = gradientCoords(params.gradientDir);
  const originX = gc.x1 === "0%" ? 0 : 100;
  const originY = gc.y1 === "0%" ? 0 : 100;

  const dots: { cx: number; cy: number; r: number }[] = [];
  for (let row = 0; row < cols; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = step / 2 + col * step;
      const cy = step / 2 + row * step;
      const dist = Math.sqrt((cx - originX) ** 2 + (cy - originY) ** 2) / 141.4;
      const r = (step / 2) * (1 - dist * 0.8) * 0.85;
      if (r > 0.5) dots.push({ cx, cy, r });
    }
  }

  return (
    <>
      <defs>
        <linearGradient id={`g-${uid}`} {...gradientCoords(params.gradientDir)}>
          <stop offset="0%" stopColor={params.colorPair.from} />
          <stop offset="100%" stopColor={params.colorPair.to} />
        </linearGradient>
      </defs>
      <g transform={`rotate(${params.rotation} 50 50)`}>
        {dots.map((dot, i) => (
          <circle key={i} cx={dot.cx} cy={dot.cy} r={dot.r} fill={`url(#g-${uid})`} />
        ))}
      </g>
    </>
  );
}

// Pattern 1: Concentric rings
function ConcentricRings({ params, uid }: { params: AvatarParams; uid: string }) {
  const d = densityValue(params.density);
  const count = 3 + d * 2; // 3, 5, 7
  const maxR = 48;

  return (
    <>
      <defs>
        <linearGradient id={`g-${uid}`} {...gradientCoords(params.gradientDir)}>
          <stop offset="0%" stopColor={params.colorPair.from} />
          <stop offset="100%" stopColor={params.colorPair.to} />
        </linearGradient>
      </defs>
      {Array.from({ length: count }, (_, i) => {
        const r = maxR - (i * maxR) / count;
        const opacity = i % 2 === 0 ? 0.9 : 0.4;
        return (
          <circle
            key={i}
            cx={50}
            cy={50}
            r={r}
            fill="none"
            stroke={`url(#g-${uid})`}
            strokeWidth={maxR / count - 1}
            opacity={opacity}
          />
        );
      })}
    </>
  );
}

// Pattern 2: Diagonal stripes
function DiagonalStripes({ params, uid }: { params: AvatarParams; uid: string }) {
  const d = densityValue(params.density);
  const count = 5 + d * 3; // 5, 8, 11
  const angle = params.rotation % 180 || 30;

  return (
    <>
      <defs>
        <linearGradient id={`g-${uid}`} {...gradientCoords(params.gradientDir)}>
          <stop offset="0%" stopColor={params.colorPair.from} />
          <stop offset="100%" stopColor={params.colorPair.to} />
        </linearGradient>
      </defs>
      <g transform={`rotate(${angle} 50 50)`}>
        {Array.from({ length: count }, (_, i) => {
          const y = -20 + (i * 140) / count;
          const width = (140 / count) * 0.55;
          const opacity = 0.4 + (i / count) * 0.6;
          return (
            <rect
              key={i}
              x={-20}
              y={y}
              width={140}
              height={width}
              fill={`url(#g-${uid})`}
              opacity={opacity}
            />
          );
        })}
      </g>
    </>
  );
}

// Pattern 3: Radial burst — wedge segments
function RadialBurst({ params, uid }: { params: AvatarParams; uid: string }) {
  const d = densityValue(params.density);
  const segments = 6 + d * 3; // 6, 9, 12
  const angleStep = 360 / segments;

  const wedges = Array.from({ length: segments }, (_, i) => {
    const startAngle = (i * angleStep + params.rotation) * (Math.PI / 180);
    const endAngle = ((i + 1) * angleStep + params.rotation) * (Math.PI / 180);
    const r = 50;
    const x1 = 50 + r * Math.cos(startAngle);
    const y1 = 50 + r * Math.sin(startAngle);
    const x2 = 50 + r * Math.cos(endAngle);
    const y2 = 50 + r * Math.sin(endAngle);
    return { d: `M50,50 L${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2} Z`, opacity: i % 2 === 0 ? 0.9 : 0.35 };
  });

  return (
    <>
      <defs>
        <linearGradient id={`g-${uid}`} {...gradientCoords(params.gradientDir)}>
          <stop offset="0%" stopColor={params.colorPair.from} />
          <stop offset="100%" stopColor={params.colorPair.to} />
        </linearGradient>
      </defs>
      {wedges.map((w, i) => (
        <path key={i} d={w.d} fill={`url(#g-${uid})`} opacity={w.opacity} />
      ))}
    </>
  );
}

// Pattern 4: Geometric grid — diamond tessellation
function GeometricGrid({ params, uid }: { params: AvatarParams; uid: string }) {
  const d = densityValue(params.density);
  const cols = 3 + d; // 3, 4, 5
  const step = 100 / cols;
  const h = hashString_local(uid);

  const shapes: { points: string; opacity: number }[] = [];
  for (let row = 0; row < cols; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * step;
      const y = row * step;
      const mid = step / 2;
      const show = ((h + row * 7 + col * 13) % 3) !== 0;
      if (!show) continue;
      const opacity = 0.3 + ((row + col) % 3) * 0.3;
      shapes.push({
        points: `${x + mid},${y} ${x + step},${y + mid} ${x + mid},${y + step} ${x},${y + mid}`,
        opacity,
      });
    }
  }

  return (
    <>
      <defs>
        <linearGradient id={`g-${uid}`} {...gradientCoords(params.gradientDir)}>
          <stop offset="0%" stopColor={params.colorPair.from} />
          <stop offset="100%" stopColor={params.colorPair.to} />
        </linearGradient>
      </defs>
      <g transform={`rotate(${params.rotation % 90} 50 50)`}>
        {shapes.map((s, i) => (
          <polygon key={i} points={s.points} fill={`url(#g-${uid})`} opacity={s.opacity} />
        ))}
      </g>
    </>
  );
}

// Simple local hash for pattern variation
function hashString_local(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Pattern 5: Wave lines
function WaveLines({ params, uid }: { params: AvatarParams; uid: string }) {
  const d = densityValue(params.density);
  const count = 4 + d * 2; // 4, 6, 8
  const amp = 8 + d * 4;

  const paths = Array.from({ length: count }, (_, i) => {
    const y = (100 / (count + 1)) * (i + 1);
    const freq = 2 + (i % 3);
    const points: string[] = [];
    for (let x = 0; x <= 100; x += 2) {
      const py = y + Math.sin((x / 100) * Math.PI * freq + i) * amp;
      points.push(`${x === 0 ? "M" : "L"}${x},${py.toFixed(1)}`);
    }
    return { d: points.join(" "), opacity: 0.4 + (i / count) * 0.6 };
  });

  return (
    <>
      <defs>
        <linearGradient id={`g-${uid}`} {...gradientCoords(params.gradientDir)}>
          <stop offset="0%" stopColor={params.colorPair.from} />
          <stop offset="100%" stopColor={params.colorPair.to} />
        </linearGradient>
      </defs>
      <g transform={`rotate(${params.rotation % 180} 50 50)`}>
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke={`url(#g-${uid})`}
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={p.opacity}
          />
        ))}
      </g>
    </>
  );
}

const PATTERN_RENDERERS = [Halftone, ConcentricRings, DiagonalStripes, RadialBurst, GeometricGrid, WaveLines];

export function GeneratedAvatar({ seed, size, className }: GeneratedAvatarProps) {
  const uid = useId();
  const params = getAvatarParams(seed);
  const PatternComponent = PATTERN_RENDERERS[params.patternType];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="User avatar"
      className={className}
    >
      <defs>
        <clipPath id={`clip-${uid}`}>
          <circle cx={50} cy={50} r={50} />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${uid})`}>
        <rect width={100} height={100} fill="var(--surface, #111113)" />
        <PatternComponent params={params} uid={uid} />
      </g>
    </svg>
  );
}
