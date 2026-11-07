import type { TankKind, TankSpec } from './constants';

// ------------------------------------------------------------------ the stripes (iteration 19): experience and a skill tree in the coop campaign
// Asked for by a player (feedback n° 23). Each destroyed enemy gives its shooter some experience, every cleared mission
// gives everyone a little; every XP_PER_GALON points of experience earn a galon (a stripe), spent in a small tree of
// three branches of three ranks. Campaign only (never the daily challenge, the mole, the workshop or the versus), and
// for one run: it all starts over with a new campaign.

/** Three branches, three ranks each, in wire order (the index travels in the `skill` message: append, never reorder). */
export const BRANCHES = [
  {
    key: 'canon', label: 'Canon', icon: '💥', color: 0xffb43d,
    ranks: [
      { label: 'Chargeur', desc: '+1 obus en vol' },
      { label: 'Ricochet', desc: '+1 rebond pour tous tes obus' },
      { label: 'Brise-liège', desc: 'tes obus font sauter le liège qu’ils touchent' },
    ],
  },
  {
    key: 'genie', label: 'Génie', icon: '💣', color: 0xff6f5e,
    ranks: [
      { label: 'Sac de mines', desc: '+1 mine' },
      { label: 'Grand souffle', desc: 'tes mines explosent un quart plus large' },
      { label: 'Sang-froid', desc: 'tes propres mines ne te font plus rien' },
    ],
  },
  {
    key: 'blindage', label: 'Blindage', icon: '🛡️', color: 0x4fd1ff,
    ranks: [
      { label: 'Bouclier de départ', desc: 'chaque mission commence avec un bouclier' },
      { label: 'Bonus prolongés', desc: 'les bonus des caisses durent moitié plus longtemps' },
      { label: 'Bouclier qui revient', desc: `ton bouclier se recharge 20 s après avoir cédé` },
    ],
  },
] as const;
export const RANKS_PER_BRANCH = 3;
/** Galons needed for rank 1, 2, 3 of a branch. */
export const RANK_COST = [1, 2, 3];
export const XP_PER_GALON = 5;
/** Experience everyone in the mission gets when it is cleared. */
export const XP_CLEAR = 3;
/** Seconds before the « Bouclier qui revient » shield grows back. */
export const RESHIELD_SECONDS = 20;
/** « Grand souffle »: blast radius multiplier of the player's own mines. */
export const BIG_BLAST = 1.25;
/** « Bonus prolongés »: timed bonuses last this much longer. */
export const LONG_BUFFS = 1.5;
/** Seconds the end-of-mission screen waits when someone has galons to spend (it ends early once they are done). */
export const TRAINING_SECONDS = 10;

/** Ranks bought in each branch (0 to 3). */
export type Ranks = [number, number, number];
/** A player's progress in the campaign, as it travels in the phase message. */
export interface Progress {
  xp: number;
  g: number; // galons earned so far (spent ones included)
  r: Ranks;
}

/** Experience for destroying an enemy: the tough and the tricky ones are worth more, a boss a lot. */
export function killXp(kind: TankKind | string): number {
  if (kind === 'boss' || kind === 'drill' || kind === 'thunder') return 8;
  if (kind === 'steel' || kind === 'mason' || kind === 'thief' || kind === 'rampart' || kind === 'white' || kind === 'black' || kind === 'green') return 2;
  return 1;
}

/** Galons a player starts a campaign with: a head start at the checkpoints (two per five missions skipped). */
export function startGalons(mission: number) {
  return 2 * Math.floor(Math.max(0, mission - 1) / 5);
}

export function cleanRanks(r: unknown): Ranks {
  const a = Array.isArray(r) ? r : [];
  return [0, 1, 2].map((i) => Math.max(0, Math.min(RANKS_PER_BRANCH, Math.floor(Number(a[i]) || 0)))) as Ranks;
}

export function spentGalons(r: Ranks) {
  let n = 0;
  for (const k of r) for (let i = 0; i < k; i++) n += RANK_COST[i];
  return n;
}

/** Galons left to spend. */
export function freeGalons(p: Progress) {
  return Math.max(0, p.g - spentGalons(p.r));
}

/** Can this branch take one more rank? */
export function canBuy(p: Progress, branch: number) {
  const k = p.r[branch];
  return k !== undefined && k < RANKS_PER_BRANCH && freeGalons(p) >= RANK_COST[k];
}

/** Is there anything left this player can buy right now? */
export function canBuyAny(p: Progress) {
  return [0, 1, 2].some((b) => canBuy(p, b));
}

export function totalRanks(r: Ranks | undefined) {
  return r ? r[0] + r[1] + r[2] : 0;
}

/** A player's sheet once trained: the numbers that the client predicts with too (ammo count). */
export function trainSpec(spec: TankSpec, r: Ranks | undefined): TankSpec {
  if (!r) return spec;
  return { ...spec, maxBullets: spec.maxBullets + (r[0] >= 1 ? 1 : 0), bounces: spec.bounces + (r[0] >= 2 ? 1 : 0), mines: spec.mines + (r[1] >= 1 ? 1 : 0) };
}
