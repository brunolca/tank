import {
  BONUS_INFO, BONUS_KINDS, BONUS_LIFE, BONUS_R, BOSS_VOLLEY_EVERY, BOSS_VOLLEY_SHOTS, BOSS_VOLLEY_WARN, BULLET_R, BULLET_SPEED, BonusKind, DT,
  FAN_SPREAD, FLAG_ALERT, FLAG_CHARGING, FLAG_RAGE, H, NIGHT_REVEAL, NIGHT_SIGHT, MINE_BLAST, PORTAL_MAX_R, MINE_FUSE, MINE_R, MINE_TRIGGER_R, ROCKET_SPEED, SPECS, SUBSTEPS, TANK_R, TURBO_MULT,
  TankKind, TankSpec, Tile, W, isPortal, isSolidTank,
} from './constants';
import { angDiff, bulletBlocked, castRicochet, moveCircle, resolveCircle, rotateToward, segCircle, tileAt, warpTarget } from './physics';
import type { GameEvent, Input, NetBonus, NetBullet, NetMine, NetTank, TankInfo } from './protocol';

export interface Tank {
  id: number;
  kind: TankKind;
  team: number;
  pid?: string;
  name?: string;
  color: number;
  x: number;
  y: number;
  body: number;
  turret: number;
  alive: boolean;
  fireCd: number;
  mineCd: number;
  spec: TankSpec;
  ai?: AIState;
  buffs: Buffs;
  r: number; // hull radius
  hp: number;
  maxHp: number;
  boss?: BossState;
  reveal: number; // night: seconds left during which the last muzzle flash gives this tank away
  alert: boolean; // AI: a foe is in sight right now
}

/** The boss: a radial volley every few seconds (announced by a glow), and a rage mode at half health. */
export interface BossState {
  volleyT: number;
  warn: number; // > 0 while the warning glow is on
  spin: number;
  rage: boolean;
}

/** Active bonuses: shield is a single-use flag, the others are seconds left. */
export interface Buffs {
  shield: boolean;
  bounce: number;
  turbo: number;
  fan: number;
  invuln: number; // grace period right after a shield breaks
}

export interface Bonus {
  id: number;
  kind: BonusKind;
  x: number;
  y: number;
  t: number;
  dead: boolean;
}

export interface Bullet {
  id: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: number;
  rocket: boolean;
  dead: boolean;
}

export interface Mine {
  id: number;
  owner: number;
  team: number;
  x: number;
  y: number;
  t: number;
  fuse: number;
  dead: boolean;
}

interface AIState {
  think: number;
  aim: number;
  aimValid: boolean;
  wanderAim: number;
  wanderT: number;
  path: number[];
  pathT: number;
  dodgeX: number;
  dodgeY: number;
  dodgeT: number;
  stuckT: number;
  lastX: number;
  lastY: number;
  mineCd: number;
  hesitate: number;
  locked: boolean;
  prefDist: number;
  goal?: number; // a cell to drive to (the demo sends tanks through portals), forgotten after a portal jump
  seenX: number; // night: where a foe was last seen, remembered for seenT seconds
  seenY: number;
  seenT: number;
  prowlX: number; // night: a spot to prowl to when nobody is in sight
  prowlY: number;
  prowlT: number;
}

type Pt = { x: number; y: number };

const PREF_DIST: Partial<Record<TankKind, number>> = {
  ash: 6, marine: 7, yellow: 5, pink: 5, violet: 4, white: 4.5, black: 3.5,
};

export type KillCb = (victim: Tank, killer: Tank | undefined) => void;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Shared by the server simulation and client-side prediction. */
export function driveStep(tiles: ArrayLike<number>, x: number, y: number, body: number, mx: number, my: number, speed: number, dt: number, r = TANK_R): [number, number, number] {
  const len = Math.hypot(mx, my);
  if (len < 0.05) return [x, y, body];
  if (len > 1) { mx /= len; my /= len; }
  const target = Math.atan2(my, mx);
  // tanks can drive forwards or backwards: rotate toward the closest of the two
  const alt = target + Math.PI;
  const goal = Math.abs(angDiff(body, target)) <= Math.abs(angDiff(body, alt)) ? target : alt;
  body = rotateToward(body, goal, 11 * dt);
  const sp = speed * dt;
  const px = x, py = y;
  [x, y] = moveCircle(tiles, x, y, mx * sp, my * sp, r);
  if (r <= PORTAL_MAX_R) {
    const w = warpTarget(tiles, px, py, x, y);
    if (w) [x, y] = w;
  }
  return [x, y, body];
}

export class Game {
  tiles: number[];
  tanks: Tank[] = [];
  bullets: Bullet[] = [];
  mines: Mine[] = [];
  events: GameEvent[] = [];
  bonuses: Bonus[] = [];
  /** Bonus crates: off by default, the room (and the demo) switch them on. */
  bonusOn = false;
  bonusNext = 8;
  bonusEvery: [number, number] = [13, 19];
  bonusCap = 2;
  /** Night mission: the AI only sees foes close by, or those whose muzzle flash just lit up. */
  night = false;
  tick = 0;
  frozen = true;
  private nextId = 1;
  onKill?: KillCb;

