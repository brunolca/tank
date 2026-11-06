import {
  BELT_DIRS, BELT_SPEED, BOLT_EVERY, BOLT_FLASH, DRILL_BLAST, DRILL_DIG_EVERY, DRILL_DIG_WARN, DRILL_RING_SHOTS, DRILL_RISE_WARN, DRILL_UNDER_MAX, DRILL_UNDER_SPEED, FLAG_BURROW, MASON_EVERY, MASON_FIRST, MASON_MAX, MASON_REACH, BOLT_R, BOLT_WARN, BONUS_INFO, BONUS_KINDS, BONUS_LIFE, BONUS_R, BOSS_VOLLEY_EVERY, BOSS_VOLLEY_SHOTS, BOSS_VOLLEY_WARN, BULLET_R, BULLET_SPEED, BonusKind, DT,
  FAN_SPREAD, FLAG_ALERT, FLAG_CHARGING, FLAG_RAGE, H, NIGHT_REVEAL, NIGHT_SIGHT, MINE_BLAST, PORTAL_MAX_R, MINE_FUSE, MINE_R, MINE_TRIGGER_R, ROCKET_SPEED, SPECS, STEEL_STRIPPED, SUBSTEPS, TANK_R, THIEF_CRATE_RUSH, THIEF_REACH, TURBO_MULT,
  TankKind, TankSpec, THUNDER_EVERY, THUNDER_MAX, THUNDER_PER_FOE, THUNDER_WARN, Tile, TUNNEL_SIGHT, isBossKind, W, Weapon, isPortal, isSolidTank, isTunnel, playerSpec,
} from './constants';
import { angDiff, beltStep, bulletBlocked, castRicochet, moveCircle, resolveCircle, rotateToward, segCircle, tileAt, warpTarget } from './physics';
import type { GameEvent, Input, NetBonus, NetBullet, NetMine, NetTank, TankInfo } from './protocol';
import { BIG_BLAST, LONG_BUFFS, RESHIELD_SECONDS, totalRanks, trainSpec, type Ranks } from './skills';

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
  weapon?: Weapon; // player tanks: the cannon picked in the lobby (canon when omitted)
  build?: MasonState; // the Maçon (iteration 12)
  loot?: BonusKind; // the Pilleur (iteration 15): the last bonus it stole, dropped when it is destroyed
  ranks?: Ranks; // player tanks in the coop campaign (iteration 19): skills bought with galons
  follow?: { id: number; t: number }; // an AI teammate answering « Suis-moi ! » (iteration 20): the leader's tank id, seconds left
  reshield?: number; // « Bouclier qui revient »: seconds until the broken shield grows back
}

/** The Maçon: when it lays its next block, and the cells of the blocks it laid. */
export interface MasonState {
  t: number;
  cells: number[];
}

/** The boss: a radial volley every few seconds (announced by a glow), and a rage mode at half health. */
export interface BossState {
  volleyT: number;
  warn: number; // > 0 while the warning glow is on
  spin: number;
  rage: boolean;
  // the Foreur (iteration 11): 0 on the surface, 1 spinning up, 2 under the table, 3 about to burst out
  dig: number;
  digT: number; // seconds left in the current dig phase (or until the next dive, on the surface)
  tx: number; // under the table: where it is heading
  ty: number;
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
  volley?: number; // shells fired together (fan shot) never collide with one another
  cork?: boolean; // « Brise-liège » (iteration 19): the shell blows up the cork it hits instead of bouncing off it
}

/** A lightning strike announced on the floor (storm missions): it falls when t reaches BOLT_WARN. */
export interface Bolt {
  x: number;
  y: number;
  t: number;
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
  blast?: number; // radius of its blast (MINE_BLAST when omitted; « Grand souffle » makes it wider)
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
  escape?: number; // direction to leave a mine just laid (iteration 13)
}

type Pt = { x: number; y: number };

const PREF_DIST: Partial<Record<TankKind, number>> = {
  ash: 6, marine: 7, yellow: 5, pink: 5, violet: 4, white: 4.5, black: 3.5, steel: 6, mason: 4.5, thief: 3.5,
};

