import { H, W, Tile, TankKind } from './constants';

// Legend: . empty  # wall  H tall wall  o cork (destructible)  _ hole
//         * + portals (each symbol appears exactly twice: going into one pops you out of the other)
//         1 2 player spawns
//         b brown  a ash  m marine  y yellow  p pink  g green  v violet  w white  k black  X boss
const ENEMY_CHARS: Record<string, TankKind> = {
  b: 'brown', a: 'ash', m: 'marine', y: 'yellow', p: 'pink', g: 'green', v: 'violet', w: 'white', k: 'black', X: 'boss',
};

export interface LevelDef {
  name: string;
  map: string[];
  night?: boolean; // dark table: the AI only sees up close (or a muzzle flash), players drive with headlights
}

export const LEVELS: LevelDef[] = [
  {
    name: 'Premier contact',
    map: [
      '......................',
      '......................',
      '......................',
      '......................',
      '......................',
      '..........##..........',
      '..........##..........',
      '..1.......##..........',
      '..........##......b...',
      '..2.......##..........',
      '..........##..........',
      '..........##..........',
      '......................',
      '......................',
      '......................',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Les deux tours',
    map: [
      '......................',
      '......................',
      '...######.............',
      '........#.........a...',
      '........#.............',
      '........#.............',
      '......................',
      '..1...................',
      '......................',
      '..2...................',
      '......................',
      '.............#........',
      '.............#........',
      '.............#........',
      '...a.........######...',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Bouchons',
    map: [
      '......................',
      '..1...................',
      '......................',
      '..2.....oooooo........',
      '........o....o........',
      '....##..o....o..##....',
      '....#...........a#....',
      '....#....HH......#....',
      '.........HH...........',
      '....#....HH......#....',
      '....#.b..........#....',
      '....##..o....o..##....',
      '........o....o........',
      '........oooooo........',
      '..................a...',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Missiles',
    map: [
      '......................',
      '......................',
      '..1......#............',
      '.........#.......m....',
      '..2......#............',
      '.........#.....####...',
      '.........#............',
      '......................',
      '....######..######....',
      '......................',
      '............#.........',
      '...####.....#.........',
      '............#.........',
      '....m.......#.........',
      '............#.........',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Champ de mines',
    map: [
      '......................',
      '.1....................',
      '......o......o........',
      '.2....o......o....y...',
      '......o......o........',
      '...oooo..##..oooo.....',
      '.........##...........',
      '......................',
      '...y.....__.....y.....',
      '.........__...........',
      '......................',
      '.........##...........',
      '...oooo..##..oooo.....',
      '......o......o........',
      '......o......o........',
      '......o......o........',
      '......................',
    ],
  },
  {
    name: 'Escouade',
    map: [
      '......................',
      '...........*..........',
      '..1..#........#.......',
      '.....#........#...a...',
      '..2..#..####..#.......',
      '.....#........#.......',
      '..........b...........',
      '...####..........##...',
      '......................',
      '...##..........####...',
      '...........m..........',
      '.......#........#.....',
      '.......#..####..#..a..',
      '.......#........#.....',
      '...*...#........#.....',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Rafales roses',
    map: [
      '......................',
      '......................',
      '..1...................',
      '.......___....___.....',
      '..2...................',
      '.........H....H.......',
      '.........H....H...p...',
      '.....####H....H####...',
      '......................',
      '.....####H....H####...',
      '.........H....H.......',
      '.........H....H.......',
      '..................p...',
      '.......___....___.....',
      '......................',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Snipers',
    map: [
      '......................',
      '......................',
      '...................g..',
      '..1...........#####...',
      '..............#.......',
      '..2...........#.......',
      '......####............',
      '......#...............',
      '......#.......___.....',
      '......#...............',
      '......####............',
      '..............#.......',
      '..............#.......',
      '..............#####...',
      '...................g..',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Labyrinthe',
    map: [
      '......................',
      '.1....#.......#.......',
      '......#...p...#...y...',
      '.2....#.......#.......',
      '......###...###.......',
      '......................',
      '..oo......##......oo..',
      '..........##..........',
      '....m.....##.....m....',
      '..........##..........',
      '..oo......##......oo..',
      '......................',
      '.......###...###......',
      '.........#...#........',
      '.........#...#........',
      '.........#...#........',
      '......................',
    ],
  },
  {
    name: 'Le Colosse',
    map: [
      '......................',
      '......................',
      '..1.......oo..........',
      '.......H.........H....',
      '..2....H.........H....',
      '......................',
      '.....oo...............',
      '...............a......',
      '..........H...........',
      '..........H.....X.....',
      '.....oo...............',
      '...............a......',
      '......................',
      '.......H.........H....',
      '.......H.........H....',
      '..........oo..........',
      '......................',
    ],
  },
  {
    name: 'Ombres violettes',
    map: [
      '......................',
      '......................',
      '..1...................',
      '........o.....o.......',
      '..2.....o..v..o.......',
      '.....HHHo.....oHHH....',
      '......................',
      '......................',
      '.........#####........',
      '......................',
      '......................',
      '.....HHHo.....oHHH....',
      '........o..v..o.......',
      '........o.....o.......',
      '......................',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Forteresse',
    map: [
      '......................',
      '..1...................',
      '......................',
      '..2.........#######...',
      '............#.....#...',
      '............#..g..#...',
      '...ooo......#.....#...',
      '...o........##o.o##...',
      '...o..................',
      '...ooo..........p.....',
      '..........y...........',
      '......................',
      '....#####.......p.....',
      '......................',
      '......................',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Fantômes',
    map: [
      '......................',
      '......................',
      '..1......#...#........',
      '.........#...#....w...',
      '..2......#...#........',
      '.........#...#........',
      '......................',
      '...###.....___...###..',
      '......................',
      '...###.....___...###..',
      '......................',
      '.........#...#........',
      '.........#...#........',
      '.........#...#....w...',
      '.........#...#........',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Coalition',
    map: [
      '......................',
      '.1.......o.........+..',
      '.........o.......g....',
      '.2.......o............',
      '.........o....#####...',
      '....###..o............',
      '......#.......a.......',
      '......#...............',
      '...*..#...HHHH........',
      '......#...............',
      '......###.......m.....',
      '..............#####...',
      '...........o..........',
      '...........o......v...',
      '...........o..........',
      '........+..o.......*..',
      '......................',
    ],
  },
  {
    name: 'Éclair noir',
    map: [
      '......................',
      '......................',
      '..1...................',
      '......#..........#....',
      '..2...#....oo....#....',
      '......#....oo....#....',
      '......#..........#....',
      '......................',
      '..........____........',
      '......................',
      '......#..........#....',
      '......#....oo....#....',
      '......#....oo....#.k..',
      '......#..........#....',
      '......................',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Tempête',
    map: [
      '......................',
      '.1....................',
      '......#...........k...',
      '.2....#.....g.........',
      '......#...............',
      '......#####....####...',
      '..............#.......',
      '...oooo.......#.......',
      '..............#...w...',
      '...oooo...............',
      '..........H...........',
      '..........H....####...',
      '......#####...........',
      '..................v...',
      '......................',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Ultime',
    map: [
      '......................',
      '.1........H...........',
      '..........H.......k...',
      '.2........H...........',
      '..........H....oo.....',
      '....ooo........oo.v...',
      '......................',
      '...######....######...',
      '..........w...........',
      '...######....######...',
      '......................',
      '....ooo........oo.v...',
      '..........H....oo.....',
      '..........H...........',
      '..........H.......k...',
      '..........H...........',
      '......................',
    ],
  },
  {
    name: 'Va-et-vient',
    map: [
      '......................',
      '......................',
      '..1.......####........',
      '..........#..#....v...',
      '..2...*...#..#........',
      '..........#..#........',
      '.......####..####.....',
      '.......#........#.....',
      '.......#...+..g.#..*..',
      '.......#........#.....',
      '.......####..####.....',
      '..........#..#........',
      '..........#..#........',
      '...+......#..#....w...',
      '..........####........',
      '......................',
      '......................',
    ],
  },
  {
    name: 'Couvre-feu',
    night: true,
    map: [
      '......................',
      '.......#......#.......',
      '..1....#..b...#....p..',
      '.......#......#.......',
      '..2....o......o.......',
      '.......o..HH..o.......',
      '..........HH..........',
      '####..............####',
      '......___....___..a...',
      '####..............####',
      '..........HH..........',
      '.......o..HH..o.......',
      '.......o......o.......',
      '.......#......#.......',
      '.......#..y...#....a..',
      '.......#......#.......',
      '......................',
    ],
  },
];

export interface ParsedLevel {
  name: string;
  tiles: number[];
  spawns: [number, number][];
  enemies: { kind: TankKind; x: number; y: number }[];
  night?: boolean;
}

export function parseLevel(def: LevelDef): ParsedLevel {
  const tiles = new Array(W * H).fill(Tile.Empty);
  const spawns: [number, number][] = [];
  const enemies: ParsedLevel['enemies'] = [];
  for (let y = 0; y < H; y++) {
    const row = (def.map[y] ?? '').padEnd(W, '.');
    for (let x = 0; x < W; x++) {
      const c = row[x];
      const i = y * W + x;
      if (c === '#') tiles[i] = Tile.Wall;
      else if (c === 'H') tiles[i] = Tile.Tall;
      else if (c === 'o') tiles[i] = Tile.Cork;
      else if (c === '_') tiles[i] = Tile.Hole;
      else if (c === '*') tiles[i] = Tile.PortalA;
      else if (c === '+') tiles[i] = Tile.PortalB;
      else if (c >= '1' && c <= '4') spawns[+c - 1] = [x + 0.5, y + 0.5];
      else if (ENEMY_CHARS[c]) enemies.push({ kind: ENEMY_CHARS[c], x: x + 0.5, y: y + 0.5 });
    }
  }
  return { name: def.name, tiles, spawns: spawns.filter(Boolean), enemies, night: def.night };
}

// ---------- procedural missions (endless mode after the handmade campaign) ----------

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const ROSTER_BY_TIER: TankKind[][] = [
  ['brown', 'ash', 'marine'],
  ['ash', 'marine', 'yellow', 'pink'],
  ['pink', 'green', 'yellow', 'violet'],
  ['violet', 'white', 'green', 'black'],
];

export function proceduralLevel(mission: number): ParsedLevel {
  const r = rng(mission * 7919 + 13);
  for (let attempt = 0; attempt < 30; attempt++) {
    const tiles = new Array(W * H).fill(Tile.Empty);
    const set = (x: number, y: number, t: Tile) => {
      // mirror horizontally around centre for a fair, symmetric look
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      tiles[y * W + x] = t;
      tiles[(H - 1 - y) * W + (W - 1 - x)] = t;
    };
    const pieces = 5 + Math.floor(r() * 5);
    for (let p = 0; p < pieces; p++) {
      const t = r() < 0.55 ? Tile.Wall : r() < 0.5 ? Tile.Cork : r() < 0.6 ? Tile.Tall : Tile.Hole;
      const x0 = 3 + Math.floor(r() * (W - 6)), y0 = 1 + Math.floor(r() * (H - 2));
      const horiz = r() < 0.5, len = 2 + Math.floor(r() * 5);
      for (let k = 0; k < len; k++) set(horiz ? x0 + k : x0, horiz ? y0 : y0 + k, t);
      if (r() < 0.35) for (let k = 0; k < 3; k++) set(horiz ? x0 : x0 + k, horiz ? y0 + k : y0, t);
    }
    const free = (x: number, y: number) => tiles[y * W + x] === Tile.Empty;
    // clear spawn zone
    for (let y = 5; y <= 11; y++) for (let x = 1; x <= 4; x++) tiles[y * W + x] = Tile.Empty;
    const spawns: [number, number][] = [[2.5, 7.5], [2.5, 9.5]];
    // reachability flood from spawn
    const seen = new Uint8Array(W * H);
    const q = [7 * W + 2];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop()!;
      const x = i % W, y = (i / W) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && free(nx, ny)) { seen[j] = 1; q.push(j); }
      }
    }
    const cells: [number, number][] = [];
    for (let y = 0; y < H; y++) for (let x = 11; x < W; x++) if (seen[y * W + x]) cells.push([x, y]);
    if (cells.length < 30) continue;
    // fill unreachable pockets
    for (let i = 0; i < W * H; i++) if (!seen[i] && tiles[i] === Tile.Empty) tiles[i] = Tile.Wall;
    addPortals(tiles, seen, mission, cells);
    const tier = Math.min(3, Math.floor((mission - 1) / 8));
    const count = Math.min(8, 3 + Math.floor((mission - 16) / 3));
    const enemies: ParsedLevel['enemies'] = [];
    const used = new Set<number>();
    for (let e = 0; e < count; e++) {
      for (let tries = 0; tries < 40; tries++) {
        const [x, y] = cells[Math.floor(r() * cells.length)];
        const key = y * W + x;
        if (used.has(key) || used.has(key + 1) || used.has(key - 1) || used.has(key + W) || used.has(key - W)) continue;
        used.add(key);
        const roster = ROSTER_BY_TIER[Math.min(3, tier + (r() < 0.3 ? 1 : 0))];
        enemies.push({ kind: roster[Math.floor(r() * roster.length)], x: x + 0.5, y: y + 0.5 });
        break;
      }
    }
    // about a third of the later generated missions are played at night (own random stream again)
    const night = mission > 20 && rng(mission * 31337 + 5)() < 0.32;
    return { name: night ? `Mission de nuit ${mission}` : `Mission spéciale ${mission}`, tiles, spawns, enemies, night };
  }
  return parseLevel(LEVELS[0]);
}

/**
 * Later generated missions get one or two portal pairs, each linking the players' half to the enemies' half.
 * Its own random stream, so the walls of a mission stay the same whether it has portals or not.
 */
function addPortals(tiles: number[], seen: Uint8Array, mission: number, cells: [number, number][]) {
  const r = rng(mission * 104729 + 7);
  if (mission < 19 || r() < 0.35) return;
  const open = (x: number, y: number) =>
    seen[y * W + x] && [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => tiles[(y + dy) * W + x + dx] === Tile.Empty);
  const pick = (x0: number, x1: number): [number, number] | undefined => {
    for (let tries = 0; tries < 60; tries++) {
      const x = x0 + Math.floor(r() * (x1 - x0)), y = 1 + Math.floor(r() * (H - 2));
      if (open(x, y)) return [x, y];
    }
    return undefined;
  };
  const pairs = r() < 0.4 ? 2 : 1;
  for (let p = 0; p < pairs; p++) {
    const a = pick(5, 10), b = pick(12, W - 2);
    if (!a || !b) continue;
    const t = p === 0 ? Tile.PortalA : Tile.PortalB;
    tiles[a[1] * W + a[0]] = t;
    tiles[b[1] * W + b[0]] = t;
  }
  // enemies never start on a portal
  for (let i = cells.length - 1; i >= 0; i--) if (tiles[cells[i][1] * W + cells[i][0]] !== Tile.Empty) cells.splice(i, 1);
}

/** Every tenth mission is a boss fight. */
export const isBossMission = (mission: number) => mission % 10 === 0;

const BOSS_ARENAS: string[][] = [
  [
    '......................',
    '......................',
    '..1.....#......#......',
    '........#......#......',
    '..2.....#......#......',
    '......................',
    '.............oo.......',
    '....HH................',
    '.................X....',
    '....HH................',
    '.............oo.......',
    '......................',
    '........#......#......',
    '........#......#......',
    '........#......#......',
    '......................',
    '......................',
  ],
  [
    '......................',
    '.1....................',
    '.......o......o.......',
    '.2.....o......o.......',
    '.......o..__..o.......',
    '..........__..........',
    '....###..........###..',
    '......................',
    '.................X....',
    '......................',
    '....###..........###..',
    '..........__..........',
    '.......o..__..o.......',
    '.......o......o.......',
    '.......o......o.......',
    '......................',
    '......................',
  ],
];
const BOSS_ESCORTS: TankKind[][] = [['pink', 'green'], ['violet', 'green'], ['violet', 'black'], ['white', 'black']];

/** Endless-mode boss fights: an open arena, the boss and two escorts that get nastier. */
function bossLevel(mission: number): ParsedLevel {
  const lvl = parseLevel({ name: `Le Colosse · ${mission}`, map: BOSS_ARENAS[(mission / 10) % BOSS_ARENAS.length] });
  const esc = BOSS_ESCORTS[Math.min(BOSS_ESCORTS.length - 1, Math.floor(mission / 10) - 2)];
  lvl.enemies.push({ kind: esc[0], x: 18.5, y: 3.5 }, { kind: esc[1], x: 18.5, y: 13.5 });
  // every other boss fight from the 30th happens at night
  if (mission >= 30 && (mission / 10) % 2 === 1) { lvl.night = true; lvl.name = `Le Colosse de nuit · ${mission}`; }
  return lvl;
}

export function getMission(mission: number): ParsedLevel {
  if (mission <= LEVELS.length) return parseLevel(LEVELS[mission - 1]);
  if (isBossMission(mission)) return bossLevel(mission);
  return proceduralLevel(mission);
}

/** Arenas for versus mode: handmade maps with enemies stripped, spawns in opposite corners. */
export function versusArena(round: number): ParsedLevel {
  const pool = [1, 2, 3, 5, 6, 7, 10, 12, 14, 15];
  const base = parseLevel(LEVELS[pool[round % pool.length]]);
  base.enemies = [];
  const corners: [number, number][] = [[1, 1], [W - 2, H - 2], [W - 2, 1], [1, H - 2]];
  base.spawns = corners.map(([cx, cy]) => nearestFree(base.tiles, cx, cy));
  base.night = round % 4 === 3; // every fourth round is fought in the dark
  return base;
}

export function nearestFree(tiles: number[], cx: number, cy: number, avoid: [number, number][] = []): [number, number] {
  for (let rad = 0; rad < 12; rad++) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (tiles[y * W + x] !== Tile.Empty) continue;
        if (avoid.some(([ax, ay]) => Math.hypot(ax - (x + 0.5), ay - (y + 0.5)) < 0.9)) continue;
        return [x + 0.5, y + 0.5];
      }
    }
  }
  return [cx + 0.5, cy + 0.5];
}
