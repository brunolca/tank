import { GHOST_DEPTH, BELT_DIRS, BELT_SPEED, ICE, ICE_GRIP, QUICK, QUICK_PULL, QUICK_SLOW, SAND, SAND_SLOW, SNOW, PACKED, SNOW_SLOW, H, W, PORTAL_MAX_R, isPortal, isSolidTank, isSolidBullet, isSnowman, isTunnel, isPit, mirrorOf, Tile } from './constants';

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
export function castRicochet(tiles: ArrayLike<number>, x: number, y: number, ang: number, bounces: number, maxLen = 60, ghost = false): Segment[] {
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
    if (hit.mirror) {
      // « Les miroirs » (iteration 57): a quarter turn, and no bounce used up
      [dx, dy] = mirrorTurn(hit.mirror, dx, dy);
      x = hit.x + dx * 1e-4;
      y = hit.y + dy * 1e-4;
      continue;
    }
    if (!hit.hit) break;
    if (ghost) {
      // « Passe-muraille » (iteration 52): the first wall inside the table lets the shell through (see Game.ghostStep)
      const out = ghostExit(tiles, hit.x, hit.y, dx, dy);
      if (out !== undefined) ghost = false; // the frame: a plain bounce, the ghost waits for the next wall
      if (out) {
        remaining -= out.depth;
        segs.push({ x0: hit.x, y0: hit.y, x1: out.x, y1: out.y });
        x = out.x; y = out.y;
        continue;
      }
      if (out === null) break; // it fades away in a wall too thick
    }
    if (isSnowman(tileAt(tiles, hit.cx, hit.cy))) break; // « Les bonshommes de neige » (iteration 53): the snow swallows the shell
    if (hit.axis === 0) dx = -dx; else dy = -dy;
    x = hit.x + dx * 1e-4;
    y = hit.y + dy * 1e-4;
    b++;
  }
  return segs;
}

/**
 * Where a ghost shell entering a wall at (x, y) along (dx, dy) comes out: the first point clear of every wall, undefined
 * when that wall is the frame of the table (it bounces off as usual), null when it would fade inside (thicker than GHOST_DEPTH).
 */
function ghostExit(tiles: ArrayLike<number>, x: number, y: number, dx: number, dy: number): { x: number; y: number; depth: number } | null | undefined {
  const R = 0.09, step = 0.05, inside = (px: number, py: number) => px - R >= 0 && py - R >= 0 && px + R < W && py + R < H;
  if (!inside(x + dx * 0.2, y + dy * 0.2)) return undefined;
  for (let d = step; d <= GHOST_DEPTH; d += step) {
    const px = x + dx * d, py = y + dy * d;
    if (!inside(px, py)) return null;
    if (!bulletBlocked(tiles, px, py, R)) return { x: px, y: py, depth: d };
  }
  return null;
}

/**
 * The windy twin of castRicochet (iteration 23): steps a shell of that speed through a steady wind (ax, ay), with the
 * same per-axis bounces as the simulation, and returns its curved path as short chords. Used by the AI to aim in the wind.
 */
export function castWindy(tiles: ArrayLike<number>, x: number, y: number, ang: number, speed: number, bounces: number, ax: number, ay: number, maxLen = 45): Segment[] {
  const segs: Segment[] = [];
  const R = 0.09, dt = Math.min(0.12, 0.85 / speed); // steps shorter than a wall is thick
  let vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed;
  let x0 = x, y0 = y, steps = 0;
  const pull = Math.hypot(ax, ay) > 1e-6;
  for (let len = 0; len < maxLen; len += speed * dt) {
    const ox = x, oy = y;
    let bounced = false;
    const nx = x + vx * dt;
    if (bulletBlocked(tiles, nx, y, R)) { if (snowmanNear(tiles, nx, y, R)) break; vx = -vx; bounced = true; } else x = nx;
    const ny = y + vy * dt;
    if (bulletBlocked(tiles, x, ny, R)) { if (snowmanNear(tiles, x, ny, R)) break; vy = -vy; bounced = true; } else y = ny;
    const mh = mirrorHit(tiles, ox, oy, x, y);
    if (mh) {
      // « Les miroirs » (iteration 57): turned at the glass, as in the simulation
      const px = ox + (x - ox) * mh.s, py = oy + (y - oy) * mh.s;
      const [rx, ry] = mirrorTurn(mh.m, x - px, y - py);
      x = px + rx; y = py + ry;
      [vx, vy] = mirrorTurn(mh.m, vx, vy);
    }
    const w = warpTarget(tiles, ox, oy, x, y);
    if (bounced || w || mh || ++steps >= 2) {
      segs.push({ x0, y0, x1: x, y1: y });
      steps = 0;
      if (bounced && --bounces < 0) return segs;
      if (w) [x, y] = w;
      x0 = x; y0 = y;
    }
    if (pull) {
      // same bend as the simulation: sideways only, the shell keeps its speed
      const s = Math.hypot(vx, vy), bx = vx + ax * dt, by = vy + ay * dt, n = Math.hypot(bx, by) || 1;
      vx = (bx / n) * s; vy = (by / n) * s;
    }
    if (x < -1 || y < -1 || x > W + 1 || y > H + 1) break;
  }
  if (x0 !== x || y0 !== y) segs.push({ x0, y0, x1: x, y1: y });
  return segs;
}

