// The workshop (iteration 14): missions drawn by the players in the browser, shared by link, played in coop online.
// The room checks every map it is sent with `checkAtelier` before playing it: the client's own check is only a courtesy.
import { H, W, Tile, isBossKind, type TankKind } from './constants';
import { parseLevel, type LevelDef, type ParsedLevel } from './levels';
import { tunnelAxis } from './physics';
import type { AtelierMap } from './protocol';

/** Lives of a workshop game (no bonus life: it is a single mission). */
export const ATELIER_LIVES = 3;
/** Enemies a workshop mission may hold. */
export const ATELIER_MAX_ENEMIES = 12;
/** Longest mission name. */
export const ATELIER_NAME_MAX = 28;

/** One brush of the workshop palette: the map character it paints and how the editor shows it. */
export interface Brush { ch: string; label: string; group: 'sol' | 'tank' }
export const BRUSHES: Brush[] = [
  { ch: '.', label: 'Sol', group: 'sol' },
  { ch: '#', label: 'Mur', group: 'sol' },
  { ch: 'H', label: 'Mur haut', group: 'sol' },
  { ch: 'o', label: 'Liège', group: 'sol' },
  { ch: '_', label: 'Trou', group: 'sol' },
  { ch: '=', label: 'Tunnel', group: 'sol' },
  { ch: '*', label: 'Portail bleu', group: 'sol' },
  { ch: '+', label: 'Portail rose', group: 'sol' },
  { ch: '1', label: 'Départ 1', group: 'tank' },
  { ch: '2', label: 'Départ 2', group: 'tank' },
  { ch: 'b', label: 'Brun', group: 'tank' },
  { ch: 'a', label: 'Gris', group: 'tank' },
  { ch: 'm', label: 'Turquoise', group: 'tank' },
  { ch: 'y', label: 'Jaune', group: 'tank' },
  { ch: 'p', label: 'Rose', group: 'tank' },
  { ch: 'g', label: 'Vert', group: 'tank' },
  { ch: 'v', label: 'Violet', group: 'tank' },
  { ch: 'w', label: 'Blanc', group: 'tank' },
  { ch: 'k', label: 'Noir', group: 'tank' },
  { ch: 's', label: 'Acier', group: 'tank' },
  { ch: 'c', label: 'Maçon', group: 'tank' },
  { ch: 'X', label: 'Colosse', group: 'tank' },
  { ch: 'D', label: 'Foreur', group: 'tank' },
  { ch: 't', label: 'Pilleur', group: 'tank' },
  // iteration 16: conveyor belts (share-code letters Y, Z, a, b)
  { ch: '>', label: 'Tapis →', group: 'sol' },
  { ch: '<', label: 'Tapis ←', group: 'sol' },
  { ch: '^', label: 'Tapis ↑', group: 'sol' },
  { ch: 'V', label: 'Tapis ↓', group: 'sol' },
  // iteration 18: the third boss (share-code letter c)
  { ch: 'G', label: 'Grondeur', group: 'tank' },
  // iteration 21: ice (share-code letter d)
  { ch: '~', label: 'Glace', group: 'sol' },
  // iteration 22: the Rempart (share-code letter e)
  { ch: 'r', label: 'Rempart', group: 'tank' },
  // iteration 25: the fourth boss (share-code letter f)
  { ch: 'S', label: 'Semeur', group: 'tank' },
];
/** The showcase mission of the videos (and a good first example). */
export const ATELIER_SAMPLE: AtelierMap = {
  name: 'La forge de Lou',
  map: [
    '......................',
    '.........HH........y..',
    '...###...HH....###....',
    '...#.............#....',
    '..1.....o....o.....a..',
    '........o____o........',
    '###=##..o....o..##=###',
    '......................',
    '..*.......c........*..',
    '......................',
    '###=##..o....o..##=###',
    '........o____o........',
    '..2.....o....o.....s..',
    '...#.............#....',
    '...###...HH....###....',
    '.........HH........p..',
    '......................',
  ],
};

const CHARS = BRUSHES.map((b) => b.ch).join('');
/** Share-code letter of a brush: A to Z, then a, b… (iteration 16, older codes only use capitals). */
const letter = (i: number) => String.fromCharCode(i < 26 ? 65 + i : 97 + i - 26);
const brushOf = (l: string) => { const c = l.charCodeAt(0); return CHARS[c >= 97 ? c - 97 + 26 : c - 65]; };

/** An empty table with the two starting spots on the left. */
export function blankMap(): string[] {
  const rows = Array.from({ length: H }, () => '.'.repeat(W));
  const put = (x: number, y: number, c: string) => { rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1); };
  put(2, 7, '1');
  put(2, 9, '2');
  return rows;
}

