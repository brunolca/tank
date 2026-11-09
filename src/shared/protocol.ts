import type { TankKind, Weapon } from './constants';
import type { DailyTwist } from './daily';
import type { Progress, Ranks } from './skills';
import type { CouncilState, TaupeResult } from './taupe';
import type { NetFlag } from './drapeau';

// 'daily' (the daily challenge) came with iteration 6: older tabs show it like the coop campaign at worst.
// 'taupe' (the hidden mole) came with iteration 8, and its 'council' phase: older tabs show a coop game that pauses.
// 'atelier' (a mission drawn in the workshop) came with iteration 14: older tabs are told to reload anyway (welcome.v).
// 'drapeau' (capture the flag, Bleus against Rouges) came with iteration 24: older tabs are told to reload (welcome.v).
export type Mode = 'coop' | 'versus' | 'daily' | 'taupe' | 'atelier' | 'drapeau';
export type Phase = 'lobby' | 'intro' | 'playing' | 'cleared' | 'failed' | 'roundEnd' | 'council' | 'gameover';

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  host: boolean;
  connected: boolean;
  score: number;
  weapon?: Weapon; // cannon picked in the lobby (iteration 7)
  bot?: number; // versus rival driven by the AI (iteration 17): its level, index in RIVAL_LEVELS
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
  sk?: Ranks; // player tanks, coop campaign (iteration 19): skills bought in each branch of the tree
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
// 64 boss charging a volley (or the Foreur spinning up), 128 boss enraged, 256 enemy has spotted a foe (night), 512 the Foreur is under the table. hp only for tanks with several hit points.
// iteration 21, tables with ice only: then [.., hp or null, vx, vy], the speed the tank slides at.
export type NetTank = [number, number, number, number, number, number, (number | null)?, number?, number?];
// bullet: [id, x, y, vx, vy, rocket, ownerTankId]
export type NetBullet = [number, number, number, number, number, number, number];
// mine: [id, x, y, blinking]
export type NetMine = [number, number, number, number] | [number, number, number, number, number]; // 5th: a seed of the Semeur (iteration 25), 1 + its age in tenths of a second
// bonus crate: [id, x, y, kind (index in BONUS_KINDS), blinking]
export type NetBonus = [number, number, number, number, number];

export type GameEvent =
  | ['shot', number, number, number, number, number] // x y ang rocket shooterId
  | ['bounce', number, number]
  | ['pop', number, number]
  | ['boom', number, number, number] // x y tankId
  | ['mineSet', number, number]
  | ['mboom', number, number] | ['mboom', number, number, number, number] // x y [radius ownerTankId]: a seed of the Semeur bursts (iteration 25)
  | ['block', number, number]
  | ['bonus', number, number, number, number] // x y kind tankId (picked up)
  | ['shield', number, number, number] // x y tankId (a shield absorbed a hit)
  | ['crate', number, number, number] // x y kind (a crate drops in)
  | ['hurt', number, number, number, number, number] // x y tankId hpLeft hpMax (a tough tank takes a hit)
  | ['volley', number, number, number] // x y tankId (the boss fires a ring of shells)
  | ['rage', number, number, number] // x y tankId (the boss is down to half health)
  | ['warp', number, number, number, number, number] // x0 y0 x1 y1 tankId (0 for a shell) went through a portal
  | ['ff', number, number, number, number] // x y victimTankId killerTankId: a player destroyed by a player (or by themselves), coop-like modes
  | ['zap', number, number, number] // x y seconds: a lightning strike is announced there (storm, iteration 9)
  | ['bolt', number, number] // x y: the lightning falls (older clients ignore both and just see the damage)
  | ['dig', number, number, number] // x y tankId: the Foreur goes under the table (iteration 11)
  | ['quake', number, number, number, number] // x y seconds tankId: the ground shakes where the Foreur is about to burst out
  | ['erupt', number, number, number] // x y tankId: it bursts out (older clients ignore all three and just see the damage)
  | ['build', number, number, number] // cx cy tankId: the Maçon lays a cork block on that cell (iteration 12; older tabs are told to reload)
  | ['loot', number, number, number] // x y bonusKind: a Pilleur is destroyed and drops a crate of what it stole (iteration 15)
  | ['call', number, number, number, number] // x y tankId strikes: the Grondeur calls the lightning (iteration 18; older clients ignore it, the strikes are plain 'zap')
  | ['rally', number, number, number, number] // x y tankId teammates: « Suis-moi ! », AI teammates come along (iteration 20; older clients ignore it)
  | ['deflect', number, number, number] // x y tankId: a shell bounced off the Rempart's shield (iteration 22; older clients ignore it)
  | ['sow', number, number, number, number] // x y tankId seeds: the Semeur throws its seeds (iteration 25; older clients ignore it, the seeds are plain mines to them)
  | ['flag', number, number, number, number, number]; // x y flagTeam tankId what: « Drapeaux » (iteration 24), 0 grabbed, 1 dropped, 2 sent home (tankId 0: by itself), 3 brought home (a capture), 4 a tank is back at its base, 5 thirty seconds left

