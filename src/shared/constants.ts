export const W = 22;
export const H = 17;
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SUBSTEPS = 2;

export const TANK_R = 0.36;
export const BULLET_R = 0.09;
export const MINE_R = 0.22;
export const MINE_BLAST = 1.55;
export const MINE_FUSE = 10;
export const MINE_TRIGGER_R = 1.25;
export const BULLET_SPEED = 6.2;
export const ROCKET_SPEED = 10.5;

export const enum Tile {
  Empty = 0,
  Wall = 1,
  Tall = 2,
  Cork = 3,
  Hole = 4,
}

export type TankKind =
  | 'player'
  | 'brown'
  | 'ash'
  | 'marine'
  | 'yellow'
  | 'pink'
  | 'green'
  | 'violet'
  | 'white'
  | 'black';

export interface TankSpec {
  speed: number;
  maxBullets: number;
  bounces: number;
  rocket: boolean;
  fireCd: number;
  turretSpeed: number;
  mines: number;
  skill: number; // 0 = scan only, 1 = direct, 2 = ricochet, 3 = ricochet + lead
  invisible?: boolean;
  label: string;
}

export const SPECS: Record<TankKind, TankSpec> = {
  player: { speed: 3.0, maxBullets: 5, bounces: 1, rocket: false, fireCd: 0.14, turretSpeed: 99, mines: 2, skill: 0, label: 'Joueur' },
  brown: { speed: 0, maxBullets: 1, bounces: 1, rocket: false, fireCd: 2.4, turretSpeed: 1.1, mines: 0, skill: 0, label: 'Brun' },
  ash: { speed: 1.3, maxBullets: 1, bounces: 1, rocket: false, fireCd: 1.8, turretSpeed: 2.2, mines: 0, skill: 1, label: 'Gris' },
  marine: { speed: 1.3, maxBullets: 1, bounces: 0, rocket: true, fireCd: 1.6, turretSpeed: 2.8, mines: 0, skill: 1, label: 'Turquoise' },
  yellow: { speed: 2.4, maxBullets: 1, bounces: 1, rocket: false, fireCd: 2.0, turretSpeed: 2.2, mines: 4, skill: 1, label: 'Jaune' },
  pink: { speed: 1.6, maxBullets: 3, bounces: 1, rocket: false, fireCd: 0.55, turretSpeed: 2.8, mines: 0, skill: 2, label: 'Rose' },
  green: { speed: 0, maxBullets: 2, bounces: 2, rocket: true, fireCd: 1.3, turretSpeed: 3.5, mines: 0, skill: 3, label: 'Vert' },
  violet: { speed: 2.7, maxBullets: 5, bounces: 1, rocket: false, fireCd: 0.45, turretSpeed: 3.5, mines: 2, skill: 2, label: 'Violet' },
  white: { speed: 1.9, maxBullets: 5, bounces: 1, rocket: false, fireCd: 0.6, turretSpeed: 3.2, mines: 2, skill: 2, invisible: true, label: 'Blanc' },
  black: { speed: 3.5, maxBullets: 3, bounces: 0, rocket: true, fireCd: 0.65, turretSpeed: 5, mines: 2, skill: 3, label: 'Noir' },
};

export const ENEMY_COLORS: Record<TankKind, number> = {
  player: 0x3d7bff,
  brown: 0x8b5a2b,
  ash: 0x8f979e,
  marine: 0x22b3a3,
  yellow: 0xf2c230,
  pink: 0xff7eb6,
  green: 0x3f9e3a,
  violet: 0x8a4fd6,
  white: 0xeeeeee,
  black: 0x2a2a30,
};

export const PLAYER_COLORS = [0x3d7bff, 0xff4d5e, 0x2fd07a, 0xffa63d, 0x26c6f0, 0xc66bff];

export function isSolidTank(t: number) {
  return t !== Tile.Empty;
}
export function isSolidBullet(t: number) {
  return t === Tile.Wall || t === Tile.Tall || t === Tile.Cork;
}
