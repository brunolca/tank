export const W = 22;
export const H = 17;
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SUBSTEPS = 2;

export const TANK_R = 0.36;
export const BOSS_R = 0.62;
export const DRILL_R = 0.56;
export const THUNDER_R = 0.58;
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
  PortalA = 5, // portals come in pairs: a tank or a shell entering one pops out of its twin
  PortalB = 6,
  Tunnel = 7, // iteration 13: a covered passage, tanks drive through and hide inside, shells bounce off its roof
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
  | 'black'
  | 'boss'
  | 'steel'
  | 'drill'
  | 'mason'
  | 'thief'
  | 'thunder';

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
  hp?: number; // hits it takes to go down (1 when omitted)
  size?: number; // hull radius (TANK_R when omitted)
  reaction: number; // seconds between spotting a shot and pulling the trigger
  aimError: number; // max angular error (radians) when firing
  label: string;
}

export const SPECS: Record<TankKind, TankSpec> = {
  player: { speed: 3.0, maxBullets: 5, bounces: 1, rocket: false, fireCd: 0.14, turretSpeed: 99, mines: 2, skill: 0, reaction: 0.2, aimError: 0.03, label: 'Joueur' },
  brown: { speed: 0, maxBullets: 1, bounces: 1, rocket: false, fireCd: 3.2, turretSpeed: 0.8, mines: 0, skill: 0, reaction: 0.7, aimError: 0.1, label: 'Brun' },
  ash: { speed: 1.2, maxBullets: 1, bounces: 1, rocket: false, fireCd: 2.4, turretSpeed: 1.6, mines: 0, skill: 1, reaction: 0.6, aimError: 0.09, label: 'Gris' },
  marine: { speed: 1.2, maxBullets: 1, bounces: 0, rocket: true, fireCd: 2.8, turretSpeed: 1.8, mines: 0, skill: 1, reaction: 0.8, aimError: 0.08, label: 'Turquoise' },
  yellow: { speed: 2.2, maxBullets: 1, bounces: 1, rocket: false, fireCd: 2.4, turretSpeed: 1.8, mines: 4, skill: 1, reaction: 0.6, aimError: 0.09, label: 'Jaune' },
  pink: { speed: 1.5, maxBullets: 3, bounces: 1, rocket: false, fireCd: 0.9, turretSpeed: 2.2, mines: 0, skill: 2, reaction: 0.45, aimError: 0.07, label: 'Rose' },
  green: { speed: 0, maxBullets: 2, bounces: 2, rocket: true, fireCd: 1.8, turretSpeed: 2.6, mines: 0, skill: 3, reaction: 0.5, aimError: 0.035, label: 'Vert' },
  violet: { speed: 2.5, maxBullets: 5, bounces: 1, rocket: false, fireCd: 0.65, turretSpeed: 2.8, mines: 2, skill: 2, reaction: 0.35, aimError: 0.06, label: 'Violet' },
  white: { speed: 1.8, maxBullets: 5, bounces: 1, rocket: false, fireCd: 0.8, turretSpeed: 2.6, mines: 2, skill: 2, invisible: true, reaction: 0.4, aimError: 0.06, label: 'Blanc' },
  black: { speed: 3.3, maxBullets: 3, bounces: 0, rocket: true, fireCd: 0.9, turretSpeed: 3.8, mines: 2, skill: 3, reaction: 0.3, aimError: 0.04, label: 'Noir' },
  boss: { speed: 1.05, maxBullets: 4, bounces: 1, rocket: false, fireCd: 0.75, turretSpeed: 2.2, mines: 3, skill: 2, reaction: 0.4, aimError: 0.05, hp: 8, size: BOSS_R, label: 'Colosse' },
  // iteration 10: armour plates soak up the first hit, then it sheds its weight (see STEEL_STRIPPED)
  steel: { speed: 0.95, maxBullets: 2, bounces: 1, rocket: false, fireCd: 1.5, turretSpeed: 2.2, mines: 0, skill: 2, hp: 2, reaction: 0.5, aimError: 0.06, label: 'Acier' },
  // iteration 11: the second boss, it digs under the table and bursts out beneath its prey (see DRILL_*)
  drill: { speed: 1.35, maxBullets: 3, bounces: 1, rocket: false, fireCd: 1.1, turretSpeed: 2.4, mines: 0, skill: 2, reaction: 0.45, aimError: 0.06, hp: 8, size: DRILL_R, label: 'Foreur' },
  // iteration 12: it lays cork blocks between itself and its prey (see MASON_*)
  mason: { speed: 1.6, maxBullets: 2, bounces: 1, rocket: false, fireCd: 1.7, turretSpeed: 2, mines: 0, skill: 1, reaction: 0.55, aimError: 0.08, label: 'Maçon' },
  // iteration 15: it races the players to the bonus crates and keeps them for itself (see THIEF_*)
  thief: { speed: 2.5, maxBullets: 2, bounces: 1, rocket: false, fireCd: 1.5, turretSpeed: 2.6, mines: 0, skill: 1, reaction: 0.5, aimError: 0.09, label: 'Pilleur' },
  // iteration 18: the third boss, it calls lightning down on its foes (see THUNDER_*)
  thunder: { speed: 1.15, maxBullets: 3, bounces: 1, rocket: false, fireCd: 1.2, turretSpeed: 2.3, mines: 0, skill: 2, reaction: 0.45, aimError: 0.06, hp: 8, size: THUNDER_R, label: 'Grondeur' },
};

