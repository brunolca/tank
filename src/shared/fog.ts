// The fog (iteration 26): on some tables, banks of mist drift slowly across the board. A tank deep inside a bank cannot
// be made out from afar: the AI loses it, and on screen it disappears under the mist. Up close (FOG_SIGHT), or for an
// instant after it fires, it shows again. Like the wind, the banks are a pure function of the level's fog seed and of
// the simulation tick: the server, the client and the AI all see the same mist at the same time, nothing travels on the wire.
import { H, TICK_RATE, W } from './constants';

/** How many banks of mist drift over a foggy table. */
export const FOG_BANKS = 5;
/** Within this distance (tiles, plus the target's radius), a tank sees through the mist. */
export const FOG_SIGHT = 2.2;
/** Density from which a tank is hidden (0 clear, 1 the heart of a bank). */
export const FOG_HIDE = 0.5;

export interface FogBank { x: number; y: number; r: number }

interface BankPath { px: number; py: number; fx: number; fy: number; r: number }

// a tiny xorshift of its own, so that this file depends on nothing but the constants
function stream(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const paths = new Map<number, BankPath[]>();
function pathsOf(seed: number): BankPath[] {
  let p = paths.get(seed);
  if (!p) {
    const r = stream(seed * 977 + 13);
    p = [];
    for (let i = 0; i < FOG_BANKS; i++) {
      p.push({ px: 34 + r() * 26, py: 26 + r() * 22, fx: r() * Math.PI * 2, fy: r() * Math.PI * 2, r: 3 + r() * 1.1 });
    }
    if (paths.size > 64) paths.clear();
    paths.set(seed, p);
  }
  return p;
}

/** Where the banks of mist are at that tick: centres (tiles) and radii. They wander the whole table on slow Lissajous loops. */
export function fogBanks(seed: number, tick: number, out: FogBank[] = []): FogBank[] {
  const s = tick / TICK_RATE, ps = pathsOf(seed);
  out.length = ps.length;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const b = out[i] ?? (out[i] = { x: 0, y: 0, r: 0 });
    b.x = W / 2 + (W / 2 - 2.2) * Math.sin((s * Math.PI * 2) / p.px + p.fx);
    b.y = H / 2 + (H / 2 - 2) * Math.sin((s * Math.PI * 2) / p.py + p.fy);
    b.r = p.r;
  }
  return out;
}

/** Density of the mist at (x, y) among those banks: 0 in the clear, 1 in the heart of a bank (the inner 45 % of its radius). */
export function fogDensity(banks: FogBank[], x: number, y: number): number {
  let best = 0;
  for (const b of banks) {
    const d = Math.hypot(x - b.x, y - b.y);
    const k = (b.r - d) / (b.r * 0.55);
    if (k > best) best = k;
  }
  return best > 1 ? 1 : best;
}

/** Is a tank at (x, y) lost in the mist for someone at (sx, sy)? (r: the tank's radius) */
export function fogHides(banks: FogBank[], x: number, y: number, sx: number, sy: number, r = 0): boolean {
  const d = FOG_SIGHT + r;
  if ((x - sx) ** 2 + (y - sy) ** 2 < d * d) return false;
  return fogDensity(banks, x, y) >= FOG_HIDE;
}
