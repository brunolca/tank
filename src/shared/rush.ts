import { bossLevel, parseLevel, rng, type BossKind, type ParsedLevel } from './levels';
import { dayLabel, mix } from './daily';

// « La ronde des boss » (iteration 28): the four bosses in a row, then two of them at once, with three shared lives.
// The order of the week is the same for everyone (it changes on Monday, UTC); the fighting time decides the weekly board.

export const RUSH_STAGES = 5;
export const RUSH_LIVES = 3;
/** The finale's two bosses are a little lighter than alone: 6 hit points each, +2 per tank beyond the first (instead of 8 and +3). */
export const RUSH_DUO_HP = 6;
export const RUSH_DUO_HP_PER_PLAYER = 2;
export const RUSH_BOSSES: BossKind[] = ['boss', 'drill', 'thunder', 'sower'];

/** The finale duos, in turn from one week to the next (index = week % 6): never reorder, last week's board keeps its duo. */
export const RUSH_DUOS: [BossKind, BossKind][] = [
  ['boss', 'sower'], ['drill', 'thunder'], ['boss', 'thunder'], ['drill', 'sower'], ['boss', 'drill'], ['thunder', 'sower'],
];

export const BOSS_NAMES: Record<BossKind, string> = { boss: 'le Colosse', drill: 'le Foreur', thunder: 'le Grondeur', sower: 'le Semeur' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Weeks since 1970, starting on Mondays (UTC): day 4 (1970-01-05) was a Monday. */
export function weekNumber(day: number) {
  return Math.floor((day + 3) / 7);
}

/** The Monday of a week, as a day number. */
export const weekStart = (week: number) => week * 7 - 3;

/** « lundi 9 novembre » */
export const weekLabel = (week: number) => dayLabel(weekStart(week));

/** This week's order of the four bosses (a shuffle seeded by the week). */
export function rushOrder(week: number): BossKind[] {
  const r = rng(mix(week, 0x5e7));
  const out = RUSH_BOSSES.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const rushDuo = (week: number): [BossKind, BossKind] => RUSH_DUOS[((week % RUSH_DUOS.length) + RUSH_DUOS.length) % RUSH_DUOS.length];

/** Who waits at each stage: one boss for stages 1 to 4, two for the finale. */
export function rushStageBosses(week: number, stage: number): BossKind[] {
  return stage >= RUSH_STAGES ? rushDuo(week) : [rushOrder(week)[Math.max(0, stage - 1)]];
}

/** The finale's arena, « le chapiteau »: a ring of cork in the middle, high-wall corners, and little tunnels (the only roofs against the Grondeur). */
const FINALE: string[] = [
  '......................',
  '.1....................',
  '.....HH........HH.....',
  '.2...H..........H.....',
  '.........oooo.........',
  '.......o......o.......',
  '..#=#..o......o..#=#..',
  '......................',
  '....H............H....',
  '......................',
  '..#=#..o......o..#=#..',
  '.......o......o.......',
  '.........oooo.........',
  '.....H..........H.....',
  '.....HH........HH.....',
  '......................',
  '......................',
];

/** Stage 1..RUSH_STAGES of the given week. Escorts get nastier from one boss to the next; the finale has none. */
export function rushLevel(week: number, stage: number): ParsedLevel {
  if (stage >= RUSH_STAGES) {
    const [a, b] = rushDuo(week);
    const lvl = parseLevel({ name: `Le bouquet final : ${BOSS_NAMES[a]} et ${BOSS_NAMES[b]}`, map: FINALE });
    lvl.enemies.push({ kind: a, x: 17.5, y: 4.5 }, { kind: b, x: 17.5, y: 12.5 });
    return lvl;
  }
  const who = rushOrder(week)[Math.max(0, stage - 1)];
  // the boss arenas of missions 20, 30, 40 and 50: their escorts toughen up (pink and green… up to violet and black)
  const lvl = bossLevel(10 * (stage + 1), who);
  lvl.name = `${cap(BOSS_NAMES[who])}${lvl.night ? ' de nuit' : lvl.wind !== undefined ? ' dans le vent' : ''}`;
  return lvl;
}
