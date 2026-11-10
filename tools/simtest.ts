import { ATELIER_SAMPLE, atelierLevel, blankMap, checkAtelier, cleanName, decodeAtelier, encodeAtelier } from '../src/shared/atelier';
import { councilVerdict, taupeLevel, TAUPE_STAGES } from '../src/shared/taupe';
import { applyTwist, DAILY_STAGES, DAILY_TWISTS, SEVEN_TWISTS_FROM, SIX_TWISTS_FROM, dailyLevel, dailyTwist, dayNumber, formatTicks } from '../src/shared/daily';
import { EXTRA_LEVELS, bossOf, getMission, isBossMission, LEVELS, versusArena } from '../src/shared/levels';
import { Game, driveStep, slideDrive } from '../src/shared/sim';
import { BOLT_R, BULLET_SPEED, FLAG_MAGNET, MAGNET_HELD_SHIFT, MAGNET_ON, MAGNET_R, ICE, BOLT_WARN, DT, FLAG_BURROW, MASON_MAX, H, SPECS, STEEL_STRIPPED, Tile, W, WEAPONS, isBossKind, playerSpec } from '../src/shared/constants';
import { beltStep, castRicochet, castWindy, tunnelAxis } from '../src/shared/physics';
import { WIND_ACC, gustAt, windAt } from '../src/shared/wind';
import { FOG_SIGHT, fogBanks, fogDensity, fogHides } from '../src/shared/fog';
import { RIVAL_LEVELS, makeRival, rivalLevel } from '../src/shared/rivals';
import { CTF_ARENA_COUNT, CTF_RESPAWN, CTF_RETURN, CTF_ROUND, ctfArena, ctfTeam, newFlags } from '../src/shared/drapeau';
import { canBuy, canBuyAny, cleanRanks, freeGalons, killXp, spentGalons, startGalons, trainSpec, type Progress } from '../src/shared/skills';

for (const def of Object.values(EXTRA_LEVELS)) {
  const bad = def.map.map((r, y) => [y, r.length]).filter(([, l]) => l !== W);
  if (def.map.length !== H || bad.length) { console.error('BAD MAP', def.name, def.map.length, bad); process.exitCode = 1; }
}
for (let i = 0; i < LEVELS.length; i++) {
  const bad = LEVELS[i].map.map((r, y) => [y, r.length]).filter(([, l]) => l !== W);
  if (LEVELS[i].map.length !== H || bad.length) { console.error('BAD MAP', i + 1, LEVELS[i].map.length, bad); process.exitCode = 1; }
}
let t0 = Date.now();
for (let mission = 1; mission <= LEVELS.length + 15; mission++) {
  const lvl = getMission(mission);
  if (!lvl.spawns.length || !lvl.enemies.length) { console.error(`M${mission}: no spawn or no enemy`); process.exitCode = 1; }
  const g = new Game(lvl.tiles, lvl.belts);
  const p = g.addTank('player', 0, lvl.spawns[0][0], lvl.spawns[0][1], 0x3d7bff, 'p1', 'P');
  for (const e of lvl.enemies) g.addTank(e.kind, 99, e.x, e.y, 0);
  g.frozen = false;
  g.bonusOn = true;
  g.bonusNext = 1;
  g.bonusEvery = [3, 5];
  g.storm = !!lvl.storm;
  g.wind = lvl.wind;
  g.fog = lvl.fog;
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
  const g = new Game(lvl.tiles, lvl.belts);
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
    if (!isBossMission(mission) || !lvl.enemies.some((e) => isBossKind(e.kind))) fail(`la mission ${mission} n’a pas de boss`);
  }
  const lvl = getMission(10);
  const g = new Game(lvl.tiles, lvl.belts);
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
        const g = new Game(lvl.tiles, lvl.belts);
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
    const g = new Game(lvl.tiles, lvl.belts);
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
  const s = new Game(lvl.tiles, lvl.belts);
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
  const s = new Game(lvl.tiles, lvl.belts);
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
  for (const [mission, kind] of [[10, 'boss'], [20, 'drill'], [30, 'thunder'], [40, 'sower'], [50, 'boss'], [60, 'drill'], [70, 'thunder'], [80, 'sower'], [90, 'boss'], [130, 'boss']] as const) {
    if (!getMission(mission).enemies.some((e) => e.kind === kind)) fail(`la mission ${mission} devrait opposer ${kind}`);
  }
  if (getMission(20).night || getMission(60).night || getMission(20).storm) fail('le Foreur se bat de jour, sans orage');
  if (!getMission(50).night || getMission(90).night || getMission(10).night) fail('un Colosse sur deux se bat de nuit, à partir du 50ᵉ');
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
  const s = new Game(lvl.tiles, lvl.belts);
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
  if (!getMission(20).enemies.some((e) => e.kind === 'drill') || !getMission(30).enemies.some((e) => e.kind === 'thunder')) fail('les boss ont bougé');
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
    p.buffs.invuln = 1; m.buffs.invuln = 1; // both stand there and take it (its own ricochet could end the test by chance): we only watch the masonry
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
  const s = new Game(lvl.tiles, lvl.belts);
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

