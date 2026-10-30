import META from '../shared/meta.json';

import { dayNumber } from '../shared/daily';
import { parseFeedbackForm } from './feedback';

export { Room } from './room';
export { FeedbackStore } from './feedback';
export { Board } from './board';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/version') {
      return Response.json({ iteration: META.iteration, date: META.date, title: META.title });
    }
    if (url.pathname === '/api/new') {
      return Response.json({ room: newCode() });
    }
    if (url.pathname === '/api/daily') {
      // today's challenge board (read only: rooms write the runs they host)
      const board = env.BOARD.get(env.BOARD.idFromName('daily'));
      const day = dayNumber();
      try {
        return Response.json(await board.get(day), { headers: { 'cache-control': 'no-store' } });
      } catch {
        return Response.json({ error: 'Classement indisponible.' }, { status: 503 });
      }
    }
    if (url.pathname.startsWith('/api/feedback')) return feedback(req, url, env);
    const m = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4,8})\/ws$/);
    if (m) {
      const code = m[1];
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const fwd = new URL(req.url);
      fwd.searchParams.set('room', code);
      return stub.fetch(new Request(fwd, req));
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

async function feedback(req: Request, url: URL, env: Env): Promise<Response> {
  const store = env.FEEDBACK.get(env.FEEDBACK.idFromName('global'));
  if (url.pathname === '/api/feedback' && req.method === 'POST') {
    if (Number(req.headers.get('content-length') ?? 0) > 4_500_000) return Response.json({ error: 'Envoi trop volumineux.' }, { status: 413 });
    let form: FormData;
    try { form = await req.formData(); } catch { return Response.json({ error: 'Formulaire invalide.' }, { status: 400 }); }
    const input = await parseFeedbackForm(form);
    if (typeof input === 'string') return Response.json({ error: input }, { status: 400 });
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tanks:' + ip));
    const ipHash = [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const res = await store.add(input, ipHash);
    return res.ok ? Response.json({ id: res.id }) : Response.json({ error: res.error }, { status: res.status });
  }
  // reading feedback is private: only the export workflow holds the token
  if (!env.FEEDBACK_TOKEN || req.headers.get('authorization') !== `Bearer ${env.FEEDBACK_TOKEN}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (url.pathname === '/api/feedback' && req.method === 'GET') {
    return Response.json(await store.list(Number(url.searchParams.get('since')) || 0));
  }
  const m = url.pathname.match(/^\/api\/feedback\/(\d+)\/(screenshot|attachment)$/);
  if (m) {
    const f = await store.file(Number(m[1]), m[2] as 'screenshot' | 'attachment');
    if (!f) return new Response('not found', { status: 404 });
    return new Response(f.data, { headers: { 'content-type': f.type } });
  }
  return new Response('not found', { status: 404 });
}