/** A mission drawn in the workshop (iteration 14): 17 rows of 22 map characters. */
export interface AtelierMap { name: string; map: string[]; night?: boolean; storm?: boolean; wind?: boolean } // wind: iteration 23, it blows to the right

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
  atelier?: { name: string; won: boolean }; // workshop mission (iteration 14)
  drapeau?: { teams: [number, number]; winner: number }; // « Drapeaux » (iteration 24): rounds won by each team, the winning team (1 or 2)
  // ff: teammates destroyed (coop-like modes, iteration 8)
  // g: galons earned in the coop campaign (iteration 19)
  // team: « Drapeaux », 1 Bleus or 2 Rouges; caps: flags they brought home
  players: { id: string; name: string; color: number; kills: Partial<Record<TankKind, number>>; deaths: number; score: number; ff?: number; bot?: number; g?: number; team?: number; caps?: number }[];
  winner?: string;
}

export type ServerMsg =
  | { t: 'welcome'; id: string; room: string; v?: number } // v: the server's iteration (iteration 10), so an old tab knows to reload
  | { t: 'lobby'; players: PlayerInfo[]; mode: Mode; phase: Phase; from?: number; atelier?: AtelierMap } // from: mission the coop campaign starts at; atelier: the host's workshop mission
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
      storm?: 1; // storm: lightning strikes (iteration 9; older clients see tanks blow up without the lightning)
      wind?: number; // wind (iteration 23): where it mainly blows (radians); the gust of the moment follows from the tick (see wind.ts). Older clients just see the shells curve
      belts?: number[]; // conveyor belts, one code per cell (iteration 16; older tabs are told to reload, at worst they see tanks glide)
      daily?: DailyState;
      bases?: number[]; // « Drapeaux » (iteration 24): x1 y1 x2 y2, the bases of the Bleus (team 1) and the Rouges (team 2)
    }
  | {
      t: 'phase'; phase: Phase; mission: number; lives: number; enemies: number; text?: string; results?: Results; scores?: Record<string, number>; daily?: DailyState;
      council?: CouncilState; // mole mode: the vote after each mission
      stages?: number; // mole mode: number of stages
      prog?: Record<string, Progress>; // coop campaign (iteration 19): experience, galons and skills of each player
      training?: string[]; // coop campaign, end of a mission: players still choosing their skills
      teams?: [number, number]; // « Drapeaux » (iteration 24): rounds won by the Bleus and the Rouges
      win?: number; // « Drapeaux », end of a round: the team that took it (0: a draw)
      left?: number; // « Drapeaux »: seconds left in the round (the clock runs on each side while it is played)
    }
  | { t: 'role'; mole: boolean } // mole mode: sent privately to each player
  | { t: 'snap'; k: number; a: number; T: NetTank[]; B: NetBullet[]; M: NetMine[]; E: GameEvent[]; P?: NetBonus[]; F?: NetFlag[] } // F: the flags (iteration 24)
  | { t: 'pong'; c: number }
  | { t: 'error'; msg: string };

export type ClientMsg =
  | { t: 'hello'; name: string; color: number }
  | { t: 'mode'; mode: Mode }
  | { t: 'arm'; w: Weapon } // pick a cannon (iteration 7, applies from the next mission)
  | { t: 'from'; n: number } // host: start the campaign at a checkpoint (1, 6, 11…)
  | { t: 'atelier'; name: string; map: string[]; night?: boolean; storm?: boolean; wind?: boolean } // host: the workshop mission to play (iteration 14; also switches to that mode)
  | { t: 'rival'; op: 'add' | 'del' | 'lvl'; id?: string } // host, versus lobby: add an AI rival, remove one, or change its level (iteration 17)
  | { t: 'order' } // coop campaign (iteration 20): « Suis-moi ! », the AI teammates come to the sender's tank
  | { t: 'skill'; b: number } // coop campaign (iteration 19): buy the next rank of branch b (0 to 2), or -1 « ready » at the end of a mission
  | { t: 'vote'; who: string } // mole mode, during a council: the pid accused ('' = nobody)
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'in'; i: Input[] }
  | { t: 'ping'; c: number };