/** Does a shell of radius r at (x, y) touch a snowman (iteration 53)? */
export function snowmanNear(tiles: ArrayLike<number>, x: number, y: number, r: number): boolean {
  for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) if (isSnowman(tileAt(tiles, cx, cy))) return true;
  return false;
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
  // « Les miroirs » (iteration 57): the ray may cross the glass of the cell it is in (a shell fired from right against a mirror)
  const glass = (gx: number, gy: number, m: number) => {
    const s = mirrorRay(gx, gy, m, x, y, dx, dy);
    return s >= 0 && s <= maxT ? { hit: false, t: s, x: x + dx * s, y: y + dy * s, axis: 0, warp: -1, cx: gx, cy: gy, mirror: m } : undefined;
  };
  const m0 = mirrorOf(tileAt(tiles, cx, cy));
  if (m0) { const g = glass(cx, cy, m0); if (g) return g; }
  for (let i = 0; i < 200; i++) {
    let t: number, axis: number;
    if (tMaxX < tMaxY) { t = tMaxX; axis = 0; cx += stepX; tMaxX += tDeltaX; }
    else { t = tMaxY; axis = 1; cy += stepY; tMaxY += tDeltaY; }
    if (t > maxT) return { hit: false, t: maxT, x: x + dx * maxT, y: y + dy * maxT, axis, warp: -1, cx, cy, mirror: 0 };
    const tile = tileAt(tiles, cx, cy);
    const m = mirrorOf(tile);
    if (m) { const g = glass(cx, cy, m); if (g) return g; continue; }
    if (isSolidBullet(tile)) return { hit: true, t, x: x + dx * t, y: y + dy * t, axis, warp: -1, cx, cy, mirror: 0 };
    if (isPortal(tile)) {
      const twin = portalTwin(tiles, cy * W + cx);
      if (twin >= 0) return { hit: false, t, x: x + dx * t, y: y + dy * t, axis, warp: twin, cx, cy, mirror: 0 };
    }
  }
  return { hit: false, t: maxT, x: x + dx * maxT, y: y + dy * maxT, axis: 0, warp: -1, cx, cy, mirror: 0 };
}

// ---------------------------------------------------------------- « Les miroirs » (iteration 57)

/** A direction turned by a mirror: '/' (m = 1) sends right to up, '\\' (m = -1) sends right to down (y grows down the map). */
export function mirrorTurn(m: number, vx: number, vy: number): [number, number] {
  return m > 0 ? [-vy, -vx] : [vy, vx];
}

/** Side of the mirror line of cell (cx, cy) the point (x, y) is on (signed; 0 on the glass). */
function mirrorSide(cx: number, cy: number, m: number, x: number, y: number) {
  return m > 0 ? x - cx + (y - cy) - 1 : x - cx - (y - cy);
}

/** Distance along the ray (x, y) + s (dx, dy) to the glass of the mirror m of cell (cx, cy), inside that cell; -1 if it misses. */
function mirrorRay(cx: number, cy: number, m: number, x: number, y: number, dx: number, dy: number): number {
  const den = m > 0 ? dx + dy : dx - dy;
  if (Math.abs(den) < 1e-9) return -1;
  const s = -mirrorSide(cx, cy, m, x, y) / den;
  if (s < 1e-6) return -1;
  const px = x + dx * s, py = y + dy * s;
  return px >= cx - 1e-6 && px <= cx + 1 + 1e-6 && py >= cy - 1e-6 && py <= cy + 1 + 1e-6 ? s : -1;
}

