import { DurableObject } from 'cloudflare:workers';
import { dailyTwist } from '../shared/daily';
import type { BoardDay, BoardEntry } from '../shared/protocol';

// The daily challenge board, in a single SQLite-backed Durable Object (free tier).
// Only rooms write to it, at the end of a daily run played on the server: there is no public write route.

const TOP = 10;
const KEEP_DAYS = 30;

export class Board extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day INTEGER NOT NULL,
      team TEXT NOT NULL,
      cleared INTEGER NOT NULL,
      ticks INTEGER NOT NULL,
      lives INTEGER NOT NULL,
      created INTEGER NOT NULL
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS runs_day ON runs (day, cleared DESC, ticks ASC)');
  }

  /** Record a finished run and return the day's board, with the rank of that run. */
  async submit(day: number, e: BoardEntry): Promise<BoardDay> {
    const team = JSON.stringify(e.team.slice(0, 4).map((p) => ({ name: String(p.name).slice(0, 16), color: Number(p.color) || 0 })));
    this.sql.exec('INSERT INTO runs (day, team, cleared, ticks, lives, created) VALUES (?, ?, ?, ?, ?, ?)',
      day, team, e.cleared | 0, e.ticks | 0, e.lives | 0, Date.now());
    this.sql.exec('DELETE FROM runs WHERE day < ?', day - KEEP_DAYS);
    const better = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE day = ? AND (cleared > ? OR (cleared = ? AND ticks < ?))',
      day, e.cleared | 0, e.cleared | 0, e.ticks | 0).one().n;
    return { ...(await this.get(day)), rank: better + 1 };
  }

  async get(day: number): Promise<BoardDay> {
    const rows = this.sql.exec<{ team: string; cleared: number; ticks: number; lives: number }>(
      'SELECT team, cleared, ticks, lives FROM runs WHERE day = ? ORDER BY cleared DESC, ticks ASC, id ASC LIMIT ?', day, TOP).toArray();
    const total = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE day = ?', day).one().n;
    return {
      day,
      twist: dailyTwist(day),
      total,
      entries: rows.map((r) => ({ team: JSON.parse(r.team), cleared: r.cleared, ticks: r.ticks, lives: r.lives })),
    };
  }
}