// the Pilleur (iteration 15): it races to the crates, keeps the bonus, and drops it when destroyed
{
  const fail = (m: string) => { console.error('PILLEUR:', m); process.exitCode = 1; };
  if (getMission(24).name !== 'Le marché aux puces' || getMission(24).enemies.filter((e) => e.kind === 'thief').length < 2) fail('« Le marché aux puces » (24) devrait avoir des pilleurs');
  if (getMission(21).name !== 'Le chantier' || getMission(22).name !== 'Le tunnel') fail('les missions faites main ont bougé');
  const thiefMissions: number[] = [];
  for (let mission = 1; mission <= 80; mission++) if (getMission(mission).enemies.some((e) => e.kind === 'thief')) thiefMissions.push(mission);
  if (thiefMissions.some((m) => m < 24)) fail('pilleur avant la 24ᵉ mission');
  if (thiefMissions.length < 8) fail(`trop peu de missions avec des pilleurs (${thiefMissions.length})`);
  for (let day = SEVEN_TWISTS_FROM - 3; day < SEVEN_TWISTS_FROM + 20; day++) {
    for (let st = 1; st <= DAILY_STAGES; st++) if (dailyLevel(day, st).enemies.some((e) => e.kind === 'thief')) fail(`défi du jour ${day} : un pilleur est apparu`);
  }
  for (let seed = 1; seed < 10; seed++) for (let st = 1; st <= TAUPE_STAGES; st++) if (taupeLevel(seed * 31, st).enemies.some((e) => e.kind === 'thief')) fail('pilleur dans la taupe');
  // open table: a crate falls far from both, the Pilleur fetches it
  const g = new Game(new Array(W * H).fill(Tile.Empty));
  g.bonusOn = true;
  g.bonusNext = 999;
  const p = g.addTank('player', 0, 3.5, 8.5, 0x3d7bff, 'p1', 'P');
  const th = g.addTank('thief', 99, 12.5, 8.5, 0);
  g.frozen = false;
  const c = g.spawnBonus('fan');
  if (!c) fail('aucune caisse posée');
  else {
    c.x = 18.5; c.y = 2.5;
    let took = -1;
    for (let i = 0; i < 30 * 15 && took < 0; i++) {
      p.buffs.invuln = 1; th.buffs.invuln = 1;
      g.bonusNext = 999;
      g.step(new Map([['p1', { s: i, mx: 0, my: 0, a: 0, f: 0, m: 0 }]]));
      for (const e of g.events) if (e[0] === 'bonus' && e[4] === th.id) took = i;
      g.events = [];
    }
    if (took < 0) fail('le pilleur n’a pas ramassé la caisse en 15 s');
    else if (th.buffs.fan <= 0 || th.loot !== 'fan') fail('le pilleur n’a pas gardé le bonus');
    th.buffs.invuln = 0;
    g.killTank(th, p);
    const loot = g.events.find((e) => e[0] === 'loot');
    if (th.alive) fail('le pilleur a survécu');
    else if (!loot || !g.bonuses.some((b) => b.kind === 'fan')) fail('le butin n’est pas tombé');
    else if (g.tiles[Math.floor(loot[2] as number) * W + Math.floor(loot[1] as number)] !== Tile.Empty) fail('butin posé sur un mur');
    if (process.exitCode !== 1) console.log(`Pilleur : caisse volée en ${(took / 30).toFixed(1)} s`);
  }
  // the flea market stays cheap with four AI players
  const lvl = getMission(24);
  const s = new Game(lvl.tiles, lvl.belts);
  s.bonusOn = true;
  for (const [x, y] of lvl.spawns) { const pl = s.addTank('player', 0, x, y, 0x3d7bff); s.enableAI(pl, { skill: 2 }); }
  for (const en of lvl.enemies) s.addTank(en.kind, 99, en.x, en.y, 0);
  s.frozen = false;
  let stolen = 0, crates = 0;
  const t1 = performance.now();
  for (let i = 0; i < 30 * 60; i++) {
    s.step(new Map());
    for (const e of s.events) {
      if (e[0] === 'crate') crates++;
      if (e[0] === 'bonus' && s.tankById(e[4] as number)?.kind === 'thief') stolen++;
    }
    s.events = [];
  }
  const per = (performance.now() - t1) / (30 * 60);
  if (per > 1) fail(`${per.toFixed(3)} ms par tick`);
  if (process.exitCode !== 1) console.log(`Pilleur OK (${crates} caisse(s) et ${stolen} vol(s) au marché en 60 s, ${per.toFixed(3)} ms/tick, missions : ${thiefMissions.join(', ')})`);
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
  p.x = 10.5; // deep inside: at the mouth its hull sticks out, and a ricochet there is fair game
  let hits = 0;
  // only a hit while still inside counts: an enemy driving into the tunnel may shove the player out of the mouth first (fair game)
  g.onKill = (v) => { if (v === p && g.inTunnel(p)) hits++; };
  const t1 = performance.now();
  let roamed = 0; // furthest the enemy went from its post (its prowl may bring it back by chance: judge the whole trip)
  for (let i = 0; i < 30 * 20; i++) { g.step(new Map([['p1', { s: i, mx: 0, my: 0, a: 0, f: 0, m: 0 }]])); g.events = []; roamed = Math.max(roamed, Math.hypot(e.x - 10.5, e.y - 3.5)); }
  if (hits) fail('touché à travers le toit');
  if (roamed < 0.5) fail('l’ennemi devrait partir à sa recherche');
  // the real missions run cheap, and the enemies there rarely blow themselves up
  let selfKills = 0, ticks = 0;
  for (const mission of [22, 23, 17, 12]) {
    const lvl = getMission(mission);
    const s = new Game(lvl.tiles, lvl.belts);
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

// the workshop (iteration 14): maps drawn by the players are checked by the room, shared by link, and play like any mission
{
  const fail = (m: string) => { console.error('ATELIER:', m); process.exitCode = 1; };
  const why = checkAtelier(ATELIER_SAMPLE.map);
  if (why) fail(`la mission d’exemple est refusée : ${why}`);
  // every handmade mission can serve as a template
  for (const def of [...LEVELS, ...Object.values(EXTRA_LEVELS)]) { const w = checkAtelier(def.map); if (w) fail(`« ${def.name} » refusée comme modèle : ${w}`); }
  // share codes go there and back, weather included
  for (const a of [ATELIER_SAMPLE, { name: 'Été ! « ça » ⛵', map: LEVELS[9].map, night: true, storm: true }, { name: '', map: blankMap() }]) {
    const code = encodeAtelier(a);
    const back = decodeAtelier(code);
    if (!back || back.map.join('') !== a.map.join('') || back.name !== cleanName(a.name) || !!back.night !== !!a.night || !!back.storm !== !!a.storm) fail(`aller-retour du code raté pour « ${a.name} »`);
    if (/[^A-Za-z0-9_.-]/.test(code)) fail(`code pas sûr pour un lien : ${code}`);
    if (code.length > 400) fail(`code trop long (${code.length})`);
  }
  for (const bad of ['', 'abc', 'AAAA.Z9', '.A373', '.A375', 'x.A2000']) if (decodeAtelier(bad)) fail(`code invalide accepté : ${bad}`);
  // the room refuses what it cannot play
  const edit = (f: (rows: string[]) => void) => { const m = ATELIER_SAMPLE.map.slice(); f(m); return m; };
  const set = (m: string[], x: number, y: number, c: string) => { m[y] = m[y].slice(0, x) + c + m[y].slice(x + 1); };
  const cases: [string, unknown][] = [
    ['pas un tableau', 'nope'],
    ['ligne trop courte', edit((m) => { m[3] = m[3].slice(1); })],
    ['caractère inconnu', edit((m) => set(m, 0, 0, 'Z'))],
    ['sans départ', edit((m) => { m[4] = m[4].replace('1', '.'); })],
    ['deux départs 1', edit((m) => set(m, 0, 0, '1'))],
    ['sans ennemi', blankMap()],
    ['deux boss', edit((m) => { set(m, 0, 0, 'X'); set(m, 0, 16, 'D'); })],
    ['portail seul', edit((m) => set(m, 0, 0, '+'))],
    ['tunnel en plein champ', edit((m) => set(m, 0, 0, '='))],
    ['départ emmuré', edit((m) => { set(m, 1, 4, '#'); set(m, 3, 4, '#'); set(m, 2, 3, '#'); set(m, 2, 5, '#'); })],
    ['trop d’ennemis', edit((m) => { m[16] = 'bbbbbbbbbbbbbbbbbbbbbb'; })],
  ];
  for (const [label, map] of cases) if (!checkAtelier(map)) fail(`carte acceptée à tort : ${label}`);
  if (cleanName('  <b>Ma\nmission</b> trop longue pour tenir sur la ligne ') !== 'bMa mission/b trop longue po') fail(`nettoyage du nom : « ${cleanName('  <b>Ma\nmission</b> trop longue pour tenir sur la ligne ')} »`);
  // it plays: heroes driven by the AI against the sample, night and storm included, and stays cheap
  const t1 = performance.now();
  let ticks = 0, kills = 0;
  for (const a of [ATELIER_SAMPLE, { ...ATELIER_SAMPLE, night: true, storm: true }]) {
    const lvl = atelierLevel(a);
    if (lvl.name !== a.name || !!lvl.night !== !!a.night) fail('niveau de l’atelier mal construit');
    const g = new Game(lvl.tiles, lvl.belts);
    for (const [sx, sy] of lvl.spawns) { const pl = g.addTank('player', 0, sx, sy, 0x3d7bff); g.enableAI(pl, { skill: 2 }); }
    for (const e of lvl.enemies) g.addTank(e.kind, 99, e.x, e.y, 0);
    g.night = !!lvl.night; g.storm = !!lvl.storm; g.bonusOn = true; g.frozen = false;
    g.onKill = (v) => { if (v.team === 99) kills++; };
    for (let i = 0; i < 30 * 45; i++, ticks++) { g.step(new Map()); g.events = []; }
  }
  const per = (performance.now() - t1) / ticks;
  if (per > 1) fail(`${per.toFixed(3)} ms par tick`);
  if (process.exitCode !== 1) console.log(`atelier OK (« ${ATELIER_SAMPLE.name} » : ${kills} ennemi(s) détruit(s) en ${(ticks / 30).toFixed(0)} s, ${per.toFixed(3)} ms/tick, code de ${encodeAtelier(ATELIER_SAMPLE).length} caractères)`);
}

// conveyor belts (iteration 16): they carry tanks, mines and crates, the client prediction agrees, slow tanks don't fight them
{
  const fail = (m: string) => { console.error('TAPIS:', m); process.exitCode = 1; };
  const beltMissions: number[] = [];
  for (let mission = 1; mission <= 40; mission++) {
    const lvl = getMission(mission);
    if (!lvl.belts) continue;
    beltMissions.push(mission);
    if (lvl.belts.length !== W * H) fail(`mission ${mission} : couche de tapis de mauvaise taille`);
    lvl.belts.forEach((b, i) => {
      if (b < 0 || b > 5) fail(`mission ${mission} : code de tapis ${b}`);
      if (b && lvl.tiles[i] !== Tile.Empty) fail(`mission ${mission} : tapis sous un mur en (${i % W}, ${Math.floor(i / W)})`);
    });
  }
  if (!beltMissions.includes(25) || !beltMissions.includes(26)) fail(`missions à tapis : ${beltMissions.join(', ')}`);
  if (!Array.from({ length: 24 }, (_, r) => !!versusArena(r).belts).some(Boolean)) fail('aucune arène de versus à tapis');
  for (let d = 0; d < 60; d++) if (dailyLevel(20000 + d, 1 + (d % DAILY_STAGES)).belts) fail('un tapis dans le défi du jour');
  // an empty table with a belt running right along row 8, a wall at its end
  const tiles = new Array(W * H).fill(Tile.Empty);
  const belts = new Array(W * H).fill(0);
  for (let x = 2; x <= 15; x++) belts[8 * W + x] = 1;
  tiles[8 * W + 17] = Tile.Wall;
  const g = new Game(tiles, belts);
  const p = g.addTank('player', 0, 3.5, 8.5, 0x3d7bff, 'p1', 'P');
  const brown = g.addTank('brown', 99, 6.5, 8.5, 0);
  g.frozen = false;
  const idle = new Map([['p1', { s: 0, mx: 0, my: 0, a: 0, f: 0 as const, m: 0 as const }]]);
  for (let i = 0; i < 30; i++) { g.step(idle); g.events = []; }
  if (Math.abs(p.x - 3.5 - 1.45) > 0.05) fail(`le tapis n’emporte pas le joueur (${p.x.toFixed(2)})`);
  if (Math.abs(brown.x - 6.5 - 1.45) > 0.05) fail(`le tapis n’emporte pas la tourelle (${brown.x.toFixed(2)})`);
  // a mine rides along and stops just past the end of the belt (its centre leaves the last cell)
  const mine = { id: 999, owner: brown.id, team: 99, x: 12.5, y: 8.5, t: 0, fuse: -1, dead: false };
  g.mines.push(mine as (typeof g.mines)[number]);
  g.tanks = g.tanks.filter((t) => t !== brown);
  p.x = 3.5; p.y = 4.5;
  for (let i = 0; i < 30 * 3; i++) { g.step(idle); g.events = []; }
  if (mine.x < 16 || mine.x > 16.1) fail(`la mine n’a pas suivi le tapis jusqu’au bout (${mine.x.toFixed(2)})`);
  // the client prediction (drive, then belt, input by input) lands exactly where the room puts the tank
  {
    const lvl = getMission(26);
    const s = new Game(lvl.tiles, lvl.belts);
    const pl = s.addTank('player', 0, 1.5, 6.5, 0x3d7bff, 'p1', 'P');
    s.frozen = false;
    let x = pl.x, y = pl.y, body = pl.body, worst = 0;
    for (let k = 0; k < 30 * 8; k++) {
      const inp = { s: k, mx: Math.cos(k / 23) * 0.6, my: Math.sin(k / 31), a: 0, f: 0 as const, m: 0 as const };
      s.step(new Map([['p1', inp]]));
      s.events = [];
      [x, y, body] = driveStep(lvl.tiles, x, y, body, inp.mx, inp.my, SPECS.player.speed, DT);
      [x, y] = beltStep(lvl.tiles, lvl.belts, x, y, pl.r, DT);
      worst = Math.max(worst, Math.hypot(x - pl.x, y - pl.y));
    }
    if (worst > 1e-9) fail(`la prédiction s’écarte de ${worst.toFixed(4)} sur les tapis`);
  }
  // the carrousel turns: its brown turrets come back round, and slow tanks never plan a path up a belt
  {
    const lvl = getMission(26);
    const s = new Game(lvl.tiles, lvl.belts);
    for (const e of lvl.enemies) s.addTank(e.kind, 99, e.x, e.y, 0);
    s.frozen = false;
    const b0 = s.tanks.find((t) => t.kind === 'brown')!;
    const x0 = b0.x, y0 = b0.y;
    let moved = 0;
    for (let i = 0; i < 30 * 20; i++) { s.step(new Map()); s.events = []; moved = Math.max(moved, Math.hypot(b0.x - x0, b0.y - y0)); }
    if (moved < 5) fail(`la tourelle du carrousel ne tourne pas (${moved.toFixed(1)} cases)`);
  }
  // the workshop paints belts and shares them by link
  {
    const map = ATELIER_SAMPLE.map.slice();
    map[7] = '>>>>>>^...VVV....<<<<';
    map[7] = map[7].padEnd(W, '<');
    if (checkAtelier(map)) fail(`atelier : carte à tapis refusée (${checkAtelier(map)})`);
    const code = encodeAtelier({ name: 'Usine', map });
    const back = decodeAtelier(code);
    if (!back || back.map.join('') !== map.join('')) fail('atelier : aller-retour du code raté avec des tapis');
    if (/[^A-Za-z0-9_.-]/.test(code)) fail(`atelier : code pas sûr pour un lien : ${code}`);
    if (!atelierLevel({ name: 'Usine', map }).belts?.some(Boolean)) fail('atelier : les tapis disparaissent en partie');
    if (decodeAtelier(encodeAtelier(ATELIER_SAMPLE))?.map.join('') !== ATELIER_SAMPLE.map.join('')) fail('atelier : les anciens codes ne passent plus');
  }
  // performance with every belt busy
  {
    const lvl = getMission(25);
    const s = new Game(lvl.tiles, lvl.belts);
    for (const [sx, sy] of lvl.spawns) { const pl = s.addTank('player', 0, sx, sy, 0x3d7bff); s.enableAI(pl, { skill: 2 }); }
    for (const e of lvl.enemies) s.addTank(e.kind, 99, e.x, e.y, 0);
    s.bonusOn = true; s.frozen = false;
    const t1 = performance.now();
    for (let i = 0; i < 30 * 40; i++) { s.step(new Map()); s.events = []; }
    const per = (performance.now() - t1) / (30 * 40);
    if (per > 1) fail(`${per.toFixed(3)} ms par tick`);
    if (process.exitCode !== 1) console.log(`tapis OK (missions : ${beltMissions.join(', ')}, ${per.toFixed(3)} ms/tick)`);
  }
}

// versus rivals (iteration 17): four AI tanks, one team each, must settle a round on every arena, quickly
{
  const fail = (m: string) => { console.error('rivaux : ' + m); process.exitCode = 1; };
  if (rivalLevel(-3) !== 0 || rivalLevel(9) !== RIVAL_LEVELS.length - 1 || rivalLevel('x') !== 1) fail('rivalLevel ne borne pas les niveaux');
  let settled = 0, rounds = 0, worst = 0, totalTicks = 0;
  const wins = [0, 0, 0];
  for (let round = 0; round < 24; round++) {
    const lvl = versusArena(round);
    const g = new Game(lvl.tiles, lvl.belts);
    g.bonusOn = true; g.bonusNext = 5; g.bonusEvery = [8, 12];
    g.night = !!lvl.night; g.storm = !!lvl.storm;
    const levels = [round % 3, (round + 1) % 3, (round + 2) % 3, round % 3];
    lvl.spawns.forEach(([x, y], i) => {
      const t = g.addTank('player', i + 1, x, y, 0x3d7bff, `ia:${i + 1}`, `R${i}`);
      g.arm(t, WEAPONS[(round + i) % WEAPONS.length]);
      makeRival(g, t, levels[i]);
    });
    g.frozen = false;
    let ticks = 0;
    const t1 = performance.now();
    for (; ticks < 30 * 120 && g.tanks.filter((t) => t.alive).length > 1; ticks++) { g.step(new Map()); g.events = []; }
    const per = (performance.now() - t1) / Math.max(1, ticks);
    worst = Math.max(worst, per);
    totalTicks += ticks;
    rounds++;
    const alive = g.tanks.filter((t) => t.alive);
    if (alive.length <= 1) settled++;
    if (alive.length === 1) wins[levels[alive[0].team - 1]]++;
    // the cannon keeps its ammo and speed: the brain only changes how it aims
    for (const t of g.tanks) if (t.spec.speed !== playerSpec(t.weapon ?? 'canon').speed) fail('un rival roule plus vite que son canon');
  }
  if (settled < rounds * 0.75) fail(`seulement ${settled}/${rounds} manches décidées en 2 minutes`);
  if (worst > 1) fail(`${worst.toFixed(3)} ms par tick`);
  if (process.exitCode !== 1) console.log(`rivaux OK (${settled}/${rounds} manches décidées, ${(totalTicks / rounds / 30).toFixed(0)} s en moyenne, victoires novice/malin/redoutable ${wins.join('/')}, ${worst.toFixed(3)} ms/tick au pire)`);
}

// the Grondeur (iteration 18): the third boss calls the lightning on each foe; its own strikes never touch it
{
  const fail = (m: string) => { console.error('GRONDEUR : ' + m); process.exitCode = 1; };
  for (const m of [30, 70, 110]) {
    const lvl = getMission(m);
    if (!lvl.storm || lvl.enemies.filter((e) => e.kind === 'thunder').length !== 1) fail(`la mission ${m} devrait opposer le Grondeur, sous l’orage`);
    for (const e of lvl.enemies) if (lvl.tiles[Math.floor(e.y) * W + Math.floor(e.x)] !== Tile.Empty) fail(`mission ${m} : un ennemi part dans un mur`);
  }
  const g = new Game(new Array(W * H).fill(Tile.Empty));
  const p = g.addTank('player', 0, 4.5, 4.5, 0x3d7bff, 'p1', 'P');
  const q = g.addTank('player', 0, 4.5, 12.5, 0x3d7bff, 'p2', 'Q');
  const t = g.addTank('thunder', 99, 15.5, 8.5, 0);
  const esc = g.addTank('ash', 99, 15.5, 4.5, 0);
  g.storm = true;
  g.frozen = false;
  if (!t.boss || t.hp !== 8) fail('le Grondeur devrait être un boss à 8 PV');
  t.boss!.volleyT = 0;
  const saw: Record<string, number> = {};
  const zaps: [number, number][] = [];
  for (let i = 0; i < 30 * 3; i++) {
    g.step(new Map([['p1', { s: i, mx: 0, my: 0, a: 0, f: 0, m: 0 }], ['p2', { s: i, mx: 0, my: 0, a: 0, f: 0, m: 0 }]]));
    for (const e of g.events) { saw[e[0]] = (saw[e[0]] ?? 0) + 1; if (e[0] === 'zap') zaps.push([e[1], e[2]]); }
    g.events = [];
  }
  if (!saw.call) fail(`il n’a pas appelé la foudre : ${JSON.stringify(saw)}`);
  if (zaps.length !== 2) fail(`calme, une frappe par adversaire (${zaps.length}) ; l’orage naturel doit se taire tant qu’il est debout`);
  for (const pl of [p, q]) if (!zaps.some(([x, y]) => Math.hypot(x - pl.x, y - pl.y) < 0.8)) fail('une frappe tombe loin de sa cible');
  if (p.alive || q.alive) fail('deux joueurs immobiles sous la foudre devraient sauter');
  // its own lightning: not a scratch on it, but its escort is fair game
  g.strike({ x: t.x, y: t.y, t: 0 });
  g.strike({ x: esc.x, y: esc.y, t: 0 });
  if (!t.alive || t.hp !== 8) fail('sa propre foudre le blesse');
  if (esc.alive) fail('la foudre épargne ses alliés');
  // enraged: two strikes per foe (on the spot, and ahead)
  const h = new Game(new Array(W * H).fill(Tile.Empty));
  h.addTank('player', 0, 4.5, 8.5, 0x3d7bff, 'p1', 'P');
  const r = h.addTank('thunder', 99, 16.5, 8.5, 0);
  h.setHp(r, 4, 8);
  if (!r.boss!.rage) fail('pas de colère à mi-vie');
  h.frozen = false;
  r.boss!.volleyT = 0;
  let n = 0;
  for (let i = 0; i < 30 * 1.5; i++) { h.step(new Map()); n += h.events.filter((e) => e[0] === 'zap').length; h.events = []; }
  if (n !== 2) fail(`en colère, deux frappes par adversaire (${n})`);
  // a real fight stays cheap, and the storm wakes up once it falls
  const lvl = getMission(30);
  const s = new Game(lvl.tiles, lvl.belts);
  s.storm = true;
  for (const [x, y] of lvl.spawns) { const pl = s.addTank('player', 0, x, y, 0x3d7bff); s.enableAI(pl, { skill: 2 }); }
  for (const en of lvl.enemies) { const e = s.addTank(en.kind, 99, en.x, en.y, 0); if (e.boss) e.boss.volleyT = 0.5; }
  s.frozen = false;
  let calls = 0;
  const t1 = performance.now();
  for (let i = 0; i < 30 * 60; i++) { s.step(new Map()); calls += s.events.filter((x) => x[0] === 'call').length; s.events = []; }
  const per = (performance.now() - t1) / (30 * 60);
  if (per > 1) fail(`${per.toFixed(3)} ms par tick`);
  if (!calls) fail('aucun appel de foudre en une minute de combat');
  const k = new Game(new Array(W * H).fill(Tile.Empty));
  k.addTank('player', 0, 4.5, 8.5, 0x3d7bff, 'p1', 'P');
  const dead = k.addTank('thunder', 99, 16.5, 8.5, 0);
  dead.alive = false;
  k.storm = true; k.stormNext = 0.01; k.frozen = false;
  k.step(new Map());
  if (!k.events.some((e) => e[0] === 'zap')) fail('l’orage ne revient pas quand le Grondeur tombe');
  if (process.exitCode !== 1) console.log(`Grondeur OK (${calls} appel(s) en 60 s, ${per.toFixed(3)} ms/tick)`);
}

// the stripes (iteration 19): experience, galons and the skill tree of the coop campaign
{
  const fail = (m: string) => { console.error('GALONS : ' + m); process.exitCode = 1; };
  const p0: Progress = { xp: 0, g: 3, r: [0, 0, 0] };
  if (!canBuy(p0, 0) || canBuy(p0, 3)) fail('achat du rang I');
  p0.r = [1, 0, 0];
  if (freeGalons(p0) !== 2 || !canBuy(p0, 0)) fail('rang II à 2 galons');
  p0.r = [2, 0, 0];
  if (freeGalons(p0) !== 0 || canBuyAny(p0)) fail('plus rien à acheter sans galon');
  if (spentGalons([3, 3, 3]) !== 18) fail('l’arbre complet coûte 18 galons');
  if (cleanRanks([9, -2, 'x']).join() !== '3,0,0') fail('cleanRanks');
  if (startGalons(1) !== 0 || startGalons(11) !== 4) fail('avance des paliers');
  const base = playerSpec('canon');
  const sp = trainSpec(base, [2, 1, 0]);
  if (sp.maxBullets !== base.maxBullets + 1 || sp.bounces !== base.bounces + 1 || sp.mines !== base.mines + 1 || sp.speed !== base.speed) fail('trainSpec');
  const empty = () => new Array(W * H).fill(Tile.Empty);
  // starting shield, longer bonuses, shield that grows back
  const g = new Game(empty());
  const t = g.addTank('player', 0, 4.5, 8.5, 0x3d7bff, 'p1', 'P');
  g.arm(t, 'canon');
  g.train(t, [0, 0, 3]);
  if (!t.buffs.shield) fail('pas de bouclier de départ');
  if (g.tankInfos()[0].sk?.join() !== '0,0,3') fail('les compétences ne voyagent pas dans TankInfo');
  g.giveBonus(t, 'turbo');
  if (Math.abs(t.buffs.turbo - 15) > 1e-6) fail('bonus prolongés');
  g.frozen = false;
  g.killTank(t, undefined);
  if (!t.alive || t.buffs.shield) fail('le bouclier de départ n’encaisse pas');
  for (let i = 0; i < 30 * 20 + 5; i++) g.step(new Map());
  if (!t.buffs.shield) fail('le bouclier ne revient pas au bout de 20 s');
  // an untrained tank has none of it
  const u = g.addTank('player', 0, 8.5, 8.5, 0x3d7bff, 'p2', 'Q');
  g.arm(u, 'canon'); g.train(u, [0, 0, 0]);
  if (u.buffs.shield || u.ranks || g.tankInfos()[1].sk) fail('un tank sans compétence en a');
  // cork breaker: the shell blows the cork away instead of bouncing
  const tiles = empty();
  tiles[8 * W + 8] = Tile.Cork;
  const c = new Game(tiles);
  const s = c.addTank('player', 0, 4.5, 8.5, 0x3d7bff, 'p1', 'P');
  c.arm(s, 'canon'); c.train(s, [3, 0, 0]);
  c.frozen = false;
  c.step(new Map([['p1', { s: 1, mx: 0, my: 0, a: 0, f: 1, m: 0 }]]));
  let broke = false;
  for (let i = 0; i < 40; i++) { c.step(new Map()); if (c.events.some((e) => e[0] === 'block')) broke = true; c.events = []; }
  if (!broke || c.tiles[8 * W + 8] !== Tile.Empty) fail('le brise-liège ne casse pas le liège');
  // wider blast, and one's own mines spare one
  const m = new Game(empty());
  const a = m.addTank('player', 0, 6.5, 8.5, 0x3d7bff, 'p1', 'P');
  const foe = m.addTank('ash', 99, 6.5 + 1.75, 8.5, 0);
  m.arm(a, 'canon'); m.train(a, [0, 3, 0]);
  m.frozen = false;
  if (!m.tryMine(a)) fail('pas de mine posée');
  m.explodeMine(m.mines[0]);
  if (!a.alive) fail('sang-froid : sa propre mine le détruit');
  if (foe.alive) fail('grand souffle : la mine devrait porter plus loin');
  const plain = new Game(empty());
  const b = plain.addTank('player', 0, 6.5, 8.5, 0x3d7bff, 'p1', 'P');
  const foe2 = plain.addTank('ash', 99, 6.5 + 1.75, 8.5, 0);
  plain.arm(b, 'canon');
  plain.frozen = false;
  plain.tryMine(b);
  plain.explodeMine(plain.mines[0]);
  if (b.alive || !foe2.alive) fail('une mine ordinaire a changé');
  if (killXp('thunder') <= killXp('steel') || killXp('steel') <= killXp('brown')) fail('XP des ennemis');
  if (process.exitCode !== 1) console.log('galons OK (arbre, bouclier qui revient, brise-liège, grand souffle, sang-froid)');
}

// ---------------------------------------------------------------- coop teammates and « Suis-moi ! » (iteration 20)
{
  const fails = () => process.exitCode === 1;
  let cleared = 0, came = 0, spent = 0, steps = 0;
  const missions = [2, 4, 7, 12];
  for (const mission of missions) {
    const lvl = getMission(mission);
    const g = new Game(lvl.tiles, lvl.belts);
    // a human standing still at the spawn, two AI teammates of the room
    const me = g.addTank('player', 0, lvl.spawns[0][0], lvl.spawns[0][1], 0x3d7bff, 'p1', 'Moi');
    me.buffs.invuln = 1e9; // the human never dies: the teammates do the work
    for (let i = 1; i <= 2; i++) {
      const sp = lvl.spawns[i] ?? lvl.spawns[0];
      const t = g.addTank('player', 0, sp[0], sp[1] + (lvl.spawns[i] ? 0 : i), 0xe8473f, `ia:${i}`, `Robot ${i}`);
      makeRival(g, t, 2);
    }
    for (const e of lvl.enemies) g.addTank(e.kind, 99, e.x, e.y, 0);
    g.frozen = false;
    const inputs = new Map([['p1', { s: 0, mx: 0, my: 0, a: 0, f: 0, m: 0 }]]);
    let ticks = 0;
    for (; ticks < 30 * 120 && g.aliveCount(99) > 0; ticks++) {
      const t0 = performance.now();
      g.step(inputs);
      spent += performance.now() - t0; steps++;
      g.events = [];
    }
    if (g.aliveCount(99) === 0) cleared++;
    // the call: the teammates still standing come to the human
    const mates = g.tanks.filter((t) => t.alive && t.pid?.startsWith('ia:'));
    for (const t of mates) { t.x = 19.5; t.y = 14.5; } // far away (the walls don't matter: they plan a path)
    const free = mates.filter((t) => !g.tiles[Math.floor(t.y) * W + Math.floor(t.x)]);
    const n = g.rally(me);
    if (n !== mates.length) { console.error(`Suis-moi : ${n} réponse(s) pour ${mates.length} coéquipier(s)`); process.exitCode = 1; }
    if (mates.length && !g.events.some((e) => e[0] === 'rally')) { console.error('Suis-moi : pas d’événement'); process.exitCode = 1; }
    for (let k = 0; k < 30 * 8; k++) { g.step(inputs); g.events = []; }
    if (free.length) came += free.filter((t) => Math.hypot(t.x - me.x, t.y - me.y) < 4.5).length;
    if (g.rally({ ...me, alive: false })) { console.error('Suis-moi : un tank détruit ne peut pas appeler'); process.exitCode = 1; }
  }
  if (cleared < 2) { console.error(`coéquipiers : seulement ${cleared}/${missions.length} missions gagnées par deux coéquipiers redoutables`); process.exitCode = 1; }
  if (came === 0) { console.error('Suis-moi : aucun coéquipier n’est venu'); process.exitCode = 1; }
  const per = spent / Math.max(1, steps);
  if (per > 0.5) { console.error(`coéquipiers : ${per.toFixed(3)} ms/tick, trop lent`); process.exitCode = 1; }
  if (!fails()) console.log(`coéquipiers OK (${cleared}/${missions.length} missions gagnées par les coéquipiers, ${came} venu(s) au « Suis-moi ! », ${per.toFixed(3)} ms/tick)`);
}

// ice (iteration 21): tanks keep their momentum, walls stop it, the client prediction agrees, the AI copes
{
  const fail = (m: string) => { console.error('GLACE:', m); process.exitCode = 1; };
  const iceMissions: number[] = [];
  for (let mission = 1; mission <= 60; mission++) if (getMission(mission).belts?.includes(ICE)) iceMissions.push(mission);
  if (!iceMissions.includes(27) || !iceMissions.includes(28)) fail(`missions sur la glace : ${iceMissions.join(', ')}`);
  if (!Array.from({ length: 26 }, (_, r) => !!versusArena(r).belts?.includes(ICE)).some(Boolean)) fail('aucune arène de versus sur la glace');
  for (let d = 0; d < 60; d++) if (dailyLevel(20000 + d, 1 + (d % DAILY_STAGES)).belts) fail('de la glace dans le défi du jour');
  // an empty table, ice from column 5 to 16, a wall at column 17
  const tiles = new Array(W * H).fill(Tile.Empty);
  const floor = new Array(W * H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 5; x <= 16; x++) floor[y * W + x] = ICE;
  for (let y = 0; y < H; y++) tiles[y * W + 17] = Tile.Wall;
  const g = new Game(tiles, floor);
  if (!g.ice) fail('la partie ne voit pas la glace');
  const p = g.addTank('player', 0, 2.5, 8.5, 0x3d7bff, 'p1', 'P');
  g.frozen = false;
  const go = new Map([['p1', { s: 0, mx: 1, my: 0, a: 0, f: 0 as const, m: 0 as const }]]);
  const idle = new Map([['p1', { s: 0, mx: 0, my: 0, a: 0, f: 0 as const, m: 0 as const }]]);
  // drive onto the ice at full speed, then let go: it slides on well past where it would have stopped
  while (p.x < 6) { g.step(go); g.events = []; }
  const x0 = p.x;
  for (let i = 0; i < 30; i++) { g.step(idle); g.events = []; }
  if (p.x - x0 < 1) fail(`le tank ne glisse pas (${(p.x - x0).toFixed(2)} case)`);
  if (Math.hypot(p.vx, p.vy) > 0.6) fail('le tank ne ralentit pas sur la glace');
  // steering on the ice bends the slide slowly: half a second after turning down, it still runs right
  p.x = 6.5; p.y = 3.5; p.vx = 3; p.vy = 0;
  const down = new Map([['p1', { s: 0, mx: 0, my: 1, a: 0, f: 0 as const, m: 0 as const }]]);
  for (let i = 0; i < 15; i++) { g.step(down); g.events = []; }
  if (p.vx < 0.8 || p.vy < 0.8) fail(`la glissade ne s’infléchit pas en douceur (vx ${p.vx.toFixed(2)}, vy ${p.vy.toFixed(2)})`);
  // off the ice, the tank stops at once
  p.x = 2.5; p.y = 12.5; p.vx = p.vy = 0;
  for (let i = 0; i < 10; i++) { g.step(go); g.events = []; }
  g.step(idle); g.events = [];
  const xs = p.x;
  g.step(idle); g.events = [];
  if (p.x !== xs) fail('le tank glisse hors de la glace');
  // a wall stops the slide
  p.x = 15.5; p.y = 6.5; p.vx = 3; p.vy = 0;
  for (let i = 0; i < 30; i++) { g.step(idle); g.events = []; }
  if (p.x > 17 - p.r + 1e-6 || Math.abs(p.vx) > 1e-6) fail(`le mur n’arrête pas la glissade (x ${p.x.toFixed(2)}, vx ${p.vx.toFixed(2)})`);
  // the client prediction (slideDrive input by input) lands exactly where the room puts the tank
  for (const mission of [27, 28]) {
    const lvl = getMission(mission);
    const s = new Game(lvl.tiles, lvl.belts);
    const pl = s.addTank('player', 0, mission === 27 ? 10.5 : 8.5, mission === 27 ? 11.5 : 6.5, 0x3d7bff, 'p1', 'P'); // out on the ice
    s.frozen = false;
    let x = pl.x, y = pl.y, body = pl.body, vx = 0, vy = 0, worst = 0, slid = 0;
    for (let k = 0; k < 30 * 12; k++) {
      const on = k < 50 || k % 90 < 60; // drive to the rink first, then steer about and let go now and then
      const inp = { s: k, mx: k < 50 ? 0.8 : on ? Math.cos(k / 37) : 0, my: k < 50 ? 0.6 : on ? Math.sin(k / 29) * 0.8 : 0, a: 0, f: 0 as const, m: 0 as const };
      s.step(new Map([['p1', inp]]));
      s.events = [];
      [x, y, body, vx, vy] = slideDrive(lvl.tiles, lvl.belts!, x, y, body, vx, vy, inp.mx, inp.my, SPECS.player.speed, DT);
      worst = Math.max(worst, Math.hypot(x - pl.x, y - pl.y));
      if (!inp.mx && Math.hypot(pl.vx, pl.vy) > 0.5) slid++;
      // the snapshot tells the speed, rounded: replaying from it stays close
    }
    if (worst > 1e-9) fail(`mission ${mission} : la prédiction s’écarte de ${worst.toFixed(4)} sur la glace`);
    if (!slid) fail(`mission ${mission} : jamais de glissade`);
    const n = s.netTanks()[0];
    if (n.length !== 9 || n[6] !== null || typeof n[7] !== 'number') fail(`mission ${mission} : l’instantané ne donne pas la vitesse (${JSON.stringify(n)})`);
  }
  // no speed on the wire off the ice tables (older tabs, smaller snapshots)
  if (getMission(1).belts || new Game(getMission(25).tiles, getMission(25).belts).ice) fail('de la glace là où il n’y en a pas');
  // the workshop paints ice and shares it by link
  {
    const map = ATELIER_SAMPLE.map.slice();
    map[7] = '~'.repeat(W);
    if (checkAtelier(map)) fail(`atelier : carte glacée refusée (${checkAtelier(map)})`);
    const back = decodeAtelier(encodeAtelier({ name: 'Givre', map }));
    if (!back || back.map.join('') !== map.join('')) fail('atelier : aller-retour du code raté avec de la glace');
    if (!atelierLevel({ name: 'Givre', map }).belts?.includes(ICE)) fail('atelier : la glace disparaît en partie');
  }
  // the AI copes on the rink: duos of AI players clear the ice missions, quickly
  let cleared = 0, spent = 0, steps = 0;
  for (const mission of [27, 28]) {
    for (let run = 0; run < 3; run++) {
      const lvl = getMission(mission);
      const s = new Game(lvl.tiles, lvl.belts);
      for (const [sx, sy] of lvl.spawns) { const pl = s.addTank('player', 0, sx, sy, 0x3d7bff); s.enableAI(pl, { skill: 3, aimError: 0.02 }); }
      for (const e of lvl.enemies) s.addTank(e.kind, 99, e.x, e.y, 0);
      s.frozen = false;
      for (let i = 0; i < 30 * 150 && s.aliveCount(99) > 0 && s.aliveCount(0) > 0; i++) {
        const t0 = performance.now();
        s.step(new Map());
        spent += performance.now() - t0; steps++;
        s.events = [];
      }
      if (s.aliveCount(99) === 0) cleared++;
    }
  }
  const per = spent / Math.max(1, steps);
  if (per > 0.5) fail(`${per.toFixed(3)} ms par tick sur la glace`);
  if (cleared === 0) fail('l’IA ne gagne jamais sur la glace');
  if (process.exitCode !== 1) console.log(`glace OK (missions : ${iceMissions.join(', ')}, ${cleared}/6 parties gagnées par l’IA, ${per.toFixed(3)} ms/tick)`);
}

// the Rempart (iteration 22): its turret shield sends shells back head-on, but it goes down from the side, from behind, or on a mine
{
  const fail = (m: string) => { console.error('REMPART:', m); process.exitCode = 1; };
  const shoot = (fromX: number, fromY: number, turret: number) => {
    const g = new Game(new Array(W * H).fill(Tile.Empty));
    const p = g.addTank('player', 0, fromX, fromY, 0x3d7bff, 'p1', 'P');
    const r = g.addTank('rampart', 99, 11.5, 8.5, 0);
    g.frozen = false;
    r.turret = turret;
    r.ai = undefined; // hold still, shield where we put it
    p.turret = Math.atan2(r.y - p.y, r.x - p.x);
    g.tryFire(p);
    let deflected = false;
    for (let i = 0; i < 40 && r.alive; i++) {
      g.step(new Map());
      if (g.events.some((e) => e[0] === 'deflect')) deflected = true;
      g.events = [];
    }
    return { g, p, r, deflected };
  };
  // head-on: it bounces back, now the Rempart's shell, and comes back at the shooter
  const a = shoot(5.5, 8.5, Math.PI);
  if (!a.r.alive) fail('détruit de face');
  if (!a.deflected) fail('pas d’événement deflect');
  if (a.p.alive && !a.g.bullets.some((b) => b.owner === a.r.id && b.vx < 0)) fail('l’obus renvoyé ne repart pas vers le tireur');
  // from behind and from the side
  if (shoot(5.5, 8.5, 0).r.alive) fail('pas détruit par derrière');
  if (shoot(11.5, 2.5, Math.PI).r.alive) fail('pas détruit par le côté');
  // a mine does not care about shields
  const g = new Game(new Array(W * H).fill(Tile.Empty));
  const r = g.addTank('rampart', 99, 11.5, 8.5, 0);
  g.mines.push({ id: 999, owner: 0, team: 0, x: 11.5, y: 8.5, t: 1, fuse: -1, dead: false });
  g.explodeMine(g.mines[0]);
  if (r.alive) fail('une mine ne le détruit pas');
  // the AI players do not fire into its shield (traceShot sees it as a wall)
  const h = new Game(new Array(W * H).fill(Tile.Empty));
  const q = h.addTank('player', 0, 5.5, 8.5, 0x3d7bff, 'p1', 'P');
  const s = h.addTank('rampart', 99, 11.5, 8.5, 0);
  s.turret = Math.PI;
  if (h.traceShot(q, 0, 0).hit === s) fail('l’IA croit pouvoir le toucher de face');
  s.turret = 0;
  if (h.traceShot(q, 0, 0).hit !== s) fail('l’IA ne le voit plus de dos');
  // the missions: handmade 29 and 31, then some generated ones; never in the daily challenge nor the mole
  const rm: number[] = [];
  for (let mission = 1; mission <= 90; mission++) if (getMission(mission).enemies.some((e) => e.kind === 'rampart')) rm.push(mission);
  if (!rm.includes(29) || !rm.includes(31)) fail('missions 29 et 31 sans Rempart');
  if (rm.some((m) => m < 29)) fail('Rempart avant la 29ᵉ mission');
  if (rm.length < 8) fail(`trop peu de missions avec des Remparts (${rm.length})`);
  for (let day = 1; day < 40; day++) for (let st = 1; st <= DAILY_STAGES; st++) if (dailyLevel(day, st).enemies.some((e) => e.kind === 'rampart')) fail('Rempart dans le défi du jour');
  for (let seed = 1; seed < 10; seed++) for (let st = 1; st <= TAUPE_STAGES; st++) if (taupeLevel(seed * 31, st).enemies.some((e) => e.kind === 'rampart')) fail('Rempart dans la taupe');
  // the workshop knows it, and its share code survives the round trip
  const map = blankMap();
  map[8] = map[8].slice(0, 15) + 'r' + map[8].slice(16);
  if (checkAtelier(map)) fail(`atelier : Rempart refusé (${checkAtelier(map)})`);
  const back = decodeAtelier(encodeAtelier({ name: 'Garde', map }));
  if (!back || back.map.join('') !== map.join('')) fail('atelier : aller-retour du code raté avec un Rempart');
  if (killXp('rampart') <= killXp('ash')) fail('XP du Rempart');
  // duos of AI players clear its missions, and it stays cheap
  let cleared = 0, spent = 0, steps = 0, deflects = 0;
  for (const mission of [29, 31]) {
    for (let run = 0; run < 3; run++) {
      const lvl = getMission(mission);
      const s2 = new Game(lvl.tiles, lvl.belts);
      for (const [sx, sy] of lvl.spawns) { const pl = s2.addTank('player', 0, sx, sy, 0x3d7bff); s2.enableAI(pl, { skill: 3, aimError: 0.02 }); }
      for (const e of lvl.enemies) s2.addTank(e.kind, 99, e.x, e.y, 0);
      s2.frozen = false;
      for (let i = 0; i < 30 * 150 && s2.aliveCount(99) > 0 && s2.aliveCount(0) > 0; i++) {
        const t0 = performance.now();
        s2.step(new Map());
        spent += performance.now() - t0; steps++;
        deflects += s2.events.filter((e) => e[0] === 'deflect').length;
        s2.events = [];
      }
      if (s2.aliveCount(99) === 0) cleared++;
    }
  }
  const per = spent / Math.max(1, steps);
  if (per > 0.5) fail(`${per.toFixed(3)} ms par tick`);
  if (cleared === 0) fail('l’IA ne vient jamais à bout des Remparts');
  if (process.exitCode !== 1) console.log(`rempart OK (missions : ${rm.join(', ')}, ${cleared}/6 parties gagnées par l’IA, ${deflects} obus renvoyés, ${per.toFixed(3)} ms/tick)`);
}

// the wind (iteration 23): it bends shells in flight without changing their speed, the same at the same tick everywhere
{
  const fail = (m: string) => { console.error('VENT:', m); process.exitCode = 1; };
  // a shell fired right, in a wind blowing down the map, curves down and keeps its speed
  const fly = (wind?: number) => {
    const g = new Game(new Array(W * H).fill(Tile.Empty));
    const p = g.addTank('player', 0, 2.5, 4.5, 0x3d7bff, 'p1', 'P');
    g.wind = wind;
    g.frozen = false;
    p.turret = 0;
    g.tryFire(p);
    const b = g.bullets[0];
    for (let i = 0; i < 45 && !b.dead; i++) g.step(new Map());
    return b;
  };
  const calm = fly(), windy = fly(Math.PI / 2);
  if (Math.abs(calm.y - 4.5) > 0.01) fail('sans vent, l’obus dévie');
  if (windy.y - 4.5 < 0.5) fail(`l’obus ne dévie pas dans le vent (${(windy.y - 4.5).toFixed(2)})`);
  const sp = Math.hypot(windy.vx, windy.vy);
  if (Math.abs(sp - BULLET_SPEED) > 0.01) fail(`le vent change la vitesse de l’obus (${sp.toFixed(3)})`);
  // the gust follows the tick: a lull and a gust within one cycle, always between 0.1 and 1
  let lo = 9, hi = 0;
  for (let k = 0; k < 30 * 14; k++) { const v = gustAt(k); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (lo < 0.09 || lo > 0.2 || hi < 0.95 || hi > 1.0001) fail(`rafales hors bornes (${lo.toFixed(2)} à ${hi.toFixed(2)})`);
  const [ax, ay] = windAt(0, 123);
  if (Math.abs(Math.hypot(ax, ay) - WIND_ACC * gustAt(123)) > 1e-9) fail('windAt incohérent');
  // the AI follows the curve: the windy trace of an aimed shot ends where the real shell goes
  {
    const g = new Game(new Array(W * H).fill(Tile.Empty));
    const p = g.addTank('player', 0, 2.5, 4.5, 0x3d7bff, 'p1', 'P');
    g.wind = Math.PI / 2;
    g.frozen = false;
    g.step(new Map());
    const segs = castWindy(g.tiles, 2.5, 4.5, 0, BULLET_SPEED, 0, g.gust[0], g.gust[1], 8);
    const end = segs[segs.length - 1];
    if (!end || end.y1 - 4.5 < 0.2) fail('le tracé de l’IA ne se courbe pas');
    void p;
  }
  // the missions: 33 and 34 by hand, some generated ones from the 33rd; never in the daily challenge nor the mole
  const wm: number[] = [];
  for (let mission = 1; mission <= 120; mission++) if (getMission(mission).wind !== undefined) wm.push(mission);
  if (!wm.includes(33) || !wm.includes(34)) fail('missions 33 et 34 sans vent');
  if (wm.some((m) => m < 33)) fail('du vent avant la 33ᵉ mission');
  if (wm.length < 12) fail(`trop peu de missions venteuses (${wm.length})`);
  if (wm.some((m) => m % 10 === 0 && bossOf(m) !== 'sower')) fail('du vent sur un boss (seul le Semeur y a droit, un sur deux)');
  for (let day = 1; day < 40; day++) for (let st = 1; st <= DAILY_STAGES; st++) if (dailyLevel(day, st).wind !== undefined) fail('vent dans le défi du jour');
  for (let seed = 1; seed < 10; seed++) for (let st = 1; st <= TAUPE_STAGES; st++) if (taupeLevel(seed * 31, st).wind !== undefined) fail('vent dans la taupe');
  if (![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].some((r) => versusArena(r).wind !== undefined)) fail('pas de vent en versus');
  // the workshop: a « Vent » box, kept in the share code
  const map = blankMap();
  const back = decodeAtelier(encodeAtelier({ name: 'Brise', map, wind: true }));
  if (!back?.wind) fail('atelier : le vent se perd dans le code');
  if (atelierLevel({ name: 'Brise', map, wind: true }).wind !== 0) fail('atelier : le vent ne souffle pas vers la droite');
  if (decodeAtelier(encodeAtelier({ name: 'Calme', map }))?.wind) fail('atelier : du vent sans case cochée');
  // duos of AI players clear the windy missions, and it stays cheap
  let cleared = 0, spent = 0, steps = 0, worst = 0;
  for (const mission of [33, 34, wm.find((m) => m > 34)!]) {
    for (let run = 0; run < 2; run++) {
      const lvl = getMission(mission);
      const s2 = new Game(lvl.tiles, lvl.belts);
      s2.wind = lvl.wind;
      for (const [sx, sy] of lvl.spawns) { const pl = s2.addTank('player', 0, sx, sy, 0x3d7bff); s2.enableAI(pl, { skill: 3, aimError: 0.02 }); }
      for (const e of lvl.enemies) s2.addTank(e.kind, 99, e.x, e.y, 0);
      s2.frozen = false;
      for (let i = 0; i < 30 * 150 && s2.aliveCount(99) > 0 && s2.aliveCount(0) > 0; i++) {
        const t0 = performance.now();
        s2.step(new Map());
        const dt = performance.now() - t0;
        spent += dt; steps++; worst = Math.max(worst, dt);
        s2.events = [];
      }
      if (s2.aliveCount(99) === 0) cleared++;
    }
  }
  const per = spent / Math.max(1, steps);
  if (per > 0.5) fail(`${per.toFixed(3)} ms par tick`);
  if (cleared === 0) fail('l’IA ne vient jamais à bout du vent');
  console.log(`vent : pire tick ${worst.toFixed(3)} ms`);
  if (process.exitCode !== 1) console.log(`vent OK (missions : ${wm.join(', ')}, ${cleared}/6 parties gagnées par l’IA, ${per.toFixed(3)} ms/tick)`);
}

// « Drapeaux » (iteration 24): symmetric arenas, grab / drop / return / capture, and AI teams that actually go for the flag
{
  const fail = (m: string) => { console.error('drapeaux : ' + m); process.exitCode = 1; };
  // every arena: the right size, mirrored, bases and spawns on free floor, each base reachable from the other
  for (let r = 0; r < CTF_ARENA_COUNT; r++) {
    const lvl = ctfArena(r);
    if (lvl.tiles.length !== W * H) fail(`${lvl.name} : mauvaise taille`);
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) {
      const a = lvl.tiles[y * W + x], b = lvl.tiles[y * W + (W - 1 - x)];
      if (a !== b) { fail(`${lvl.name} : pas symétrique en (${x}, ${y})`); break; }
    }
    for (const [x, y] of [...lvl.bases, ...lvl.spawns]) if (lvl.tiles[Math.floor(y) * W + Math.floor(x)] !== Tile.Empty) fail(`${lvl.name} : base ou départ sur une case occupée (${x}, ${y})`);
    if (lvl.spawns.length !== 4) fail(`${lvl.name} : ${lvl.spawns.length} départs`);
    // flood from the first base, tanks only
    const seen = new Uint8Array(W * H), q = [Math.floor(lvl.bases[0][1]) * W + Math.floor(lvl.bases[0][0])];
    seen[q[0]] = 1;
    for (let i = 0; i < q.length; i++) {
      const c = q[i], cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, n = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[n]) continue;
        const t = lvl.tiles[n];
        if (t !== Tile.Empty && t !== Tile.Tunnel && t !== Tile.PortalA && t !== Tile.PortalB) continue;
        seen[n] = 1; q.push(n);
      }
    }
    if (!seen[Math.floor(lvl.bases[1][1]) * W + Math.floor(lvl.bases[1][0])]) fail(`${lvl.name} : une base est injoignable depuis l’autre`);
  }
  if (ctfTeam(0) !== 1 || ctfTeam(1) !== 2 || ctfTeam(2) !== 1 || ctfTeam(3) !== 2) fail('les équipes ne sont pas alternées');

  // the rules, with two hand-driven tanks on an empty table
  {
    const lvl = ctfArena(0);
    const g = new Game(new Array(W * H).fill(Tile.Empty));
    g.flags = newFlags(lvl.bases);
    const blue = g.addTank('player', 1, 6.5, 8.5, 0x3d7bff, 'b', 'B');
    const red = g.addTank('player', 2, 15.5, 8.5, 0xe2453c, 'r', 'R');
    g.frozen = false;
    const ev = () => { const e = g.events.filter((x) => x[0] === 'flag'); g.events = []; return e.map((x) => x[5]); };
    g.step(new Map()); ev();
    // blue drives over the red flag: grabbed, it follows the carrier
    blue.x = lvl.bases[1][0]; blue.y = lvl.bases[1][1];
    g.step(new Map());
    const red0 = g.flags[1];
    if (red0.state !== 1 || red0.carrier !== blue.id) fail('le drapeau n’est pas ramassé');
    if (ev()[0] !== 0) fail('pas d’événement « pris »');
    blue.x = 11; blue.y = 3.5;
    g.step(new Map());
    if (Math.hypot(red0.x - blue.x, red0.y - blue.y) > 0.01) fail('le drapeau ne suit pas son porteur');
    // a red touch on its own flag while carried does nothing; the carrier blows up: dropped where it fell
    g.killTank(blue, red);
    g.step(new Map());
    if (red0.state !== 2 || Math.hypot(red0.x - 11, red0.y - 3.5) > 0.01) fail('le drapeau n’est pas lâché sur place');
    if (ev()[0] !== 1) fail('pas d’événement « lâché »');
    // a red tank touches it: home at once
    red.x = 11; red.y = 3.5;
    g.step(new Map());
    if (red0.state !== 0 || red0.x !== red0.hx || red0.y !== red0.hy) fail('un coéquipier ne renvoie pas le drapeau');
    if (ev()[0] !== 2) fail('pas d’événement « rentré »');
    // red grabs the blue flag, drops it, and it flies home by itself after CTF_RETURN seconds
    red.x = lvl.bases[0][0]; red.y = lvl.bases[0][1];
    g.step(new Map());
    if (g.flags[0].carrier !== red.id) fail('les Rouges ne prennent pas le drapeau bleu');
    red.x = 9; red.y = 13.5; g.step(new Map());
    red.alive = false; g.step(new Map());
    if (g.flags[0].state !== 2) fail('drapeau bleu non lâché');
    for (let i = 0; i < 30 * CTF_RETURN + 2; i++) g.step(new Map());
    if (g.flags[0].state !== 0) fail('le drapeau lâché ne rentre pas tout seul');
    // capture: red (alive again) brings the blue flag home
    red.alive = true; ev();
    red.x = lvl.bases[0][0]; red.y = lvl.bases[0][1]; g.step(new Map());
    red.x = lvl.bases[1][0] - 0.4; red.y = lvl.bases[1][1]; g.step(new Map());
    if (g.ctfWinner !== 2) fail('la capture n’est pas comptée');
    if (!ev().includes(3)) fail('pas d’événement « capturé »');
    // the net view
    const nf = g.netFlags()!;
    if (nf.length !== 2 || nf[0][0] !== 1 || nf[0][3] !== red.id || nf[0][4] !== 1) fail(`vue réseau inattendue ${JSON.stringify(nf)}`);
  }

  // destroyed tanks come back at their base, untouchable for a moment
  {
    const lvl = ctfArena(0);
    const g = new Game(lvl.tiles, lvl.belts);
    g.flags = newFlags(lvl.bases);
    const a = g.addTank('player', 1, lvl.spawns[0][0], lvl.spawns[0][1], 0, 'a', 'A');
    g.addTank('player', 2, lvl.spawns[1][0], lvl.spawns[1][1], 0, 'b', 'B');
    g.frozen = false;
    g.step(new Map());
    a.x = 11; a.y = 0.5;
    g.killTank(a, undefined);
    for (let i = 0; i < 30 * CTF_RESPAWN + 2; i++) g.step(new Map());
    if (!a.alive || Math.hypot(a.x - lvl.spawns[0][0], a.y - lvl.spawns[0][1]) > 0.01) fail('un tank détruit ne revient pas à sa base');
    g.killTank(a, undefined);
    if (!a.alive) fail('un tank de retour à sa base n’est pas protégé');
  }

  // AI teams: rounds must end by a capture, quickly and cheaply
  let caps = 0, rounds = 0, worst = 0, ticksAll = 0;
  const capsBy = [0, 0];
  for (let round = 0; round < 18; round++) {
    const lvl = ctfArena(round);
    const g = new Game(lvl.tiles, lvl.belts);
    g.bonusOn = true; g.bonusNext = 5; g.bonusEvery = [8, 12];
    g.night = !!lvl.night; g.wind = lvl.wind;
    g.flags = newFlags(lvl.bases);
    const n = round % 3 === 0 ? 2 : 4;
    lvl.spawns.slice(0, n).forEach(([x, y], i) => {
      const t = g.addTank('player', ctfTeam(i), x, y, 0x3d7bff, `ia:${i + 1}`, `R${i}`);
      g.arm(t, WEAPONS[(round + i) % WEAPONS.length]);
      makeRival(g, t, (round + i) % 3);
    });
    g.frozen = false;
    let ticks = 0;
    const t1 = performance.now();
    for (; ticks < 30 * CTF_ROUND && !g.ctfWinner; ticks++) { g.step(new Map()); g.events = []; }
    worst = Math.max(worst, (performance.now() - t1) / Math.max(1, ticks));
    ticksAll += ticks;
    rounds++;
    if (g.ctfWinner) { caps++; capsBy[g.ctfWinner - 1]++; }
  }
  if (caps < rounds * 0.7) fail(`seulement ${caps}/${rounds} manches gagnées par une capture`);
  if (worst > 1) fail(`${worst.toFixed(3)} ms par tick`);
  if (process.exitCode !== 1) console.log(`drapeaux OK (${CTF_ARENA_COUNT} arènes, ${caps}/${rounds} manches gagnées par une capture, Bleus ${capsBy[0]} · ${capsBy[1]} Rouges, ${(ticksAll / rounds / 30).toFixed(0)} s en moyenne, ${worst.toFixed(3)} ms/tick au pire)`);
}