/** The steel tank once its armour is blown off: lighter, faster, angrier. */
export const STEEL_STRIPPED: Partial<TankSpec> = { speed: 2.4, fireCd: 0.8, turretSpeed: 3.4, reaction: 0.35 };

/** Sheet of an enemy kind, with a harmless fallback for kinds this build does not know (a newer server). */
export function specOf(kind: string): TankSpec {
  return SPECS[kind as TankKind] ?? SPECS.ash;
}
/** Colour of a tank kind (enemies), with a fallback for unknown kinds. */
export function enemyColor(kind: string): number {
  return ENEMY_COLORS[kind as TankKind] ?? 0x8f979e;
}

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
  boss: 0xb8323a,
  steel: 0x56708f,
  drill: 0xd9822b,
  mason: 0x7b7430,
  thief: 0x8e2a4e,
  thunder: 0x34508f,
};

/** Hull radius of a tank kind (the boss is much bigger than everyone else). */
export function tankRadius(kind: TankKind) {
  return SPECS[kind]?.size ?? TANK_R;
}

// ------------------------------------------------------------------ boss
export const BOSS_VOLLEY_WARN = 0.9; // seconds of glowing warning before a radial volley
export const BOSS_VOLLEY_EVERY: [number, number] = [7.5, 4.8]; // calm, then enraged
export const BOSS_VOLLEY_SHOTS: [number, number] = [10, 14];
/** Extra hit points per extra player, so the boss lasts in a crowd too. */
export const BOSS_HP_PER_PLAYER = 3;
// flags bits used by the boss (after the bonus flags)
export const FLAG_CHARGING = 64;
export const FLAG_RAGE = 128;

// ------------------------------------------------------------------ the Foreur (iteration 11): the boss that digs
/** Seconds it spins its drill on the spot before going under (flag FLAG_CHARGING meanwhile). */
export const DRILL_DIG_WARN = 0.8;
/** Seconds between two dives (calm, then enraged). */
export const DRILL_DIG_EVERY: [number, number] = [6.5, 4.4];
/** Speed under the table (calm, then enraged): a bit slower than a player, so running away works. */
export const DRILL_UNDER_SPEED: [number, number] = [2.4, 2.9];
/** Longest trip under the table, in seconds (calm, then enraged). */
export const DRILL_UNDER_MAX: [number, number] = [3.4, 3];
/** Seconds the ground shakes where it is about to burst out (calm, then enraged). */
export const DRILL_RISE_WARN: [number, number] = [1.2, 0.95];
/** Reach of the burst: tanks, shells and cork in it are gone, mines go off. */
export const DRILL_BLAST = 1.45;
/** Enraged, it also throws a ring of shells as it comes out. */
export const DRILL_RING_SHOTS = 8;
/** Flags bit: the Foreur is under the table (nothing can touch it, it touches nothing). */
export const FLAG_BURROW = 512;
/** The three bosses that take turns every ten missions. */
export const isBossKind = (k: string) => k === 'boss' || k === 'drill' || k === 'thunder';

