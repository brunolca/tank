import { councilVerdict, taupeLevel, TAUPE_STAGES } from '../src/shared/taupe';
import { applyTwist, DAILY_STAGES, DAILY_TWISTS, SEVEN_TWISTS_FROM, SIX_TWISTS_FROM, dailyLevel, dailyTwist, dayNumber, formatTicks } from '../src/shared/daily';
import { EXTRA_LEVELS, getMission, isBossMission, LEVELS, versusArena } from '../src/shared/levels';
import { Game, driveStep } from '../src/shared/sim';
import { BOLT_R, BOLT_WARN, DT, FLAG_BURROW, MASON_MAX, H, SPECS, STEEL_STRIPPED, Tile, W, WEAPONS, playerSpec } from '../src/shared/constants';
import { castRicochet, tunnelAxis } from '../src/shared/physics';

for (const def of Object.values(EXTRA_LEVELS)) {
  const bad = def.map.map((r, y) => [y, r.length]).filter(([, l]) => l !== W);
  if (def.map.length !== H || bad.length) { console.error('BAD MAP', def.name, def.map.length, bad); process.exitCode = 1; }
}
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
  g.storm = !!lvl.storm;
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
    // the three shells of a fan shot leave side by side: they must not destroy one another
    for (let i = 0; i < 3; i++) g.step(new Map());
    if (g.bullets.length - before < 3) fail(`éventail : il ne reste que ${g.bullets.length - before} obus après trois ticks`);
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
    if (!isBossMission(mission) || !lvl.enemies.some((e) => e.kind === 'boss' || e.kind === 'drill')) fail(`la mission ${mission} n’a pas de boss`);
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

// daily challenge: five valid stages a day, the same for everyone, twists that do what they say
{
  const fail = (m: string) => { console.error('DÉFI:', m); process.exitCode = 1; };
  const today = dayNumber(Date.UTC(2026, 9, 30));
  const seen = new Set<string>();
  let worst = 0;
  for (let day = today; day < today + 30; day++) {
    const twist = dailyTwist(day);
    seen.add(twist);
    for (let stage = 1; stage <= DAILY_STAGES; stage++) {
      const lvl = dailyLevel(day, stage);
      if (!lvl.spawns.length || !lvl.enemies.length) fail(`jour ${day} étape ${stage} : ni départ ni ennemi`);
      if (JSON.stringify(dailyLevel(day, stage)) !== JSON.stringify(lvl)) fail(`jour ${day} étape ${stage} : pas déterministe`);
      for (const t of [Tile.PortalA, Tile.PortalB]) {
        const n = lvl.tiles.filter((v) => v === t).length;
        if (n !== 0 && n !== 2) fail(`jour ${day} étape ${stage} : ${n} portail(s)`);
      }
      if (twist === 'nuit' && !lvl.night) fail(`jour ${day} : étape ${stage} de jour malgré « nuit »`);
      if (twist !== 'nuit' && lvl.night) fail(`jour ${day} : étape ${stage} de nuit sans la consigne`);
      if (twist === 'portails' && !lvl.tiles.includes(Tile.PortalA)) fail(`jour ${day} : étape ${stage} sans portail`);
      if ((twist === 'colosse' && stage === DAILY_STAGES) !== lvl.enemies.some((e) => e.kind === 'boss')) fail(`jour ${day} étape ${stage} : Colosse mal placé`);
      // a quick fight to make sure the stage runs and stays cheap
      if (day < today + 5) {
        const g = new Game(lvl.tiles);
        applyTwist(g, twist);
        const p = g.addTank('player', 0, lvl.spawns[0][0], lvl.spawns[0][1], 0x3d7bff, 'p1', 'P');
        for (const e of lvl.enemies) g.addTank(e.kind, 99, e.x, e.y, 0);
        g.frozen = false;
        g.bonusOn = true;
        const t0 = performance.now();
        let n = 0;
        for (; n < 30 * 20 && p.alive; n++) g.step(new Map([['p1', { s: n, mx: Math.cos(n / 50), my: Math.sin(n / 37), a: n / 20, f: n % 25 === 0 ? 1 : 0, m: 0 }]]));
        worst = Math.max(worst, (performance.now() - t0) / n);
      }
    }
  }
  if (seen.size !== DAILY_TWISTS.length) fail(`consignes vues sur 30 jours : ${[...seen].join(', ')}`);
  if (dailyLevel(today, 1).name === dailyLevel(today + 1, 1).name && JSON.stringify(dailyLevel(today, 1).tiles) === JSON.stringify(dailyLevel(today + 1, 1).tiles)) fail('deux jours de suite identiques');
  // « ricochets fous »: player shells get one more bounce
  const g = new Game(new Array(W * H).fill(Tile.Empty));
  const p = g.addTank('player', 0, 5.5, 8.5, 0x3d7bff, 'p1', 'P');
  g.frozen = false;
  applyTwist(g, 'ricochets');
  p.fireCd = 0;
  g.tryFire(p);
  if (g.bullets[0]?.bounces !== SPECS.player.bounces + 1) fail('« Ricochets fous » ne donne pas de rebond en plus');
  if (formatTicks(30 * 125.5) !== '2:05,5') fail(`chrono mal formaté : ${formatTicks(30 * 125.5)}`);
  if (process.exitCode !== 1) console.log(`défi du jour OK (pire tick ${worst.toFixed(3)} ms, aujourd’hui : ${dailyTwist(dayNumber())}, « ${dailyLevel(dayNumber(), 1).name} »)`);
}

