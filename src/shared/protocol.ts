import type { TankKind, Weapon } from './constants';
import type { DailyTwist } from './daily';
import type { CouncilState, TaupeResult } from './taupe';

// 'daily' (the daily challenge) came with iteration 6: older tabs show it like the coop campaign at worst.
// 'taupe' (the hidden mole) came with iteration 8, and its 'council' phase: older tabs show a coop game that pauses.
export type Mode = 'coop' | 'versus' | 'daily' | 'taupe';
export type Phase = 'lobby' | 'intro' | 'playing' | 'cleared' | 'failed' | 'roundEnd' | 'council' | 'gameover';

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  host: boolean;
  connected: boolean;
  score: number;
  weapon?: Weapon; // cannon picked in the lobby (iteration 7)
}

export interface TankInfo {
  id: number;
  kind: TankKind;
  team: number;
  pid?: string;
  name?: string;
  color: number;
  hp?: number; // max hit points, only sent for tanks that take more than one hit (the boss)
  w?: Weapon; // player tanks: the cannon picked in the lobby (canon when omitted; older clients draw a plain cannon)
}

export interface Input {
  s: number; // sequence
  mx: number;
  my: number;
  a: number; // turret angle
  f: 0 | 1; // fire
  m: 0 | 1; // mine
}

// tank: [id, x, y, body, turret, flags, hp?]  flags: 1 alive, 2 invisible, then BONUS_INFO[*].flag (4 shield, 8 turbo, 16 bounce, 32 fan),
// 64 boss charging a volley, 128 boss enraged, 256 enemy has spotted a foe (night). hp only for tanks with several hit points.
export type NetTank = [number, number, number, number, number, number, number?];
// bullet: [id, x, y, vx, vy, rocket, ownerTankId]
export type NetBullet = [number, number, number, number, number, number, number];
// mine: [id, x, y, blinking]
export type NetMine = [number, number, number, number];
// bonus crate: [id, x, y, kind (index in BONUS_KINDS), blinking]
export type NetBonus = [number, number, number, number, number];

export type GameEvent =
  | ['shot', number, number, number, number, number] // x y ang rocket shooterId
  | ['bounce', number, number]
  | ['pop', number, number]
  | ['boom', number, number, number] // x y tankId
  | ['mineSet', number, number]
  | ['mboom', number, number]
  | ['block', number, number]
  | ['bonus', number, number, number, number] // x y kind tankId (picked up)
  | ['shield', number, number, number] // x y tankId (a shield absorbed a hit)
  | ['crate', number, number, number] // x y kind (a crate drops in)
  | ['hurt', number, number, number, number, number] // x y tankId hpLeft hpMax (a tough tank takes a hit)
  | ['volley', number, number, number] // x y tankId (the boss fires a ring of shells)
  | ['rage', number, number, number] // x y tankId (the boss is down to half health)
  | ['warp', number, number, number, number, number] // x0 y0 x1 y1 tankId (0 for a shell) went through a portal
  | ['ff', number, number, number, number]; // x y victimTankId killerTankId: a player destroyed by a player (or by themselves), coop-like modes

/** One finished run on the daily board. */
export interface BoardEntry {
  team: { name: string; color: number }[];
  cleared: number; // stages cleared (DAILY_STAGES = the whole challenge)
  ticks: number; // simulation ticks spent fighting (30 per second)
  lives: number; // lives left at the end
}

/** The board of one day: best runs first (most stages, then fastest). */
export interface BoardDay {
  day: number;
  twist: DailyTwist;
  entries: BoardEntry[];
  total: number; // runs recorded that day
  rank?: number; // rank of the run just submitted (1 = best)
}

/** Daily challenge progress, sent with the level and phase messages. */
export interface DailyState {
  day: number;
  twist: DailyTwist;
  stage: number;
  stages: number;
  ticks: number; // fighting time so far
}

export interface Results {
  mode: Mode;
  mission?: number;
  daily?: { state: DailyState; cleared: number; board?: BoardDay };
  taupe?: TaupeResult & { cleared: number; stages: number };
  // ff: teammates destroyed (coop-like modes, iteration 8)
  players: { id: string; name: string; color: number; kills: Partial<Record<TankKind, number>>; deaths: number; score: number; ff?: number }[];
  winner?: string;
}

export type ServerMsg =
  | { t: 'welcome'; id: string; room: string }
  | { t: 'lobby'; players: PlayerInfo[]; mode: Mode; phase: Phase; from?: number } // from: mission the coop campaign starts at
  | {
      t: 'level';
      mode: Mode;
      mission: number;
      name: string;
      tiles: number[];
      tanks: TankInfo[];
      lives: number;
      tick: number;
      night?: 1; // night mission (older clients just play it in daylight)
      daily?: DailyState;
    }
  | {
      t: 'phase'; phase: Phase; mission: number; lives: number; enemies: number; text?: string; results?: Results; scores?: Record<string, number>; daily?: DailyState;
      council?: CouncilState; // mole mode: the vote after each mission
      stages?: number; // mole mode: number of stages
    }
  | { t: 'role'; mole: boolean } // mole mode: sent privately to each player
  | { t: 'snap'; k: number; a: number; T: NetTank[]; B: NetBullet[]; M: NetMine[]; E: GameEvent[]; P?: NetBonus[] }
  | { t: 'pong'; c: number }
  | { t: 'error'; msg: string };

export type ClientMsg =
  | { t: 'hello'; name: string; color: number }
  | { t: 'mode'; mode: Mode }
  | { t: 'arm'; w: Weapon } // pick a cannon (iteration 7, applies from the next mission)
  | { t: 'from'; n: number } // host: start the campaign at a checkpoint (1, 6, 11…)
  | { t: 'vote'; who: string } // mole mode, during a council: the pid accused ('' = nobody)
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'in'; i: Input[] }
  | { t: 'ping'; c: number };
