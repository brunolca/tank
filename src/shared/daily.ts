import type { Game } from './sim';
import { bossLevel, proceduralLevel, rng, type ParsedLevel } from './levels';

// The daily challenge: the same five generated missions for everyone on a given (UTC) day, with a twist of the day.
// The room plays them in a row with three shared lives; the time spent fighting decides the daily ranking.

export const DAILY_STAGES = 5;
export const DAILY_LIVES = 3;

// The index in DAILY_TWISTS is derived from the day: append new twists, never reorder (yesterday's board must keep its twist).
export const DAILY_TWISTS = ['nuit', 'portails', 'caisses', 'ricochets', 'colosse'] as const;
export type DailyTwist = (typeof DAILY_TWISTS)[number];
export const TWIST_INFO: Record<DailyTwist, { label: string; desc: string }> = {
  nuit: { label: 'Nuit noire', desc: 'Les cinq étapes se jouent de nuit.' },
  portails: { label: 'Portails partout', desc: 'Chaque étape a ses portails.' },
  caisses: { label: 'Pluie de caisses', desc: 'Les caisses bonus tombent trois fois plus souvent.' },
  ricochets: { label: 'Ricochets fous', desc: 'Les obus des joueurs rebondissent une fois de plus.' },
  colosse: { label: 'Le Colosse attend', desc: 'La dernière étape est un combat contre le Colosse.' },
};

/** Days since 1970-01-01, in UTC: the challenge changes at midnight UTC. */
export function dayNumber(ms = Date.now()) {
  return Math.floor(ms / 86_400_000);
}

export function dailyTwist(day: number): DailyTwist {
  return DAILY_TWISTS[((day % DAILY_TWISTS.length) + DAILY_TWISTS.length) % DAILY_TWISTS.length];
}

/** « vendredi 30 octobre », « dimanche 1er novembre » */
export function dayLabel(day: number) {
  return new Date(day * 86_400_000)
    .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .replace(/ 1 /, ' 1er ');
}

/** Scramble nearby seeds (day, stage) into unrelated ones: the xorshift stream alone starts too alike. */
export function mix(a: number, b: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** « 3:07,4 » from simulation ticks (30 per second). */
export function formatTicks(ticks: number) {
  const s = ticks / 30;
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(1).replace('.', ',');
  return `${m}:${rest.padStart(4, '0')}`;
}

const PLACES: [string, boolean][] = [
  ['Verger', false], ['Clairière', true], ['Grenier', false], ['Atelier', false], ['Cour', true], ['Remise', true],
  ['Labyrinthe', false], ['Bibliothèque', true], ['Jardin', false], ['Pâtisserie', true], ['Moulin', false], ['Serre', true],
];
const MOODS: [string, string][] = [
  ['tranquille', 'tranquille'], ['endormi', 'endormie'], ['ensoleillé', 'ensoleillée'], ['oublié', 'oubliée'], ['sonore', 'sonore'],
  ['secret', 'secrète'], ['brumeux', 'brumeuse'], ['enchanté', 'enchantée'], ['bancal', 'bancale'], ['pressé', 'pressée'],
];

/** A playful, day-seeded name for each stage (« La Serre enchantée »). */
function stageName(day: number, stage: number) {
  const r = rng(mix(day, stage + 100));
  const [place, fem] = PLACES[Math.floor(r() * PLACES.length)];
  const mood = MOODS[Math.floor(r() * MOODS.length)];
  const art = /^[AEIOUÂÉ]/.test(place) ? 'L’' : fem ? 'La ' : 'Le ';
  return `${art}${place} ${fem ? mood[1] : mood[0]}`;
}

/** Stage 1..DAILY_STAGES of the given day's challenge. */
export function dailyLevel(day: number, stage: number): ParsedLevel {
  const twist = dailyTwist(day);
  if (twist === 'colosse' && stage === DAILY_STAGES) {
    const lvl = bossLevel(20);
    lvl.name = 'Le Colosse du jour';
    lvl.night = false;
    return lvl;
  }
  // difficulty of the endless missions 17, 20, 23, 26, 29: from 3 to 7 enemies, rosters that toughen up
  return proceduralLevel(14 + stage * 3, {
    seed: mix(day, stage),
    night: twist === 'nuit',
    portals: twist === 'portails' ? true : undefined,
    name: stageName(day, stage),
  });
}

/** What the twist changes in the simulation itself (same code for the room and the demo). */
export function applyTwist(g: Game, twist: DailyTwist) {
  if (twist === 'caisses') { g.bonusNext = 2; g.bonusEvery = [4, 6.5]; g.bonusCap = 3; }
  if (twist === 'ricochets') g.playerBounces = 1;
}
