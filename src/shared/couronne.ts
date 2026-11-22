// « La couronne » (iteration 50): a free-for-all around a single golden crown, set on a red cushion in the middle.
// Drive over it to put it on: every second you wear it counts. Wear it CROWN_HOLD seconds in all and the round is yours.
// A tank hit while crowned drops it where it fell; left alone on the floor, it flies back to its cushion. Destroyed
// tanks come back at their corner a moment later. If nobody reigns long enough, the clock decides: the longest reign
// takes the round (a tie: nobody). First to CROWN_TARGET rounds.
import { nearestFree, versusArena, type ParsedLevel } from './levels';

export const CROWN_TARGET = 3; // rounds to win the game
export const CROWN_HOLD = 25; // seconds of reign that take the round
export const CROWN_ROUND = 90; // seconds a round lasts at most
export const CROWN_GRAB = 0.62; // how close a tank must drive to put the crown on
export const CROWN_RETURN = 7; // seconds a dropped crown waits on the floor before it flies home
export const CROWN_COOL = 0.5; // seconds after a drop before anyone can pick it up
export const CROWN_RESPAWN = 2.5; // seconds before a destroyed tank is back at its corner
export const CROWN_WARN = 5; // seconds of reign left when everyone is warned
export const CROWN_HURRY = 15; // seconds left on the clock when it turns red
/** The gold of the crown (its halo, the scoreboard, the floaters). */
export const CROWN_COLOR = 0xffc93a;

/** The crown of a round, kept by the simulation. */
export interface CrownState {
  hx: number; hy: number; // its cushion
  x: number; y: number;
  holder: number; // tank id wearing it (0: nobody)
  state: 0 | 1 | 2; // 0 on its cushion, 1 worn, 2 dropped on the floor
  dropT: number; // seconds spent on the floor
  cool: number; // seconds before it can be picked up again
  time: number; // seconds of play in this round
  held: Map<number, number>; // tank id → seconds worn this round
  winner: number; // the tank that reigned CROWN_HOLD seconds (0: not yet)
  warned: boolean; // the « five seconds left » call went out for the current reign
}

export const newCrown = (hx: number, hy: number): CrownState => ({ hx, hy, x: hx, y: hy, holder: 0, state: 0, dropT: 0, cool: 0, time: 0, held: new Map(), winner: 0, warned: false });

/** The arenas of the versus, in another order, without the storm and the fog (the crown must be seen), and the cushion in the middle. */
export function crownArena(round: number): ParsedLevel & { crown: [number, number] } {
  const lvl = versusArena(round + 5);
  lvl.name = 'La couronne';
  lvl.storm = false;
  lvl.fog = undefined;
  const crown = nearestFree(lvl.tiles, 10, 8, lvl.spawns); // the free cell nearest to the middle: fair to every corner
  return { ...lvl, crown };
}

/** The winner of a round on time: the longest reign (0 when nobody wore it, or on a tie at the top, to the tenth). */
export function crownLeader(held: Map<number, number>): number {
  let best = 0, who = 0, tie = false;
  for (const [id, s] of held) {
    const n = Math.floor(s * 10);
    if (n > best) { best = n; who = id; tie = false; }
    else if (n === best && n > 0) tie = true;
  }
  return tie ? 0 : who;
}