/** Clean a mission name: trimmed, short, without control characters. */
export function cleanName(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, ATELIER_NAME_MAX);
}

/** Why this map cannot be played (in French, for the players), or undefined when it is fine. */
export function checkAtelier(map: unknown): string | undefined {
  if (!Array.isArray(map) || map.length !== H) return 'Carte invalide.';
  for (const row of map) {
    if (typeof row !== 'string' || row.length !== W) return 'Carte invalide.';
    for (const c of row) if (!CHARS.includes(c)) return 'Carte invalide.';
  }
  const all = map.join('');
  const count = (c: string) => all.split(c).length - 1;
  if (count('1') !== 1) return 'Place le départ 1 des joueurs.';
  if (count('2') > 1) return 'Un seul départ 2, s’il te plaît.';
  const lvl = parseLevel({ name: '', map: map as string[] });
  if (!lvl.enemies.length) return 'Ajoute au moins un tank ennemi.';
  if (lvl.enemies.length > ATELIER_MAX_ENEMIES) return `Pas plus de ${ATELIER_MAX_ENEMIES} tanks ennemis.`;
  if (lvl.enemies.filter((e) => isBossKind(e.kind)).length > 1) return 'Un seul boss par mission.';
  for (const [c, label] of [['*', 'bleu'], ['+', 'rose']]) {
    const n = count(c);
    if (n !== 0 && n !== 2) return `Il faut exactement deux portails ${label}s (ou aucun).`;
  }
  for (let i = 0; i < lvl.tiles.length; i++) {
    if (lvl.tiles[i] === Tile.Tunnel && tunnelAxis(lvl.tiles, i) < 0) return 'Chaque tunnel doit passer entre deux murs (ou trous), à gauche et à droite ou en haut et en bas.';
  }
  // the players must be able to drive somewhere: at least one open cell next to the first spot
  const [sx, sy] = lvl.spawns[0];
  const cx = Math.floor(sx), cy = Math.floor(sy);
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !'#Ho_'.includes(map[y][x]);
  if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => open(cx + dx, cy + dy))) return 'Le départ 1 est emmuré : laisse-lui de la place.';
  return undefined;
}

/** The level the room plays for a checked workshop map. */
export function atelierLevel(a: AtelierMap): ParsedLevel {
  return parseLevel({ name: cleanName(a.name) || 'Mission maison', map: a.map, night: !!a.night, storm: !!a.storm, wind: a.wind ? 0 : undefined } satisfies LevelDef); // the wind blows to the right (iteration 23)
}

/** Enemy kinds on a map, for the lobby summary. */
export function atelierKinds(map: string[]): TankKind[] {
  return [...new Set(parseLevel({ name: '', map }).enemies.map((e) => e.kind))];
}

// ---------------------------------------------------------------- share codes
// Each cell becomes a letter (A, B, C… in BRUSHES order, then a, b… past Z); a run of identical cells is the letter followed by its length.
// The name goes first, as base64url, then a dot, the cells, and optionally a dot and the weather (n night, s storm, w wind). The code lives in the link's hash: it never reaches the server.

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function encodeAtelier(a: AtelierMap): string {
  const cells = a.map.join('');
  let out = '';
  for (let i = 0; i < cells.length;) {
    let j = i;
    while (j < cells.length && cells[j] === cells[i]) j++;
    out += letter(CHARS.indexOf(cells[i])) + (j - i > 1 ? String(j - i) : '');
    i = j;
  }
  const flags = (a.night ? 'n' : '') + (a.storm ? 's' : '') + (a.wind ? 'w' : '');
  return `${b64(cleanName(a.name))}.${out}${flags ? '.' + flags : ''}`;
}

export function decodeAtelier(code: string): AtelierMap | undefined {
  try {
    const [head, body, flags = ''] = code.split('.');
    if (body === undefined) return;
    const name = cleanName(unb64(head));
    let cells = '';
    const re = /([A-Za-z])(\d*)/g;
    let m: RegExpExecArray | null;
    let used = 0;
    while ((m = re.exec(body))) {
      const ch = brushOf(m[1]);
      const n = m[2] ? Number(m[2]) : 1;
      if (!ch || n < 1 || cells.length + n > W * H) return;
      cells += ch.repeat(n);
      used += m[0].length;
    }
    if (used !== body.length || cells.length !== W * H) return;
    const map = Array.from({ length: H }, (_, y) => cells.slice(y * W, (y + 1) * W));
    return { name, map, night: flags.includes('n') || undefined, storm: flags.includes('s') || undefined, wind: flags.includes('w') || undefined };
  } catch {
    return;
  }
}
