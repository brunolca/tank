import { getMission, LEVELS } from '../src/shared/levels';
import { Game } from '../src/shared/sim';
import { W, H } from '../src/shared/constants';

for (let i = 0; i < LEVELS.length; i++) {
  const bad = LEVELS[i].map.map((r, y) => [y, r.length]).filter(([, l]) => l !== W);
  if (LEVELS[i].map.length !== H || bad.length) console.log('BAD MAP', i + 1, LEVELS[i].map.length, bad);
}
let t0 = Date.now();
for (let mission = 1; mission <= 22; mission++) {
  const lvl = getMission(mission);
  const g = new Game(lvl.tiles);
  const p = g.addTank('player', 0, lvl.spawns[0][0], lvl.spawns[0][1], 0x3d7bff, 'p1', 'P');
  for (const e of lvl.enemies) g.addTank(e.kind, 99, e.x, e.y, 0);
  g.frozen = false;
  let kills = 0, shots = 0, ticks = 0;
  g.onKill = () => kills++;
  const inputs = new Map();
  const start = Date.now();
  // player wanders randomly and shoots at random
  for (ticks = 0; ticks < 30 * 60 && p.alive; ticks++) {
    const a = Math.sin(ticks / 40) * 3;
    inputs.set('p1', { s: ticks, mx: Math.cos(ticks / 60), my: Math.sin(ticks / 47), a, f: ticks % 20 === 0 ? 1 : 0, m: ticks % 300 === 0 ? 1 : 0 });
    g.step(inputs);
    shots += g.events.filter((e) => e[0] === 'shot').length;
    g.events = [];
  }
  console.log(`M${mission} ${lvl.name.padEnd(22)} enemies=${lvl.enemies.length} survived=${(ticks / 30).toFixed(1)}s shots=${shots} kills=${kills} cpu/tick=${((Date.now() - start) / ticks).toFixed(3)}ms`);
}
console.log('total', Date.now() - t0, 'ms');