  constructor(tiles: number[]) {
    this.tiles = tiles.slice();
  }

  addTank(kind: TankKind, team: number, x: number, y: number, color: number, pid?: string, name?: string): Tank {
    const spec = SPECS[kind];
    const t: Tank = {
      id: this.nextId++, kind, team, pid, name, color, x, y,
      body: team === 0 ? 0 : Math.PI, turret: team === 0 ? 0 : Math.PI,
      alive: true, fireCd: team === 0 ? 0 : 2 + Math.random() * 1.5, mineCd: 0, spec,
      buffs: { shield: false, bounce: 0, turbo: 0, fan: 0, invuln: 0 },
      r: spec.size ?? TANK_R, hp: spec.hp ?? 1, maxHp: spec.hp ?? 1, reveal: 0, alert: false,
    };
    if (kind === 'boss') t.boss = { volleyT: 5, warn: 0, spin: 0, rage: false };
    if (kind !== 'player') this.enableAI(t);
    this.tanks.push(t);
    return t;
  }

  /** Give a tank a brain (enemies always; player-coloured tanks in the demo/attract mode). */
  enableAI(t: Tank, spec?: Partial<TankSpec>) {
    if (spec) t.spec = { ...t.spec, ...spec };
    const { x, y, kind } = t;
    {
      t.ai = {
        think: Math.random() * 0.3, aim: t.turret, aimValid: false, wanderAim: t.turret, wanderT: 0,
        path: [], pathT: 0, dodgeX: 0, dodgeY: 0, dodgeT: 0, stuckT: 0, lastX: x, lastY: y,
        mineCd: 2 + Math.random() * 3, hesitate: 0, locked: false, prefDist: PREF_DIST[kind] ?? 5,
        seenX: x, seenY: y, seenT: 0, prowlX: x, prowlY: y, prowlT: 0,
      };
    }
  }

  tankInfos(): TankInfo[] {
    return this.tanks.map((t) => ({ id: t.id, kind: t.kind, team: t.team, pid: t.pid, name: t.name, color: t.color, hp: t.maxHp > 1 ? t.maxHp : undefined }));
  }

  /** Set a tough tank's hit points (the room scales the boss with the number of players). */
  setHp(t: Tank, hp: number, maxHp = hp) {
    t.maxHp = Math.max(1, Math.round(maxHp));
    t.hp = Math.max(1, Math.min(t.maxHp, Math.round(hp)));
    if (t.boss && t.hp <= t.maxHp / 2) this.enrage(t, false);
  }

