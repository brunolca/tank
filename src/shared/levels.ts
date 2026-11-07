import { BELT_CHARS, H, ICE, ICE_CHAR, W, Tile, TankKind } from './constants';

// Legend: . empty  # wall  H tall wall  o cork (destructible)  _ hole
//         * + portals (each symbol appears exactly twice: going into one pops you out of the other)
//         = tunnel (iteration 13): tanks drive through and hide inside, shells bounce off; it must sit between two
//           solid tiles (walls or holes) on either its left and right or its top and bottom, which gives its direction
//         > < ^ V conveyor belts (iteration 16): tanks, mines and crates ride them (the cell stays floor underneath)
//         ~ ice (iteration 21): tanks slide on it, keeping their momentum (the cell stays floor, like a belt)
//         1 2 player spawns
//         b brown  a ash  m marine  y yellow  p pink  g green  v violet  w white  k black  s steel  X boss  D drill (the Foreur)  c mason (the Maçon)  t thief (the Pilleur)  G thunder (the Grondeur)
export const ENEMY_CHARS: Record<string, TankKind> = {
  b: 'brown', a: 'ash', m: 'marine', y: 'yellow', p: 'pink', g: 'green', v: 'violet', w: 'white', k: 'black', s: 'steel', X: 'boss', D: 'drill', c: 'mason', t: 'thief', G: 'thunder',
};