// arsenal: each cannon changes ammo, bounces, rockets and mines, and travels in the tank infos
{
  const fail = (m: string) => { console.error('ARSENAL:', m); process.exitCode = 1; };
  const lvl = getMission(1);
  for (const w of WEAPONS) {
    const g = new Game(lvl.tiles);
    const [sx, sy] = lvl.spawns[0];
    const p = g.addTank('player', 0, sx, sy, 0x3d7bff, 'p1', 'P');
    g.arm(p, w);
    g.frozen = false;
    const spec = playerSpec(w);
    if (p.spec.maxBullets !== spec.maxBullets || p.spec.bounces !== spec.bounces || p.spec.mines !== spec.mines) fail(`${w} : fiche non appliquée`);
    if ((g.tankInfos()[0].w ?? 'canon') !== w) fail(`${w} : absent des infos du tank`);
    p.turret = -Math.PI / 2; // towards the open middle of the map
    let fired = 0;
    for (let i = 0; i < 40; i++) { p.fireCd = 0; if (g.tryFire(p)) fired++; }
    if (g.bullets.length !== spec.maxBullets) fail(`${w} : ${g.bullets.length} obus en vol au lieu de ${spec.maxBullets}`);
    if (g.bullets.some((b) => b.rocket !== spec.rocket || b.bounces !== spec.bounces)) fail(`${w} : obus mal réglés`);
    let mines = 0;
    for (let i = 0; i < 8; i++) { p.mineCd = 0; p.x = 2.5 + i * 1.1; if (g.tryMine(p)) mines++; }
    if (mines !== spec.mines) fail(`${w} : ${mines} mines posées au lieu de ${spec.mines}`);
    if (fired < spec.maxBullets) fail(`${w} : tir refusé`);
  }
  if (playerSpec('canon').maxBullets !== SPECS.player.maxBullets) fail('le canon doit garder la fiche du joueur');
  if (process.exitCode !== 1) console.log('arsenal OK');
}

// mole mode (iteration 8): council verdicts and generated stages
{

  const fail = (m: string) => { console.error('TAUPE:', m); process.exitCode = 1; };
  const v3 = ['a', 'b', 'c'], v4 = ['a', 'b', 'c', 'd'];
  if (councilVerdict(v3, { a: 'b', c: 'b', b: 'a' }) !== 'b') fail('2 voix sur 2 autres devraient accuser b');
  if (councilVerdict(v3, { a: 'b', b: 'a', c: 'a' }) !== 'a') fail('a devrait être accusé');
  if (councilVerdict(v3, { a: 'b', b: 'c', c: '' }) !== undefined) fail('une seule voix ne suffit pas à 3');
  if (councilVerdict(v4, { a: 'b', c: 'b' }) !== 'b') fail('2 voix sur 3 autres devraient suffire à 4');
  if (councilVerdict(v4, { a: 'b', c: 'd' }) !== undefined) fail('voix dispersées : personne');
  if (councilVerdict(v3, { a: 'a', b: 'a' }) !== undefined) fail('on ne vote pas pour soi');
  if (councilVerdict(v3, { a: 'z', b: 'z' }) !== undefined) fail('cible inconnue ignorée');
  for (let seed = 1; seed < 40; seed++) {
    for (let stage = 1; stage <= TAUPE_STAGES; stage++) {
      const lvl = taupeLevel(seed * 977, stage);
      if (!lvl.spawns.length || lvl.enemies.length < 3 || lvl.night) fail(`graine ${seed} étape ${stage} : ${lvl.spawns.length} départs, ${lvl.enemies.length} ennemis`);
      if (lvl.tiles.some((t) => t === Tile.PortalA || t === Tile.PortalB)) fail(`graine ${seed} étape ${stage} : portails`);
    }
  }
  console.log('taupe OK', taupeLevel(8, 1).name, taupeLevel(8, 1).enemies.length, taupeLevel(8, 3).enemies.length);
}