export type KillCb = (victim: Tank, killer: Tank | undefined) => void;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The Foreur under the table: out of reach of shells, mines, lightning and other tanks. */
export const under = (t: Tank) => !!t.boss && t.boss.dig >= 2;
/** « Suis-moi ! » (iteration 20): how long AI teammates stick to the player who called them, and how close they come. */
export const RALLY_SECONDS = 9;
export const RALLY_NEAR = 2.6;

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
  /** Extra bounces for every player shell (the « Ricochets fous » daily twist). */
  playerBounces = 0;
  /** Storm: lightning strikes fall on the table every few seconds (announced first). The room stops new ones once a mission is decided. */
  storm = false;
  stormNext = 3.5 + Math.random() * 1.5;
  bolts: Bolt[] = [];
  /** Seconds left of the last lightning flash: the whole table is lit (the AI sees everyone, even at night). */
  flash = 0;
  /** Conveyor belts (iteration 16): one code per cell (0 none, 1 right, 2 left, 3 up, 4 down), empty when the map has none. */
  belts: number[] = [];
  tick = 0;
  frozen = true;
  private nextId = 1;
  onKill?: KillCb;

  constructor(tiles: number[], belts?: number[]) {
    this.tiles = tiles.slice();
    if (belts?.some(Boolean)) this.belts = belts.slice();
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
    if (isBossKind(kind)) t.boss = { volleyT: kind === 'thunder' ? 4 : 5, warn: 0, spin: 0, rage: false, dig: 0, digT: kind === 'drill' ? 4 : 0, tx: x, ty: y };
    if (kind === 'mason') t.build = { t: MASON_FIRST + Math.random(), cells: [] };
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

  /** Hand a player tank the cannon its driver picked in the lobby. */
  arm(t: Tank, weapon: Weapon) {
    t.weapon = weapon === 'canon' ? undefined : weapon;
    t.spec = playerSpec(weapon);
  }

  /** Skills bought in the campaign skill tree (iteration 19), on top of the cannon: call after `arm`. */
  train(t: Tank, r: Ranks | undefined) {
    if (!r || !totalRanks(r)) { t.ranks = undefined; return; }
    t.ranks = [r[0], r[1], r[2]];
    t.spec = trainSpec(t.spec, r);
    if (r[2] >= 1) t.buffs.shield = true; // « Bouclier de départ »
  }

  tankInfos(): TankInfo[] {
    return this.tanks.map((t) => ({ id: t.id, kind: t.kind, team: t.team, pid: t.pid, name: t.name, color: t.color, hp: t.maxHp > 1 ? t.maxHp : undefined, w: t.weapon, sk: t.ranks }));
  }

  /** Set a tough tank's hit points (the room scales the boss with the number of players). */
  setHp(t: Tank, hp: number, maxHp = hp) {
    t.maxHp = Math.max(1, Math.round(maxHp));
    t.hp = Math.max(1, Math.min(t.maxHp, Math.round(hp)));
    if (t.boss && t.hp <= t.maxHp / 2) this.enrage(t, false);
    if (t.kind === 'steel' && t.hp < t.maxHp) this.strip(t);
  }

  /** A steel tank loses its armour: lighter and faster from now on. */
  strip(t: Tank) {
    t.spec = { ...SPECS.steel, ...STEEL_STRIPPED };
    if (t.ai) t.ai.prefDist = 3.5; // and it closes in
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
      if (t.reshield !== undefined && !bf.shield) {
        t.reshield -= DT;
        if (t.reshield <= 0) {
          // « Bouclier qui revient »: the shield grows back (shown like a picked-up one)
          t.reshield = undefined;
          bf.shield = true;
          this.events.push(['bonus', r2(t.x), r2(t.y), BONUS_KINDS.indexOf('shield'), t.id]);
        }
      }
      if (t.boss && t.kind === 'drill') {
        if (this.updateDrill(t)) continue; // spinning up or under the table: no driving, no shooting
      } else if (t.boss) this.updateBoss(t);
      if (t.build) this.updateMason(t);
      if (t.ai) {
        this.updateAI(t);
        this.rideBelt(t);
      } else if (t.pid) {
        const inp = inputs.get(t.pid);
        if (inp) { this.applyInput(t, inp); this.rideBelt(t); } // same order as the client prediction: drive, then the belt
      }
    }
    this.separateTanks();
    const sdt = DT / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.stepBullets(sdt);
    this.stepMines(DT);
    if (this.storm || this.bolts.length || this.flash > 0) this.stepStorm(DT);
    if (this.bonusOn) this.stepBonuses(DT);
  }

  // -------------------------------------------------------------- storm

  stepStorm(dt: number) {
    if (this.flash > 0) this.flash -= dt;
    // the Grondeur owns the sky while it stands: the storm only strikes where it calls (iteration 18)
    if (this.storm && !this.tanks.some((t) => t.alive && t.kind === 'thunder')) {
      this.stormNext -= dt;
      if (this.stormNext <= 0) {
        const [a, b] = BOLT_EVERY;
        this.stormNext = a + Math.random() * (b - a);
        this.spawnBolt();
      }
    }
    for (const bo of this.bolts) {
      bo.t += dt;
      if (bo.t >= BOLT_WARN) this.strike(bo);
    }
    this.bolts = this.bolts.filter((bo) => bo.t < BOLT_WARN);
  }

  /** Announce a strike: usually close to a tank (anyone's, so it can help as well as hurt), sometimes anywhere. */
  spawnBolt(at?: { x: number; y: number }): Bolt | undefined {
    const alive = this.tanks.filter((t) => t.alive);
    for (let tries = 0; tries < 40; tries++) {
      let x: number, y: number;
      if (at && tries === 0) { x = at.x; y = at.y; }
      else if (alive.length && Math.random() < 0.7) {
        const t = alive[Math.floor(Math.random() * alive.length)];
        const a = Math.random() * Math.PI * 2, d = 0.5 + Math.random() * 1.9;
        x = t.x + Math.cos(a) * d; y = t.y + Math.sin(a) * d;
      } else {
        x = 1 + Math.random() * (W - 2); y = 1 + Math.random() * (H - 2);
      }
      const bo = this.boltAt(x, y);
      if (bo) return bo;
    }
    return undefined;
  }

  /** Announce a strike right there, unless the spot is a wall, a tunnel roof or too close to another strike. */
  boltAt(x: number, y: number, gap = BOLT_R * 2): Bolt | undefined {
    // rounded first: the announced spot is the one checked (a strike at 4.998 used to be sent as 5.00, on the wall next door)
    x = r2(Math.max(0.6, Math.min(W - 0.6, x))); y = r2(Math.max(0.6, Math.min(H - 0.6, y)));
    const tile = tileAt(this.tiles, Math.floor(x), Math.floor(y));
    if (tile === Tile.Wall || tile === Tile.Tall || tile === Tile.Tunnel) return undefined;
    if (this.bolts.some((o) => Math.hypot(o.x - x, o.y - y) < gap)) return undefined;
    const bo: Bolt = { x, y, t: 0 };
    this.bolts.push(bo);
    this.events.push(['zap', bo.x, bo.y, BOLT_WARN]);
    return bo;
  }

  /** The lightning falls: tanks, shells and cork in reach are gone, mines go off, and the whole table lights up. */
  strike(bo: Bolt) {
    this.events.push(['bolt', bo.x, bo.y]);
    this.flash = BOLT_FLASH;
    for (const t of this.tanks) {
      // a tank hiding in a tunnel is under a roof (iteration 13); the Grondeur's lightning rod takes the hit for it (iteration 18)
      if (t.alive && !this.inTunnel(t) && t.kind !== 'thunder' && Math.hypot(t.x - bo.x, t.y - bo.y) < BOLT_R + t.r * 0.4) this.killTank(t, undefined);
    }
    for (const b of this.bullets) {
      if (!b.dead && Math.hypot(b.x - bo.x, b.y - bo.y) < BOLT_R) b.dead = true;
    }
    for (const m of this.mines) {
      if (!m.dead && Math.hypot(m.x - bo.x, m.y - bo.y) < BOLT_R + 0.3 && (m.fuse < 0 || m.fuse > 0.12)) m.fuse = 0.12;
    }
    for (let cy = Math.floor(bo.y - 2); cy <= Math.floor(bo.y + 2); cy++) {
      for (let cx = Math.floor(bo.x - 2); cx <= Math.floor(bo.x + 2); cx++) {
        if (tileAt(this.tiles, cx, cy) !== Tile.Cork) continue;
        if (Math.hypot(cx + 0.5 - bo.x, cy + 0.5 - bo.y) < BOLT_R + 0.35) {
          this.tiles[cy * W + cx] = Tile.Empty;
          this.events.push(['block', cx, cy]);
        }
      }
    }
  }

  // -------------------------------------------------------------- bonus crates

  stepBonuses(dt: number) {
    // a Pilleur on the table: crates fall faster, there is something to race for (iteration 15)
    this.bonusNext -= this.tanks.some((t) => t.alive && t.kind === 'thief') ? dt * THIEF_CRATE_RUSH : dt;
    if (this.bonusNext <= 0) {
      const [a, b] = this.bonusEvery;
      this.bonusNext = a + Math.random() * (b - a);
      if (this.bonuses.length < this.bonusCap) this.spawnBonus();
    }
    for (const c of this.bonuses) {
      c.t += dt;
      if (c.t >= BONUS_LIFE) { c.dead = true; continue; }
      if (c.t < 0.5) continue; // still dropping in
      if (this.belts.length) [c.x, c.y] = beltStep(this.tiles, this.belts, c.x, c.y, BONUS_R, dt); // and so do the crates
      for (const t of this.tanks) {
        if (!t.alive || (t.kind !== 'player' && t.kind !== 'thief')) continue;
        const rr = TANK_R + BONUS_R;
        if ((t.x - c.x) ** 2 + (t.y - c.y) ** 2 < rr * rr) {
          c.dead = true;
          this.giveBonus(t, c.kind);
          if (t.kind === 'thief') t.loot = c.kind;
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
      // the Pilleurs hear it fall and turn towards it
      for (const o of this.tanks) if (o.alive && o.kind === 'thief' && o.ai) o.ai.pathT = Math.min(o.ai.pathT, 0.4);
      return c;
    }
    return undefined;
  }

  giveBonus(t: Tank, kind: BonusKind) {
    if (kind === 'shield') t.buffs.shield = true;
    else t.buffs[kind] = BONUS_INFO[kind].duration * (t.ranks && t.ranks[2] >= 2 ? LONG_BUFFS : 1);
  }

  speedOf(t: Tank) {
    return t.spec.speed * (t.buffs.turbo > 0 ? TURBO_MULT : 1);
  }

  // -------------------------------------------------------------- boss

  updateBoss(t: Tank) {
    const bs = t.boss!;
    const thunder = t.kind === 'thunder';
    if (bs.warn > 0) {
      bs.warn -= DT;
      if (bs.warn <= 0) { if (thunder) this.thunderCall(t); else this.bossVolley(t); }
      return;
    }
    bs.volleyT -= DT;
    if (bs.volleyT <= 0) {
      // the Grondeur only raises its rod when someone is out there to strike
      if (thunder && !this.tanks.some((o) => o.alive && o.team !== t.team && !under(o))) { bs.volleyT = 0.5; return; }
      bs.warn = thunder ? THUNDER_WARN : BOSS_VOLLEY_WARN;
      bs.volleyT = (thunder ? THUNDER_EVERY : BOSS_VOLLEY_EVERY)[bs.rage ? 1 : 0] * (0.85 + Math.random() * 0.3);
    }
  }

  /**
   * The Grondeur (iteration 18) calls the lightning: a strike announced under each foe (a little off the mark),
   * and enraged a second one where the foe is heading. Strikes fall BOLT_WARN later, like the storm's: there is time to run.
   */
  thunderCall(t: Tank) {
    const per = THUNDER_PER_FOE[t.boss!.rage ? 1 : 0];
    const foes = this.tanks.filter((o) => o.alive && o.team !== t.team && !under(o));
    let n = 0;
    for (const f of foes) {
      for (let k = 0; k < per && n < THUNDER_MAX; k++) {
        for (let tries = 0; tries < 6; tries++) {
          const a = Math.random() * Math.PI * 2, off = tries ? 0.4 + Math.random() * 1.2 : Math.random() * 0.45;
          const lead = k ? 1.9 : 0; // ahead along its hull
          const x = f.x + Math.cos(f.body) * lead + Math.cos(a) * off, y = f.y + Math.sin(f.body) * lead + Math.sin(a) * off;
          if (Math.hypot(x - t.x, y - t.y) < t.r + 0.5) continue; // never right on itself
          if (this.boltAt(x, y, BOLT_R * 1.4)) { n++; break; }
        }
      }
    }
    if (n) this.events.push(['call', r2(t.x), r2(t.y), t.id, n]);
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
    if (t.kind === 'drill' && t.boss.dig === 0) t.boss.digT = Math.min(t.boss.digT, 2);
    if (loud) {
      t.boss.volleyT = Math.min(t.boss.volleyT, 1.5);
      this.events.push(['rage', r2(t.x), r2(t.y), t.id]);
    }
  }

  // -------------------------------------------------------------- the Foreur (iteration 11)

  /**
   * The digging boss. On the surface it fights like a tank and drills through cork; every few seconds it
   * spins up, goes under the table, burrows toward a foe, makes the ground shake where it will come out,
   * then bursts out: everything in reach is blown away. Returns true when the AI must not drive it this tick.
   */
  updateDrill(t: Tank): boolean {
    const bs = t.boss!;
    const k = bs.rage ? 1 : 0;
    bs.digT -= DT;
    if (bs.dig === 0) {
      this.drillCork(t);
      const foes = this.tanks.some((o) => o.alive && o.team !== t.team);
      if (bs.digT <= 0 && foes) {
        bs.dig = 1;
        bs.digT = DRILL_DIG_WARN;
      }
      return false;
    }
    if (bs.dig === 1) {
      t.turret += DT * 6;
      if (bs.digT <= 0) {
        bs.dig = 2;
        bs.digT = DRILL_UNDER_MAX[k];
        this.events.push(['dig', r2(t.x), r2(t.y), t.id]);
        if (t.ai) { t.ai.path = []; t.ai.dodgeT = 0; t.ai.locked = false; }
      }
      return true;
    }
    if (bs.dig === 2) {
      // burrow toward the nearest foe (it can feel the treads above), straight under walls and holes
      let foe: Tank | undefined, bd = Infinity;
      for (const o of this.tanks) {
        if (!o.alive || o.team === t.team || under(o)) continue;
        const d = Math.hypot(o.x - t.x, o.y - t.y);
        if (d < bd) { bd = d; foe = o; }
      }
      if (foe) { bs.tx = foe.x; bs.ty = foe.y; }
      const dx = bs.tx - t.x, dy = bs.ty - t.y, d = Math.hypot(dx, dy);
      const sp = DRILL_UNDER_SPEED[k] * DT;
      if (d > sp) { t.x += (dx / d) * sp; t.y += (dy / d) * sp; t.body = Math.atan2(dy, dx); }
      t.x = Math.max(1, Math.min(W - 1, t.x)); t.y = Math.max(1, Math.min(H - 1, t.y));
      t.turret += DT * 4;
      if (d < 0.45 || bs.digT <= 0) {
        const [cx, cy] = this.drillExit(t.x, t.y);
        bs.dig = 3;
        bs.digT = DRILL_RISE_WARN[k];
        bs.tx = cx; bs.ty = cy;
        this.events.push(['quake', r2(cx), r2(cy), DRILL_RISE_WARN[k], t.id]);
      }
      return true;
    }
    // dig === 3: slide to the exit spot while the ground shakes, then burst out
    const dx = bs.tx - t.x, dy = bs.ty - t.y, d = Math.hypot(dx, dy);
    const sp = 4 * DT;
    if (d > sp) { t.x += (dx / d) * sp; t.y += (dy / d) * sp; } else { t.x = bs.tx; t.y = bs.ty; }
    t.turret += DT * 4;
    if (bs.digT <= 0) {
      t.x = bs.tx; t.y = bs.ty;
      this.erupt(t);
      bs.dig = 0;
      bs.digT = DRILL_DIG_EVERY[k] * (0.9 + Math.random() * 0.25);
      t.fireCd = Math.max(t.fireCd, 0.8);
    }
    return true;
  }

  /** Nearest cell where the Foreur can come out: free (or cork, which the burst clears), with no wall, tall wall or hole around. */
  drillExit(x: number, y: number): [number, number] {
    const ok = (cx: number, cy: number) => {
      if (cx < 1 || cy < 1 || cx > W - 2 || cy > H - 2) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tl = this.tiles[(cy + dy) * W + cx + dx];
        if (tl === Tile.Wall || tl === Tile.Tall || tl === Tile.Hole || ((dx || dy) ? false : isPortal(tl) || tl === Tile.Tunnel)) return false;
      }
      return true;
    };
    const fx = Math.floor(x), fy = Math.floor(y);
    let best: [number, number] | undefined, bd = Infinity;
    for (let rad = 0; rad < 8 && !best; rad++) {
      for (let cy = fy - rad; cy <= fy + rad; cy++) for (let cx = fx - rad; cx <= fx + rad; cx++) {
        if (Math.max(Math.abs(cx - fx), Math.abs(cy - fy)) !== rad || !ok(cx, cy)) continue;
        const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
        if (d < bd) { bd = d; best = [cx + 0.5, cy + 0.5]; }
      }
    }
    return best ?? [W / 2, H / 2];
  }

  /** It bursts out of the table: tanks, shells and cork in reach are gone, mines go off; enraged, a ring of shells too. */
  erupt(t: Tank) {
    this.events.push(['erupt', r2(t.x), r2(t.y), t.id]);
    for (const o of this.tanks) {
      if (o !== t && o.alive && Math.hypot(o.x - t.x, o.y - t.y) < DRILL_BLAST + o.r * 0.4) this.killTank(o, t);
    }
    for (const b of this.bullets) if (!b.dead && Math.hypot(b.x - t.x, b.y - t.y) < DRILL_BLAST) b.dead = true;
    for (const m of this.mines) {
      if (!m.dead && Math.hypot(m.x - t.x, m.y - t.y) < DRILL_BLAST + 0.3 && (m.fuse < 0 || m.fuse > 0.12)) m.fuse = 0.12;
    }
    for (let cy = Math.floor(t.y - 2); cy <= Math.floor(t.y + 2); cy++) {
      for (let cx = Math.floor(t.x - 2); cx <= Math.floor(t.x + 2); cx++) {
        if (tileAt(this.tiles, cx, cy) !== Tile.Cork) continue;
        if (Math.hypot(cx + 0.5 - t.x, cy + 0.5 - t.y) < DRILL_BLAST + 0.35) {
          this.tiles[cy * W + cx] = Tile.Empty;
          this.events.push(['block', cx, cy]);
        }
      }
    }
    [t.x, t.y] = resolveCircle(this.tiles, t.x, t.y, t.r);
    if (t.boss!.rage) {
      const bs = t.boss!;
      bs.spin += 0.4 + Math.random() * 0.5;
      const tip = t.r + 0.2;
      for (let i = 0; i < DRILL_RING_SHOTS; i++) {
        const a = bs.spin + (i * Math.PI * 2) / DRILL_RING_SHOTS, dx = Math.cos(a), dy = Math.sin(a);
        const x = t.x + dx * tip, y = t.y + dy * tip;
        if (bulletBlocked(this.tiles, x, y, BULLET_R)) continue;
        const sp = BULLET_SPEED * 0.75;
        this.bullets.push({ id: this.nextId++, owner: t.id, x, y, vx: dx * sp, vy: dy * sp, bounces: 0, rocket: false, dead: false });
      }
    }
  }

  /** On the surface the Foreur grinds through any cork it touches. */
  drillCork(t: Tank) {
    const rr = t.r + 0.14;
    for (let cy = Math.floor(t.y - rr); cy <= Math.floor(t.y + rr); cy++) {
      for (let cx = Math.floor(t.x - rr); cx <= Math.floor(t.x + rr); cx++) {
        if (tileAt(this.tiles, cx, cy) !== Tile.Cork) continue;
        const nx = Math.max(cx, Math.min(cx + 1, t.x)), ny = Math.max(cy, Math.min(cy + 1, t.y));
        if ((nx - t.x) ** 2 + (ny - t.y) ** 2 < rr * rr) {
          this.tiles[cy * W + cx] = Tile.Empty;
          this.events.push(['block', cx, cy]);
        }
      }
    }
  }

  // -------------------------------------------------------------- the Maçon (iteration 12)

  /** Every few seconds the Maçon lays a cork block on its side of the line to its nearest foe: instant cover. */
  updateMason(t: Tank) {
    const st = t.build!;
    st.t -= DT;
    if (st.t > 0) return;
    st.t = 0.6; // nothing to do right now: look again shortly
    st.cells = st.cells.filter((c) => this.tiles[c] === Tile.Cork);
    if (st.cells.length >= MASON_MAX) return;
    const foe = this.nearestFoe(t);
    if (!foe) return;
    const cell = this.masonSpot(t, foe);
    if (cell < 0) return;
    this.tiles[cell] = Tile.Cork;
    st.cells.push(cell);
    const [a, b] = MASON_EVERY;
    st.t = a + Math.random() * (b - a);
    this.events.push(['build', cell % W, (cell / W) | 0, t.id]);
    if (t.ai) { t.ai.path = []; t.ai.pathT = 0; }
  }

  /** Best free cell for a cover block between the Maçon and a foe (-1 when none fits). */
  masonSpot(t: Tank, foe: Pt): number {
    let ux = foe.x - t.x, uy = foe.y - t.y;
    const ud = Math.hypot(ux, uy);
    if (ud < 1.6) return -1; // too close: no time for masonry
    ux /= ud; uy /= ud;
    const cand: [number, number][] = [];
    const R = Math.ceil(MASON_REACH);
    for (let cy = Math.floor(t.y) - R; cy <= Math.floor(t.y) + R; cy++) {
      for (let cx = Math.floor(t.x) - R; cx <= Math.floor(t.x) + R; cx++) {
        if (cx < 0 || cy < 0 || cx >= W || cy >= H || this.tiles[cy * W + cx] !== Tile.Empty) continue;
        const px = cx + 0.5 - t.x, py = cy + 0.5 - t.y;
        const along = px * ux + py * uy, perp = Math.abs(px * uy - py * ux);
        if (along < 0.7 || along > MASON_REACH || along > ud - 1.2 || perp > 1.6) continue;
        cand.push([cy * W + cx, -perp * 1.4 - Math.abs(along - 1.4) + Math.random() * 0.35]);
      }
    }
    cand.sort((p, q) => q[1] - p[1]);
    for (let i = 0; i < cand.length && i < 8; i++) if (this.canBuild(cand[i][0])) return cand[i][0];
    return -1;
  }

  /** A cell can take a block if nothing stands on it and closing it does not cut the table in two. */
  canBuild(cell: number): boolean {
    const cx = cell % W, cy = (cell / W) | 0;
    for (const o of this.tanks) {
      if (!o.alive || under(o)) continue;
      const nx = Math.max(cx, Math.min(cx + 1, o.x)), ny = Math.max(cy, Math.min(cy + 1, o.y));
      const rr = o.r + 0.2;
      if ((nx - o.x) ** 2 + (ny - o.y) ** 2 < rr * rr) return false;
    }
    const near = (x: number, y: number, d: number) => Math.abs(x - cx - 0.5) < d && Math.abs(y - cy - 0.5) < d;
    for (const b of this.bullets) if (!b.dead && near(b.x, b.y, 0.75)) return false;
    for (const m of this.mines) if (!m.dead && near(m.x, m.y, 0.9)) return false;
    for (const c of this.bonuses) if (!c.dead && near(c.x, c.y, 0.95)) return false;
    for (const bo of this.bolts) if (near(bo.x, bo.y, 0.6)) return false;
    // every open neighbour must still reach every other one once the cell is closed
    const open = (i: number) => this.tiles[i] === Tile.Empty || isPortal(this.tiles[i]) || isTunnel(this.tiles[i]);
    const nb: number[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && open(y * W + x)) nb.push(y * W + x);
    }
    if (nb.length <= 1) return nb.length === 1;
    const seen = new Uint8Array(W * H);
    seen[cell] = 1;
    seen[nb[0]] = 1;
    const q = [nb[0]];
    let found = 1;
    for (let qi = 0; qi < q.length && found < nb.length; qi++) {
      const c = q[qi], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (seen[n] || !open(n)) continue;
        seen[n] = 1;
        if (nb.includes(n)) found++;
        q.push(n);
      }
    }
    return found === nb.length;
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

  /** A conveyor belt under the tank carries it along (iteration 16). */
  rideBelt(t: Tank) {
    if (!this.belts.length || !t.alive) return;
    const px = t.x, py = t.y;
    [t.x, t.y] = beltStep(this.tiles, this.belts, t.x, t.y, t.r, DT);
    if ((t.x - px) ** 2 + (t.y - py) ** 2 > 1) {
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
    const bounces = t.spec.bounces + (t.buffs.bounce > 0 ? 1 : 0) + (t.kind === 'player' ? this.playerBounces : 0);
    const cork = t.ranks && t.ranks[0] >= 3 ? true : undefined;
    const main: Bullet = { id: this.nextId++, owner: t.id, x, y, vx: dx * sp, vy: dy * sp, bounces, rocket: t.spec.rocket, dead: false, cork };
    this.bullets.push(main);
    if (t.buffs.fan > 0) {
      main.volley = main.id;
      // two extra shells on each side of the main one (they may push past the ammo cap)
      for (const da of [-FAN_SPREAD, FAN_SPREAD]) {
        const a = t.turret + da, ex = Math.cos(a), ey = Math.sin(a);
        const fx = t.x + ex * tip, fy = t.y + ey * tip;
        if (bulletBlocked(this.tiles, fx, fy, BULLET_R)) continue;
        this.bullets.push({ id: this.nextId++, owner: t.id, x: fx, y: fy, vx: ex * sp, vy: ey * sp, bounces, rocket: t.spec.rocket, dead: false, volley: main.id, cork });
      }
    }
    return true;
  }

  tryMine(t: Tank): boolean {
    if (t.mineCd > 0 || this.ownMines(t) >= t.spec.mines) return false;
    for (const m of this.mines) if (!m.dead && Math.hypot(m.x - t.x, m.y - t.y) < MINE_R * 3) return false;
    t.mineCd = 0.6;
    const blast = t.ranks && t.ranks[1] >= 2 ? MINE_BLAST * BIG_BLAST : undefined;
    this.mines.push({ id: this.nextId++, owner: t.id, team: t.team, x: t.x, y: t.y, t: 0, fuse: -1, dead: false, blast });
    this.events.push(['mineSet', r2(t.x), r2(t.y)]);
    return true;
  }

  separateTanks() {
    const alive = this.tanks.filter((t) => t.alive && !under(t));
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
      if (bulletBlocked(this.tiles, nx, b.y, BULLET_R)) {
        if (b.cork && this.breakCork(nx, b.y)) { b.dead = true; this.events.push(['pop', r2(b.x), r2(b.y)]); continue; }
        b.vx = -b.vx; bounced = true;
      } else b.x = nx;
      const ny = b.y + b.vy * dt;
      if (bulletBlocked(this.tiles, b.x, ny, BULLET_R)) {
        if (b.cork && this.breakCork(b.x, ny)) { b.dead = true; this.events.push(['pop', r2(b.x), r2(b.y)]); continue; }
        b.vy = -b.vy; bounced = true;
      } else b.y = ny;
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
        if (!t.alive || under(t)) continue;
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
        if (b.dead || (a.volley && a.volley === b.volley)) continue;
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
      if (this.belts.length) [m.x, m.y] = beltStep(this.tiles, this.belts, m.x, m.y, MINE_R, dt); // mines ride the belts too
      if (m.fuse < 0 && m.t > 0.4) {
        for (const t of this.tanks) {
          if (!t.alive || t.team === m.team || t.id === m.owner || under(t)) continue;
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

  /** « Brise-liège »: the cork cells a shell at (x, y) touches are blown away; false when it touched no cork. */
  breakCork(x: number, y: number): boolean {
    let hit = false;
    for (let cy = Math.floor(y - BULLET_R); cy <= Math.floor(y + BULLET_R); cy++) {
      for (let cx = Math.floor(x - BULLET_R); cx <= Math.floor(x + BULLET_R); cx++) {
        if (tileAt(this.tiles, cx, cy) !== Tile.Cork) continue;
        this.tiles[cy * W + cx] = Tile.Empty;
        this.events.push(['block', cx, cy]);
        hit = true;
      }
    }
    return hit;
  }

  explodeMine(m: Mine) {
    if (m.dead) return;
    m.dead = true;
    const R = m.blast ?? MINE_BLAST;
    this.events.push(['mboom', r2(m.x), r2(m.y)]);
    const owner = this.tankById(m.owner);
    for (const t of this.tanks) {
      if (t === owner && t.ranks && t.ranks[1] >= 3) continue; // « Sang-froid »: one's own mines spare one
      if (t.alive && Math.hypot(t.x - m.x, t.y - m.y) < R + t.r * 0.4) this.killTank(t, owner);
    }
    for (const b of this.bullets) {
      if (!b.dead && Math.hypot(b.x - m.x, b.y - m.y) < R) b.dead = true;
    }
    for (const o of this.mines) {
      if (!o.dead && o !== m && Math.hypot(o.x - m.x, o.y - m.y) < R + 0.3) {
        if (o.fuse < 0 || o.fuse > 0.12) o.fuse = 0.12;
      }
    }
    const minX = Math.floor(m.x - R - 1), maxX = Math.floor(m.x + R + 1);
    const minY = Math.floor(m.y - R - 1), maxY = Math.floor(m.y + R + 1);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (tileAt(this.tiles, cx, cy) !== Tile.Cork) continue;
        if (Math.hypot(cx + 0.5 - m.x, cy + 0.5 - m.y) < R + 0.35) {
          this.tiles[cy * W + cx] = Tile.Empty;
          this.events.push(['block', cx, cy]);
        }
      }
    }
  }

  killTank(t: Tank, killer: Tank | undefined) {
    if (!t.alive || t.buffs.invuln > 0 || under(t)) return;
    if (t.hp > 1) {
      // tough tanks (the boss) soak up hits, with a short grace so one blast counts once
      t.hp--;
      t.buffs.invuln = 0.25;
      this.events.push(['hurt', r2(t.x), r2(t.y), t.id, t.hp, t.maxHp]);
      if (t.boss && t.hp <= t.maxHp / 2) this.enrage(t);
      if (t.kind === 'steel') this.strip(t);
      return;
    }
    if (t.buffs.shield) {
      t.buffs.shield = false;
      t.buffs.invuln = 0.5;
      if (t.ranks && t.ranks[2] >= 3) t.reshield = RESHIELD_SECONDS; // « Bouclier qui revient »
      this.events.push(['shield', r2(t.x), r2(t.y), t.id]);
      return;
    }
    t.alive = false;
    this.events.push(['boom', r2(t.x), r2(t.y), t.id]);
    if (t.loot && this.bonusOn) this.dropLoot(t, t.loot);
    this.onKill?.(t, killer);
  }

  /** A Pilleur falls: the crate it stole tumbles out of its sack, on the free cell nearest to the wreck. */
  dropLoot(t: Tank, kind: BonusKind) {
    t.loot = undefined;
    const cx0 = Math.floor(t.x), cy0 = Math.floor(t.y);
    let best: [number, number] | undefined, bd = Infinity;
    for (let cy = cy0 - 2; cy <= cy0 + 2; cy++) for (let cx = cx0 - 2; cx <= cx0 + 2; cx++) {
      if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1 || this.tiles[cy * W + cx] !== Tile.Empty) continue;
      const x = cx + 0.5, y = cy + 0.5;
      if (this.mines.some((m) => !m.dead && Math.hypot(m.x - x, m.y - y) < MINE_BLAST)) continue;
      if (this.bonuses.some((o) => Math.hypot(o.x - x, o.y - y) < 0.9)) continue;
      const d = Math.hypot(x - t.x, y - t.y);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) return;
    const c: Bonus = { id: this.nextId++, kind, x: best[0], y: best[1], t: 0, dead: false };
    this.bonuses.push(c);
    this.events.push(['crate', c.x, c.y, BONUS_KINDS.indexOf(kind)]);
    this.events.push(['loot', c.x, c.y, BONUS_KINDS.indexOf(kind)]);
  }

  /**
   * Direction of a straight run of free ground out of a mine's blast from where tank t stands, the one that heads
   * furthest from the foe; undefined when there is none (then it does not lay the mine).
   */
  mineEscape(t: Tank, foe: Pt): number | undefined {
    let best: number | undefined, bestScore = -Infinity;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4, dx = Math.cos(a), dy = Math.sin(a);
      let ok = true;
      for (let s = 0.4; s <= MINE_BLAST + 0.6 && ok; s += 0.3) {
        const x = t.x + dx * s, y = t.y + dy * s;
        for (const [ox, oy] of [[-dy, dx], [dy, -dx]]) {
          // the hull is wide: check both of its sides, not only its centre line
          const sx = x + ox * t.r * 0.9, sy = y + oy * t.r * 0.9;
          if (isSolidTank(tileAt(this.tiles, Math.floor(sx), Math.floor(sy)))) ok = false;
        }
        if (this.mines.some((m) => !m.dead && Math.hypot(m.x - x, m.y - y) < MINE_BLAST)) ok = false;
      }
      if (!ok) continue;
      const score = -(dx * (foe.x - t.x) + dy * (foe.y - t.y));
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  /** Is this tank's centre under a tunnel roof? (iteration 13) */
  inTunnel(t: Tank) {
    return isTunnel(tileAt(this.tiles, Math.floor(t.x), Math.floor(t.y)));
  }

  tankById(id: number) {
    return this.tanks.find((t) => t.id === id);
  }

  /**
   * « Suis-moi ! » (iteration 20): the AI teammates of that tank (same team, player-coloured, driven by the AI) come
   * to it for a few seconds, still shooting on the way. Returns how many answered.
   */
  rally(leader: Tank): number {
    if (!leader.alive) return 0;
    let n = 0;
    for (const o of this.tanks) {
      if (o === leader || !o.alive || !o.ai || !o.pid || o.team !== leader.team) continue;
      o.follow = { id: leader.id, t: RALLY_SECONDS };
      o.ai.path = []; // head off at once
      o.ai.pathT = 0;
      n++;
    }
    if (n) this.events.push(['rally', r2(leader.x), r2(leader.y), leader.id, n]);
    return n;
  }

  /** Where a teammate answering « Suis-moi ! » heads: its leader, while still far enough (undefined: fight as usual). */
  private followSpot(t: Tank): Tank | undefined {
    const f = t.follow;
    if (!f) return undefined;
    f.t -= DT;
    const l = this.tanks.find((o) => o.id === f.id);
    if (f.t <= 0 || !l || !l.alive) { t.follow = undefined; return undefined; }
    return Math.hypot(l.x - t.x, l.y - t.y) > RALLY_NEAR ? l : undefined;
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
      | (t.boss && (t.boss.warn > 0 || t.boss.dig === 1) ? FLAG_CHARGING : 0) | (t.boss?.rage ? FLAG_RAGE : 0) | (under(t) ? FLAG_BURROW : 0) | (this.night && t.alert ? FLAG_ALERT : 0);
  }
  netBonuses(): NetBonus[] {
    return this.bonuses.map((c) => [c.id, r2(c.x), r2(c.y), BONUS_KINDS.indexOf(c.kind), c.t > BONUS_LIFE - 3 ? 1 : 0]);
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
        if (!o.alive || under(o)) continue;
        if (o === t && si === 0) continue;
        // a ricochet that comes back is checked against a wider self (the shooter keeps moving), and allies get a little
        // margin too: without it the AI could fire a rebound that it then drove into (players saw them self-destruct)
        const pad = o === t ? 0.55 : o.team === t.team ? 0.15 : 0.04;
        const u = segCircle(s, o.x, o.y, o.r + BULLET_R + pad);
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
    if (o.team === t.team) return true;
    // a tank in a tunnel is out of sight, unless you are right at its door (iteration 13)
    if (this.inTunnel(o) && (o.x - t.x) ** 2 + (o.y - t.y) ** 2 > TUNNEL_SIGHT * TUNNEL_SIGHT) return false;
    if (!this.night || o.reveal > 0 || this.flash > 0) return true;
    const d = NIGHT_SIGHT + o.r;
    return (o.x - t.x) ** 2 + (o.y - t.y) ** 2 < d * d;
  }

  private nearestFoe(t: Tank): Tank | undefined {
    let best: Tank | undefined, bd = Infinity;
    for (const o of this.tanks) {
      if (!o.alive || o.team === t.team || under(o) || !this.canSee(t, o)) continue;
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
      // nobody in sight (night, or everyone hiding in tunnels): go and look for them
      if (this.tanks.some((o) => o.alive && o.team !== t.team && !under(o))) this.aiProwl(t);
      else if (t.follow) { const l = this.followSpot(t); if (l && spec.speed > 0) this.aiMove(t, l); } // the table is clear: still come along
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
        // never under a foe's nose (it would set it off before we get away), and only with a way out (iteration 13:
        // players watched enemies blow themselves up on their own mines)
        const way = !allyNear && d > 2.4 ? this.mineEscape(t, foe) : undefined;
        if (way !== undefined && (d < 6 ? Math.random() < 0.35 : Math.random() < 0.06)) {
          if (this.tryMine(t)) {
            ai.escape = way;
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
          // the shaky aim must not turn the shot back on itself or a friend: if it would, fire the steady one
          const shaken = this.traceShot(t, t.turret, spec.bounces).hit;
          if (shaken && shaken.team === t.team) t.turret = aim;
          this.tryFire(t);
          t.turret = aim;
          ai.locked = false;
          ai.hesitate = 0.2 + Math.random() * 0.4;
        }
      } else if (aligned) {
        ai.locked = false;
      }
    }

    if (spec.speed > 0) this.aiMove(t, (t.follow && this.followSpot(t)) || foe);
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
    if (t.spec.speed > 0) this.aiMove(t, (t.follow && this.followSpot(t)) || spot);
  }

  private aiThinkAim(t: Tank, foe: Tank) {
    const ai = t.ai!;
    const spec = t.spec;
    if (spec.skill === 0) { ai.aimValid = false; return; }
    const foes = this.tanks.filter((o) => o.alive && o.team !== t.team && !under(o) && this.canSee(t, o));
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
      if (d >= MINE_BLAST + 0.7) continue;
      threat = true;
      if (d < 0.08) {
        // sitting right on it (a mine just laid): there is no « away », take the planned way out (iteration 13: they
        // used to freeze on the spot until their own mine went off)
        const a = ai.escape ?? t.body;
        ax += Math.cos(a) * 1.5; ay += Math.sin(a) * 1.5;
      } else { ax += dx / (d + 0.01) * 1.5; ay += dy / (d + 0.01) * 1.5; }
    }
    // announced lightning strikes: get out of the ring (everyone notices the crackling, even simple tanks)
    for (const bo of this.bolts) {
      if (t.kind === 'thunder') break; // its own lightning never touches it
      const dx = t.x - bo.x, dy = t.y - bo.y;
      const d = Math.hypot(dx, dy);
      if (d < BOLT_R + t.r + 0.45) { threat = true; ax += dx / (d + 0.01) * 2; ay += dy / (d + 0.01) * 2; }
    }
    // the ground shakes where the Foreur is about to burst out: everyone clears the spot
    for (const o of this.tanks) {
      if (o === t || !o.alive || o.boss?.dig !== 3) continue;
      const dx = t.x - o.x, dy = t.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d < DRILL_BLAST + t.r + 0.5) { threat = true; ax += dx / (d + 0.01) * 2; ay += dy / (d + 0.01) * 2; }
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
      // a Pilleur keeps an eye on the crates: a new one and it changes course at once
      ai.pathT = t.kind === 'thief' && this.bonuses.length ? 0.5 + Math.random() * 0.4 : 2 + Math.random() * 2.5;
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
    // the Foreur drills straight through cork
    const drills = t.kind === 'drill';
    for (let i = 0; i < W * H; i++) if ((isSolidTank(this.tiles[i]) && !(drills && this.tiles[i] === Tile.Cork)) || (isPortal(this.tiles[i]) && i !== start && i !== ai.goal)) blocked[i] = 1;
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
    for (const bo of this.bolts) {
      for (let cy = Math.floor(bo.y - 2); cy <= Math.floor(bo.y + 2); cy++)
        for (let cx = Math.floor(bo.x - 2); cx <= Math.floor(bo.x + 2); cx++)
          if (cx >= 0 && cy >= 0 && cx < W && cy < H && Math.hypot(cx + 0.5 - bo.x, cy + 0.5 - bo.y) < BOLT_R + 0.5) blocked[cy * W + cx] = 1;
    }
    for (const o of this.tanks) {
      if (o === t || !o.alive || o.boss?.dig !== 3) continue;
      for (let cy = Math.floor(o.y - 2); cy <= Math.floor(o.y + 2); cy++)
        for (let cx = Math.floor(o.x - 2); cx <= Math.floor(o.x + 2); cx++)
          if (cx >= 0 && cy >= 0 && cx < W && cy < H && Math.hypot(cx + 0.5 - o.x, cy + 0.5 - o.y) < DRILL_BLAST + 0.5) blocked[cy * W + cx] = 1;
    }
    // the Pilleur looks across the whole table when there is a crate to snatch (iteration 15)
    const thief = t.kind === 'thief' && this.bonuses.some((c) => c.t >= 0.3);
    const slowOnBelts = this.belts.length > 0 && this.speedOf(t) < BELT_SPEED + 0.5;
    const prev = new Int32Array(W * H).fill(-2);
    const dist = new Int32Array(W * H);
    prev[start] = -1;
    const q = [start];
    const reach: number[] = [];
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (dist[c] > (ai.goal !== undefined || thief ? THIEF_REACH : 9)) continue;
      if (dist[c] <= 9) reach.push(c);
      const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (prev[n] !== -2 || blocked[n]) continue;
        if (dx && dy && (blocked[y * W + nx] || blocked[ny * W + x])) continue;
        if (slowOnBelts && this.belts[n]) {
          // a tank slower than the belts cannot drive up one: it plans around (or rides it) instead (iteration 16)
          const [bx, by] = BELT_DIRS[this.belts[n]];
          if (bx * dx + by * dy < 0) continue;
        }
        prev[n] = c;
        dist[n] = dist[c] + 1;
        q.push(n);
      }
    }
    if (reach.length < 2) { ai.path = []; return; }
    let best = -1, bestScore = -Infinity;
    if (ai.goal !== undefined && prev[ai.goal] !== -2 && ai.goal !== start) best = ai.goal;
    // AI-driven player tanks (demo) love bonus crates
    if (best < 0 && (thief || (t.kind === 'player' && this.bonuses.length && Math.random() < 0.8))) {
      for (const c of this.bonuses) {
        const cell = Math.floor(c.y) * W + Math.floor(c.x);
        if (prev[cell] === -2 || dist[cell] > (thief ? THIEF_REACH : 9)) continue;
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
