// « Le ballon » (iteration 55): a match, Bleus against Rouges, with a big striped beach ball and two goals.
// Every shell that hits the ball sends it rolling away from the impact, every tank that drives into it pushes it
// along, and a mine's blast throws it across the table. Put the ball in the goal of the other team (the Bleus attack
// the goal on the right, the Rouges the one on the left) to take the round. Destroyed tanks come back at their side
// a moment later. No goal before the clock runs out: a draw. First team to BALL_TARGET goals.
import { H, ICE, W } from './constants';
import { mirrorRow } from './drapeau';
import { nearestFree, parseLevel, type ParsedLevel } from './levels';

export const BALL_TARGET = 3; // goals (rounds) to win the match
export const BALL_ROUND = 100; // seconds a round lasts at most (then it is a draw)
export const BALL_HURRY = 20; // seconds left on the clock when it turns red
export const BALL_RESPAWN = 2.5; // seconds before a destroyed tank is back on its side
export const BALL_R = 0.42; // radius of the ball (a tank is 0.36)
export const BALL_KICK = 4.6; // speed a shell gives the ball (tiles/s), added to what it already has
export const BALL_PUSH = 2.6; // speed of a ball pushed by a tank driving into it
export const BALL_BLAST = 7; // speed a mine's blast throws the ball at, right next to it (less further away)
export const BALL_MAX = 9; // the ball never rolls faster than this
export const BALL_DRAG = 0.6; // the ball slows down by this fraction each second (much less on ice)
export const BALL_ICE_DRAG = 0.12;
export const BALL_CAMBER = 1.7; // the pitch is hollow: within this distance of an edge (not in front of a goal), the ball rolls back toward the middle
export const BALL_SLOPE = 2.2; // how steep (tiles/s² per tile of depth into the edge)
export const BALL_BOUNCE = 0.72; // speed it keeps when it bounces off a wall
export const BALL_IDLE = 16; // seconds without anybody touching it: the ball goes back to the kick-off spot
export const GOAL_TOP = 6; // the mouth of each goal, along the short sides of the table (rows 6 to 10)
export const GOAL_BOTTOM = 11;
export const GOAL_LINE = 0.9; // the ball's centre past this distance from the edge, within the mouth: a goal
export const KICKOFF: [number, number] = [W / 2, H / 2];
/** The colours of the beach ball's six segments (and its white caps). */
export const BALL_COLORS = [0xe2453c, 0xfff4dc, 0x3d7bff, 0xfff4dc, 0xffc93a, 0xfff4dc] as const;

/** The ball of a round, kept by the simulation. */
export interface BallState {
  x: number; y: number;
  vx: number; vy: number;
  last: number; // the tank that touched it last (it scores the goal)
  idle: number; // seconds since a tank or a shell last touched it
  time: number; // seconds of play in this round
  scored: number; // the team that scored (0: not yet)
  scorer: number; // the tank credited with the goal (0: nobody, an own goal counts for the other team without a scorer)
}

export const newBall = (): BallState => ({ x: KICKOFF[0], y: KICKOFF[1], vx: 0, vy: 0, last: 0, idle: 0, time: 0, scored: 0, scorer: 0 });

/** The goal a team attacks: the Bleus (team 1, on the left) shoot to the right, the Rouges to the left. [x, y] of its middle. */
export const goalOf = (team: number): [number, number] => [team === 1 ? W - 0.4 : 0.4, (GOAL_TOP + GOAL_BOTTOM) / 2];
/** The goal a team defends. */
export const ownGoal = (team: number): [number, number] => goalOf(team === 1 ? 2 : 1);

/** Which team scores with the ball at (x, y): 2 in the left goal (the Bleus'), 1 in the right one, 0 none. */
export function goalAt(x: number, y: number): number {
  if (y <= GOAL_TOP || y >= GOAL_BOTTOM) return 0;
  if (x < GOAL_LINE) return 2;
  if (x > W - GOAL_LINE) return 1;
  return 0;
}

/**
 * The pitches, drawn as their left half (11 columns, the goal on the left): the right half is its mirror image. The
 * walls in the first column on rows 5 and 11 are the goalposts; rows 6 to 10 of the first two columns stay free.
 */
const PITCHES: { name: string; half: string[]; ice?: boolean }[] = [
  {
    name: 'Le stade',
    half: [
      '...........',
      '...........',
      '...##......',
      '...........',
      '.......o...',
      '#..........',
      '...........',
      '...........',
      '...........',
      '...........',
      '...........',
      '#..........',
      '.......o...',
      '...........',
      '...##......',
      '...........',
      '...........',
    ],
  },
  {
    name: 'Le terrain vague',
    half: [
      '...........',
      '.....__....',
      '.....__....',
      '..o........',
      '..o.....#..',
      '#.......#..',
      '...........',
      '......o....',
      '...........',
      '......o....',
      '...........',
      '#.......#..',
      '..o.....#..',
      '..o........',
      '.....__....',
      '.....__....',
      '...........',
    ],
  },
  {
    name: 'La patinoire',
    ice: true,
    half: [
      '...........',
      '...........',
      '...........',
      '..#........',
      '..#........',
      '#..........',
      '...........',
      '.......##..',
      '...........',
      '.......##..',
      '...........',
      '#..........',
      '..#........',
      '..#........',
      '...........',
      '...........',
      '...........',
    ],
  },
  {
    name: 'Les quatre piliers',
    half: [
      '...........',
      '...........',
      '...........',
      '....#......',
      '....#...o..',
      '#..........',
      '...........',
      '........#..',
      '...........',
      '........#..',
      '...........',
      '#..........',
      '....#...o..',
      '....#......',
      '...........',
      '...........',
      '...........',
    ],
  },
];

export const BALL_PITCH_COUNT = PITCHES.length;

/** The pitch of a round (they take turns), with spawns on each side: team 1 gets spawns 0 and 2, team 2 gets 1 and 3. */
export function ballArena(round: number): ParsedLevel {
  const p = PITCHES[((round % PITCHES.length) + PITCHES.length) % PITCHES.length];
  const map = p.half.map(mirrorRow);
  // the ice of « La patinoire » covers the middle of the pitch (between the goal areas)
  const lvl = parseLevel({ name: p.name, map });
  if (p.ice) {
    const belts = lvl.belts?.slice() ?? new Array(W * H).fill(0);
    for (let y = 1; y < H - 1; y++) for (let x = 4; x < W - 4; x++) if (lvl.tiles[y * W + x] === 0) belts[y * W + x] = ICE;
    lvl.belts = belts;
  }
  lvl.enemies = [];
  const spawns: [number, number][] = [];
  for (const [x, y] of [[3, 5], [W - 4, 5], [3, 11], [W - 4, 11]]) spawns.push(nearestFree(lvl.tiles, x, y, spawns));
  lvl.spawns = spawns;
  lvl.name = p.name;
  return lvl;
}