// storm (iteration 9): announced strikes, a blast that spares nobody, the AI gets out of the way, missions and twists
{
  const fail = (m: string) => { console.error('ORAGE:', m); process.exitCode = 1; };
  if (!getMission(16).storm) fail('« Tempête » (16) devrait se jouer sous l’orage');
  const storms: number[] = [];
  for (let mission = 1; mission <= 80; mission++) if (getMission(mission).storm) storms.push(mission);
  if (storms.length < 8) fail(`trop peu de missions d’orage (${storms.length})`);
  if (storms.some((m) => m < 21 && m !== 16)) fail('orage avant la 21ᵉ mission');
  if (![0, 1, 2, 3, 4, 5, 6, 7].some((r) => versusArena(r).storm)) fail('aucune manche versus sous l’orage');
  // the twists of the days already played don't move; the six-twist rotation starts with the storm
  for (let day = SIX_TWISTS_FROM - 40; day < SIX_TWISTS_FROM; day++) if (dailyTwist(day) !== DAILY_TWISTS[day % 5]) fail(`le jour ${day} a changé de consigne`);
  if (dailyTwist(SIX_TWISTS_FROM) !== 'orage') fail('le premier jour à six consignes devrait être un jour d’orage');
  const seen = new Set<string>();
  for (let day = SIX_TWISTS_FROM; day < SIX_TWISTS_FROM + 12; day++) {
    seen.add(dailyTwist(day));
    for (let st = 1; st <= DAILY_STAGES; st++) if (!!dailyLevel(day, st).storm !== (dailyTwist(day) === 'orage')) fail(`jour ${day} étape ${st} : orage mal réglé`);
  }
  if (seen.size !== DAILY_TWISTS.length) fail('une consigne manque à la rotation');
  for (let seed = 1; seed < 10; seed++) for (let st = 1; st <= TAUPE_STAGES; st++) if (taupeLevel(seed * 31, st).storm) fail('orage dans la taupe');
  // a strike: announced first, nobody hurt during the warning, then everything in reach goes
  const tiles = new Array(W * H).fill(Tile.Empty);
  tiles[8 * W + 11] = Tile.Cork;
  const g = new Game(tiles);
  g.night = true;
  const p = g.addTank('player', 0, 10.5, 8.5, 0x3d7bff, 'p1', 'P');
  const far = g.addTank('player', 0, 3.5, 3.5, 0x3d7bff, 'p2', 'Q');
  const e = g.addTank('brown', 99, 18.5, 14.5, 0);
  g.frozen = false;
  g.mines.push({ id: 900, owner: far.id, team: 0, x: 11.2, y: 9.3, t: 0, fuse: -1, dead: false });
  let killer: unknown = 'none';
  g.onKill = (_v, k) => { killer = k; };
  const bo = g.spawnBolt({ x: 10.6, y: 8.6 });
  if (!bo || !g.events.some((ev) => ev[0] === 'zap')) fail('la foudre n’est pas annoncée');
  if (g.canSee(e, p)) fail('de nuit, l’ennemi voit le joueur de loin avant l’éclair');
  const idle = new Map([['p1', { s: 0, mx: 0, my: 0, a: 0, f: 0 as const, m: 0 as const }]]);
  for (let i = 0; i < Math.floor(BOLT_WARN / DT) - 2; i++) { p.x = 10.5; p.y = 8.5; g.step(idle); }
  if (!p.alive) fail('la foudre tombe avant la fin de l’annonce');
  for (let i = 0; i < 6; i++) { p.x = 10.5; p.y = 8.5; g.step(idle); }
  if (p.alive) fail('la foudre épargne un tank sous l’éclair');
  if (killer !== undefined) fail('la foudre ne devrait être attribuée à personne');
  if (!far.alive) fail('la foudre touche un tank loin d’elle');
  if (g.tiles[8 * W + 11] !== Tile.Empty) fail('le liège résiste à la foudre');
  if (!g.events.some((ev) => ev[0] === 'bolt')) fail('pas d’événement bolt');
  if (!g.canSee(e, far)) fail('l’éclair n’illumine pas la table');
  for (let i = 0; i < 10; i++) g.step(new Map());
  if (g.mines.length) fail('la mine sous la foudre n’a pas sauté');
  for (let i = 0; i < 40; i++) g.step(new Map());
  if (g.canSee(e, far)) fail('l’éclair dure trop longtemps');
  // the AI drives out of an announced strike
  let fled = 0;
  for (let k = 0; k < 6; k++) {
    const h = new Game(new Array(W * H).fill(Tile.Empty));
    h.addTank('player', 0, 2.5, 2.5, 0x3d7bff, 'p1', 'P');
    const a = h.addTank('ash', 99, 12.5, 8.5, 0);
    h.frozen = false;
    h.spawnBolt({ x: a.x + 0.2, y: a.y + 0.1 });
    for (let i = 0; i < Math.floor(BOLT_WARN / DT) + 2; i++) h.step(new Map());
    if (a.alive) fled++;
  }
  if (fled < 5) fail(`l’IA ne fuit pas la foudre (${fled}/6)`);
  // a storm keeps striking on its own, never on walls, and stays cheap
  const lvl = getMission(16);
  const s = new Game(lvl.tiles);
  s.storm = true;
  s.addTank('player', 0, lvl.spawns[0][0], lvl.spawns[0][1], 0x3d7bff, 'p1', 'P').ai = undefined;
  for (const en of lvl.enemies) s.addTank(en.kind, 99, en.x, en.y, 0);
  s.frozen = false;
  let zaps = 0;
  const t1 = performance.now();
  for (let i = 0; i < 30 * 40; i++) {
    s.step(new Map());
    for (const ev of s.events) if (ev[0] === 'zap') {
      zaps++;
      const tl = s.tiles[Math.floor(ev[2]) * W + Math.floor(ev[1])];
      if (tl === Tile.Wall || tl === Tile.Tall) fail('foudre annoncée sur un mur');
    }
    s.events = [];
  }
  const per = (performance.now() - t1) / (30 * 40);
  if (zaps < 7 || zaps > 18) fail(`${zaps} éclairs en 40 s`);
  if (s.bolts.some((b) => b.t >= BOLT_WARN)) fail('éclair resté en attente');
  void BOLT_R;
  if (process.exitCode !== 1) console.log(`orage OK (${zaps} éclairs en 40 s, ${per.toFixed(3)} ms/tick, missions d’orage : ${storms.join(', ')})`);
}

