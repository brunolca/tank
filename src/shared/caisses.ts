// « La chasse aux caisses » (iteration 37): a free-for-all where every bonus crate picked up scores a point.
// Crates rain on the table all round long. A destroyed tank drops one of its crates where it fell (anyone can grab it)
// and comes back at its corner a moment later. In the last seconds, a golden crate drops: it is worth three.
// When the clock runs out, the tank with the most crates takes the round. First to HUNT_TARGET rounds.
import { versusArena, type ParsedLevel } from './levels';

export const HUNT_TARGET = 3; // rounds to win the game
export const HUNT_ROUND = 60; // seconds a round lasts
export const HUNT_GOLD_AT = 18; // seconds left when the golden crate drops
export const HUNT_GOLD = 3; // what the golden crate is worth
export const HUNT_RESPAWN = 2.5; // seconds before a destroyed tank is back at its corner
export const HUNT_HURRY = 10; // seconds left when the clock turns red
/** Crates fall much faster than in the versus: there is always one to race for. */
export const HUNT_CRATES = { first: 1.2, every: [2.2, 3.6] as [number, number], cap: 4 };
/** The colour of the golden crate (its halo, its beam, the « +3 »). */
export const GOLD_COLOR = 0xffc93a;

/** The crates of a round, kept by the simulation. */
export interface HuntState {
  time: number; // seconds of play in this round
  got: Map<number, number>; // tank id → crates this round
  gold: boolean; // the golden crate has dropped
}

export const newHunt = (): HuntState => ({ time: 0, got: new Map(), gold: false });

/** The arenas of the versus, in a different order, without the storm and the fog (the crates must be seen). */
export function huntArena(round: number): ParsedLevel {
  const lvl = versusArena(round + 3);
  lvl.name = 'La chasse aux caisses';
  lvl.storm = false;
  lvl.fog = undefined;
  return lvl;
}

/** The winner of a round: the tank with the most crates (0 when nobody has any, or on a tie at the top). */
export function huntLeader(got: Map<number, number>): number {
  let best = 0, who = 0, tie = false;
  for (const [id, n] of got) {
    if (n > best) { best = n; who = id; tie = false; }
    else if (n === best && n > 0) tie = true;
  }
  return tie ? 0 : who;
}
