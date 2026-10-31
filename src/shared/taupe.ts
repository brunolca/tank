import { mix } from './daily';
import { proceduralLevel, type ParsedLevel } from './levels';

// The mole (« la Taupe », iteration 8): a coop party mode with a hidden saboteur.
// One player, drawn at random and told in secret, wins if the team runs out of lives.
// The others win by clearing every stage, or by unmasking the mole at a council (a vote held after each mission).

export const TAUPE_STAGES = 3;
export const TAUPE_LIVES = 3;
export const TAUPE_MIN_PLAYERS = 3;
export const COUNCIL_SECONDS = 16;
export const VERDICT_SECONDS = 5;

const NAMES = ['Le Terrier', 'La Galerie', 'Le Grand Tunnel', 'La Taupinière', 'Le Souterrain', 'La Cave aux secrets'];

/** Stage 1..TAUPE_STAGES of a mole game (seed drawn when the game starts): 4 to 6 enemies. */
export function taupeLevel(seed: number, stage: number): ParsedLevel {
  const name = NAMES[(mix(seed, 77) + stage) % NAMES.length];
  return proceduralLevel(17 + stage * 3, { seed: mix(seed, stage), portals: false, night: false, name });
}

/** A council in progress (or just decided, when `done`). */
export interface CouncilState {
  /** what led to it: the mission was cleared or failed */
  why: 'cleared' | 'failed';
  /** seconds left to vote (or to read the verdict) */
  left: number;
  /** voters, in lobby order: those who may vote (and may be accused) */
  voters: string[];
  /** who has voted so far (targets stay secret until the end) */
  voted: string[];
  done?: boolean;
  /** revealed at the end: voter -> accused ('' = nobody) */
  votes?: Record<string, string>;
  /** the player the council put aside, if a majority agreed */
  accused?: string;
  /** whether the accused was the mole */
  wasMole?: boolean;
}

/**
 * The council's decision. A player is accused when more than half of the *other* voters point at them
 * (so the mole can never sway the vote alone). Ties and missing votes accuse nobody.
 */
export function councilVerdict(voters: string[], votes: Record<string, string>): string | undefined {
  const count = new Map<string, number>();
  for (const v of voters) {
    const target = votes[v];
    if (target && target !== v && voters.includes(target)) count.set(target, (count.get(target) ?? 0) + 1);
  }
  for (const [target, n] of count) {
    if (n > (voters.length - 1) / 2) return target;
  }
  return undefined;
}

/** Outcome of a mole game, for the results screen. */
export interface TaupeResult {
  mole?: string; // pid of the mole
  winner: 'loyaux' | 'taupe';
  why: 'missions' | 'demasquee' | 'vies';
}