// steel tanks (iteration 10): two hits, the first one blows the armour off and makes them faster
{
  const fail = (m: string) => { console.error('ACIER:', m); process.exitCode = 1; };
  if (!getMission(12).enemies.some((e) => e.kind === 'steel')) fail('« Forteresse » (12) devrait avoir un tank d’acier');
  const steelMissions: number[] = [];
  for (let mission = 1; mission <= 80; mission++) if (getMission(mission).enemies.some((e) => e.kind === 'steel')) steelMissions.push(mission);
  if (steelMissions.some((m) => m !== 12 && m < 21)) fail('tank d’acier avant la 21ᵉ mission (hors Forteresse)');
  if (steelMissions.length < 15) fail(`trop peu de missions avec des tanks d’acier (${steelMissions.length})`);
  // the days already played keep their twist and their stages
  for (let day = SIX_TWISTS_FROM - 10; day < SEVEN_TWISTS_FROM; day++) {
    if (dailyTwist(day) === 'blindes') fail(`le jour ${day} est devenu « Blindés »`);
    for (let st = 1; st <= DAILY_STAGES; st++) if (dailyLevel(day, st).enemies.some((e) => e.kind === 'steel')) fail(`jour passé ${day} : un tank d’acier est apparu`);
  }
  if (dailyTwist(SIX_TWISTS_FROM) !== 'orage') fail('le 2 novembre doit rester un jour d’orage');
  if (dailyTwist(SEVEN_TWISTS_FROM) !== 'blindes') fail('le premier jour à sept consignes devrait être « Blindés »');
  for (let day = SEVEN_TWISTS_FROM; day < SEVEN_TWISTS_FROM + 21; day++) {
    const tw = dailyTwist(day);
    for (let st = 1; st <= DAILY_STAGES; st++) {
      const n = dailyLevel(day, st).enemies.filter((e) => e.kind === 'steel').length;
      if (tw === 'blindes' && n === 0) fail(`jour ${day} « Blindés » : étape ${st} sans tank d’acier`);
      if (tw !== 'blindes' && n > 0) fail(`jour ${day} : tank d’acier sans la consigne`);
    }
  }
  for (let seed = 1; seed < 10; seed++) for (let st = 1; st <= TAUPE_STAGES; st++) if (taupeLevel(seed * 31, st).enemies.some((e) => e.kind === 'steel')) fail('tank d’acier dans la taupe');
  // two hits; the first one strips it (faster), with a short grace so one blast counts once
  const g = new Game(new Array(W * H).fill(Tile.Empty));
  g.addTank('player', 0, 2.5, 2.5, 0x3d7bff, 'p1', 'P');
  const t = g.addTank('steel', 99, 15.5, 8.5, 0);
  g.frozen = false;
  if (t.hp !== 2 || t.maxHp !== 2) fail(`PV ${t.hp}/${t.maxHp} au lieu de 2/2`);
  if (!g.tankInfos().find((i) => i.id === t.id)?.hp) fail('les PV max ne sont pas annoncés');
  g.killTank(t, undefined);
  if (!t.alive || t.hp !== 1) fail('le premier coup devrait seulement arracher le blindage');
  if (t.spec.speed !== STEEL_STRIPPED.speed) fail('le tank dénudé ne va pas plus vite');
  if (!g.events.some((e) => e[0] === 'hurt')) fail('pas d’événement hurt');
  if (g.netTanks().find((n) => n[0] === t.id)?.[6] !== 1) fail('les PV ne voyagent pas dans l’instantané');
  g.killTank(t, undefined);
  if (!t.alive) fail('pas de répit juste après le premier coup');
  for (let i = 0; i < 10; i++) g.step(new Map());
  g.killTank(t, undefined);
  if (t.alive) fail('le deuxième coup devrait le détruire');
  if (SPECS.steel.speed >= (STEEL_STRIPPED.speed ?? 0)) fail('le blindé devrait être lent tant qu’il porte son armure');
  // a retried mission keeps it bare (the room remembers the hit points)
  const h = new Game(new Array(W * H).fill(Tile.Empty));
  const u = h.addTank('steel', 99, 15.5, 8.5, 0);
  h.setHp(u, 1, 2);
  if (u.hp !== 1 || u.spec.speed !== STEEL_STRIPPED.speed) fail('setHp ne dénude pas un blindé déjà touché');
  // a real mission with steel tanks runs and stays cheap
  const lvl = getMission(12);
  const s = new Game(lvl.tiles);
  for (const [x, y] of lvl.spawns) { const pl = s.addTank('player', 0, x, y, 0x3d7bff); s.enableAI(pl, { skill: 2 }); }
  for (const en of lvl.enemies) s.addTank(en.kind, 99, en.x, en.y, 0);
  s.frozen = false;
  let hurt = 0;
  const t1 = performance.now();
  for (let i = 0; i < 30 * 60; i++) { s.step(new Map()); hurt += s.events.filter((e) => e[0] === 'hurt').length; s.events = []; }
  const per = (performance.now() - t1) / (30 * 60);
  if (per > 1) fail(`${per.toFixed(3)} ms par tick`);
  if (process.exitCode !== 1) console.log(`acier OK (${hurt} blindage(s) arraché(s) en 60 s, ${per.toFixed(3)} ms/tick, missions : ${steelMissions.join(', ')})`);
}

