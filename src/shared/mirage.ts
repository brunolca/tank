// « L’Illusionniste » (iteration 58): a toy conjurer in a top hat. When a foe comes into sight, it holds still and
// taps its wand (« Abracadabra ! », CONJ_WARN seconds), then vanishes in a puff of stars and reappears as three
// identical tanks: itself, somewhere among them, and two mirages. A mirage drives as the mirror image of the real one
// (one mirrors its moves left-right, the other up-down), aims at the nearest foe, and fires when the real one fires:
// its shells look exactly like real ones, bounce like real ones, and burst into harmless stars on whatever they hit.
// A single shell dispels a mirage (« Pouf ! »), so does a mine's blast; they all vanish when the real one is destroyed,
// or after CONJ_LIFE seconds. Tells for the sharp-eyed: tanks drive straight through a mirage, mines ignore it.

/** A mirage of the Illusionniste on the table. `m`: 0 it mirrors the real one's moves left-right, 1 up-down. */
export interface Decoy {
  id: number;
  owner: number;
  team: number;
  x: number;
  y: number;
  body: number;
  turret: number;
  life: number;
  m: number;
}

/** The Illusionniste: seconds until its next trick, the wand tap before it (warn > 0), and where it stood last tick. */
export interface ConjureState {
  t: number;
  warn: number;
  lx: number;
  ly: number;
}

/** Seconds into the mission before its first trick (plus up to a second at random). */
export const CONJ_FIRST = 2.2;
/** Seconds between two tricks (min, max), counted from the moment its mirages are gone. */
export const CONJ_EVERY: [number, number] = [4.5, 6.5];
/** Seconds it holds still, wand raised, before the puff of stars. */
export const CONJ_WARN = 0.7;
/** How far from where it stood the three tanks reappear (tiles). */
export const CONJ_MIN = 1.9;
export const CONJ_MAX = 3.6;
/** A foe must be in sight and this close for it to start a trick. */
export const CONJ_RANGE = 11;
/** Seconds a mirage lasts. */
export const CONJ_LIFE = 9;
/** Mirages on the table at once, per Illusionniste. */
export const CONJ_DECOYS = 2;

/** 'poof' event: what vanished. */
export const POOF_DECOY = 0;
export const POOF_SHELL = 1;
