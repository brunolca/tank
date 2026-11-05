// Rivals (iteration 17): AI-driven tanks that fill the versus mode, so a lone player (or two) can still play a full free-for-all.
// The room owns them like players (name, colour, cannon, score), but their tank gets a brain from the shared AI.
import { WEAPONS, type TankSpec, type Weapon } from './constants';
import type { Game, Tank } from './sim';

export const MAX_RIVALS = 3;
/** Rival ids start with this prefix (never a real player's id: those are UUIDs or the client's own random ids). */
export const RIVAL_PREFIX = 'ia:';
export const isRivalId = (pid: string | undefined) => !!pid && pid.startsWith(RIVAL_PREFIX);

export interface RivalLevel {
  label: string;
  desc: string;
  /** Overrides of the player spec (speed and ammo stay those of the cannon). */
  spec: Pick<TankSpec, 'skill' | 'reaction' | 'aimError' | 'turretSpeed'> & { minFireCd: number };
  /** Distance it likes to keep from its target: rivals close in more than enemies do, or rounds drag on. */
  prefDist: number;
}

// order fixed: the level travels as an index (PlayerInfo.bot)
export const RIVAL_LEVELS: RivalLevel[] = [
  { label: 'Novice', desc: 'Tire droit, réagit lentement', spec: { skill: 1, reaction: 0.75, aimError: 0.13, turretSpeed: 3, minFireCd: 0.9 }, prefDist: 4 },
  { label: 'Malin', desc: 'Joue les ricochets', spec: { skill: 2, reaction: 0.42, aimError: 0.06, turretSpeed: 4.5, minFireCd: 0.5 }, prefDist: 3.5 },
  { label: 'Redoutable', desc: 'Vise juste et anticipe', spec: { skill: 3, reaction: 0.22, aimError: 0.025, turretSpeed: 6, minFireCd: 0.34 }, prefDist: 3 },
];

export const RIVAL_NAMES = ['Boulon', 'Grelot', 'Toupie', 'Bobine', 'Pistache', 'Ressort', 'Cabriole', 'Zigzag', 'Moustache', 'Clafoutis'];

export function rivalLevel(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(RIVAL_LEVELS.length - 1, v)) : 1;
}

/** What to hand Game.enableAI for a rival of that level, on top of its cannon's spec. */
export function rivalBrain(level: number, base: TankSpec): Partial<TankSpec> {
  const { minFireCd, ...s } = RIVAL_LEVELS[rivalLevel(level)].spec;
  return { ...s, fireCd: Math.max(minFireCd, base.fireCd) };
}

export function randomWeapon(): Weapon {
  return WEAPONS[Math.floor(Math.random() * WEAPONS.length)];
}

/** Turn an armed player tank into a rival of that level (the room, the demo and the tests share this). */
export function makeRival(g: Game, t: Tank, level: number) {
  g.enableAI(t, rivalBrain(level, t.spec));
  if (t.ai) t.ai.prefDist = RIVAL_LEVELS[rivalLevel(level)].prefDist;
  t.fireCd = 0.8 + Math.random(); // a breath before the first shot, like the enemies
}