// the Foreur (iteration 11): the boss of even tens; it digs, burrows toward a foe, shakes the ground, then bursts out
{
  const fail = (m: string) => { console.error('FOREUR:', m); process.exitCode = 1; };
  for (const [mission, kind] of [[10, 'boss'], [20, 'drill'], [30, 'boss'], [40, 'drill'], [60, 'drill']] as const) {
    if (!getMission(mission).enemies.some((e) => e.kind === kind)) fail(`la mission ${mission} devrait opposer ${kind}`);
  }
  if (getMission(20).night || getMission(40).night || getMission(20).storm) fail('le Foreur se bat de jour, sans orage');
  // the daily « Le Colosse attend » keeps its Colosse
  for (let day = SEVEN_TWISTS_FROM; day < SEVEN_TWISTS_FROM + 14; day++) {
    if (dailyTwist(day) === 'colosse' && !dailyLevel(day, DAILY_STAGES).enemies.some((e) => e.kind === 'boss')) fail('le défi « Le Colosse attend » a perdu son Colosse');
  }
  const tiles = new Array(W * H).fill(Tile.Empty);
  for (let y = 3; y < 14; y++) tiles[y * W + 11] = Tile.Wall; // a wall between them: it digs under it
  const g = new Game(tiles);
  const p = g.addTank('player', 0, 9.3, 8.5, 0x3d7bff, 'p1', 'P');
  const d = g.addTank('drill', 99, 17.5, 8.5, 0);
  g.frozen = false;
  if (!d.boss || d.hp !== 8) fail('le Foreur devrait être un boss à 8 PV');
  d.boss!.digT = 0;
  let saw: Record<string, number> = {};
  let underTicks = 0, hitUnder = false, killed = false;
  g.onKill = (v, k) => { if (v === p && k === d) killed = true; };
  for (let i = 0; i < 30 * 6 && !saw.erupt; i++) {
    g.step(new Map([['p1', { s: i, mx: 0, my: 0, a: 0, f: 0, m: 0 }]]));
    for (const e of g.events) saw[e[0]] = (saw[e[0]] ?? 0) + 1;
    g.events = [];
    if (d.boss!.dig >= 2) {
      underTicks++;
      if (!(g.netTanks().find((n) => n[0] === d.id)![5] & FLAG_BURROW)) fail('drapeau « sous la table » absent');
      const hp = d.hp;
      g.killTank(d, p);
      if (d.hp !== hp) hitUnder = true;
    }
  }
  if (!saw.dig || !saw.quake || !saw.erupt) fail(`cycle incomplet : ${JSON.stringify(saw)}`);
  if (hitUnder) fail('on peut le toucher sous la table');
  if (underTicks < 20) fail('trop peu de temps sous la table');
  if (Math.hypot(d.x - p.x, d.y - p.y) > 2.2) fail(`il ressort trop loin de sa proie (${d.x.toFixed(1)}, ${d.y.toFixed(1)})`);
  if (d.x > 11) fail('il n’est pas passé sous le mur');
  if (p.alive || !killed) fail('un joueur immobile sur le sol qui tremble devrait sauter');
  // the exit spot is always clear of walls
  const [ex, ey] = g.drillExit(11.5, 8.5);
  if (Math.abs(ex - 11.5) < 1.2) fail('sortie dans un mur');
  // enraged: a ring of shells as it comes out; hits on the surface count as usual
  const h = new Game(new Array(W * H).fill(Tile.Empty));
  const q = h.addTank('player', 0, 3.5, 3.5, 0x3d7bff, 'p1', 'P');
  const e = h.addTank('drill', 99, 15.5, 12.5, 0);
  h.setHp(e, 4, 8);
  h.frozen = false;
  if (!e.boss!.rage) fail('pas de colère à mi-vie');
  e.boss!.digT = 0;
  let ring = 0;
  for (let i = 0; i < 30 * 6 && !ring; i++) {
    const n = h.bullets.length;
    h.step(new Map([['p1', { s: i, mx: 1, my: 0, a: 0, f: 0, m: 0 }]]));
    if (h.events.some((x) => x[0] === 'erupt')) ring = h.bullets.length - n;
    h.events = [];
  }
  if (ring < 5) fail(`pas de salve en colère à la sortie (${ring})`);
  e.buffs.invuln = 0;
  const hp0 = e.hp;
  h.killTank(e, q);
  if (e.boss!.dig < 2 && e.hp !== hp0 - 1) fail('un coup en surface ne compte pas');
  // a real Foreur fight stays cheap
  const lvl = getMission(20);
  const s = new Game(lvl.tiles);
  for (const [x, y] of lvl.spawns) { const pl = s.addTank('player', 0, x, y, 0x3d7bff); s.enableAI(pl, { skill: 2 }); }
  for (const en of lvl.enemies) s.addTank(en.kind, 99, en.x, en.y, 0);
  s.frozen = false;
  let erupts = 0;
  const t1 = performance.now();
  for (let i = 0; i < 30 * 60; i++) { s.step(new Map()); erupts += s.events.filter((x) => x[0] === 'erupt').length; s.events = []; }
  const per = (performance.now() - t1) / (30 * 60);
  if (per > 1) fail(`${per.toFixed(3)} ms par tick`);
  if (process.exitCode !== 1) console.log(`Foreur OK (${erupts} sortie(s) en 60 s, ${per.toFixed(3)} ms/tick)`);
}

