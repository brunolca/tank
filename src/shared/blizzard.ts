// « Le blizzard » (iteration 54): on some snowy, windy tables the wind brings squalls of snow. Every BLIZZARD_PERIOD
// seconds a squall sweeps the table: for a few seconds the snow is so thick that nobody sees farther than BLIZZARD_SIGHT
// (the AI loses its targets, the screen turns white around your tank), the wind blows harder and the trails in the snow
// fill up much faster. Like the wind and the fog, it is a pure function of the simulation tick: the server, the client and
// the AI all feel the same squall at the same time, nothing travels on the wire but the level's flag.
import { TICK_RATE } from './constants';

/** Seconds from the start of one squall to the start of the next. */
export const BLIZZARD_PERIOD = 15;
/** When, in that cycle, the squall starts rising, is at its thickest, starts easing and is gone (seconds). */
export const SQUALL_RISE = 8.5, SQUALL_FULL = 9.7, SQUALL_EASE = 12.7, SQUALL_END = 13.9;
/** Within this distance (tiles, plus the target's radius), a tank still makes out another in a squall. */
export const BLIZZARD_SIGHT = 3.2;
/** Thickness of the squall from which tanks are lost to sight (0 clear, 1 the heart of the squall). */
export const BLIZZARD_HIDE = 0.5;
/** Seconds before a trail in the snow is covered again, on a blizzard table (SNOW_REFILL elsewhere). */
export const BLIZZARD_REFILL = 8;
/** How much harder the wind pulls the shells at the heart of a squall (×(1 + BLIZZARD_PUSH)). */
export const BLIZZARD_PUSH = 0.7;
/** Seconds of warning the screen gives before a squall (« Bourrasque ! »). */
export const SQUALL_WARN = 1.5;

const ease = (u: number) => u * u * (3 - 2 * u);

/** Seconds into the squall cycle at that tick. */
export function squallClock(tick: number): number {
  const s = tick / TICK_RATE;
  return ((s % BLIZZARD_PERIOD) + BLIZZARD_PERIOD) % BLIZZARD_PERIOD;
}

/** Thickness of the squall at that tick: 0 between squalls, 1 at its heart. */
export function whiteoutAt(tick: number): number {
  const c = squallClock(tick);
  if (c < SQUALL_RISE || c >= SQUALL_END) return 0;
  if (c < SQUALL_FULL) return ease((c - SQUALL_RISE) / (SQUALL_FULL - SQUALL_RISE));
  if (c < SQUALL_EASE) return 1;
  return ease(1 - (c - SQUALL_EASE) / (SQUALL_END - SQUALL_EASE));
}

/** Seconds before the next squall starts rising (0 while one is blowing). */
export function squallIn(tick: number): number {
  const c = squallClock(tick);
  if (c >= SQUALL_RISE && c < SQUALL_END) return 0;
  return c < SQUALL_RISE ? SQUALL_RISE - c : BLIZZARD_PERIOD - c + SQUALL_RISE;
}

/** Is a tank at (x, y) lost in the squall for someone at (sx, sy)? (w: the squall's thickness, r: the tank's radius) */
export function blizzardHides(w: number, x: number, y: number, sx: number, sy: number, r = 0): boolean {
  if (w < BLIZZARD_HIDE) return false;
  const d = BLIZZARD_SIGHT + r;
  return (x - sx) ** 2 + (y - sy) ** 2 >= d * d;
}