/**
 * A shell moved from (x0, y0) to (x1, y1): did its centre cross the glass of a mirror on the way? Returns where (s, from 0
 * to 1 along the move), which mirror (m) and its cell; the earliest one when two cells are touched. Undefined otherwise.
 */
export function mirrorHit(tiles: ArrayLike<number>, x0: number, y0: number, x1: number, y1: number): { s: number; m: number; cx: number; cy: number } | undefined {
  let best: { s: number; m: number; cx: number; cy: number } | undefined;
  const ax = Math.floor(Math.min(x0, x1)), bx = Math.floor(Math.max(x0, x1)), ay = Math.floor(Math.min(y0, y1)), by = Math.floor(Math.max(y0, y1));
  for (let cy = ay; cy <= by; cy++) {
    for (let cx = ax; cx <= bx; cx++) {
      const m = mirrorOf(tileAt(tiles, cx, cy));
      if (!m) continue;
      const a = mirrorSide(cx, cy, m, x0, y0), b = mirrorSide(cx, cy, m, x1, y1);
      if (a === 0 || a * b > 0) continue; // starting on the glass: it was just turned there
      const s = a / (a - b);
      const px = x0 + (x1 - x0) * s, py = y0 + (y1 - y0) * s;
      if (px < cx - 1e-6 || px > cx + 1 + 1e-6 || py < cy - 1e-6 || py > cy + 1 + 1e-6) continue;
      if (!best || s < best.s) best = { s, m, cx, cy };
    }
  }
  return best;
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

/**
 * Direction of a tunnel cell (iteration 13): 0 when it runs left-right (solid above and below), 1 when it runs
 * up-down (solid on both sides), -1 when it is not a proper tunnel. Neighbouring tunnel cells count as a run.
 */
export function tunnelAxis(tiles: ArrayLike<number>, cell: number): number {
  if (!isTunnel(tiles[cell])) return -1;
  const x = cell % W, y = Math.floor(cell / W);
  const shut = (cx: number, cy: number) => { const t = tileAt(tiles, cx, cy); return isSolidTank(t) && !isTunnel(t); };
  const horiz = shut(x, y - 1) && shut(x, y + 1);
  const vert = shut(x - 1, y) && shut(x + 1, y);
  if (horiz && !vert) return 0;
  if (vert && !horiz) return 1;
  if (horiz && vert) return isTunnel(tileAt(tiles, x - 1, y)) || isTunnel(tileAt(tiles, x + 1, y)) ? 0 : 1;
  return -1;
}

/**
 * Direction of a bridge cell (iteration 33): 0 when it runs left-right (pit above and below), 1 when it runs
 * up-down (pit on both sides). Neighbouring bridge cells count as pit for its sides. Drawing only.
 */
export function bridgeAxis(tiles: ArrayLike<number>, cell: number): number {
  const x = cell % W, y = Math.floor(cell / W);
  const pit = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < W && cy < H && isPit(tiles[cy * W + cx]);
  const bridge = (cx: number, cy: number) => tileAt(tiles, cx, cy) === Tile.Bridge;
  const vert = pit(x - 1, y) && pit(x + 1, y);
  const horiz = pit(x, y - 1) && pit(x, y + 1);
  if (vert && !horiz) return 1;
  if (horiz && !vert) return 0;
  if (vert && horiz) return bridge(x, y - 1) || bridge(x, y + 1) ? 1 : 0;
  return pit(x - 1, y) || pit(x + 1, y) ? 1 : 0;
}

/** Belt code (0 none, 1 right, 2 left, 3 up, 4 down) under a point, iteration 16. */
export function beltAt(belts: ArrayLike<number> | undefined, x: number, y: number): number {
  if (!belts || !belts.length) return 0;
  const cx = Math.floor(x), cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= W || cy >= H) return 0;
  return belts[cy * W + cx] | 0;
}

/**
 * A conveyor belt carries whatever sits on it (its centre decides) one step along. Purely positional, like the
 * portals: the server and the client prediction run the same function after each drive step and agree.
 * Returns the moved position (through a portal when the belt runs into one).
 */
