// « Le pétard » (iteration 61): a free-for-all around a lit firecracker. Shells no longer destroy anyone: they only daze
// (a second with stars round the turret). The tank carrying the firecracker gets rid of it by bumping into another tank
// or by hitting one with a shell (a ricochet counts: « en bande ! »). When the fuse burns down, the firecracker goes off
// on its carrier's back: that tank is out of the round, and a new firecracker is lit on one of the survivors. The last
// tank standing takes the round. First to PETARD_TARGET rounds.
import { versusArena, type ParsedLevel } from './levels';

export const PETARD_TARGET = 3; // rounds to win the game
export const PETARD_FUSE: [number, number] = [11, 17]; // seconds a fuse burns (drawn at random each time it is lit)
export const PETARD_WARN = 4; // seconds of fuse left when it starts to hiss and blink (and the HUD counts down)
export const PETARD_COOL = 0.9; // seconds after a handover before the firecracker can change hands again (no instant return)
export const PETARD_DAZE = 0.9; // seconds a hit tank is dazed (no driving, no shooting)
export const PETARD_SAFE = 0.5; // seconds after a daze before another one can land
export const PETARD_RELIGHT = 1.6; // seconds between a bang and the next firecracker
export const PETARD_BLAST = 1.7; // the bang dazes every tank this close to it
export const PETARD_SPEED = 1.2; // the carrier drives this much faster (it is in a hurry!)
export const PETARD_TOUCH = 0.1; // how close (beyond touching hulls) the carrier must drive to hand it over
/** The red of the firecracker (its glow, the scoreboard, the floaters). */
export const PETARD_COLOR = 0xff4b3a;

/** The firecracker of a round, kept by the simulation. */
export interface PetardState {
  holder: number; // tank id carrying it (0: none lit, between a bang and the next one)
  fuse: number; // seconds left on the fuse
  len: number; // seconds the fuse had when it was lit (the drawing burns the wick down)
  cool: number; // seconds before it can change hands
  wait: number; // seconds before the next one is lit (when holder is 0)
  last: number; // tank id that handed it over last (credited with the bang)
  warned: boolean; // the « it is about to go off » call went out for this fuse
  passes: Map<number, number>; // tank id → handovers this round (for the scoreboard)
  bangs: number; // firecrackers gone off this round
}

export const newPetard = (): PetardState => ({ holder: 0, fuse: 0, len: 0, cool: 0, wait: PETARD_RELIGHT, last: 0, warned: false, passes: new Map(), bangs: 0 });

/** The arenas of the versus, in another order, by day, without the storm, the fog or the squalls (the firecracker must be seen coming). */
export function petardArena(round: number): ParsedLevel {
  const lvl = versusArena(round + 3);
  lvl.name = 'Le pétard';
  lvl.night = false;
  lvl.storm = false;
  lvl.fog = undefined;
  lvl.blizzard = undefined;
  return lvl;
}

/** A fuse length between the two bounds, from a number in [0, 1). */
export const fuseLength = (u: number) => PETARD_FUSE[0] + (PETARD_FUSE[1] - PETARD_FUSE[0]) * u;