export interface LevelDef {
  name: string;
  map: string[];
  night?: boolean; // dark table: the AI only sees up close (or a muzzle flash), players drive with headlights
  storm?: boolean; // lightning strikes fall on the table, announced by a crackling ring (iteration 9)
  /** Optional overlay of conveyor belts (same 17 rows, only > < ^ V count): lets a tank start on a belt (iteration 16). */
  belts?: string[];
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
      '..........s...........',
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
    storm: true,
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

/**
 * Handmade missions placed after the campaign's opening run (mission number → map). They keep the generated
 * missions around them where they are, and the boss missions stay boss missions.
 */
export const EXTRA_LEVELS: Record<number, LevelDef> = {
  // iteration 12: the Maçon's first building site, open ground for it to wall up
  21: {
    name: 'Le chantier',
    map: [
      '......................',
      '......................',
      '..........o.....c.....',
      '..1.......o...........',
      '..........o.......a...',
      '..2...................',
      '.......##......##.....',
      '.......#........#.....',
      '...........c..........',
      '.......#........#.....',
      '.......##......##.....',
      '......................',
      '..........o.......p...',
      '..........o...........',
      '..........o.....c.....',
      '......................',
      '......................',
    ],
  },
  // iteration 13: tunnels through a long wall, hide inside to slip past (but you cannot fire from in there)
  22: {
    name: 'Le tunnel',
    map: [
      '......................',
      '......................',
      '.........####.........',
      '.........####......a..',
      '..1......====.........',
      '.........####.........',
      '..2......####....m....',
      '..........##..........',
      '....o.....##.....##y..',
      '....o.....##..........',
      '.........####.........',
      '.........####....p....',
      '.........====.........',
      '.........####......a..',
      '.........####.........',
      '......................',
      '......................',
    ],
  },
  // iteration 13: a walled yard with six tunnel doors, an invisible tank prowling inside
  23: {
    name: 'Les galeries',
    map: [
      '......................',
      '..1...................',
      '.............g........',
      '..2...................',
      '......................',
      '..#####=####=#####....',
      '..#.......w......#....',
      '..#..____...____.#....',
      '..=...........v..=..k.',
      '..#..____...____.#....',
      '..#..............#....',
      '..#####=####=#####....',
      '......................',
      '.......o......o.......',
      '..................a...',
      '.....................y',
      '......................',
    ],
  },
  // iteration 15: the Pilleurs' flea market, cork stalls round an open square where the crates fall
  24: {
    name: 'Le marché aux puces',
    map: [
      '......................',
      '..............t.......',
      '..1....oo....oo.......',
      '.......o......o....a..',
      '..2...................',
      '....##..........##....',
      '....#....o..o....#....',
      '.........o..o.........',
      '..o..........t.....o..',
      '.........o..o.........',
      '....#....o..o....#....',
      '....##..........##....',
      '...................p..',
      '.......o......o.......',
      '.......oo....oo.......',
      '..............t.......',
      '......................',
    ],
  },
  // iteration 16: the toy factory's assembly line, three belts running across the table in turn
  25: {
    name: 'La chaîne de montage',
    map: [
      '......................',
      '..1.......#.......a...',
      '..........#...........',
      '..2.......#.....##....',
      '>>>>>>>>>>>>>>>>>>>>>>',
      '......o.......o.......',
      '....###...y.....###...',
      '......................',
      '<<<<<<<<<<<<<<<<<<<<<<',
      '......................',
      '....###.....p....###..',
      '......o.......o.......',
      '>>>>>>>>>>>>>>>>>>>>>>',
      '..........#.....##....',
      '..........#.......a...',
      '.......m..#...........',
      '......................',
    ],
  },
  // iteration 16: a merry-go-round of belts carrying brown and green turrets round the yard
  26: {
    name: 'Le carrousel',
    map: [
      '......................',
      '..1...................',
      '......................',
      '.......b.....b........',
      '......................',
      '.....##.......##......',
      '.....#....a.....#.....',
      '......................',
      '.......HHHHHHHH.....g.',
      '......................',
      '.....#.....p....#.....',
      '.....##.......##......',
      '......................',
      '........b.......b.....',
      '......................',
      '..2...................',
      '......................',
    ],
    belts: [
      '......................',
      '......................',
      '......................',
      '.V<<<<<<<<<<<<<<<<<<<.',
      '.V..................^.',
      '.V..................^.',
      '.V..................^.',
      '.V..................^.',
      '.V..................^.',
      '.V..................^.',
      '.V..................^.',
      '.V..................^.',
      '.V..................^.',
      '.>>>>>>>>>>>>>>>>>>>^.',
      '......................',
      '......................',
      '......................',
    ],
  },
  // iteration 21: a skating rink in the middle of the table, where nobody stops where they meant to
  27: {
    name: 'La patinoire',
    map: [
      '......................',
      '..1.......#...........',
      '..........#.......a...',
      '..2...................',
      '.....oo.........oo....',
      '......................',
      '.......#...p...#......',
      '.......#.......#......',
      '..........HH......y...',
      '.......#.......#......',
      '.......#...y...#......',
      '......................',
      '.....oo.........oo....',
      '......................',
      '..........#.......a...',
      '..........#...........',
      '......................',
    ],
    belts: [
      '......................',
      '......................',
      '......................',
      '......................',
      '....~~~~~~~~~~~~~~....',
      '....~~~~~~~~~~~~~~....',
      '....~~~~~~~~~~~~~~....',
      '....~~~~~~~~~~~~~~....',
      '....~~~~~~~~~~~~~~....',
      '....~~~~~~~~~~~~~~....',
      '....~~~~~~~~~~~~~~....',
      '....~~~~~~~~~~~~~~....',
      '....~~~~~~~~~~~~~~....',
      '......................',
      '......................',
      '......................',
      '......................',
    ],
  },
  // iteration 21: ice floes between the holes of a frozen lake, the green turrets watch the channels
  28: {
    name: 'La banquise',
    map: [
      '......................',
      '.1.......__......v....',
      '.........__...........',
      '.2....................',
      '....___.......___.....',
      '....___...g...___.....',
      '......................',
      '..........oo.......w..',
      '.....__...oo...__.....',
      '..........oo..........',
      '......................',
      '....___.......___.....',
      '....___...g...___.....',
      '......................',
      '.........__...........',
      '.........__......v....',
      '......................',
    ],
    belts: [
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
      '...~~~~~~~~~~~~~~~~...',
    ],
  },
};

export interface ParsedLevel {
  name: string;
  tiles: number[];
  spawns: [number, number][];
  enemies: { kind: TankKind; x: number; y: number }[];
  night?: boolean;
  storm?: boolean;
  /** Floor layer: conveyor belts (iteration 16) and ice (iteration 21), one code per cell (0 none, 1 right, 2 left, 3 up, 4 down, 5 ice), only when the map has some. */
  belts?: number[];
}

export function parseLevel(def: LevelDef): ParsedLevel {
  const tiles = new Array(W * H).fill(Tile.Empty);
  const spawns: [number, number][] = [];
  const enemies: ParsedLevel['enemies'] = [];
  let belts: number[] | undefined;
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
      else if (c === '=') tiles[i] = Tile.Tunnel;
      else if ((BELT_CHARS as readonly string[]).includes(c)) (belts ??= new Array(W * H).fill(0))[i] = (BELT_CHARS as readonly string[]).indexOf(c) + 1;
      else if (c === ICE_CHAR) (belts ??= new Array(W * H).fill(0))[i] = ICE;
      else if (c >= '1' && c <= '4') spawns[+c - 1] = [x + 0.5, y + 0.5];
      else if (ENEMY_CHARS[c]) enemies.push({ kind: ENEMY_CHARS[c], x: x + 0.5, y: y + 0.5 });
    }
  }
  if (def.belts) {
    for (let y = 0; y < H; y++) {
      const row = def.belts[y] ?? '';
      for (let x = 0; x < W; x++) {
        if (tiles[y * W + x] !== Tile.Empty) continue; // the floor layer only covers floor (a tank may start on it)
        const k = (BELT_CHARS as readonly string[]).indexOf(row[x]);
        if (k >= 0) (belts ??= new Array(W * H).fill(0))[y * W + x] = k + 1;
        else if (row[x] === ICE_CHAR) (belts ??= new Array(W * H).fill(0))[y * W + x] = ICE;

      }
    }
  }
  return { name: def.name, tiles, spawns: spawns.filter(Boolean), enemies, night: def.night, storm: def.storm, belts };
}

