import { getMission, isBossMission, LEVELS } from '../src/shared/levels';
import { Game } from '../src/shared/sim';
import { W, H } from '../src/shared/constants';

for (let i = 0; i < LEVELS.length; i++) {
  const bad = LEVELS[i].map.map((r, y) => [y, r.length]).filter(([, l]) => l !== W);
  if (LEVELS[i].map.length !== H || bad.length) { console.error('BAD MAP', i + 1, LEVELS[i].map.length, bad); process.exitCode = 1; }
}
let t0 = Date.now();
for (let mission = 1; mission <= LEVELS.length + 13; mission++) {
  const lvl = getMission(mission);
  if (!lvl.spawns.length || !lvl.enemies.length) { console.error(`M${mission}: no spawn or no enemy`); process.exitCode = 1; }
  const g = new Game(lvl.tiles);
  const p = g.addTank('player', 0, lvl.spawns[0][0], lvl.spawns[0][1], 0x3d7bff, 'p1', 'P');
  for (const e of lvl.enemies) g.addTank(e.kind, 99, e.x, e.y, 0);
  g.frozen = false;
  g.bonusOn = true;
  g.bonusNext = 1;
  g.bonusEvery = [3, 5];
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

// bonus crates: pickup, shield absorbs one hit, fan shot fires three shells
{
  const fail = (m: string) => { console.error('BONUS:', m); process.exitCode = 1; };
  const lvl = getMission(1);
  const g = new Game(lvl.tiles);
  g.bonusOn = true;
  g.bonusNext = 999;
  const [sx, sy] = lvl.spawns[0];
  const p = g.addTank('player', 0, sx, sy, 0x3d7bff, 'p1', 'P');
  g.frozen = false;
  const c = g.spawnBonus('shield');
  if (!c) fail('aucune caisse posée');
  else {
    c.x = p.x; c.y = p.y; c.t = 1;
    g.step(new Map());
    if (!p.buffs.shield) fail('la caisse bouclier n’a pas été ramassée');
    if (!g.events.some((e) => e[0] === 'bonus')) fail('pas d’événement bonus');
    g.killTank(p, undefined);
    if (!p.alive || p.buffs.shield) fail('le bouclier n’a pas absorbé le coup');
    g.killTank(p, undefined);
    if (!p.alive) fail('pas de répit juste après le bouclier');
    for (let i = 0; i < 20; i++) g.step(new Map());
    g.giveBonus(p, 'fan');
    p.fireCd = 0; p.turret = 0;
    const before = g.bullets.length;
    g.tryFire(p);
    if (g.bullets.length - before < 2) fail(`éventail : ${g.bullets.length - before} obus au lieu de 3`);
    g.killTank(p, undefined);
    if (p.alive) fail('le tank devrait être détruit sans bouclier');
    if (!fails()) console.log('bonus OK');
  }
  function fails() { return process.exitCode === 1; }
}

// boss: soaks hits, gets angry at half health, fires a ring of shells, then goes down
{
  const fail = (m: string) => { console.error('BOSS:', m); process.exitCode = 1; };
  for (const mission of [10, 20, 30]) {
    const lvl = getMission(mission);
    if (!isBossMission(mission) || !lvl.enemies.some((e) => e.kind === 'boss')) fail(`la mission ${mission} n’a pas de boss`);
  }
  const lvl = getMission(10);
  const g = new Game(lvl.tiles);
  const p = g.addTank('player', 0, lvl.spawns[0][0], lvl.spawns[0][1], 0x3d7bff, 'p1', 'P');
  const be = lvl.enemies.find((e) => e.kind === 'boss')!;
  const boss = g.addTank('boss', 99, be.x, be.y, 0);
  g.setHp(boss, 6);
  g.frozen = false;
  let killed = false;
  g.onKill = (v) => { if (v === boss) killed = true; };
  for (let i = 0; i < 2; i++) { g.killTank(boss, p); boss.buffs.invuln = 0; }
  if (boss.hp !== 4 || !boss.alive) fail(`PV après 2 coups : ${boss.hp}`);
  g.killTank(boss, p); boss.buffs.invuln = 0;
  if (!boss.boss?.rage || !g.events.some((e) => e[0] === 'rage')) fail('pas de colère à mi-vie');
  g.events = [];
  boss.boss!.volleyT = 0;
  const before = g.bullets.length;
  for (let i = 0; i < 40; i++) g.step(new Map());
  if (!g.events.some((e) => e[0] === 'volley') || g.bullets.length - before < 6) fail('pas de salve circulaire');
  if (!(g.netTanks().find((t) => t[0] === boss.id)?.[6])) fail('PV absents de l’instantané');
  for (let i = 0; i < 10 && boss.alive; i++) { g.killTank(boss, p); boss.buffs.invuln = 0; }
  if (boss.alive || !killed) fail('le boss ne tombe pas');
  if (process.exitCode !== 1) console.log('boss OK');
}
