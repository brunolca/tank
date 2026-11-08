// « Drapeaux » (iteration 24): capture the flag, Bleus against Rouges, in short rounds.
// Each team has a flag planted at its base. Drive over the enemy flag to grab it, bring it back to your own base to win
// the round. Destroyed tanks come back at their base a moment later. A destroyed carrier drops the flag where it fell:
// a foe picks it up again, a teammate sends it home with a touch (and it goes home by itself after a while).
// No capture before the clock runs out: a draw. First team to 3 rounds.
import { PLAYER_COLORS, TANK_R, W } from './constants';
import { nearestFree, parseLevel, type LevelDef, type ParsedLevel } from './levels';

export const CTF_TARGET = 3; // rounds to win the game
export const CTF_RETURN = 12; // seconds before a dropped flag flies home by itself
export const CTF_RESPAWN = 3; // seconds before a destroyed tank is back at its base
export const CTF_SAFE = 2; // seconds a tank back at its base cannot be destroyed
export const CTF_ROUND = 150; // seconds a round lasts at most (then it is a draw)
export const CTF_GRAB = TANK_R + 0.32; // how close a tank must come to grab (or send home) a flag
export const CTF_CAPTURE = 0.95; // how close to its own base a carrier must come to score
export const TEAM_NAMES = ['Bleus', 'Rouges'] as const;
/** Team colours: the flags, the base pads and the rings under the tanks. */
export const TEAM_COLORS = [0x3d7bff, 0xe2453c] as const;
/** Tanks take their team's colours, two shades each (blue and cyan, red and orange). */
export const TEAM_TANK_COLORS = [[PLAYER_COLORS[0], PLAYER_COLORS[4]], [PLAYER_COLORS[1], PLAYER_COLORS[3]]] as const;

/** Team 1 (Bleus) plays on the left, team 2 (Rouges) on the right: their bases sit in the middle of each short side. */
export const CTF_BASES: [number, number][] = [[2.5, 8.5], [W - 2.5, 8.5]];

/** A flag on the table. state 0: at home, 1: carried, 2: dropped somewhere. */
export interface CtfFlag {
  team: number; // 1 or 2: the team it belongs to
  x: number;
  y: number;
  hx: number; // its base
  hy: number;
  carrier: number; // tank id of the carrier (0: nobody)
  state: 0 | 1 | 2;
  dropT: number; // seconds since it was dropped
}

/** One flag in a snapshot: [team, x, y, carrierTankId (0 nobody), state (0 home, 1 carried, 2 dropped), seconds before it flies home] */
export type NetFlag = [number, number, number, number, number, number];

/** Arenas are drawn as their left half (11 columns): the right half is the mirror image, so neither team is favoured. */
const HALVES: { name: string; half: string[]; night?: boolean; wind?: number }[] = [
  {
    name: 'Le pré carré',
    half: [
      '...........',
      '...........',
      '...####....',
      '...........',
      '.........o.',
      '.#.....#.o.',
      '.#.....#...',
      '...........',
      '....o......',
      '...........',
      '.#.....#...',
      '.#.....#.o.',
      '.........o.',
      '...........',
      '...####....',
      '...........',
      '...........',
    ],
  },
  {
    name: 'Les douves',
    half: [
      '...........',
      '.....#.....',
      '.....#.....',
      '..........o',
      '...__......',
      '...__...##.',
      '...........',
      '......o....',
      '......o....',
      '......o....',
      '...........',
      '...__...##.',
      '...__......',
      '..........o',
      '.....#.....',
      '.....#.....',
      '...........',
    ],
  },
  {
    name: 'La patinoire',
    half: [
      '...........',
      '...........',
      '...##......',
      '.......~~~~',
      '.......~~~~',
      '..#....~~##',
      '..#....~~~~',
      '.......~~~~',
      '....H..~~~~',
      '.......~~~~',
      '..#....~~~~',
      '..#....~~##',
      '.......~~~~',
      '.......~~~~',
      '...##......',
      '...........',
      '...........',
    ],
  },
  {
    name: 'Les raccourcis',
    half: [
      '...........',
      '...........',
      '......*....',
      '...........',
      '..###...#..',
      '........#..',
      '...........',
      '.....#.....',
      '.....#.....',
      '.....#.....',
      '...........',
      '........#..',
      '..###...#..',
      '...........',
      '......+....',
      '...........',
      '...........',
    ],
  },
  {
    name: 'Le bois de nuit',
    night: true,
    half: [
      '...........',
      '....#......',
      '....#...o..',
      '........o..',
      '..##.......',
      '......##...',
      '...........',
      '.........#.',
      '.....o...#.',
      '.........#.',
      '...........',
      '......##...',
      '..##.......',
      '........o..',
      '....#...o..',
      '....#......',
      '...........',
    ],
  },
  {
    name: 'Le col venteux',
    wind: 90, // it blows down the table: the same for both teams
    half: [
      '...........',
      '...........',
      '..#....#...',
      '..#....#...',
      '...........',
      '.....oo....',
      '...........',
      '.##........',
      '.......####',
      '.##........',
      '...........',
      '.....oo....',
      '...........',
      '..#....#...',
      '..#....#...',
      '...........',
      '...........',
    ],
  },
];

const MIRROR: Record<string, string> = { '>': '<', '<': '>' };
function mirrorRow(half: string) {
  return half + [...half].reverse().map((c) => MIRROR[c] ?? c).join('');
}

export const CTF_ARENA_COUNT = HALVES.length;

/** The arena of a round (they take turns), with spawns beside each base: team 1 gets spawns 0 and 2, team 2 gets 1 and 3. */
export function ctfArena(round: number): ParsedLevel & { bases: [number, number][] } {
  const h = HALVES[((round % HALVES.length) + HALVES.length) % HALVES.length];
  const def: LevelDef = { name: h.name, map: h.half.map(mirrorRow), night: h.night, wind: h.wind };
  const lvl = parseLevel(def);
  lvl.enemies = [];
  const [[ax, ay], [bx, by]] = CTF_BASES;
  const spawns: [number, number][] = [];
  for (const [x, y] of [[ax, ay - 2], [bx, by - 2], [ax, ay + 2], [bx, by + 2]]) spawns.push(nearestFree(lvl.tiles, Math.floor(x), Math.floor(y), spawns));
  lvl.spawns = spawns;
  return { ...lvl, bases: CTF_BASES.map(([x, y]) => [x, y]) };
}

/** Team (1 or 2) of the i-th tank of the round: they alternate, so that 2 against 2 (or 1 against 1) comes out even. */
export const ctfTeam = (i: number) => (i % 2) + 1;

export function newFlags(bases: [number, number][]): CtfFlag[] {
  return bases.slice(0, 2).map(([hx, hy], i) => ({ team: i + 1, x: hx, y: hy, hx, hy, carrier: 0, state: 0, dropT: 0 }));
}