// ---------- procedural missions (endless mode after the handmade campaign) ----------

export function rng(seed: number) {
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

/** Options for generated missions: the daily challenge picks its own layout seed, portals, night and name. */
export interface GenOptions {
  seed?: number; portals?: boolean; night?: boolean; storm?: boolean; name?: string;
  /** Share of the enemies swapped for steel tanks (iteration 10). Campaign missions from the 21st: 0.22; the daily challenge: 0 unless its twist says so. */
  armored?: number;
}

export function proceduralLevel(mission: number, opt: GenOptions = {}): ParsedLevel {
  const r = rng(opt.seed ?? mission * 7919 + 13);
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
    addPortals(tiles, seen, mission, cells, opt);
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
    // steel tanks (iteration 10) replace some of the enemies: own random stream, so walls, places and the other kinds stay put
    const armored = opt.armored ?? (opt.seed === undefined && mission > 20 ? 0.22 : 0);
    if (armored > 0) {
      const ra = rng((opt.seed ?? mission) * 6151 + 29);
      for (const e of enemies) if (ra() < armored) e.kind = 'steel';
      // a steel-tank mission always has at least one of them (and the daily twist even more)
      if (!enemies.some((e) => e.kind === 'steel') && (opt.armored ?? 0) > 0 && enemies.length) enemies[Math.floor(ra() * enemies.length)].kind = 'steel';
    }
    // the Maçon (iteration 12) takes over some of the others from the 22nd: yet another stream, nothing else moves
    if (opt.seed === undefined && mission > 21) {
      const rm = rng(mission * 4271 + 17);
      for (const e of enemies) if (e.kind !== 'steel' && rm() < 0.16) e.kind = 'mason';
    }
    // the Pilleur (iteration 15) slips in from the 25th: one more stream, at most two of them
    if (opt.seed === undefined && mission > 24) {
      const rt = rng(mission * 9029 + 41);
      let n = 0;
      for (const e of enemies) if (n < 2 && e.kind !== 'steel' && e.kind !== 'mason' && rt() < 0.09) { e.kind = 'thief'; n++; }
    }
    // about a third of the later generated missions are played at night (own random stream again)
    const night = opt.night ?? (mission > 20 && rng(mission * 31337 + 5)() < 0.32);
    // and about a quarter of them under a storm (yet another stream, so walls, portals and night stay put)
    const storm = opt.storm ?? (mission > 20 && rng(mission * 7717 + 3)() < 0.27);
    const name = storm ? (night ? `Orage de nuit ${mission}` : `Mission d’orage ${mission}`) : night ? `Mission de nuit ${mission}` : `Mission spéciale ${mission}`;
    return { name: opt.name ?? name, tiles, spawns, enemies, night, storm };
  }
  return parseLevel(LEVELS[0]);
}

/**
 * Later generated missions get one or two portal pairs, each linking the players' half to the enemies' half.
 * Its own random stream, so the walls of a mission stay the same whether it has portals or not.
 */