// the Maçon (iteration 12): it lays cork blocks between itself and its prey, never on anyone, never cutting the table in two
{
  const fail = (m: string) => { console.error('MAÇON:', m); process.exitCode = 1; };
  if (getMission(21).name !== 'Le chantier' || getMission(21).enemies.filter((e) => e.kind === 'mason').length < 2) fail('« Le chantier » (21) devrait avoir des maçons');
  if (!getMission(20).enemies.some((e) => e.kind === 'drill') || !getMission(30).enemies.some((e) => e.kind === 'boss')) fail('les boss ont bougé');
  const masonMissions: number[] = [];
  for (let mission = 1; mission <= 80; mission++) if (getMission(mission).enemies.some((e) => e.kind === 'mason')) masonMissions.push(mission);
  if (masonMissions.some((m) => m < 21)) fail('maçon avant la 21ᵉ mission');
  if (masonMissions.length < 12) fail(`trop peu de missions avec des maçons (${masonMissions.length})`);
  for (let day = SEVEN_TWISTS_FROM - 3; day < SEVEN_TWISTS_FROM + 20; day++) {
    for (let st = 1; st <= DAILY_STAGES; st++) if (dailyLevel(day, st).enemies.some((e) => e.kind === 'mason')) fail(`défi du jour ${day} : un maçon est apparu (les classements changeraient)`);
  }
  for (let seed = 1; seed < 10; seed++) for (let st = 1; st <= TAUPE_STAGES; st++) if (taupeLevel(seed * 31, st).enemies.some((e) => e.kind === 'mason')) fail('maçon dans la taupe');
  // open table: it builds between itself and the player, on its own side
  const g = new Game(new Array(W * H).fill(Tile.Empty));
  const p = g.addTank('player', 0, 4.5, 8.5, 0x3d7bff, 'p1', 'P');
  const m = g.addTank('mason', 99, 14.5, 8.5, 0);
  g.frozen = false;
  const built: number[] = [];
  for (let i = 0; i < 30 * 40; i++) {
    p.buffs.invuln = 1; // the player stands there and takes it: we only watch the masonry
    g.step(new Map([['p1', { s: i, mx: 0, my: 0, a: 0, f: 0, m: 0 }]]));
    for (const e of g.events) if (e[0] === 'build') {
      built.push(e[2] * W + e[1]);
      if (g.tiles[e[2] * W + e[1]] !== Tile.Cork) fail('événement sans bloc');
    }
    g.events = [];
    if (!m.alive) break;
  }
  if (built.length < 3) fail(`trop peu de blocs en 40 s (${built.length})`);
  const standing = g.tiles.filter((t) => t === Tile.Cork).length;
  if (standing > MASON_MAX) fail(`trop de blocs debout (${standing})`);
  for (const c of built) {
    const x = c % W + 0.5, y = Math.floor(c / W) + 0.5;
    if (Math.hypot(x - p.x, y - p.y) < 0.8) fail('bloc posé sur le joueur');
  }
  // never seals a corridor: a one-tile-wide passage stays open
  const tiles = new Array(W * H).fill(Tile.Wall);
  for (let x = 1; x < W - 1; x++) tiles[8 * W + x] = Tile.Empty;
  const h = new Game(tiles);
  const q = h.addTank('player', 0, 2.5, 8.5, 0x3d7bff, 'p1', 'P');
  const n = h.addTank('mason', 99, 12.5, 8.5, 0);
  h.frozen = false;
  let sealed = 0;
  for (let i = 0; i < 30 * 20; i++) {
    q.buffs.invuln = 1;
    h.step(new Map([['p1', { s: i, mx: 0, my: 0, a: 0, f: 0, m: 0 }]]));
    sealed += h.events.filter((e) => e[0] === 'build').length;
    h.events = [];
  }
  if (sealed) fail(`il a muré un couloir (${sealed} bloc(s))`);
  if (!q.alive && !n.alive) fail('test du couloir incohérent');
  // a real building site stays cheap
  const lvl = getMission(21);
  const s = new Game(lvl.tiles);
  for (const [x, y] of lvl.spawns) { const pl = s.addTank('player', 0, x, y, 0x3d7bff); s.enableAI(pl, { skill: 2 }); }
  for (const en of lvl.enemies) s.addTank(en.kind, 99, en.x, en.y, 0);
  s.frozen = false;
  let builds = 0;
  const t1 = performance.now();
  for (let i = 0; i < 30 * 60; i++) { s.step(new Map()); builds += s.events.filter((x) => x[0] === 'build').length; s.events = []; }
  const per = (performance.now() - t1) / (30 * 60);
  if (per > 1) fail(`${per.toFixed(3)} ms par tick`);
  if (process.exitCode !== 1) console.log(`Maçon OK (${built.length} bloc(s) en tête-à-tête, ${builds} sur le chantier en 60 s, ${per.toFixed(3)} ms/tick, missions : ${masonMissions.join(', ')})`);
}

