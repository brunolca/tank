export { Room } from './room';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/new') {
      return Response.json({ room: newCode() });
    }
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
