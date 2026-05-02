// Deterministic avatar pattern generation from a seed string (user ID)

export interface AvatarParams {
  patternType: number; // 0-5
  rotation: number; // degrees
  gradientDir: "tl" | "tr" | "bl" | "br";
  density: "sparse" | "medium" | "dense";
  colorPair: { from: string; to: string };
}

export const GRADIENT_PAIRS = [
  { from: "#2D8CFF", to: "#1A5BB5" }, // blue mono
  { from: "#FF4757", to: "#CC2233" }, // red mono
  { from: "#2D8CFF", to: "#FF4757" }, // blue-to-red
  { from: "#00E87B", to: "#2D8CFF" }, // green-to-blue
  { from: "#FFB800", to: "#FF4757" }, // yellow-to-red
  { from: "#A855F7", to: "#2D8CFF" }, // purple-to-blue
  { from: "#FF4757", to: "#FFB800" }, // red-to-yellow
  { from: "#00E87B", to: "#FFB800" }, // green-to-yellow
  { from: "#A855F7", to: "#FF4757" }, // purple-to-red
  { from: "#2D8CFF", to: "#00E87B" }, // blue-to-green
];

const ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315];
const GRADIENT_DIRS: AvatarParams["gradientDir"][] = ["tl", "tr", "bl", "br"];
const DENSITIES: AvatarParams["density"][] = ["sparse", "medium", "dense"];

export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

export function getAvatarParams(seed: string): AvatarParams {
  const h = hashString(seed);
  return {
    patternType: h % 6,
    rotation: ROTATIONS[(h >> 3) % ROTATIONS.length],
    gradientDir: GRADIENT_DIRS[(h >> 6) % GRADIENT_DIRS.length],
    density: DENSITIES[(h >> 8) % DENSITIES.length],
    colorPair: GRADIENT_PAIRS[(h >> 10) % GRADIENT_PAIRS.length],
  };
}