// ------------------------------------------------------------------ the Grondeur (iteration 18): the boss that calls the lightning
/** Seconds between two calls (calm, then enraged). */
export const THUNDER_EVERY: [number, number] = [6.2, 4.3];
/** Seconds it holds still, antenna up, before the strikes are announced (flag FLAG_CHARGING meanwhile). */
export const THUNDER_WARN = 0.85;
/** Strikes called on each foe (calm, then enraged: one on the spot, one where it is heading). */
export const THUNDER_PER_FOE: [number, number] = [1, 2];
/** Most strikes of one call. */
export const THUNDER_MAX = 5;

// ------------------------------------------------------------------ the Maçon (iteration 12): the tank that builds cork walls
/** Seconds between two blocks (min, max); the first one comes MASON_FIRST seconds into the mission. */
export const MASON_EVERY: [number, number] = [3.6, 5.6];
export const MASON_FIRST = 2.5;
/** Most of its blocks standing at once: once some are blown away, it builds again. */
export const MASON_MAX = 6;
/** It builds within this distance of its own centre (tiles). */
export const MASON_REACH = 2.6;

// ------------------------------------------------------------------ the Pilleur (iteration 15): the tank that steals the bonus crates
/** While a Pilleur is around, crates fall this much more often (there is something to fight over). */
export const THIEF_CRATE_RUSH = 1.8;
/** It heads for a crate within this many steps of its path (the other tanks only look 9 steps ahead). */
export const THIEF_REACH = 40;

// ------------------------------------------------------------------ portals
/** Colour of each portal pair (Tile.PortalA, Tile.PortalB). */
export const PORTAL_COLORS = [0x4fc3ff, 0xff5fd2];
/** Tanks bigger than this (the boss) are too wide to squeeze through a portal. */
export const PORTAL_MAX_R = 0.45;

// ------------------------------------------------------------------ conveyor belts (iteration 16)
/** Map characters of the four belt directions (a separate layer under the tiles: the cell itself stays floor). */
export const BELT_CHARS = ['>', '<', '^', 'V'] as const;
/** Direction of each belt code (1 → right, 2 → left, 3 → up, 4 → down), index 0 unused. */
export const BELT_DIRS: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1]];
/** How fast a belt carries tanks, mines and crates (tiles per second; a player drives at 3). */
export const BELT_SPEED = 1.45;

// ------------------------------------------------------------------ ice (iteration 21)
/** Map character of an ice cell. Ice lives in the same floor layer as the belts (code ICE), the cell itself stays floor. */
export const ICE_CHAR = '~';
/** Floor-layer code of an ice cell (1 to 4 are the belts). */
export const ICE = 5;
/** Grip on ice (per second): how fast a tank's sliding speed bends toward where its driver steers. Low = slippery. */
export const ICE_GRIP = 1.7;

// ------------------------------------------------------------------ night
/** At night the AI only makes out foes this close (tiles), unless they just gave themselves away by firing. */
export const NIGHT_SIGHT = 4.5;
/** Seconds a muzzle flash keeps a tank visible to everyone at night. */
export const NIGHT_REVEAL = 1.6;
/** Flags bit: this enemy has spotted a foe (the client shows a « ! » at night). */
export const FLAG_ALERT = 256;

export const PLAYER_COLORS = [0x3d7bff, 0xff4d5e, 0x2fd07a, 0xffa63d, 0x26c6f0, 0xc66bff];

