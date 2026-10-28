import { DurableObject } from 'cloudflare:workers';

// Player feedback, stored in a single SQLite-backed Durable Object (free tier, no extra service).
// Writes are public (rate limited); reads need the FEEDBACK_TOKEN secret (used by the GitHub export workflow).

const MAX_TEXT = 4000;
const MAX_CONTEXT = 96 * 1024;
const MAX_BLOB = 1_800_000;
const PER_HOUR = 12;
const ATTACHMENT_TYPES = /^(image\/(png|jpeg|webp|gif)|text\/plain|application\/json|application\/pdf)$/;
const CATEGORIES = ['bug', 'idee', 'equilibrage', 'autre'];

interface Blob_ { data: ArrayBuffer; type: string; name: string }
export interface FeedbackInput { text: string; category: string; context: string; screenshot: Blob_ | null; attachment: Blob_ | null }

/** Validate the multipart form posted by the game. */
export async function parseFeedbackForm(form: FormData): Promise<FeedbackInput | string> {
  const text = String(form.get('text') ?? '').trim().slice(0, MAX_TEXT);
  const category = String(form.get('category') ?? 'autre');
  const context = String(form.get('context') ?? '{}');
  if (!text) return 'Le message est vide.';
  if (context.length > MAX_CONTEXT) return 'Contexte trop volumineux.';
  try { JSON.parse(context); } catch { return 'Contexte invalide.'; }
  const blob = async (key: string, types: RegExp): Promise<Blob_ | null> => {
    const f = form.get(key);
    if (!f || typeof f === 'string') return null;
    if (f.size > MAX_BLOB) throw new Error(`Fichier trop volumineux (1,8 Mo max).`);
    if (!types.test(f.type)) throw new Error(`Type de fichier refusé : ${f.type || 'inconnu'}.`);
    return { data: await f.arrayBuffer(), type: f.type, name: (f.name || key).slice(0, 120) };
  };
  try {
    return {
      text,
      category: CATEGORIES.includes(category) ? category : 'autre',
      context,
      screenshot: await blob('screenshot', /^image\/(png|jpeg|webp)$/),
      attachment: await blob('attachment', ATTACHMENT_TYPES),
    };
  } catch (e) {
    return (e as Error).message;
  }
}

export interface FeedbackRow {
  id: number;
  created: string;
  category: string;
  text: string;
  context: unknown;
  hasScreenshot: boolean;
  attachment?: { name: string; type: string; size: number };
}

export class FeedbackStore extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      context TEXT NOT NULL,
      screenshot BLOB,
      screenshot_type TEXT,
      attachment BLOB,
      attachment_name TEXT,
      attachment_type TEXT
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS feedback_ip ON feedback(ip_hash, created)');
  }

  async add(input: FeedbackInput, ipHash: string): Promise<{ ok: true; id: number } | { ok: false; error: string; status: number }> {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ? AND created > ?', ipHash, since).one().n;
    if (recent >= PER_HOUR) return { ok: false, error: 'Trop de retours envoyés, réessaie dans une heure.', status: 429 };
    const { text, category, context, screenshot: shot, attachment: att } = input;
    const row = this.sql.exec<{ id: number }>(
      `INSERT INTO feedback (created, ip_hash, category, text, context, screenshot, screenshot_type, attachment, attachment_name, attachment_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      new Date().toISOString(), ipHash, category, text, context,
      shot?.data ?? null, shot?.type ?? null, att?.data ?? null, att?.name ?? null, att?.type ?? null,
    ).one();
    return { ok: true, id: row.id };
  }

  async list(since: number): Promise<FeedbackRow[]> {
    const rows = this.sql.exec(
      `SELECT id, created, category, text, context, screenshot IS NOT NULL AS has_shot, attachment_name, attachment_type, length(attachment) AS att_size
       FROM feedback WHERE id > ? ORDER BY id LIMIT 200`, since,
    ).toArray();
    return rows.map((r) => ({
      id: Number(r.id),
      created: String(r.created),
      category: String(r.category),
      text: String(r.text),
      context: JSON.parse(String(r.context)),
      hasScreenshot: !!r.has_shot,
      attachment: r.attachment_name ? { name: String(r.attachment_name), type: String(r.attachment_type), size: Number(r.att_size) } : undefined,
    }));
  }

  async file(id: number, which: 'screenshot' | 'attachment'): Promise<{ data: ArrayBuffer; type: string; name?: string } | null> {
    const cols = which === 'screenshot' ? 'screenshot AS data, screenshot_type AS type, NULL AS name' : 'attachment AS data, attachment_type AS type, attachment_name AS name';
    const r = this.sql.exec(`SELECT ${cols} FROM feedback WHERE id = ?`, id).toArray()[0];
    if (!r?.data) return null;
    return { data: r.data as ArrayBuffer, type: String(r.type), name: r.name ? String(r.name) : undefined };
  }
}