// tunnels (iteration 13): tanks drive through and hide inside, shells bounce off, no firing from inside, the roof stops lightning
{
  const fail = (m: string) => { console.error('TUNNELS:', m); process.exitCode = 1; };
  const tunnelMissions: number[] = [];
  for (let mission = 1; mission <= 80; mission++) {
    const tiles = getMission(mission).tiles;
    if (!tiles.includes(Tile.Tunnel)) continue;
    tunnelMissions.push(mission);
    tiles.forEach((t, i) => { if (t === Tile.Tunnel && tunnelAxis(tiles, i) < 0) fail(`mission ${mission} : tunnel mal bordé en (${i % W}, ${Math.floor(i / W)})`); });
  }
  if (getMission(22).name !== 'Le tunnel' || getMission(23).name !== 'Les galeries') fail('missions 22 et 23 attendues');
  if (tunnelMissions.length < 2) fail('trop peu de missions à tunnels');
  if (!Array.from({ length: 11 }, (_, r) => versusArena(r).tiles.includes(Tile.Tunnel)).some(Boolean)) fail('aucune arène de versus à tunnels');
  // a row: wall above and below cells 8..12, tunnel in the middle
  const tiles = new Array(W * H).fill(Tile.Empty);
  for (let x = 8; x <= 12; x++) { tiles[7 * W + x] = Tile.Wall; tiles[9 * W + x] = Tile.Wall; tiles[8 * W + x] = Tile.Tunnel; }
  if (tunnelAxis(tiles, 8 * W + 10) !== 0) fail('sens du tunnel');
  // a tank drives straight through
  let x = 5.5, y = 8.5, body = 0;
  for (let i = 0; i < 90; i++) [x, y, body] = driveStep(tiles, x, y, body, 1, 0, 3, DT);
  if (x < 13) fail(`le tank n’a pas traversé (x = ${x.toFixed(2)})`);
  // a shell bounces off the tunnel
  const segs = castRicochet(tiles, 10.5, 4.5, Math.PI / 2, 1);
  if (segs.length < 2 || segs[0].y1 > 7.2) fail('l’obus devrait rebondir sur le toit du tunnel');
  const g = new Game(tiles.slice());
  const p = g.addTank('player', 0, 12.5, 8.5, 0x3d7bff, 'p1', 'P');
  const e = g.addTank('ash', 99, 10.5, 3.5, 0);
  const close = g.addTank('ash', 99, 13.9, 8.5, 0);
  g.frozen = false;
  if (!g.inTunnel(p) || g.canSee(e, p)) fail('un tank dans le tunnel devrait être caché');
  if (!g.canSee(close, p)) fail('à la porte du tunnel, on voit qui est dedans');
  p.fireCd = 0; p.turret = -Math.PI / 2;
  g.tryFire(p);
  if (g.bullets.length) fail('on ne tire pas depuis un tunnel');
  g.strike({ x: 12.5, y: 8.5, t: 0 });
  if (!p.alive) fail('le toit du tunnel devrait protéger de la foudre');
  // enemies keep hunting a hidden player and never shoot it through the roof; the mission stays cheap
  close.alive = false;
  let hits = 0;
  g.onKill = (v) => { if (v === p) hits++; };
  const t1 = performance.now();
  for (let i = 0; i < 30 * 20; i++) { g.step(new Map([['p1', { s: i, mx: 0, my: 0, a: 0, f: 0, m: 0 }]])); g.events = []; }
  if (hits) fail('touché à travers le toit');
  if (Math.hypot(e.x - 10.5, e.y - 3.5) < 0.5) fail('l’ennemi devrait partir à sa recherche');
  // the real missions run cheap, and the enemies there rarely blow themselves up
  let selfKills = 0, ticks = 0;
  for (const mission of [22, 23, 17, 12]) {
    const lvl = getMission(mission);
    const s = new Game(lvl.tiles);
    for (const [sx, sy] of lvl.spawns) { const pl = s.addTank('player', 0, sx, sy, 0x3d7bff); s.enableAI(pl, { skill: 2 }); }
    for (const en of lvl.enemies) s.addTank(en.kind, 99, en.x, en.y, 0);
    s.frozen = false;
    s.onKill = (v, k) => { if (k && k.team === v.team && v.team === 99) selfKills++; };
    for (let i = 0; i < 30 * 40; i++, ticks++) { s.step(new Map()); s.events = []; }
  }
  const per = (performance.now() - t1) / (30 * 20 + ticks);
  if (per > 1) fail(`${per.toFixed(3)} ms par tick`);
  if (process.exitCode !== 1) console.log(`tunnels OK (missions : ${tunnelMissions.join(', ')}, ${selfKills} ennemi(s) tués par leur camp en ${(ticks / 30).toFixed(0)} s, ${per.toFixed(3)} ms/tick)`);
}