  step(inputs: Map<string, Input>) {
    this.tick++;
    if (this.frozen) return;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      t.fireCd -= DT;
      t.mineCd -= DT;
      const bf = t.buffs;
      if (bf.bounce > 0) bf.bounce -= DT;
      if (bf.turbo > 0) bf.turbo -= DT;
      if (bf.fan > 0) bf.fan -= DT;
      if (bf.invuln > 0) bf.invuln -= DT;
      if (t.reveal > 0) t.reveal -= DT;
      if (t.boss) this.updateBoss(t);
      if (t.ai) {
        this.updateAI(t);
      } else if (t.pid) {
        const inp = inputs.get(t.pid);
        if (inp) this.applyInput(t, inp);
      }
    }
    this.separateTanks();
    const sdt = DT / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.stepBullets(sdt);
    this.stepMines(DT);
    if (this.bonusOn) this.stepBonuses(DT);
  }

  // -------------------------------------------------------------- bonus crates

  stepBonuses(dt: number) {
    this.bonusNext -= dt;
    if (this.bonusNext <= 0) {
      const [a, b] = this.bonusEvery;
      this.bonusNext = a + Math.random() * (b - a);
      if (this.bonuses.length < this.bonusCap) this.spawnBonus();
    }
    for (const c of this.bonuses) {
      c.t += dt;
      if (c.t >= BONUS_LIFE) { c.dead = true; continue; }
      if (c.t < 0.5) continue; // still dropping in
      for (const t of this.tanks) {
        if (!t.alive || t.kind !== 'player') continue;
        const rr = TANK_R + BONUS_R;
        if ((t.x - c.x) ** 2 + (t.y - c.y) ** 2 < rr * rr) {
          c.dead = true;
          this.giveBonus(t, c.kind);
          this.events.push(['bonus', r2(c.x), r2(c.y), BONUS_KINDS.indexOf(c.kind), t.id]);
          break;
        }
      }
    }
    this.bonuses = this.bonuses.filter((c) => !c.dead);
  }

  /** Drop a crate on a free tile, away from every tank, mine and crate. */
  spawnBonus(kind?: BonusKind): Bonus | undefined {
    for (let tries = 0; tries < 60; tries++) {
      const cx = 1 + Math.floor(Math.random() * (W - 2)), cy = 1 + Math.floor(Math.random() * (H - 2));
      if (this.tiles[cy * W + cx] !== Tile.Empty) continue;
      const x = cx + 0.5, y = cy + 0.5;
      const near = (ox: number, oy: number, d: number) => (ox - x) ** 2 + (oy - y) ** 2 < d * d;
      if (this.tanks.some((t) => t.alive && near(t.x, t.y, 2.5))) continue;
      if (this.mines.some((m) => near(m.x, m.y, MINE_BLAST + 0.3))) continue;
      if (this.bonuses.some((o) => near(o.x, o.y, 3))) continue;
      const k = kind ?? BONUS_KINDS[Math.floor(Math.random() * BONUS_KINDS.length)];
      const c: Bonus = { id: this.nextId++, kind: k, x, y, t: 0, dead: false };
      this.bonuses.push(c);
      this.events.push(['crate', x, y, BONUS_KINDS.indexOf(k)]);
      return c;
    }
    return undefined;
  }

  giveBonus(t: Tank, kind: BonusKind) {
    if (kind === 'shield') t.buffs.shield = true;
    else t.buffs[kind] = BONUS_INFO[kind].duration;
  }

  speedOf(t: Tank) {
    return t.spec.speed * (t.buffs.turbo > 0 ? TURBO_MULT : 1);
  }

  // -------------------------------------------------------------- boss

  updateBoss(t: Tank) {
    const bs = t.boss!;
    if (bs.warn > 0) {
      bs.warn -= DT;
      if (bs.warn <= 0) this.bossVolley(t);
      return;
    }
    bs.volleyT -= DT;
    if (bs.volleyT <= 0) {
      bs.warn = BOSS_VOLLEY_WARN;
      bs.volleyT = BOSS_VOLLEY_EVERY[bs.rage ? 1 : 0] * (0.85 + Math.random() * 0.3);
    }
  }

  /** A ring of shells all around the hull, rotated a little more each time. */
  bossVolley(t: Tank) {
    const bs = t.boss!;
    const n = BOSS_VOLLEY_SHOTS[bs.rage ? 1 : 0];
    bs.spin += 0.5 + Math.random() * 0.6;
    const tip = t.r + 0.2;
    for (let i = 0; i < n; i++) {
      const a = bs.spin + (i * Math.PI * 2) / n, dx = Math.cos(a), dy = Math.sin(a);
      const x = t.x + dx * tip, y = t.y + dy * tip;
      if (bulletBlocked(this.tiles, x, y, BULLET_R)) continue;
      const sp = BULLET_SPEED * 0.8;
      this.bullets.push({ id: this.nextId++, owner: t.id, x, y, vx: dx * sp, vy: dy * sp, bounces: 0, rocket: false, dead: false });
    }
    this.events.push(['volley', r2(t.x), r2(t.y), t.id]);
  }

  enrage(t: Tank, loud = true) {
    if (!t.boss || t.boss.rage) return;
    t.boss.rage = true;
    t.spec = { ...t.spec, speed: t.spec.speed * 1.35, fireCd: t.spec.fireCd * 0.7, mines: t.spec.mines + 1 };
    if (loud) {
      t.boss.volleyT = Math.min(t.boss.volleyT, 1.5);
      this.events.push(['rage', r2(t.x), r2(t.y), t.id]);
    }
  }

  applyInput(t: Tank, inp: Input) {
    let mx = inp.mx, my = inp.my;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.driveTank(t, mx, my, DT);
    if (Number.isFinite(inp.a)) t.turret = inp.a;
    if (inp.f) this.tryFire(t);
    if (inp.m) this.tryMine(t);
  }

  driveTank(t: Tank, mx: number, my: number, dt: number) {
    const px = t.x, py = t.y;
    [t.x, t.y, t.body] = driveStep(this.tiles, t.x, t.y, t.body, mx, my, this.speedOf(t), dt, t.r);
    if ((t.x - px) ** 2 + (t.y - py) ** 2 > 1) {
      // went through a portal
      this.events.push(['warp', r2(px), r2(py), r2(t.x), r2(t.y), t.id]);
      if (t.ai) { t.ai.path = []; t.ai.dodgeT = 0; t.ai.goal = undefined; }
    }
  }

  ownBullets(t: Tank) {
    let n = 0;
    for (const b of this.bullets) if (b.owner === t.id && !b.dead) n++;
    return n;
  }
  ownMines(t: Tank) {
    let n = 0;
    for (const m of this.mines) if (m.owner === t.id && !m.dead) n++;
    return n;
  }

  tryFire(t: Tank): boolean {
    if (t.fireCd > 0 || this.ownBullets(t) >= t.spec.maxBullets) return false;
    t.fireCd = t.spec.fireCd;
    t.reveal = NIGHT_REVEAL;
    const dx = Math.cos(t.turret), dy = Math.sin(t.turret);
    const tip = t.r + 0.22;
    const x = t.x + dx * tip, y = t.y + dy * tip;
    const sp = t.spec.rocket ? ROCKET_SPEED : BULLET_SPEED;
    this.events.push(['shot', r2(x), r2(y), r2(t.turret), t.spec.rocket ? 1 : 0, t.id]);
    if (bulletBlocked(this.tiles, x, y, BULLET_R) || bulletBlocked(this.tiles, t.x + dx * t.r * 0.6, t.y + dy * t.r * 0.6, BULLET_R)) {
      this.events.push(['pop', r2(x), r2(y)]);
      return true;
    }
    const bounces = t.spec.bounces + (t.buffs.bounce > 0 ? 1 : 0);
    this.bullets.push({ id: this.nextId++, owner: t.id, x, y, vx: dx * sp, vy: dy * sp, bounces, rocket: t.spec.rocket, dead: false });
    if (t.buffs.fan > 0) {
      // two extra shells on each side of the main one (they may push past the ammo cap)
      for (const da of [-FAN_SPREAD, FAN_SPREAD]) {
        const a = t.turret + da, ex = Math.cos(a), ey = Math.sin(a);
        const fx = t.x + ex * tip, fy = t.y + ey * tip;
        if (bulletBlocked(this.tiles, fx, fy, BULLET_R)) continue;
        this.bullets.push({ id: this.nextId++, owner: t.id, x: fx, y: fy, vx: ex * sp, vy: ey * sp, bounces, rocket: t.spec.rocket, dead: false });
      }
    }
    return true;
  }

  tryMine(t: Tank): boolean {
    if (t.mineCd > 0 || this.ownMines(t) >= t.spec.mines) return false;
    for (const m of this.mines) if (!m.dead && Math.hypot(m.x - t.x, m.y - t.y) < MINE_R * 3) return false;
    t.mineCd = 0.6;
    this.mines.push({ id: this.nextId++, owner: t.id, team: t.team, x: t.x, y: t.y, t: 0, fuse: -1, dead: false });
    this.events.push(['mineSet', r2(t.x), r2(t.y)]);
    return true;
  }

  separateTanks() {
    const alive = this.tanks.filter((t) => t.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.r + b.r;
        if (d >= min) continue;
        if (d < 1e-6) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
        const push = (min - d) / 2;
        // static tanks don't budge, and the big boss shoves the small ones aside
        const aStatic = a.spec.speed === 0 || a.r > b.r + 0.1, bStatic = b.spec.speed === 0 || b.r > a.r + 0.1;
        const ka = aStatic ? 0 : bStatic ? 2 : 1, kb = bStatic ? 0 : aStatic ? 2 : 1;
        a.x -= dx * push * ka; a.y -= dy * push * ka;
        b.x += dx * push * kb; b.y += dy * push * kb;
        [a.x, a.y] = resolveCircle(this.tiles, a.x, a.y, a.r);
        [b.x, b.y] = resolveCircle(this.tiles, b.x, b.y, b.r);
      }
    }
  }

  stepBullets(dt: number) {
    for (const b of this.bullets) {
      if (b.dead) continue;
      let bounced = false;
      const ox = b.x, oy = b.y;
      const nx = b.x + b.vx * dt;
      if (bulletBlocked(this.tiles, nx, b.y, BULLET_R)) { b.vx = -b.vx; bounced = true; } else b.x = nx;
      const ny = b.y + b.vy * dt;
      if (bulletBlocked(this.tiles, b.x, ny, BULLET_R)) { b.vy = -b.vy; bounced = true; } else b.y = ny;
      if (bounced) {
        b.bounces--;
        if (b.bounces < 0) { b.dead = true; this.events.push(['pop', r2(b.x), r2(b.y)]); continue; }
        this.events.push(['bounce', r2(b.x), r2(b.y)]);
      }
      const w = warpTarget(this.tiles, ox, oy, b.x, b.y);
      if (w) {
        this.events.push(['warp', r2(b.x), r2(b.y), w[0], w[1], 0]);
        [b.x, b.y] = w;
      }
      if (b.x < -1 || b.y < -1 || b.x > W + 1 || b.y > H + 1) b.dead = true;
    }
    // bullet vs tank
    for (const b of this.bullets) {
      if (b.dead) continue;
      for (const t of this.tanks) {
        if (!t.alive) continue;
        const rr = t.r + BULLET_R;
        if ((t.x - b.x) ** 2 + (t.y - b.y) ** 2 < rr * rr) {
          b.dead = true;
          this.killTank(t, this.tankById(b.owner));
          break;
        }
      }
    }
    // bullet vs bullet
    for (let i = 0; i < this.bullets.length; i++) {
      const a = this.bullets[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.bullets.length; j++) {
        const b = this.bullets[j];
        if (b.dead) continue;
        const rr = BULLET_R * 2 + 0.06;
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < rr * rr) {
          a.dead = b.dead = true;
          this.events.push(['pop', r2((a.x + b.x) / 2), r2((a.y + b.y) / 2)]);
          break;
        }
      }
    }
    // bullet vs mine
    for (const b of this.bullets) {
      if (b.dead) continue;
      for (const m of this.mines) {
        if (m.dead) continue;
        if (Math.hypot(m.x - b.x, m.y - b.y) < MINE_R + BULLET_R) {
          b.dead = true;
          this.explodeMine(m);
          break;
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  stepMines(dt: number) {
    for (const m of this.mines) {
      if (m.dead) continue;
      m.t += dt;
      if (m.fuse < 0 && m.t > 0.4) {
        for (const t of this.tanks) {
          if (!t.alive || t.team === m.team || t.id === m.owner) continue;
          if (Math.hypot(t.x - m.x, t.y - m.y) < MINE_TRIGGER_R + t.r - TANK_R) { m.fuse = 0.55; break; }
        }
      }
      if (m.fuse >= 0) {
        m.fuse -= dt;
        if (m.fuse <= 0) this.explodeMine(m);
      } else if (m.t >= MINE_FUSE) this.explodeMine(m);
    }
    this.mines = this.mines.filter((m) => !m.dead);
  }

  explodeMine(m: Mine) {
    if (m.dead) return;
    m.dead = true;
    this.events.push(['mboom', r2(m.x), r2(m.y)]);
    const owner = this.tankById(m.owner);
    for (const t of this.tanks) {
      if (t.alive && Math.hypot(t.x - m.x, t.y - m.y) < MINE_BLAST + t.r * 0.4) this.killTank(t, owner);
    }
    for (const b of this.bullets) {
      if (!b.dead && Math.hypot(b.x - m.x, b.y - m.y) < MINE_BLAST) b.dead = true;
    }
    for (const o of this.mines) {
      if (!o.dead && o !== m && Math.hypot(o.x - m.x, o.y - m.y) < MINE_BLAST + 0.3) {
        if (o.fuse < 0 || o.fuse > 0.12) o.fuse = 0.12;
      }
    }
    const minX = Math.floor(m.x - MINE_BLAST - 1), maxX = Math.floor(m.x + MINE_BLAST + 1);
    const minY = Math.floor(m.y - MINE_BLAST - 1), maxY = Math.floor(m.y + MINE_BLAST + 1);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (tileAt(this.tiles, cx, cy) !== Tile.Cork) continue;
        if (Math.hypot(cx + 0.5 - m.x, cy + 0.5 - m.y) < MINE_BLAST + 0.35) {
          this.tiles[cy * W + cx] = Tile.Empty;
          this.events.push(['block', cx, cy]);
        }
      }
    }
  }

  killTank(t: Tank, killer: Tank | undefined) {
    if (!t.alive || t.buffs.invuln > 0) return;
    if (t.hp > 1) {
      // tough tanks (the boss) soak up hits, with a short grace so one blast counts once
      t.hp--;
      t.buffs.invuln = 0.25;
      this.events.push(['hurt', r2(t.x), r2(t.y), t.id, t.hp, t.maxHp]);
      if (t.boss && t.hp <= t.maxHp / 2) this.enrage(t);
      return;
    }
    if (t.buffs.shield) {
      t.buffs.shield = false;
      t.buffs.invuln = 0.5;
      this.events.push(['shield', r2(t.x), r2(t.y), t.id]);
      return;
    }
    t.alive = false;
    this.events.push(['boom', r2(t.x), r2(t.y), t.id]);
    this.onKill?.(t, killer);
  }

  tankById(id: number) {
    return this.tanks.find((t) => t.id === id);
  }

  aliveCount(team: number) {
    return this.tanks.filter((t) => t.alive && t.team === team).length;
  }

  netTanks(): NetTank[] {
    return this.tanks.map((t): NetTank => {
      const n: NetTank = [t.id, r2(t.x), r2(t.y), r2(t.body), r2(t.turret), (t.alive ? 1 : 0) | (t.spec.invisible && !this.frozen ? 2 : 0) | this.buffFlags(t)];
      if (t.maxHp > 1) n.push(t.hp);
      return n;
    });
  }
  buffFlags(t: Tank) {
    const b = t.buffs;
    return (b.shield ? BONUS_INFO.shield.flag : 0) | (b.turbo > 0 ? BONUS_INFO.turbo.flag : 0)
      | (b.bounce > 0 ? BONUS_INFO.bounce.flag : 0) | (b.fan > 0 ? BONUS_INFO.fan.flag : 0)
      | (t.boss && t.boss.warn > 0 ? FLAG_CHARGING : 0) | (t.boss?.rage ? FLAG_RAGE : 0) | (this.night && t.alert ? FLAG_ALERT : 0);
  }
  netBonuses(): NetBonus[] {
    return this.bonuses.map((c) => [c.id, c.x, c.y, BONUS_KINDS.indexOf(c.kind), c.t > BONUS_LIFE - 3 ? 1 : 0]);
  }
  netBullets(): NetBullet[] {
    return this.bullets.map((b) => [b.id, r2(b.x), r2(b.y), r2(b.vx), r2(b.vy), b.rocket ? 1 : 0, b.owner]);
  }
  netMines(): NetMine[] {
    return this.mines.map((m) => [m.id, r2(m.x), r2(m.y), m.fuse >= 0 || m.t > MINE_FUSE - 2.5 ? 1 : 0]);
  }

  // -------------------------------------------------------------- AI

  /** First tank a shot fired at `ang` from tank t would hit (or undefined). */
  traceShot(t: Tank, ang: number, bounces: number): { hit?: Tank; len: number } {
    const tip = t.r + 0.22;
    const sx = t.x + Math.cos(ang) * tip, sy = t.y + Math.sin(ang) * tip;
    if (bulletBlocked(this.tiles, sx, sy, BULLET_R)) return { len: 0 };
    const segs = castRicochet(this.tiles, sx, sy, ang, bounces, 45);
    let acc = 0;
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      let best: Tank | undefined, bestT = 2;
      for (const o of this.tanks) {
        if (!o.alive) continue;
        if (o === t && si === 0) continue;
        const u = segCircle(s, o.x, o.y, o.r + BULLET_R + 0.04);
        if (u >= 0 && u < bestT) { bestT = u; best = o; }
      }
      // mines also stop bullets: shooting into a mine near us is bad, near foes is fine
      const segLen = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
      if (best) return { hit: best, len: acc + segLen * bestT };
      acc += segLen;
    }
    return { len: acc };
  }

  /** Can tank t make out tank o? Always by day; at night only up close, or right after o fired. */
  canSee(t: Tank, o: Tank) {
    if (!this.night || o.team === t.team || o.reveal > 0) return true;
    const d = NIGHT_SIGHT + o.r;
    return (o.x - t.x) ** 2 + (o.y - t.y) ** 2 < d * d;
  }

  private nearestFoe(t: Tank): Tank | undefined {
    let best: Tank | undefined, bd = Infinity;
    for (const o of this.tanks) {
      if (!o.alive || o.team === t.team || !this.canSee(t, o)) continue;
      const d = Math.hypot(o.x - t.x, o.y - t.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  private updateAI(t: Tank) {
    const ai = t.ai!;
    const spec = t.spec;
    ai.think -= DT;
    ai.mineCd -= DT;
    ai.hesitate -= DT;
    const foe = this.nearestFoe(t);
    t.alert = !!foe;
    if (!foe) {
      if (this.night && this.tanks.some((o) => o.alive && o.team !== t.team)) this.aiProwl(t);
      return;
    }
    ai.seenX = foe.x; ai.seenY = foe.y; ai.seenT = 5;
    // the boss holds still (and holds its fire) while its volley charges
    if (t.boss && t.boss.warn > 0) { t.turret += DT * 2.5; return; }

    if (ai.think <= 0) {
      ai.think = spec.skill >= 2 ? 0.18 : 0.3;
      this.aiThinkAim(t, foe);
      if (spec.mines > 0 && ai.mineCd <= 0 && this.ownMines(t) < spec.mines) {
        const d = Math.hypot(foe.x - t.x, foe.y - t.y);
        const allyNear = this.tanks.some((o) => o.alive && o !== t && o.team === t.team && Math.hypot(o.x - t.x, o.y - t.y) < MINE_BLAST + 0.6);
        if (!allyNear && (d < 6 ? Math.random() < 0.35 : Math.random() < 0.06)) {
          if (this.tryMine(t)) {
            ai.mineCd = 3 + Math.random() * 4;
            ai.path = [];
            ai.pathT = 0;
          }
        }
      }
    }

    // turret
    if (!ai.aimValid && spec.skill === 0) {
      ai.wanderT -= DT;
      if (ai.wanderT <= 0) {
        ai.wanderT = 1 + Math.random() * 2;
        ai.wanderAim = Math.atan2(foe.y - t.y, foe.x - t.x) + (Math.random() - 0.5) * 2.2;
      }
      ai.aim = ai.wanderAim;
    }
    t.turret = rotateToward(t.turret, ai.aim, spec.turretSpeed * DT);

    // fire
    if (t.fireCd <= 0 && ai.hesitate <= 0 && this.ownBullets(t) < spec.maxBullets) {
      const aligned = spec.skill === 0 || Math.abs(angDiff(t.turret, ai.aim)) < 0.06;
      const res = aligned ? this.traceShot(t, t.turret, spec.bounces) : undefined;
      if (res?.hit && res.hit.team !== t.team && this.canSee(t, res.hit)) {
        if (!ai.locked) {
          // spotted a shot: take a human-ish moment before pulling the trigger
          ai.locked = true;
          ai.hesitate = spec.reaction * (0.6 + Math.random() * 0.8);
        } else {
          const aim = t.turret;
          t.turret += (Math.random() * 2 - 1) * spec.aimError;
          this.tryFire(t);
          t.turret = aim;
          ai.locked = false;
          ai.hesitate = 0.2 + Math.random() * 0.4;
        }
      } else if (aligned) {
        ai.locked = false;
      }
    }

    if (spec.speed > 0) this.aiMove(t, foe);
  }

  /** Night, nobody in sight: sweep the turret and creep toward the last sighting, or prowl around. */
  private aiProwl(t: Tank) {
    const ai = t.ai!;
    if (t.boss && t.boss.warn > 0) { t.turret += DT * 2.5; return; }
    ai.locked = false;
    ai.aimValid = false;
    ai.seenT -= DT;
    ai.prowlT -= DT;
    let spot: Pt;
    if (ai.seenT > 0) spot = { x: ai.seenX, y: ai.seenY };
    else {
      if (ai.prowlT <= 0) {
        // it can hear engines somewhere out there: head roughly toward a random foe
        const foes = this.tanks.filter((o) => o.alive && o.team !== t.team);
        const f = foes[Math.floor(Math.random() * foes.length)];
        ai.prowlT = 3 + Math.random() * 3;
        ai.prowlX = Math.max(1, Math.min(W - 1, f.x + (Math.random() - 0.5) * 8));
        ai.prowlY = Math.max(1, Math.min(H - 1, f.y + (Math.random() - 0.5) * 8));
      }
      spot = { x: ai.prowlX, y: ai.prowlY };
    }
    ai.wanderT -= DT;
    if (ai.wanderT <= 0) {
      ai.wanderT = 0.8 + Math.random() * 1.4;
      ai.wanderAim = Math.atan2(spot.y - t.y, spot.x - t.x) + (Math.random() - 0.5) * 2.4;
    }
    t.turret = rotateToward(t.turret, ai.wanderAim, t.spec.turretSpeed * 0.6 * DT);
    if (t.spec.speed > 0) this.aiMove(t, spot);
  }

  private aiThinkAim(t: Tank, foe: Tank) {
    const ai = t.ai!;
    const spec = t.spec;
    if (spec.skill === 0) { ai.aimValid = false; return; }
    const foes = this.tanks.filter((o) => o.alive && o.team !== t.team && this.canSee(t, o));
    let bestAng = 0, bestScore = -Infinity;
    const tryAng = (ang: number, bias: number) => {
      const res = this.traceShot(t, ang, spec.bounces);
      if (!res.hit || res.hit.team === t.team) return;
      const turn = Math.abs(angDiff(t.turret, ang));
      const score = bias - res.len * 0.08 - turn * 0.6;
      if (score > bestScore) { bestScore = score; bestAng = ang; }
    };
    for (const f of foes) {
      tryAng(Math.atan2(f.y - t.y, f.x - t.x), 1);
    }
    if (spec.bounces > 0 && (spec.skill >= 2 || Math.random() < 0.5)) {
      const n = spec.skill >= 2 ? 64 : 24;
      const off = Math.random() * ((Math.PI * 2) / n);
      for (let i = 0; i < n; i++) tryAng(off + (i * Math.PI * 2) / n, 0);
    }
    if (bestScore > -Infinity) {
      // fine-tune around the best angle so ricochets graze less
      if (spec.skill >= 3) for (const d of [-0.03, 0.03]) tryAng(bestAng + d, 0);
      ai.aim = bestAng + (spec.skill >= 3 ? 0 : (Math.random() - 0.5) * 0.04);
      ai.aimValid = true;
    } else {
      ai.aimValid = false;
      ai.aim = Math.atan2(foe.y - t.y, foe.x - t.x) + (Math.random() - 0.5) * 0.6;
    }
  }

  private aiMove(t: Tank, foe: Pt) {
    const ai = t.ai!;
    // threats: incoming bullets
    let ax = 0, ay = 0, threat = false;
    for (const b of this.bullets) {
      const rx = t.x - b.x, ry = t.y - b.y;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      const tt = (rx * b.vx + ry * b.vy) / v2;
      // simple tanks notice incoming shots late (and not every time)
      const notice = t.spec.skill >= 2 ? 0.9 : 0.5;
      if (tt <= 0 || tt > notice) continue;
      if (t.spec.skill < 2 && (b.id + t.id) % 3 === 0) continue;
      const cx = rx - b.vx * tt, cy = ry - b.vy * tt;
      const d = Math.hypot(cx, cy);
      if (d > t.r + 0.55) continue;
      threat = true;
      if (d < 1e-3) { ax += -b.vy; ay += b.vx; } else { ax += (cx / d) * (1.2 - tt); ay += (cy / d) * (1.2 - tt); }
    }
    for (const m of this.mines) {
      const dx = t.x - m.x, dy = t.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d < MINE_BLAST + 0.7) { threat = true; ax += dx / (d + 0.01) * 1.5; ay += dy / (d + 0.01) * 1.5; }
    }
    if (threat) {
      const l = Math.hypot(ax, ay) || 1;
      ai.dodgeX = ax / l; ai.dodgeY = ay / l; ai.dodgeT = 0.25;
      ai.path = [];
    }
    if (ai.dodgeT > 0) {
      ai.dodgeT -= DT;
      this.driveTank(t, ai.dodgeX, ai.dodgeY, DT);
      return;
    }

    ai.pathT -= DT;
    if (ai.path.length === 0 || ai.pathT <= 0) {
      this.aiPlan(t, foe);
      ai.pathT = 2 + Math.random() * 2.5;
    }
    if (ai.path.length) {
      const c = ai.path[0];
      const tx = (c % W) + 0.5, ty = Math.floor(c / W) + 0.5;
      const dx = tx - t.x, dy = ty - t.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.3) ai.path.shift();
      else this.driveTank(t, dx / d, dy / d, DT);
    }
    ai.stuckT += DT;
    if (ai.stuckT > 1) {
      if (Math.hypot(t.x - ai.lastX, t.y - ai.lastY) < 0.15 && ai.path.length) ai.path = [];
      ai.stuckT = 0; ai.lastX = t.x; ai.lastY = t.y;
    }
  }

  private aiPlan(t: Tank, foe: Pt) {
    const ai = t.ai!;
    const start = Math.floor(t.y) * W + Math.floor(t.x);
    const blocked = new Uint8Array(W * H);
    // portals are left out of the plans: tanks that slip into one simply replan from the other side
    for (let i = 0; i < W * H; i++) if (isSolidTank(this.tiles[i]) || (isPortal(this.tiles[i]) && i !== start && i !== ai.goal)) blocked[i] = 1;
    if (t.r > 0.45) {
      // big tanks only fit through cells whose neighbours are all free
      const solid = blocked.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (solid[y * W + x]) continue;
        for (let dy = -1; dy <= 1 && !blocked[y * W + x]; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || solid[ny * W + nx]) { blocked[y * W + x] = 1; break; }
        }
      }
    }
    for (const m of this.mines) {
      for (let cy = Math.floor(m.y - 2); cy <= Math.floor(m.y + 2); cy++)
        for (let cx = Math.floor(m.x - 2); cx <= Math.floor(m.x + 2); cx++)
          if (cx >= 0 && cy >= 0 && cx < W && cy < H && Math.hypot(cx + 0.5 - m.x, cy + 0.5 - m.y) < MINE_BLAST + 0.4) blocked[cy * W + cx] = 1;
    }
    const prev = new Int32Array(W * H).fill(-2);
    const dist = new Int32Array(W * H);
    prev[start] = -1;
    const q = [start];
    const reach: number[] = [];
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (dist[c] > (ai.goal !== undefined ? 40 : 9)) continue;
      if (dist[c] <= 9) reach.push(c);
      const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (prev[n] !== -2 || blocked[n]) continue;
        if (dx && dy && (blocked[y * W + nx] || blocked[ny * W + x])) continue;
        prev[n] = c;
        dist[n] = dist[c] + 1;
        q.push(n);
      }
    }
    if (reach.length < 2) { ai.path = []; return; }
    let best = -1, bestScore = -Infinity;
    if (ai.goal !== undefined && prev[ai.goal] !== -2 && ai.goal !== start) best = ai.goal;
    // AI-driven player tanks (demo) love bonus crates
    if (best < 0 && t.kind === 'player' && this.bonuses.length && Math.random() < 0.8) {
      for (const c of this.bonuses) {
        const cell = Math.floor(c.y) * W + Math.floor(c.x);
        if (prev[cell] === -2 || dist[cell] > 9) continue;
        if (best < 0 || dist[cell] < dist[best]) best = cell;
      }
    }
    if (best < 0) {
      for (let k = 0; k < 14; k++) {
        const c = reach[1 + Math.floor(Math.random() * (reach.length - 1))];
        const cx = (c % W) + 0.5, cy = Math.floor(c / W) + 0.5;
        const df = Math.hypot(foe.x - cx, foe.y - cy);
        let score = -Math.abs(df - ai.prefDist) + Math.random() * 2.5 + Math.min(dist[c], 6) * 0.15;
        for (const m of this.mines) score += Math.min(4, Math.hypot(m.x - cx, m.y - cy)) * 0.8;
        for (const o of this.tanks) if (o.alive && o !== t && o.team === t.team && Math.hypot(o.x - cx, o.y - cy) < 1.5) score -= 2;
        if (score > bestScore) { bestScore = score; best = c; }
      }
    }
    const path: number[] = [];
    for (let c = best; c !== -1 && c !== start; c = prev[c]) path.push(c);
    path.reverse();
    ai.path = path;
  }
}
