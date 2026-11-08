// The wind (iteration 23): on some tables, a wind blows and bends the shells in flight.
// It is a pure function of the simulation tick, so the server, the client and the AI all feel the same gust at the same time.
import { TICK_RATE } from './constants';

/** Pull of the wind on a shell at the height of a gust (tiles/s², sideways only: a shell keeps its speed). */
export const WIND_ACC = 2.3;
/** Seconds of one gust cycle (from a lull to a gust and back), and of the slow swing of the wind's direction. */
export const GUST_PERIOD = 6.5;
export const SWING_PERIOD = 13;
/** How far the wind swings either side of its main direction (radians). */
export const WIND_SWING = 0.42;

/** Strength of the wind at that tick, from 0.1 (a lull) to 1 (a gust). */
export function gustAt(tick: number): number {
  const s = tick / TICK_RATE;
  return 0.55 + 0.45 * Math.sin((s * Math.PI * 2) / GUST_PERIOD + 1);
}

/** Where the wind blows at that tick (radians, grid axes: 0 toward +x, π/2 toward +y). */
export function windAngle(base: number, tick: number): number {
  const s = tick / TICK_RATE;
  return base + WIND_SWING * Math.sin((s * Math.PI * 2) / SWING_PERIOD);
}

/** The pull of the wind at that tick: [ax, ay] in tiles/s². */
export function windAt(base: number, tick: number): [number, number] {
  const a = windAngle(base, tick), k = WIND_ACC * gustAt(tick);
  return [Math.cos(a) * k, Math.sin(a) * k];
}

/**
 * Bend one shell's speed (vx, vy) with the wind (ax, ay) over dt seconds: only the sideways part of the pull counts,
 * so the shell turns toward where the wind blows but never speeds up nor slows down.
 */
export function bend(vx: number, vy: number, ax: number, ay: number, dt: number): [number, number] {
  const s = Math.hypot(vx, vy);
  if (s < 1e-6) return [vx, vy];
  const nx = vx + ax * dt, ny = vy + ay * dt;
  const n = Math.hypot(nx, ny) || 1;
  return [(nx / n) * s, (ny / n) * s];
}

const COMPASS = ['vers la droite', 'vers le bas et la droite', 'vers le bas', 'vers le bas et la gauche', 'vers la gauche', 'vers le haut et la gauche', 'vers le haut', 'vers le haut et la droite'];
/** Where the wind goes, in words, as seen on screen (grid y points down the screen). */
export function windWords(base: number): string {
  const i = ((Math.round(base / (Math.PI / 4)) % 8) + 8) % 8;
  return COMPASS[i];
}
