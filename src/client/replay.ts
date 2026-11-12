// « Le ralenti » (iteration 32): the last seconds of play are kept, frame by frame, exactly as they were drawn.
// When a mission or a round ends, the decisive moment (the last tank destroyed, or the flag brought home) is played
// again in slow motion, the camera leaning toward it. Nothing goes through the network: it is only a film of what
// this screen already showed, so it works the same online, alone against rivals and in the demo.
import type { GameEvent } from '../shared/protocol';
import { KO_BOLT, KO_DRILL, KO_MINE } from '../shared/constants';
import type { RBonus, RBullet, RFlag, RMine, RTank } from './render';

export interface FilmFrame { dt: number; tanks: RTank[]; bullets: RBullet[]; mines: RMine[]; bonuses: RBonus[]; flags?: RFlag[]; events: GameEvent[] }

/** Seconds of play kept on film. */
const KEEP = 5;
/** The replay starts this long before the decisive moment, and ends this long after it. */
const BEFORE = 1.5;
const AFTER = 0.75;

/** Events played again in the replay: only what is drawn (no map change, no crate drop, no bubble, no toast). */
export const REPLAYED = new Set(['shot', 'bounce', 'pop', 'boom', 'mboom', 'shield', 'hurt', 'deflect', 'catch', 'unload', 'volley', 'warp', 'bolt', 'erupt', 'mineSet', 'bonus', 'freeze', 'flag']);

export class Film {
  private frames: FilmFrame[] = [];
  private pending: GameEvent[] = [];
  private span = 0;

  event(e: GameEvent) { this.pending.push(e); }

  frame(dt: number, tanks: RTank[], bullets: RBullet[], mines: RMine[], bonuses: RBonus[], flags?: RFlag[]) {
    if (!(dt > 0)) dt = 1 / 60;
    this.frames.push({ dt, tanks, bullets, mines, bonuses, flags, events: this.pending });
    this.pending = [];
    this.span += dt;
    while (this.frames.length > 2 && this.span - this.frames[0].dt > KEEP) this.span -= this.frames.shift()!.dt;
  }

  clear() { this.frames = []; this.pending = []; this.span = 0; }

  /**
   * The decisive moment in the last `within` seconds: the last frame where a tank blew up (or a flag was brought home).
   * Returns a reel ready to play, or undefined when nothing happened lately.
   */
  reel(within = 3.5): Reel | undefined {
    const frames = this.frames.slice();
    let t = 0;
    const at: number[] = frames.map((f) => (t += f.dt) - f.dt);
    const total = t;
    for (let i = frames.length - 1; i >= 0; i--) {
      if (total - at[i] > within) break;
      const ev = frames[i].events;
      const boom = [...ev].reverse().find((e) => e[0] === 'boom' || (e[0] === 'flag' && e[5] === 3));
      if (!boom) continue;
      const ko = boom[0] === 'boom' ? ev.find((e) => e[0] === 'ko' && e[1] === boom[3]) : undefined;
      return new Reel(frames, at, at[i], boom[1] as number, boom[2] as number, boom, ko);
    }
    return undefined;
  }
}

const smooth = (a: number, b: number, v: number) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpAng = (a: number, b: number, u: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * u; };

/** A replay in progress: call step() every real frame until it returns false. */
export class Reel {
  t: number; // film time now
  readonly start: number;
  readonly end: number;
  private cursor = 0;
  constructor(private frames: FilmFrame[], private at: number[], readonly key: number, readonly x: number, readonly y: number, readonly what: GameEvent, readonly ko?: GameEvent) {
    this.start = Math.max(0, key - BEFORE);
    const last = at[at.length - 1] + frames[frames.length - 1].dt;
    this.end = Math.min(last, key + AFTER);
    this.t = this.start;
    while (this.cursor < at.length && at[this.cursor] < this.start) this.cursor++;
  }

  /** How fast the film runs at film time t: almost normal on the way in, very slow around the moment itself. */
  speed(t = this.t) {
    if (t < this.key - 0.35) return 0.9;
    if (t < this.key + 0.2) return 0.3;
    return 0.8;
  }

