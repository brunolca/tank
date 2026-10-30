import { getMission, isBossMission, LEVELS } from '../src/shared/levels';
import { Game, driveStep } from '../src/shared/sim';
import { DT, H, SPECS, Tile, W } from '../src/shared/constants';
import { castRicochet } from '../src/shared/physics';

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

// portals: come in pairs, carry tanks and shells to their twin, the AI aims through them, the boss is too big
{
  const fail = (m: string) => { console.error('PORTAILS:', m); process.exitCode = 1; };
  for (let mission = 1; mission <= LEVELS.length + 40; mission++) {
    const tiles = getMission(mission).tiles;
    for (const t of [Tile.PortalA, Tile.PortalB]) {
      const n = tiles.filter((v) => v === t).length;
      if (n !== 0 && n !== 2) fail(`mission ${mission} : ${n} portail(s) de type ${t}`);
    }
  }
  const withPortals = [];
  for (let mission = 19; mission <= 60; mission++) if (getMission(mission).tiles.includes(Tile.PortalA)) withPortals.push(mission);
  if (withPortals.length < 5) fail(`trop peu de missions générées à portails (${withPortals.length})`);
  const tiles = new Array(W * H).fill(Tile.Empty);
  tiles[8 * W + 4] = Tile.PortalA;
  tiles[3 * W + 17] = Tile.PortalA;
  const g = new Game(tiles);
  const p = g.addTank('player', 0, 2.5, 8.5, 0x3d7bff, 'p1', 'P');
  g.frozen = false;
  for (let i = 0; i < 30 && p.x < 10; i++) g.step(new Map([['p1', { s: i, mx: 1, my: 0, a: 0, f: 0, m: 0 }]]));
  if (Math.hypot(p.x - 17.5, p.y - 3.5) > 1.2) fail(`le tank n’a pas été téléporté (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
  if (!g.events.some((e) => e[0] === 'warp' && e[5] === p.id)) fail('pas d’événement warp pour le tank');
  // client prediction gives the same result
  let [x, y, body] = [2.5, 8.5, 0];
  for (let i = 0; i < 30 && x < 10; i++) [x, y, body] = driveStep(tiles, x, y, body, 1, 0, SPECS.player.speed, DT);
  if (Math.hypot(x - 17.5, y - 3.5) > 1.2) fail('la prédiction ne passe pas par le portail');
  // a shell fired into a portal pops out of the other one
  g.events = [];
  const q = g.addTank('player', 0, 6.5, 10.5, 0x3d7bff, 'p2', 'Q');
  q.turret = Math.atan2(8.5 - 10.5, 4.5 - 6.5);
  q.fireCd = 0;
  g.tryFire(q);
  for (let i = 0; i < 20; i++) g.step(new Map());
  if (!g.events.some((e) => e[0] === 'warp' && e[5] === 0)) fail('l’obus n’a pas traversé le portail');
  // the AI ray-caster sees through portals
  const segs = castRicochet(tiles, 2.5, 8.5, 0, 0, 30);
  if (segs.length < 2 || Math.hypot(segs[1].x0 - 17.5, segs[1].y0 - 3.5) > 0.01) fail('castRicochet ignore les portails');
  // the boss can't use them
  const b = new Game(tiles);
  const boss = b.addTank('boss', 99, 1.5, 8.5, 0);
  boss.ai = undefined;
  b.frozen = false;
  for (let i = 0; i < 60; i++) b.driveTank(boss, 1, 0, DT);
  if (boss.y < 6) fail('le Colosse est passé par un portail');
  if (process.exitCode !== 1) console.log(`portails OK (missions générées à portails : ${withPortals.join(', ')})`);
}

// night: the AI only sees foes close by or right after they fire; a few missions are played in the dark
{
  const fail = (m: string) => { console.error('NUIT:', m); process.exitCode = 1; };
  if (!getMission(LEVELS.length).night) fail('la dernière mission faite main devrait être de nuit');
  const nights = [];
  for (let mission = 1; mission <= 80; mission++) if (getMission(mission).night) nights.push(mission);
  if (nights.length < 10) fail(`trop peu de missions de nuit (${nights.length})`);
  const tiles = new Array(W * H).fill(Tile.Empty);
  const g = new Game(tiles);
  g.night = true;
  const p = g.addTank('player', 0, 2.5, 8.5, 0x3d7bff, 'p1', 'P');
  const e = g.addTank('pink', 99, 12.5, 8.5, 0);
  e.fireCd = 0;
  g.frozen = false;
  let shots = 0;
  const idle = new Map([['p1', { s: 0, mx: 0, my: 0, a: Math.PI, f: 0 as const, m: 0 as const }]]);
  for (let i = 0; i < 60; i++) {
    p.x = 2.5; p.y = 8.5;
    g.step(idle);
    shots += g.events.filter((ev) => ev[0] === 'shot' && ev[5] === e.id).length;
    g.events = [];
  }
  if (shots) fail('l’ennemi tire sur un joueur qu’il ne voit pas');
  if (g.netTanks().find((t) => t[0] === e.id)![5] & 256) fail('l’ennemi est en alerte sans rien voir');
  p.turret = Math.PI; p.fireCd = 0;
  g.tryFire(p); // the muzzle flash gives the player away
  if (!g.canSee(e, p)) fail('le tir ne trahit pas le joueur');
  p.reveal = 0;
  p.x = e.x - 3; p.y = e.y;
  if (!g.canSee(e, p)) fail('l’ennemi ne voit pas un joueur tout proche');
  g.night = false;
  p.x = 2.5;
  if (!g.canSee(e, p)) fail('de jour, tout le monde se voit');
  if (process.exitCode !== 1) console.log(`nuit OK (missions de nuit : ${nights.join(', ')})`);
}
