import type { TankKind } from './constants';

export type Mode = 'coop' | 'versus';
export type Phase = 'lobby' | 'intro' | 'playing' | 'cleared' | 'failed' | 'roundEnd' | 'gameover';

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  host: boolean;
  connected: boolean;
  score: number;
}

export interface TankInfo {
  id: number;
  kind: TankKind;
  team: number;
  pid?: string;
  name?: string;
  color: number;
}

export interface Input {
  s: number; // sequence
  mx: number;
  my: number;
  a: number; // turret angle
  f: 0 | 1; // fire
  m: 0 | 1; // mine
}

// tank: [id, x, y, body, turret, flags]  flags: 1 alive, 2 invisible, then BONUS_INFO[*].flag (4 shield, 8 turbo, 16 bounce, 32 fan)
export type NetTank = [number, number, number, number, number, number];
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
  | ['crate', number, number, number]; // x y kind (a crate drops in)

export interface Results {
  mode: Mode;
  mission?: number;
  players: { id: string; name: string; color: number; kills: Partial<Record<TankKind, number>>; deaths: number; score: number }[];
  winner?: string;
}

export type ServerMsg =
  | { t: 'welcome'; id: string; room: string }
  | { t: 'lobby'; players: PlayerInfo[]; mode: Mode; phase: Phase }
  | {
      t: 'level';
      mode: Mode;
      mission: number;
      name: string;
      tiles: number[];
      tanks: TankInfo[];
      lives: number;
      tick: number;
    }
  | { t: 'phase'; phase: Phase; mission: number; lives: number; enemies: number; text?: string; results?: Results; scores?: Record<string, number> }
  | { t: 'snap'; k: number; a: number; T: NetTank[]; B: NetBullet[]; M: NetMine[]; E: GameEvent[]; P?: NetBonus[] }
  | { t: 'pong'; c: number }
  | { t: 'error'; msg: string };

export type ClientMsg =
  | { t: 'hello'; name: string; color: number }
  | { t: 'mode'; mode: Mode }
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'in'; i: Input[] }
  | { t: 'ping'; c: number };
