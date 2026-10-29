import { H, W, isPortal, isSolidTank, isSolidBullet, Tile } from './constants';

export function tileAt(tiles: ArrayLike<number>, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= W || cy >= H) return Tile.Wall;
  return tiles[cy * W + cx];
}

/** Push a circle out of solid tiles (walls, cork, holes). Returns corrected position. */
export function resolveCircle(tiles: ArrayLike<number>, x: number, y: number, r: number): [number, number] {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const minX = Math.floor(x - r), maxX = Math.floor(x + r);
    const minY = Math.floor(y - r), maxY = Math.floor(y + r);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (!isSolidTank(tileAt(tiles, cx, cy))) continue;
        const px = Math.max(cx, Math.min(x, cx + 1));
        const py = Math.max(cy, Math.min(y, cy + 1));
        let dx = x - px, dy = y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 < 1e-9) {
          // center inside the cell: push along the shortest axis
          const l = x - cx, rr = cx + 1 - x, t = y - cy, b = cy + 1 - y;
          const m = Math.min(l, rr, t, b);
          if (m === l) x = cx - r;
          else if (m === rr) x = cx + 1 + r;
          else if (m === t) y = cy - r;
          else y = cy + 1 + r;
        } else {
          const d = Math.sqrt(d2);
          const push = r - d;
          dx /= d; dy /= d;
          x += dx * push;
          y += dy * push;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return [x, y];
}

export function moveCircle(tiles: ArrayLike<number>, x: number, y: number, dx: number, dy: number, r: number): [number, number] {
  // split long moves to avoid tunnelling
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
  for (let i = 0; i < steps; i++) {
    x += dx / steps;
    y += dy / steps;
    [x, y] = resolveCircle(tiles, x, y, r);
  }
  return [x, y];
}

/** Index of the other portal of the same colour, or -1. */
export function portalTwin(tiles: ArrayLike<number>, cell: number): number {
  const t = tiles[cell];
  if (!isPortal(t)) return -1;
  for (let i = 0; i < W * H; i++) if (i !== cell && tiles[i] === t) return i;
  return -1;
}

/**
 * Something moved from (px, py) to (x, y): if its centre just entered a portal cell, it pops out at the
 * centre of the twin portal. Purely positional, so the server and the client prediction agree.
 */
export function warpTarget(tiles: ArrayLike<number>, px: number, py: number, x: number, y: number): [number, number] | null {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
  const cell = cy * W + cx;
  if (!isPortal(tiles[cell]) || (Math.floor(px) === cx && Math.floor(py) === cy)) return null;
  const twin = portalTwin(tiles, cell);
  if (twin < 0) return null;
  return [(twin % W) + 0.5, Math.floor(twin / W) + 0.5];
}

export function bulletBlocked(tiles: ArrayLike<number>, x: number, y: number, r: number): boolean {
  return (
    isSolidBullet(tileAt(tiles, Math.floor(x - r), Math.floor(y - r))) ||
    isSolidBullet(tileAt(tiles, Math.floor(x + r), Math.floor(y - r))) ||
    isSolidBullet(tileAt(tiles, Math.floor(x - r), Math.floor(y + r))) ||
    isSolidBullet(tileAt(tiles, Math.floor(x + r), Math.floor(y + r)))
  );
}

export interface Segment { x0: number; y0: number; x1: number; y1: number }

/** Cast a ray that ricochets off bullet-solid tiles and goes through portals. Point-sized (bullet radius approximated by inflating the walls a bit). */
export function castRicochet(tiles: ArrayLike<number>, x: number, y: number, ang: number, bounces: number, maxLen = 60): Segment[] {
  const segs: Segment[] = [];
  let dx = Math.cos(ang), dy = Math.sin(ang);
  let remaining = maxLen;
  for (let b = 0, hops = 0; b <= bounces && remaining > 0 && hops < 16; hops++) {
    const hit = dda(tiles, x, y, dx, dy, remaining);
    remaining -= hit.t;
    if (hit.warp >= 0) {
      // the shell enters a portal: the segment ends at its edge and resumes from the twin's centre
      const e = hit.t + 0.1; // dda stops a bullet radius early (inflated walls), the centre crosses a bit later
      segs.push({ x0: x, y0: y, x1: x + dx * e, y1: y + dy * e });
      x = (hit.warp % W) + 0.5;
      y = Math.floor(hit.warp / W) + 0.5;
      continue;
    }
    segs.push({ x0: x, y0: y, x1: hit.x, y1: hit.y });
    if (!hit.hit) break;
    if (hit.axis === 0) dx = -dx; else dy = -dy;
    x = hit.x + dx * 1e-4;
    y = hit.y + dy * 1e-4;
    b++;
  }
  return segs;
}

function dda(tiles: ArrayLike<number>, x: number, y: number, dx: number, dy: number, maxT: number) {
  // inflate by bullet radius: shrink the effective free space by offsetting against wall faces
  const R = 0.09;
  let cx = Math.floor(x), cy = Math.floor(y);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? ((dx > 0 ? cx + 1 - R : cx + R) - x) / dx : Infinity;
  let tMaxY = dy !== 0 ? ((dy > 0 ? cy + 1 - R : cy + R) - y) / dy : Infinity;
  if (tMaxX < 0) tMaxX = 0;
  if (tMaxY < 0) tMaxY = 0;
  for (let i = 0; i < 200; i++) {
    let t: number, axis: number;
    if (tMaxX < tMaxY) { t = tMaxX; axis = 0; cx += stepX; tMaxX += tDeltaX; }
    else { t = tMaxY; axis = 1; cy += stepY; tMaxY += tDeltaY; }
    if (t > maxT) return { hit: false, t: maxT, x: x + dx * maxT, y: y + dy * maxT, axis, warp: -1 };
    const tile = tileAt(tiles, cx, cy);
    if (isSolidBullet(tile)) return { hit: true, t, x: x + dx * t, y: y + dy * t, axis, warp: -1 };
    if (isPortal(tile)) {
      const twin = portalTwin(tiles, cy * W + cx);
      if (twin >= 0) return { hit: false, t, x: x + dx * t, y: y + dy * t, axis, warp: twin };
    }
  }
  return { hit: false, t: maxT, x: x + dx * maxT, y: y + dy * maxT, axis: 0, warp: -1 };
}

/** Distance parameter along segment where it first touches circle, or -1. */
export function segCircle(s: Segment, cx: number, cy: number, r: number): number {
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
  const fx = s.x0 - cx, fy = s.y0 - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t1 < 0 && t2 >= 0) return 0; // starts inside
  return -1;
}

export function angDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function rotateToward(a: number, target: number, maxStep: number) {
  const d = angDiff(a, target);
  if (Math.abs(d) <= maxStep) return target;
  return a + Math.sign(d) * maxStep;
}