function addPortals(tiles: number[], seen: Uint8Array, mission: number, cells: [number, number][], opt: GenOptions) {
  const r = rng((opt.seed ?? mission) * 104729 + 7);
  if (opt.portals === false) return;
  if (opt.portals !== true && (mission < 19 || r() < 0.35)) return;
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

/** The Foreur's quarries: cork everywhere (it drills through, and its bursts clear it), a few walls to hide behind. */
const DRILL_ARENAS: string[][] = [
  [
    '......................',
    '......................',
    '..1....oo.....oo......',
    '.......oo.....oo......',
    '..2...................',
    '..........HH..........',
    '....ooo.........ooo...',
    '......................',
    '....##.....D.....##...',
    '......................',
    '....ooo.........ooo...',
    '..........HH..........',
    '......................',
    '.......oo.....oo......',
    '.......oo.....oo......',
    '......................',
    '......................',
  ],
  [
    '......................',
    '.1....o........o......',
    '......o..####..o......',
    '.2....o........o......',
    '......................',
    '...oooo..........oooo.',
    '..........oo..........',
    '....#.....oo.....#....',
    '....#......D.....#....',
    '....#............#....',
    '..........oo..........',
    '...oooo...oo.....oooo.',
    '......................',
    '......o........o......',
    '......o..####..o......',
    '......o........o......',
    '......................',
  ],
];

/** Arenas of the Grondeur (iteration 18): short tunnels are the only roofs against its lightning, cork to blow up. */
const THUNDER_ARENAS: string[][] = [
  [
    '......................',
    '.1..........o.........',
    '....#=#.....o....#=#..',
    '.2..........o.........',
    '......................',
    '..oo....HH......oo....',
    '........HH............',
    '...#=#..........#=#...',
    '..........G...........',
    '...#=#..........#=#...',
    '............HH........',
    '..oo........HH..oo....',
    '......................',
    '.........o............',
    '....#=#..o.......#=#..',
    '.........o............',
    '......................',
  ],
  [
    '......................',
    '.1....................',
    '.....o..#=#..o........',
    '.2...o.......o........',
    '.....o..#=#..o..ooo...',
    '......................',
    '..#=#.....HH..........',
    '..........HH.....#=#..',
    '.......G..............',
    '..#=#.................',
    '..........HH.....#=#..',
    '..........HH..........',
    '......................',
    '.....o..#=#..o..ooo...',
    '.....o.......o........',
    '.....o..#=#..o........',
    '......................',
  ],
];

export type BossKind = 'boss' | 'drill' | 'thunder';
/** Which boss holds a boss mission, in turn: the Colosse (10, 40, 70…), the Foreur (20, 50, 80…), the Grondeur (30, 60, 90…). */
export function bossOf(mission: number): BossKind {
  const k = Math.round(mission / 10) % 3;
  return k === 2 ? 'drill' : k === 0 ? 'thunder' : 'boss';
}

/** Endless-mode boss fights: an open arena, the boss and two escorts that get nastier. */
export function bossLevel(mission: number, who: BossKind = bossOf(mission)): ParsedLevel {
  if (who === 'thunder') {
    const lvl = parseLevel({ name: `Le Grondeur · ${mission}`, map: THUNDER_ARENAS[Math.round(mission / 30) % THUNDER_ARENAS.length], storm: true });
    const esc = BOSS_ESCORTS[Math.min(BOSS_ESCORTS.length - 1, Math.floor(mission / 10) - 2)];
    lvl.enemies.push({ kind: esc[0], x: 19.5, y: 4.5 }, { kind: esc[1], x: 19.5, y: 12.5 });
    return lvl; // a storm sky: once the Grondeur falls, its lightning runs wild until the mission ends
  }
  if (who === 'drill') {
    const lvl = parseLevel({ name: `Le Foreur · ${mission}`, map: DRILL_ARENAS[(mission / 20) % DRILL_ARENAS.length | 0] });
    const esc = BOSS_ESCORTS[Math.min(BOSS_ESCORTS.length - 1, Math.floor(mission / 10) - 2)];
    lvl.enemies.push({ kind: esc[0], x: 19.5, y: 2.5 }, { kind: esc[1], x: 19.5, y: 14.5 });
    return lvl; // always by day: you need to see the ground shake
  }
  const lvl = parseLevel({ name: `Le Colosse · ${mission}`, map: BOSS_ARENAS[(mission / 10) % BOSS_ARENAS.length] });
  const esc = BOSS_ESCORTS[Math.min(BOSS_ESCORTS.length - 1, Math.floor(mission / 10) - 2)];
  lvl.enemies.push({ kind: esc[0], x: 18.5, y: 3.5 }, { kind: esc[1], x: 18.5, y: 13.5 });
  // every other Colosse from the 40th fights at night (40, 100, 160…)
  if (mission >= 40 && Math.round((mission / 10 - 1) / 3) % 2 === 1) { lvl.night = true; lvl.name = `Le Colosse de nuit · ${mission}`; }
  return lvl;
}

export function getMission(mission: number): ParsedLevel {
  if (mission <= LEVELS.length) return parseLevel(LEVELS[mission - 1]);
  if (EXTRA_LEVELS[mission]) return parseLevel(EXTRA_LEVELS[mission]);
  if (isBossMission(mission)) return bossLevel(mission);
  return proceduralLevel(mission);
}

/** Arenas for versus mode: handmade maps with enemies stripped, spawns in opposite corners. */
export function versusArena(round: number): ParsedLevel {
  // handmade missions, plus the tunnels of mission 22 (iteration 13), the belts of mission 25 (iteration 16) and the rink of mission 27 (iteration 21)
  const pool: LevelDef[] = [1, 2, 3, 5, 6, 7, 10, 12, 14, 15].map((i) => LEVELS[i]).concat(EXTRA_LEVELS[22], EXTRA_LEVELS[25], EXTRA_LEVELS[27]);
  const base = parseLevel(pool[round % pool.length]);
  base.enemies = [];
  const corners: [number, number][] = [[1, 1], [W - 2, H - 2], [W - 2, 1], [1, H - 2]];
  base.spawns = corners.map(([cx, cy]) => nearestFree(base.tiles, cx, cy));
  base.night = round % 4 === 3; // every fourth round is fought in the dark
  base.storm = round % 5 === 2; // and one in five under a storm (from the third round)
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