// the Semeur (iteration 25): the fourth boss sows giant seeds; ripe ones spare it, a shot one hurts it and is the shooter's
{
  const fail = (m: string) => { console.error('SEMEUR : ' + m); process.exitCode = 1; };
  for (const m of [40, 80, 120, 160]) {
    const lvl = getMission(m);
    if (lvl.enemies.filter((e) => e.kind === 'sower').length !== 1 || lvl.night || lvl.storm) fail(`la mission ${m} devrait opposer le Semeur, de jour`);
    for (const e of lvl.enemies) if (lvl.tiles[Math.floor(e.y) * W + Math.floor(e.x)] !== Tile.Empty) fail(`mission ${m} : un ennemi part dans un mur`);
  }
  if (getMission(40).wind !== undefined || getMission(80).wind === undefined) fail('un Semeur sur deux se bat dans le vent, à partir du 80ᵉ');
  // it sows: seeds fly out, one in front of the player, none on a wall, none under itself
  const g = new Game(new Array(W * H).fill(Tile.Empty));
  const p = g.addTank('player', 0, 4.5, 8.5, 0x3d7bff, 'p1', 'P');
  const sw = g.addTank('sower', 99, 15.5, 8.5, 0);
  g.frozen = false;
  if (!sw.boss || sw.hp !== 8 || !isBossKind('sower')) fail('le Semeur devrait être un boss à 8 PV');
  const n = g.sow(sw);
  if (n < 3) fail(`trop peu de graines (${n})`);
  const seeds = g.mines.filter((m) => m.seed !== undefined);
  if (seeds.length !== n || seeds.some((m) => Math.hypot(m.x - sw.x, m.y - sw.y) < sw.r + 0.6)) fail('graines mal semées');
  if (!seeds.some((m) => Math.hypot(m.x - p.x, m.y - p.y) < 2.5)) fail('aucune graine devant le joueur');
  if (!g.events.some((e) => e[0] === 'sow')) fail('pas d’événement « sow »');
  if (g.netMines().some((m) => m.length !== 5)) fail('le réseau ne distingue pas les graines');
  // driving over a seed does not set it off; it ripens and bursts on its own, sparing the Semeur
  const s0 = seeds[0];
  p.x = s0.x; p.y = s0.y; p.buffs.shield = true;
  for (let i = 0; i < 20; i++) g.step(new Map());
  if (s0.dead) fail('une graine a sauté au contact');
  p.x = 4.5; p.y = 8.5; p.buffs.shield = false;
  s0.x = sw.x + 1.4; s0.y = sw.y;
  for (let i = 0; i < 30 * 7 && !s0.dead; i++) g.step(new Map());
  if (!s0.dead) fail('une graine mûre n’éclate pas');
  if (sw.hp !== 8) fail('une graine mûre a blessé le Semeur');
  // a shell hits a seed next to it: the blast hurts it, and the hit is the shooter's
  const h = new Game(new Array(W * H).fill(Tile.Empty));
  const q = h.addTank('player', 0, 4.5, 8.5, 0x3d7bff, 'p1', 'P');
  const z = h.addTank('sower', 99, 15.5, 8.5, 0);
  const e = h.addTank('pink', 99, 13.5, 9.5, 0);
  h.frozen = false;
  z.ai = undefined; e.ai = undefined; // they hold still
  z.boss!.volleyT = 99;
  h.mines.push({ id: 999, owner: z.id, team: 99, x: 13.5, y: 8.5, t: 0, fuse: -1, dead: false, blast: 2.2, seed: 5 });
  let killer: unknown;
  h.onKill = (v, k) => { if (v === e) killer = k; };
  q.turret = 0; q.fireCd = 0;
  h.tryFire(q);
  for (let i = 0; i < 2 && h.mines.length; i++) h.step(new Map()); // still in the air: the shell flies under it
  for (let i = 0; i < 90 && h.mines.length; i++) h.step(new Map());
  if (h.mines.length) fail('l’obus n’a pas fait sauter la graine');
  if (z.hp !== 7) fail(`le Semeur devrait perdre 1 PV (${z.hp})`);
  if (e.alive || killer !== q) fail('l’escorte soufflée devrait être à mettre au compte du tireur');
  // AI-driven players see the trick
  const a = new Game(new Array(W * H).fill(Tile.Empty));
  const r = a.addTank('player', 0, 4.5, 8.5, 0x3d7bff);
  a.enableAI(r, { skill: 2 });
  const w = a.addTank('sower', 99, 15.5, 8.5, 0);
  w.ai = undefined; w.boss!.volleyT = 99;
  a.frozen = false;
  a.mines.push({ id: 998, owner: w.id, team: 99, x: 13.6, y: 8.5, t: 1, fuse: -1, dead: false, blast: 2.2, seed: 5 });
  if (a.seedTarget(r)?.id !== 998) fail('l’IA ne repère pas la graine à tirer');
  // a real Semeur fight stays cheap
  const lvl = getMission(40);
  const sim = new Game(lvl.tiles, lvl.belts);
  for (const [x, y] of lvl.spawns) { const pl = sim.addTank('player', 0, x, y, 0x3d7bff); sim.enableAI(pl, { skill: 2 }); }
  for (const en of lvl.enemies) sim.addTank(en.kind, 99, en.x, en.y, 0);
  sim.frozen = false;
  let sows = 0, bursts = 0, hurts = 0;
  const t1 = performance.now();
  for (let i = 0; i < 30 * 60; i++) {
    sim.step(new Map());
    for (const ev of sim.events) { if (ev[0] === 'sow') sows++; if (ev[0] === 'mboom' && ev[3]) bursts++; if (ev[0] === 'hurt') hurts++; }
    sim.events = [];
  }
  const per = (performance.now() - t1) / (30 * 60);
  if (per > 1) fail(`${per.toFixed(3)} ms par tick`);
  if (!sows) fail('pas de semailles en 60 s');
  if (process.exitCode !== 1) console.log(`Semeur OK (${sows} semailles, ${bursts} graines éclatées, ${hurts} coup(s) encaissé(s) en 60 s, ${per.toFixed(3)} ms/tick)`);
}

