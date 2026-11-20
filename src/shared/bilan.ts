// « Le bilan » (iteration 45): the end-of-mission sheet of the coop-like modes. The room counts, mission by mission
// (all the tries of a mission together), the enemy tanks destroyed by kind, the time spent playing, the shells fired
// by the players and their falls, then hands out three stars. The demo (videos) counts the same way, client side.

/** The three stars, in order: nobody fell, under the par time, within the shell budget. */
export const STAR_LABELS = ['Personne n’est tombé', 'Sous le chrono', 'Obus comptés'] as const;

/** Seconds of the end-of-mission pause added for the sheet to be read (on top of the replay). */
export const SHEET_EXTRA = 4;

/** What the sheet shows (sent with the `cleared` phase; older tabs ignore it). */
export interface Tally {
  k: [string, number][]; // enemy kinds destroyed, in the order of their first fall, and how many
  s: number; // seconds played (tenths)
  par: number; // the par time, in seconds
  shots: number; // shells fired by the players
  budget: number; // shells allowed for the third star
  falls: number; // player tanks destroyed
  stars: [boolean, boolean, boolean];
}

/** Par time of a mission: a little time to set off, then a share per enemy tank (more for a boss), rounded up to 5 s. */
export function parSeconds(enemies: { boss: boolean }[]): number {
  let s = 20;
  for (const e of enemies) s += e.boss ? 40 : 10;
  return Math.ceil(s / 5) * 5;
}

/** Shells allowed for the third star: three per hit point to take, plus three, a little more with every extra player. */
export function shotBudget(hp: number, humans: number): number {
  return Math.ceil((3 * hp + 3) * (1 + 0.5 * Math.max(0, humans - 1)));
}

/** The running count of a mission, on the server (or in the demo). */
export class TallyCount {
  kills = new Map<string, number>();
  ticks = 0;
  shots = 0;
  falls = 0;
  constructor(public mission: number, public par: number, public budget: number) {}

  kill(kind: string) { this.kills.set(kind, (this.kills.get(kind) ?? 0) + 1); }

  sheet(tickRate: number): Tally {
    const s = Math.round((10 * this.ticks) / tickRate) / 10;
    return {
      k: [...this.kills],
      s,
      par: this.par,
      shots: this.shots,
      budget: this.budget,
      falls: this.falls,
      stars: [this.falls === 0, s <= this.par, this.shots <= this.budget],
    };
  }
}

/** A tally received from the network, checked (a broken one is dropped). */
export function cleanTally(t: unknown): Tally | undefined {
  const o = t as Tally;
  if (!o || typeof o !== 'object' || !Array.isArray(o.k) || !Array.isArray(o.stars)) return undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    k: o.k.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number').slice(0, 30).map((e) => [e[0], Math.max(0, Math.min(99, e[1] | 0))]),
    s: num(o.s), par: num(o.par), shots: num(o.shots), budget: num(o.budget), falls: num(o.falls),
    stars: [!!o.stars[0], !!o.stars[1], !!o.stars[2]],
  };
}

/** Number of stars of a tally. */
export const starCount = (t: Tally) => t.stars.filter(Boolean).length;