  /** How close the camera is (0 to 1). */
  zoom(t = this.t) {
    return smooth(this.start, this.key - 0.35, t) * (1 - smooth(this.end - 0.3, this.end, t));
  }

  /** Real seconds the whole replay lasts. */
  duration() {
    let real = 0;
    for (let t = this.start; t < this.end; t += 0.01) real += 0.01 / this.speed(t);
    return real;
  }

  get done() { return this.t >= this.end; }

  /** Moves the film on by `realDt` real seconds: the events of the frames passed, and the picture to draw now. */
  step(realDt: number): { events: GameEvent[]; tanks: RTank[]; bullets: RBullet[]; mines: RMine[]; bonuses: RBonus[]; flags?: RFlag[]; dt: number } {
    const sp = this.speed();
    this.t = Math.min(this.end, this.t + realDt * sp);
    const events: GameEvent[] = [];
    while (this.cursor < this.frames.length && this.at[this.cursor] <= this.t) events.push(...this.frames[this.cursor++].events);
    const i = Math.max(0, this.cursor - 1);
    const a = this.frames[i], b = this.frames[Math.min(this.frames.length - 1, i + 1)];
    const u = b === a ? 0 : Math.min(1, Math.max(0, (this.t - this.at[i]) / a.dt));
    // in between two frames: slow motion stays smooth
    const tanks = a.tanks.map((ta) => {
      const tb = b.tanks.find((o) => o.id === ta.id);
      if (!tb || tb.alive !== ta.alive || (tb.x - ta.x) ** 2 + (tb.y - ta.y) ** 2 > 1.5) return ta;
      return { ...ta, x: lerp(ta.x, tb.x, u), y: lerp(ta.y, tb.y, u), body: lerpAng(ta.body, tb.body, u), turret: lerpAng(ta.turret, tb.turret, u) };
    });
    const bullets = a.bullets.map((ba) => {
      const bb = b.bullets.find((o) => o.id === ba.id);
      if (!bb || (bb.x - ba.x) ** 2 + (bb.y - ba.y) ** 2 > 1.5) return ba;
      return { ...ba, x: lerp(ba.x, bb.x, u), y: lerp(ba.y, bb.y, u) };
    });
    return { events, tanks, bullets, mines: a.mines, bonuses: a.bonuses, flags: a.flags, dt: realDt * sp };
  }
}

/**
 * The words under the replay: what did it. name: the name of a tank (a player, a rival, or an enemy's label).
 * Returns [the big line, the small line].
 */
export function koCaption(r: Reel, name: (id: number) => string | undefined, boss: (id: number) => boolean): [string, string] {
  if (r.what[0] === 'flag') {
    const who = name(r.what[4] as number);
    return ['Capturé !', who ? `${who} rapporte le drapeau` : 'Le drapeau est rentré'];
  }
  const victim = r.what[3] as number;
  const ko = r.ko;
  const vName = name(victim);
  if (!ko) return [boss(victim) ? 'Le coup de grâce !' : 'Le coup décisif', vName ? `${vName} est détruit` : ''];
  const [, , killer, cause, n] = ko as [string, number, number, number, number];
  const kName = killer ? name(killer) : undefined;
  const self = killer === victim;
  let how: string;
  if (cause === KO_MINE) how = self ? 'Sa propre mine !' : 'Sur la mine !';
  else if (cause === KO_BOLT) how = 'Frappé par la foudre !';
  else if (cause === KO_DRILL) how = 'Surgi de sous la table !';
  else if (self) how = n > 0 ? 'Son propre ricochet !' : 'Oups !';
  else if (n >= 3) how = `Ricochet ×${n} : chapeau !`;
  else if (n === 2) how = 'Double ricochet !';
  else if (n === 1) how = 'Ricochet !';
  else how = boss(victim) ? 'Le coup de grâce !' : 'Tir direct !';
  const sub = self ? (vName ? `${vName} s’est piégé tout seul` : '') : kName && vName ? `${kName} → ${vName}` : vName ? `${vName} est détruit` : '';
  return [how, sub];
}