// the fog (iteration 26): drifting banks of mist, pure functions of the tick; deep inside one, a tank is lost to sight
{
  const fail = (m: string) => { console.error('BROUILLARD:', m); process.exitCode = 1; };
  // the same banks at the same tick, everywhere; they move, stay over the table, and cover a fair share of it
  const a = fogBanks(7, 300), b = fogBanks(7, 300).map((k) => ({ ...k }));
  if (JSON.stringify(a) !== JSON.stringify(b)) fail('bancs différents au même tick');
  const later = fogBanks(7, 600);
  if (later.every((k, i) => Math.hypot(k.x - b[i].x, k.y - b[i].y) < 0.3)) fail('les bancs ne dérivent pas');
  let covered = 0, samples = 0;
  for (let tick = 0; tick < 30 * 120; tick += 90) {
    const bs = fogBanks(3, tick);
    for (const k of bs) if (k.x < 0 || k.x > W || k.y < 0 || k.y > H) fail(`banc hors de la table (${k.x.toFixed(1)}, ${k.y.toFixed(1)})`);
    for (let y = 0.5; y < H; y++) for (let x = 0.5; x < W; x++) { samples++; if (fogDensity(bs, x, y) >= 0.5) covered++; }
  }
  const share = covered / samples;
  if (share < 0.12 || share > 0.5) fail(`part de la table dans la brume : ${(share * 100).toFixed(0)} %`);
  // a tank in the heart of a bank: hidden from afar, seen up close, seen right after it fires
  const g = new Game(new Array(W * H).fill(Tile.Empty));
  g.fog = 11;
  g.frozen = false;
  g.step(new Map());
  const bank = g.fogNow[0];
  const e = g.addTank('ash', 99, bank.x, bank.y, 0);
  e.ai = undefined;
  const far = g.addTank('player', 0, bank.x > W / 2 ? 1.5 : W - 1.5, bank.y > H / 2 ? 1.5 : H - 1.5, 0x3d7bff);
  const fogAt = (x: number, y: number) => fogDensity(g.fogNow, x, y);
  if (fogAt(e.x, e.y) < 0.99) fail('le cœur du banc n’est pas dense');
  if (fogAt(far.x, far.y) < 0.5 && g.canSee(far, e)) fail('un tank au cœur de la brume se voit de loin');
  const near = g.addTank('player', 0, e.x + FOG_SIGHT * 0.6, e.y, 0x3d7bff);
  if (!g.canSee(near, e)) fail('un tank tout près ne se voit pas dans la brume');
  e.reveal = 1;
  if (!g.canSee(far, e)) fail('le tir ne trahit pas le tank dans la brume');
  e.reveal = 0;
  if (!fogHides(g.fogNow, e.x, e.y, far.x, far.y)) fail('fogHides incohérent');
  g.fog = undefined; g.step(new Map());
  if (!g.canSee(far, e)) fail('sans brouillard, tout le monde se voit');
  // the missions: 35 and 36 by hand, some generated ones from the 37th, by day and without wind; never in the daily challenge nor the mole
  const fm: number[] = [];
  for (let mission = 1; mission <= 160; mission++) { const l = getMission(mission); if (l.fog !== undefined) { fm.push(mission); if (l.night || l.wind !== undefined) fail(`mission ${mission} : brouillard de nuit ou dans le vent`); } }
  if (!fm.includes(35) || !fm.includes(36)) fail('missions 35 et 36 sans brouillard');
  if (fm.some((m) => m < 35)) fail('du brouillard avant la 35ᵉ mission');
  if (fm.length < 10) fail(`trop peu de missions dans la brume (${fm.length})`);
  if (fm.some((m) => m % 10 === 0)) fail('du brouillard sur un boss');
  for (let day = 1; day < 40; day++) for (let st = 1; st <= DAILY_STAGES; st++) if (dailyLevel(day, st).fog !== undefined) fail('brouillard dans le défi du jour');
  for (let seed = 1; seed < 10; seed++) for (let st = 1; st <= TAUPE_STAGES; st++) if (taupeLevel(seed * 31, st).fog !== undefined) fail('brouillard dans la taupe');
  if (![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].some((r) => versusArena(r).fog !== undefined)) fail('pas de brouillard en versus');
  // the workshop: a « Brouillard » box, kept in the share code
  const map = blankMap();
  const back = decodeAtelier(encodeAtelier({ name: 'Purée', map, fog: true, wind: true }));
  if (!back?.fog || !back.wind) fail('atelier : le brouillard se perd dans le code');
  if (atelierLevel({ name: 'Purée', map, fog: true }).fog === undefined) fail('atelier : pas de brouillard malgré la case');
  if (decodeAtelier(encodeAtelier({ name: 'Clair', map }))?.fog) fail('atelier : du brouillard sans case cochée');
  // duos of AI players clear the foggy missions, and it stays cheap
  let cleared = 0, spent = 0, steps = 0;
  const games = [35, 36, fm.find((m) => m > 36)!];
  for (const mission of games) {
    for (let run = 0; run < 2; run++) {
      const lvl = getMission(mission);
      const s2 = new Game(lvl.tiles, lvl.belts);
      s2.fog = lvl.fog;
      for (const [sx, sy] of lvl.spawns) { const pl = s2.addTank('player', 0, sx, sy, 0x3d7bff); s2.enableAI(pl, { skill: 3, aimError: 0.02 }); }
      for (const en of lvl.enemies) s2.addTank(en.kind, 99, en.x, en.y, 0);
      s2.frozen = false;
      for (let i = 0; i < 30 * 150 && s2.aliveCount(99) > 0 && s2.aliveCount(0) > 0; i++) {
        const t1 = performance.now();
        s2.step(new Map());
        spent += performance.now() - t1; steps++;
        s2.events = [];
      }
      if (s2.aliveCount(99) === 0) cleared++;
    }
  }
  const per = spent / Math.max(1, steps);
  if (per > 0.5) fail(`${per.toFixed(3)} ms par tick`);
  if (cleared === 0) fail('l’IA ne vient jamais à bout du brouillard');
  if (process.exitCode !== 1) console.log(`brouillard OK (missions : ${fm.join(', ')}, ${(share * 100).toFixed(0)} % de la table dans la brume, ${cleared}/6 parties gagnées par l’IA, ${per.toFixed(3)} ms/tick)`);
}

