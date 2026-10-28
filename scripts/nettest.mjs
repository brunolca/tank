// Two headless players join a room, host starts coop, both drive around and shoot.
const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const { room } = await fetch(BASE + '/api/new').then((r) => r.json());
console.log('room', room);
const wsBase = BASE.replace('http', 'ws');
function bot(name, pid) {
  const ws = new WebSocket(`${wsBase}/api/room/${room}/ws?pid=${pid}`);
  const st = { name, msgs: {}, snaps: 0, lastAck: 0, seq: 0, phase: null, events: {}, level: null, maxBytes: 0 };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, color: 0 }));
  ws.onmessage = (e) => {
    st.maxBytes = Math.max(st.maxBytes, e.data.length);
    const m = JSON.parse(e.data);
    st.msgs[m.t] = (st.msgs[m.t] ?? 0) + 1;
    if (m.t === 'snap') { st.snaps++; st.lastAck = m.a; for (const ev of m.E) st.events[ev[0]] = (st.events[ev[0]] ?? 0) + 1; }
    if (m.t === 'phase') { st.phase = m.phase; console.log(name, 'phase', m.phase, 'mission', m.mission, 'lives', m.lives, 'enemies', m.enemies); }
    if (m.t === 'level') st.level = m.name;
    if (m.t === 'lobby') st.lobby = m.players.map((p) => p.name + (p.host ? '*' : '')).join(',');
  };
  st.ws = ws;
  st.timer = setInterval(() => {
    if (ws.readyState !== 1) return;
    const t = st.seq++;
    ws.send(JSON.stringify({ t: 'in', i: [{ s: st.seq, mx: Math.cos(t / 25), my: Math.sin(t / 31), a: t / 10, f: t % 15 === 0 ? 1 : 0, m: t % 200 === 0 ? 1 : 0 }] }));
  }, 1000 / 30);
  return st;
}
const a = bot('Alice', 'pid-a-' + room), b = bot('Bob', 'pid-b-' + room);
await new Promise((r) => setTimeout(r, 800));
console.log('lobby seen by bob:', b.lobby);
a.ws.send(JSON.stringify({ t: 'start' }));
await new Promise((r) => setTimeout(r, 12000));
for (const s of [a, b]) console.log(s.name, { msgs: s.msgs, snaps: s.snaps, ack: s.lastAck, seq: s.seq, level: s.level, events: s.events, maxBytes: s.maxBytes });
// reconnect test: Bob drops and comes back with same pid
b.ws.close();
await new Promise((r) => setTimeout(r, 500));
const b2 = bot('Bob', 'pid-b-' + room);
await new Promise((r) => setTimeout(r, 1500));
console.log('Bob reconnected:', b2.msgs, 'level', b2.level);
for (const s of [a, b, b2]) { clearInterval(s.timer); s.ws.close(); }
setTimeout(() => process.exit(0), 300);