export function isSolidTank(t: number) {
  return t !== Tile.Empty && t !== Tile.Tunnel && !isPortal(t);
}
export function isPortal(t: number) {
  return t === Tile.PortalA || t === Tile.PortalB;
}
export function isSolidBullet(t: number) {
  return t === Tile.Wall || t === Tile.Tall || t === Tile.Cork || t === Tile.Tunnel;
}
export function isTunnel(t: number) {
  return t === Tile.Tunnel;
}
/** Below this distance an enemy still makes out a tank hiding in a tunnel (iteration 13). */
export const TUNNEL_SIGHT = 1.6;

// ------------------------------------------------------------------ bonus crates
// The index in BONUS_KINDS is what travels on the wire: append new kinds, never reorder.
export const BONUS_KINDS = ['shield', 'bounce', 'turbo', 'fan'] as const;
export type BonusKind = (typeof BONUS_KINDS)[number];
export const BONUS_R = 0.32;
export const BONUS_LIFE = 16; // seconds a crate waits on the floor
export const BONUS_INFO: Record<BonusKind, { label: string; color: number; duration: number; flag: number }> = {
  shield: { label: 'Bouclier', color: 0x4fd1ff, duration: 0, flag: 4 }, // lasts until it absorbs a hit
  bounce: { label: 'Super-ricochet', color: 0xffb43d, duration: 12, flag: 16 },
  turbo: { label: 'Turbo', color: 0x6be36b, duration: 10, flag: 8 },
  fan: { label: 'Tir en éventail', color: 0xff6fb0, duration: 10, flag: 32 },
};
export const TURBO_MULT = 1.45;
export const FAN_SPREAD = 0.2;

// ------------------------------------------------------------------ arsenal (iteration 7)
// Each player picks a cannon in the lobby. The index in WEAPONS is the wire order: append, never reorder.
export const WEAPONS = ['canon', 'ricochet', 'fusee', 'sapeur'] as const;
export type Weapon = (typeof WEAPONS)[number];
export const WEAPON_INFO: Record<Weapon, { label: string; desc: string; spec: Partial<TankSpec> }> = {
  canon: { label: 'Canon', desc: '5 obus · 1 rebond · 2 mines', spec: {} },
  ricochet: { label: 'Ricocheur', desc: '3 obus · 2 rebonds · 2 mines', spec: { maxBullets: 3, bounces: 2, fireCd: 0.2 } },
  fusee: { label: 'Fusée', desc: '3 missiles rapides · sans rebond', spec: { maxBullets: 3, bounces: 0, rocket: true, fireCd: 0.22 } },
  sapeur: { label: 'Sapeur', desc: '3 obus · 1 rebond · 5 mines', spec: { maxBullets: 3, mines: 5 } },
};
export function isWeapon(w: unknown): w is Weapon {
  return typeof w === 'string' && (WEAPONS as readonly string[]).includes(w);
}
/** A player tank's sheet once armed with a given cannon. */
export function playerSpec(w: Weapon = 'canon'): TankSpec {
  return { ...SPECS.player, ...WEAPON_INFO[w].spec };
}
/** Seconds the room waits for shells still in flight once a mission or a round is decided (nobody may fire meanwhile). */
export const SETTLE_MAX = 1.5;
/** Campaign checkpoints: the host may start at mission 1, 6, 11, 16… once someone on that browser got that far. */
export const CHECKPOINT_EVERY = 5;
export function isCheckpoint(n: number) {
  return Number.isInteger(n) && n >= 1 && n <= 201 && (n - 1) % CHECKPOINT_EVERY === 0;
}

// ------------------------------------------------------------------ storm (iteration 9)
/** Seconds a lightning strike is announced (a crackling ring on the floor) before it falls. */
export const BOLT_WARN = 1.4;
/** Radius of a lightning strike: it destroys tanks, shells and cork, and sets mines off. */
export const BOLT_R = 1.05;
/** Seconds between two strikes (min, max). */
export const BOLT_EVERY: [number, number] = [2.6, 4.6];
/** Seconds the whole table stays lit after a strike: at night the AI sees everyone meanwhile. */
export const BOLT_FLASH = 0.9;