// the Aimant (iteration 27): with its field on, it bends the shells around it and catches them, then throws them all back
{
  const fail = (m: string) => { console.error('AIMANT:', m); process.exitCode = 1; };
  const setup = () => {
    const g = new Game(new Array(W * H).fill(Tile.Empty));
    const p = g.addTank('player', 0, 4.5, 8.5, 0x3d7bff, 'p1', 'P');
    const m = g.addTank('magnet', 99, 11.5, 8.5, 0);
    m.ai = undefined; // hold still
    g.frozen = false;
    return { g, p, m };
  };
  // field on: a shell fired at it is caught, the magnet is unharmed, the flags say so
  {
    const { g, p, m } = setup();
    m.mag!.on = true; m.mag!.t = MAGNET_ON;
    p.turret = 0;
    g.tryFire(p);
    let caught = 0;
    for (let i = 0; i < 45; i++) { g.step(new Map()); caught += g.events.filter((e) => e[0] === 'catch').length; g.events = []; }
    if (!m.alive) fail('détruit alors que son champ est allumé');
    if (caught !== 1 || m.mag!.held !== 1) fail(`obus pas attrapé (${caught}, ${m.mag!.held})`);
    const fx = g.netTanks().find((n) => n[0] === m.id)![5];
    if (!(fx & FLAG_MAGNET) || ((fx >> MAGNET_HELD_SHIFT) & 7) !== 1) fail('drapeaux réseau incohérents');
    // a shell aimed to pass beside it (1.4 tiles off) is pulled in too
    p.x = 4.5; p.y = 7.1; p.turret = 0; p.fireCd = 0;
    g.tryFire(p);
    for (let i = 0; i < 45; i++) { g.step(new Map()); g.events = []; }
    if (m.mag!.held !== 2) fail('un obus qui le frôle n’est pas attiré');
    // a shell far from the field flies straight on
    p.x = 4.5; p.y = 3.5; p.turret = 0; p.fireCd = 0;
    g.tryFire(p);
    const b = g.bullets[g.bullets.length - 1];
    for (let i = 0; i < 20; i++) { g.step(new Map()); g.events = []; }
    if (Math.abs(b.vy) > 1e-6 || MAGNET_R > 5) fail('un obus loin du champ est dévié');
    // the field drops: both shells fly back in a fan at the player
    m.mag!.t = 0.01;
    g.step(new Map());
    const un = g.events.find((e) => e[0] === 'unload');
    if (!un || un[4] !== 2) fail(`pas de gerbe au retour (${un?.[4]})`);
    const back = g.bullets.filter((x) => x.owner === m.id);
    if (back.length !== 2 || back.some((x) => x.vx >= 0)) fail('les obus renvoyés ne repartent pas vers le joueur');
    if (m.mag!.held !== 0 || m.mag!.on) fail('il garde ses obus ou son champ');
  }
  // field off: one shell is enough
  {
    const { g, p, m } = setup();
    m.mag!.on = false; m.mag!.t = 9;
    p.turret = 0;
    g.tryFire(p);
    for (let i = 0; i < 45 && m.alive; i++) { g.step(new Map()); g.events = []; }
    if (m.alive) fail('pas détruit champ éteint');
  }
  // a mine gets it even with the field on; the AI does not fire into its field
  {
    const { g, p, m } = setup();
    m.mag!.on = true; m.mag!.t = 9;
    if (g.traceShot(p, 0, 0).hit === m) fail('l’IA croit pouvoir le toucher champ allumé');
    m.mag!.on = false;
    if (g.traceShot(p, 0, 0).hit !== m) fail('l’IA ne le voit plus champ éteint');
    m.mag!.on = true;
    g.mines.push({ id: 999, owner: p.id, team: 0, x: 11.5, y: 8.5, t: 1, fuse: -1, dead: false });
    g.explodeMine(g.mines[0]);
    if (m.alive) fail('une mine ne le détruit pas');
  }
  // its field turns on and off by itself
  {
    const { g, m } = setup();
    let ons = 0, prev = m.mag!.on;
    for (let i = 0; i < 30 * 20; i++) { g.step(new Map()); if (m.mag!.on && !prev) ons++; prev = m.mag!.on; g.events = []; }
    if (ons < 2) fail(`le champ ne s’allume pas en rythme (${ons})`);
  }
  // the missions: handmade 37 and 38, then some generated ones; never in the daily challenge nor the mole
  const mm: number[] = [];
  for (let mission = 1; mission <= 120; mission++) if (getMission(mission).enemies.some((e) => e.kind === 'magnet')) mm.push(mission);
  if (!mm.includes(37) || !mm.includes(38)) fail('missions 37 et 38 sans Aimant');
  if (mm.some((x) => x < 37)) fail('Aimant avant la 37ᵉ mission');
  if (mm.length < 8) fail(`trop peu de missions avec des Aimants (${mm.length})`);
  for (let day = 1; day < 40; day++) for (let st = 1; st <= DAILY_STAGES; st++) if (dailyLevel(day, st).enemies.some((e) => e.kind === 'magnet')) fail('Aimant dans le défi du jour');
  for (let seed = 1; seed < 10; seed++) for (let st = 1; st <= TAUPE_STAGES; st++) if (taupeLevel(seed * 31, st).enemies.some((e) => e.kind === 'magnet')) fail('Aimant dans la taupe');
  const map = blankMap();
  map[8] = map[8].slice(0, 15) + 'A' + map[8].slice(16);
  if (checkAtelier(map)) fail(`atelier : Aimant refusé (${checkAtelier(map)})`);
  const back = decodeAtelier(encodeAtelier({ name: 'Pôle', map }));
  if (back?.map[8][15] !== 'A') fail('atelier : l’Aimant se perd dans le code');
  if (killXp('magnet') !== 2) fail('galons de l’Aimant');
  // duos of AI players clear the magnet missions, and it stays cheap
  let cleared = 0, spent = 0, steps = 0, catches = 0;
  for (const mission of [37, 38, mm.find((x) => x > 40)!]) {
    for (let run = 0; run < 2; run++) {
      const lvl = getMission(mission);
      const s2 = new Game(lvl.tiles, lvl.belts);
      for (const [sx, sy] of lvl.spawns) { const pl = s2.addTank('player', 0, sx, sy, 0x3d7bff); s2.enableAI(pl, { skill: 3, aimError: 0.02 }); }
      for (const en of lvl.enemies) s2.addTank(en.kind, 99, en.x, en.y, 0);
      s2.frozen = false;
      for (let i = 0; i < 30 * 150 && s2.aliveCount(99) > 0 && s2.aliveCount(0) > 0; i++) {
        const t1 = performance.now();
        s2.step(new Map());
        spent += performance.now() - t1; steps++;
        catches += s2.events.filter((e) => e[0] === 'catch').length;
        s2.events = [];
      }
      if (s2.aliveCount(99) === 0) cleared++;
    }
  }
  const per = spent / Math.max(1, steps);
  if (per > 0.5) fail(`${per.toFixed(3)} ms par tick`);
  if (cleared === 0) fail('l’IA ne vient jamais à bout des Aimants');
  if (process.exitCode !== 1) console.log(`aimant OK (missions : ${mm.slice(0, 12).join(', ')}…, ${cleared}/6 parties gagnées par l’IA, ${catches} obus attrapés, ${per.toFixed(3)} ms/tick)`);
}