export function beltStep(tiles: ArrayLike<number>, belts: ArrayLike<number> | undefined, x: number, y: number, r: number, dt: number): [number, number] {
  const b = beltAt(belts, x, y);
  if (b === QUICK) return quickStep(tiles, x, y, r, dt);
  if (!b || b > 4) return [x, y]; // ice, sand and snow do not carry anything (iterations 21, 36 and 42)
  const [dx, dy] = BELT_DIRS[b] ?? [0, 0];
  const px = x, py = y;
  const sp = BELT_SPEED * dt;
  [x, y] = moveCircle(tiles, x, y, dx * sp, dy * sp, r);
  // a gentle pull toward the middle of the belt, so things ride along it instead of scraping its edge
  if (dx) y += (Math.floor(y) + 0.5 - y) * Math.min(1, 1.5 * dt);
  else x += (Math.floor(x) + 0.5 - x) * Math.min(1, 1.5 * dt);
  [x, y] = resolveCircle(tiles, x, y, r);
  if (r <= PORTAL_MAX_R) {
    const w = warpTarget(tiles, px, py, x, y);
    if (w) [x, y] = w;
  }
  return [x, y];
}

/**
 * « Les sables mouvants » (iteration 59): the whirl draws whatever sits on it toward the middle of its cell, at
 * QUICK_PULL tiles/s (never past it). The big tanks (the bosses, the train) are too heavy to be drawn in.
 */
function quickStep(tiles: ArrayLike<number>, x: number, y: number, r: number, dt: number): [number, number] {
  if (r > PORTAL_MAX_R) return [x, y];
  const dx = Math.floor(x) + 0.5 - x, dy = Math.floor(y) + 0.5 - y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-4) return [x, y];
  const k = Math.min(d, QUICK_PULL * dt) / d;
  return moveCircle(tiles, x, y, dx * k, dy * k, r);
}

/** Is the centre of this point on quicksand? (iteration 59) */
export function onQuick(belts: ArrayLike<number> | undefined, x: number, y: number): boolean {
  return beltAt(belts, x, y) === QUICK;
}

/** Is the centre of this point on a sand cell? (iteration 36) */
export function onSand(belts: ArrayLike<number> | undefined, x: number, y: number): boolean {
  return beltAt(belts, x, y) === SAND;
}

/** Is the centre of this point on snow, deep or packed? (iteration 42: a mine laid there is buried) */
export function onSnow(belts: ArrayLike<number> | undefined, x: number, y: number): boolean {
  const b = beltAt(belts, x, y);
  return b === SNOW || b === PACKED;
}

/** Share of its speed a tank keeps where it stands: SAND_SLOW on sand, SNOW_SLOW in deep snow, 1 elsewhere (server and client prediction alike). */
export function floorSpeed(belts: ArrayLike<number> | undefined, x: number, y: number): number {
  const b = beltAt(belts, x, y);
  return b === SAND ? SAND_SLOW : b === SNOW ? SNOW_SLOW : b === QUICK ? QUICK_SLOW : 1;
}

/** Is the centre of this point on an ice cell? (iteration 21) */
export function onIce(belts: ArrayLike<number> | undefined, x: number, y: number): boolean {
  return beltAt(belts, x, y) === ICE;
}

/**
 * Sliding on ice (iteration 21). On ice a tank keeps its momentum: its speed only bends slowly toward where its
 * driver steers (ICE_GRIP), so it drifts round corners and slides on when the stick is let go. Walls stop the
 * part of the speed that runs into them. Off the ice, nothing changes: `drive` moves the tank as usual and the
 * speed it ends with is the one it carries onto the next patch of ice.
 * Shared by the server and the client prediction, which replays it from the speed the server sends.
 * `want`: the speed the driver asks for (tiles/s); returns the new position and speed.
 */
export function glideStep(
  tiles: ArrayLike<number>, x: number, y: number, vx: number, vy: number, wantX: number, wantY: number, dt: number, r: number,
): [number, number, number, number] {
  const k = 1 - Math.exp(-ICE_GRIP * dt);
  vx += (wantX - vx) * k;
  vy += (wantY - vy) * k;
  if (vx * vx + vy * vy < 0.0004) return [x, y, 0, 0];
  const px = x, py = y;
  [x, y] = moveCircle(tiles, x, y, vx * dt, vy * dt, r);
  // what the walls let through is the speed we keep (a head-on bump stops us, a glancing one slides along)
  const ax = (x - px) / dt, ay = (y - py) / dt;
  if (Math.abs(ax) < Math.abs(vx)) vx = ax;
  if (Math.abs(ay) < Math.abs(vy)) vy = ay;
  if (r <= PORTAL_MAX_R) {
    const w = warpTarget(tiles, px, py, x, y);
    if (w) [x, y] = w; // and the slide goes on out of the twin portal
  }
  return [x, y, vx, vy];
}
