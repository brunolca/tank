import { BONUS_INFO, BONUS_KINDS, CHECKPOINT_EVERY, DT, ENEMY_COLORS, FLAG_ALERT, FLAG_CHARGING, PLAYER_COLORS, SPECS, TANK_R, TICK_RATE, TURBO_MULT, Tile, W, WEAPONS, WEAPON_INFO, isPortal, isWeapon, playerSpec, tankRadius, type BonusKind, type TankSpec, type Weapon } from '../shared/constants';
import { applyTwist, DAILY_STAGES, dailyLevel, dailyTwist, dayLabel, dayNumber, formatTicks, TWIST_INFO, type DailyTwist } from '../shared/daily';
import { getMission, type ParsedLevel } from '../shared/levels';
import META from '../shared/meta.json';
import { angDiff } from '../shared/physics';
import type { BoardDay, ClientMsg, DailyState, GameEvent, Input, Mode, NetBonus, NetBullet, NetMine, NetTank, Phase, PlayerInfo, Results, ServerMsg, TankInfo } from '../shared/protocol';
import { Game, driveStep } from '../shared/sim';
import { initAudio, isMusicOn, setMusicIntensity, sfx, startMusic, toggleMusic } from './audio';
import { setupFeedback, type Region } from './feedback';
import { Controls } from './input';
import { Renderer, type RBonus, type RBullet, type RMine, type RTank } from './render';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// ring buffers for the feedback context
const errorLog: { t: number; msg: string }[] = [];
const logError = (msg: string) => { errorLog.push({ t: Math.round(performance.now()), msg: msg.slice(0, 400) }); if (errorLog.length > 20) errorLog.shift(); };
addEventListener('error', (e) => logError(`${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => logError(`rejection: ${String(e.reason)}`));
const origError = console.error.bind(console);
console.error = (...a: unknown[]) => { logError(a.map(String).join(' ')); origError(...a); };
const eventLog: unknown[][] = [];
let fps = 60;

const canvas = $<HTMLCanvasElement>('#game');
const renderer = new Renderer(canvas);
const controls = new Controls(canvas, (x, y) => renderer.screenToArena(x, y), $('#mine-btn'));

// ------------------------------------------------------------------ profile

const FUN_NAMES = ['Obus', 'Chenille', 'Blindé', 'Canon', 'Tourelle', 'Ricochet', 'Panzer', 'Mortier', 'Bazooka', 'Sherman'];
const pid = localStorage.getItem('tanks.pid') ?? crypto.randomUUID();
localStorage.setItem('tanks.pid', pid);
let myName = localStorage.getItem('tanks.name') ?? `${FUN_NAMES[Math.floor(Math.random() * FUN_NAMES.length)]}${Math.floor(Math.random() * 90 + 10)}`;
let myColor = Number(localStorage.getItem('tanks.color') ?? PLAYER_COLORS[0]);
if (!PLAYER_COLORS.includes(myColor)) myColor = PLAYER_COLORS[0];
const storedWeapon = localStorage.getItem('tanks.weapon');
let myWeapon: Weapon = isWeapon(storedWeapon) ? storedWeapon : 'canon';
/** Furthest coop mission reached on this browser: unlocks the campaign checkpoints. */
let bestMission = Math.max(1, Number(localStorage.getItem('tanks.best')) || 1);

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
/** The coop campaign and the daily challenge share their rules (lives, enemies, results). */
const coopLike = (m: Mode) => m !== 'versus';

function renderProfile(el: HTMLElement) {
  el.innerHTML = `
    <label class="field"><span>Pseudo</span><input maxlength="16" value="${escapeHtml(myName)}" /></label>
    <div class="swatches">${PLAYER_COLORS.map((c) => `<button class="swatch ${c === myColor ? 'on' : ''}" data-c="${c}" style="--c:${hex(c)}" aria-label="couleur"></button>`).join('')}</div>`;
  const input = el.querySelector('input')!;
  input.addEventListener('change', () => {
    myName = input.value.trim().slice(0, 16) || myName;
    localStorage.setItem('tanks.name', myName);
    sendHello();
  });
  el.querySelectorAll<HTMLButtonElement>('.swatch').forEach((b) =>
    b.addEventListener('click', () => {
      myColor = Number(b.dataset.c);
      localStorage.setItem('tanks.color', String(myColor));
      document.querySelectorAll('.profile').forEach((p) => renderProfile(p as HTMLElement));
      sendHello();
      sfx.click();
    }),
  );
}
document.querySelectorAll('.profile').forEach((p) => renderProfile(p as HTMLElement));

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ------------------------------------------------------------------ screens

type Screen = 'home' | 'lobby' | 'game' | 'results';
let screen: Screen = 'home';
function show(s: Screen) {
  if (s === 'home' && screen !== 'home') void loadDaily();
  screen = s;
  $('#home').hidden = s !== 'home';
  $('#lobby').hidden = s !== 'lobby';
  $('#results').hidden = s !== 'results';
  $('#hud').hidden = s !== 'game';
  document.body.dataset.screen = s;
  if (s !== 'game') $('#menu').hidden = true;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

function banner(kicker: string, title: string, sub = '', cls = '') {
  const b = $('#banner');
  b.querySelector('.b-kicker')!.textContent = kicker;
  b.querySelector('.b-title')!.textContent = title;
  b.querySelector('.b-sub')!.textContent = sub;
  b.className = cls;
  b.hidden = false;
  b.style.animation = 'none';
  void b.offsetWidth;
  b.style.animation = '';
}
const hideBanner = () => ($('#banner').hidden = true);

// ------------------------------------------------------------------ networking

let ws: WebSocket | undefined;
let roomCode = '';
let wantOnline = false;
let reconnectTries = 0;
let everOpened = false;
let lobbyPlayers: PlayerInfo[] = [];
let lobbyMode: Mode = 'coop';
let lobbyFrom = 1; // coop checkpoint picked by the host
let wantDaily = false; // « Relever le défi » from the home screen: switch the new room to the daily challenge
let phase: Phase = 'lobby';
let ping = 0;

function send(msg: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function sendHello() {
  send({ t: 'hello', name: myName, color: myColor });
  send({ t: 'arm', w: myWeapon });
}

function connect(code: string) {
  roomCode = code;
  wantOnline = true;
  everOpened = false;
  history.replaceState(null, '', `/r/${code}`);
  openSocket();
}

function openSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/api/room/${roomCode}/ws?pid=${encodeURIComponent(pid)}`);
  ws = sock;
  sock.onopen = () => {
    everOpened = true;
    reconnectTries = 0;
    sendHello();
  };
  sock.onmessage = (e) => onMessage(JSON.parse(e.data) as ServerMsg);
  sock.onclose = (e) => {
    if (ws !== sock) return;
    ws = undefined;
    if (!wantOnline) return;
    if (e.code === 4000) { toast('Connexion ouverte dans un autre onglet.'); leaveRoom(); return; }
    reconnectTries++;
    if (!everOpened && reconnectTries > 2) {
      toast('Impossible de rejoindre la salle (pleine ou introuvable).');
      leaveRoom();
      return;
    }
    toast('Connexion perdue… reconnexion');
    setTimeout(() => wantOnline && openSocket(), Math.min(4000, 500 * reconnectTries));
  };
}

function leaveRoom() {
  wantOnline = false;
  ws?.close();
  ws = undefined;
  online = false;
  roomCode = '';
  history.replaceState(null, '', '/');
  hideBanner();
  show('home');
  startAttract();
}

setInterval(() => send({ t: 'ping', c: performance.now() }), 2000);

// ------------------------------------------------------------------ online game state

interface Snap { k: number; a: number; T: Map<number, NetTank>; B: Map<number, NetBullet>; M: NetMine[]; P: NetBonus[]; at: number }

let online = false;
let tiles: number[] = [];
let infos = new Map<number, TankInfo>();
let myTankId = -1;
let snaps: Snap[] = [];
let evq: { k: number; e: GameEvent }[] = [];
let renderTick = 0;
let latestK = 0;
let pending: Input[] = [];
let seq = 0;
let pred = { x: 0, y: 0, body: 0 };
let offset = { x: 0, y: 0 };
let aimAng = 0;
let localFireCd = 0;
let mySpec: TankSpec = SPECS.player; // our tank's sheet with its cannon (prediction of speed, ammo, fire rate)
let enemiesLeft = -1; // coop: enemies left according to the last phase message (0: cease-fire)
let currentMode: Mode = 'coop';
let lives = 3;
let scores: Record<string, number> = {};
const INTERP = 3;
let lastTanks: RTank[] = [];
let lastBullets: RBullet[] = [];
let lastMines: RMine[] = [];
let currentMission = 0;
let currentLevelName = '';
let dailyState: DailyState | undefined; // daily challenge in progress (stage, fighting time)
let dailyK = 0; // server tick when dailyState arrived, to run the clock between messages

function onMessage(msg: ServerMsg) {
  switch (msg.t) {
    case 'welcome':
      roomCode = msg.room || roomCode;
      $('#room-code').textContent = roomCode;
      break;
    case 'lobby': {
      lobbyPlayers = msg.players;
      lobbyMode = msg.mode;
      lobbyFrom = msg.from ?? 1;
      phase = msg.phase;
      if (wantDaily && msg.players.find((p) => p.id === pid)?.host && msg.phase === 'lobby') {
        wantDaily = false;
        if (msg.mode !== 'daily') send({ t: 'mode', mode: 'daily' });
      }
      renderLobby();
      if (msg.phase === 'lobby' && screen !== 'results') { online = false; show('lobby'); hideBanner(); startAttract(); }
      break;
    }
    case 'level':
      startLevel(msg);
      break;
    case 'phase':
      onPhase(msg);
      break;
    case 'snap':
      onSnap(msg);
      break;
    case 'pong':
      ping = Math.round(performance.now() - msg.c);
      $('#hud-ping').textContent = `${ping} ms`;
      break;
    case 'error':
      toast(msg.msg);
      break;
  }
}

function startLevel(msg: Extract<ServerMsg, { t: 'level' }>) {
  stopAttract();
  online = true;
  currentMode = msg.mode;
  tiles = msg.tiles.slice();
  infos = new Map(msg.tanks.map((t) => [t.id, t]));
  myTankId = msg.tanks.find((t) => t.pid === pid)?.id ?? -1;
  mySpec = playerSpec(msg.tanks.find((t) => t.id === myTankId)?.w ?? 'canon');
  enemiesLeft = -1;
  if (msg.mode === 'coop' && msg.mission > bestMission) {
    bestMission = msg.mission;
    try { localStorage.setItem('tanks.best', String(bestMission)); } catch {}
  }
  snaps = [];
  evq = [];
  pending = [];
  latestK = renderTick = msg.tick;
  offset = { x: 0, y: 0 };
  lives = msg.lives;
  currentMission = msg.mission;
  currentLevelName = msg.name;
  renderer.setLevel(tiles, msg.tanks);
  renderer.setNight(!!msg.night);
  show('game');
  setMusicIntensity(0);
  dailyState = msg.daily;
  dailyK = msg.tick;
  $('#hud-mission').innerHTML = msg.daily
    ? `<b>Défi · étape ${msg.daily.stage}/${msg.daily.stages}</b><span>${escapeHtml(msg.name)}</span>`
    : msg.mode === 'coop'
    ? `<b>Mission ${msg.mission}</b><span>${escapeHtml(msg.name)}</span>`
    : `<b>Manche ${msg.mission}</b><span>Versus · premier à 5</span>`;
  $('#hud').dataset.mode = msg.mode;
  const enemies = msg.tanks.filter((t) => t.team === 99);
  bossFight = enemies.some((e) => e.kind === 'boss');
  if (coopLike(msg.mode)) {
    const kinds = [...new Set(enemies.map((e) => e.kind))];
    if (msg.daily) {
      const tw = TWIST_INFO[msg.daily.twist];
      banner(`Défi du jour · étape ${msg.daily.stage}/${msg.daily.stages}${msg.night ? ' · Nuit' : ''}`, msg.name,
        `${tw ? `${tw.label} · ` : ''}Tanks ennemis : ${enemies.length}`, `intro daily${msg.night ? ' night' : ''}${bossFight ? ' boss' : ''}`);
    } else if (bossFight) banner(`Mission ${msg.mission} · Boss`, msg.name, 'Il encaisse plusieurs coups. Gare à sa salve circulaire !', 'intro boss');
    else banner(`Mission ${msg.mission}${msg.night ? ' · Nuit' : ''}`, msg.name, `Tanks ennemis : ${enemies.length}`, msg.night ? 'intro night' : 'intro');
    const sub = $('#banner .b-sub');
    sub.innerHTML += `<div class="b-tanks">${kinds.map((k) => `<span style="--c:${hex(ENEMY_COLORS[k])}">${SPECS[k].label}</span>`).join('')}</div>`;
  } else {
    banner(`Manche ${msg.mission}${msg.night ? ' · Nuit' : ''}`, 'Versus', 'Le dernier tank debout gagne la manche', msg.night ? 'intro night' : 'intro');
  }
  if (myTankId < 0) toast('Partie en cours : tu rejoindras à la prochaine manche.', 4000);
  else if (msg.night) setTimeout(() => toast(coopLike(msg.mode) ? 'Nuit : les ennemis ne te voient que de près… ou quand tu tires !' : 'Nuit : chaque tir trahit ta position.', 4000), 2200);
  else if (tiles.some(isPortal)) setTimeout(() => toast('Portails : entre dans l’un, ressors par l’autre. Les obus aussi !', 3500), 2200);
}

function onPhase(msg: Extract<ServerMsg, { t: 'phase' }>) {
  const prev = phase;
  phase = msg.phase;
  lives = msg.lives;
  if (msg.scores) scores = msg.scores;
  if (msg.daily) { dailyState = msg.daily; dailyK = latestK; }
  enemiesLeft = msg.enemies;
  renderHud();
  if (prev === msg.phase && msg.phase === 'playing') return;
  switch (msg.phase) {
    case 'intro':
      sfx.jingle('start');
      break;
    case 'playing':
      hideBanner();
      setMusicIntensity(bossFight ? 2 : 1);
      break;
    case 'cleared':
      setMusicIntensity(0);
      sfx.jingle('clear');
      if (msg.daily) {
        const last = msg.daily.stage >= msg.daily.stages;
        banner('Bravo !', last ? 'Défi relevé !' : `Étape ${msg.daily.stage} réussie`, `Chrono : ${formatTicks(msg.daily.ticks)}`, 'good');
      } else banner('Bravo !', 'Mission réussie', msg.mission % 5 === 0 ? 'Vie bonus à la prochaine mission !' : '', 'good');
      break;
    case 'failed':
      setMusicIntensity(0);
      sfx.jingle('fail');
      banner('Aïe…', 'Mission échouée', msg.lives > 0 ? `Vies restantes : ${msg.lives}` : 'Plus de vies', 'bad');
      break;
    case 'roundEnd':
      setMusicIntensity(0);
      sfx.jingle('clear');
      banner('Fin de manche', msg.text ?? '', '', 'good');
      break;
    case 'gameover':
      setMusicIntensity(0);
      sfx.jingle('over');
      hideBanner();
      if (msg.results) showResults(msg.results);
      break;
    case 'lobby':
      online = false;
      if (screen !== 'results') show('lobby');
      break;
  }
}

function onSnap(msg: Extract<ServerMsg, { t: 'snap' }>) {
  const s: Snap = { k: msg.k, a: msg.a, T: new Map(msg.T.map((t) => [t[0], t])), B: new Map(msg.B.map((b) => [b[0], b])), M: msg.M, P: msg.P ?? [], at: performance.now() };
  snaps.push(s);
  if (snaps.length > 40) snaps.shift();
  latestK = msg.k;
  for (const e of msg.E) {
    evq.push({ k: msg.k, e });
    if (e[0] === 'block') tiles[e[2] * W + e[1]] = Tile.Empty; // prediction sees the freshest map
  }
  // reconcile own tank
  const me = s.T.get(myTankId);
  if (me) {
    pending = pending.filter((p) => p.s > msg.a);
    let x = me[1], y = me[2], body = me[3];
    if (me[5] & 1 && phase === 'playing') {
      for (const p of pending) [x, y, body] = predictStep(x, y, body, p.mx, p.my, s);
    }
    const ex = pred.x + offset.x - x, ey = pred.y + offset.y - y;
    if (Math.hypot(ex, ey) < 1.5) { offset.x = ex; offset.y = ey; } else { offset.x = offset.y = 0; }
    pred = { x, y, body };
  }
}

function predictStep(x: number, y: number, body: number, mx: number, my: number, s?: Snap): [number, number, number] {
  const snap = s ?? snaps[snaps.length - 1];
  const turbo = (snap?.T.get(myTankId)?.[5] ?? 0) & BONUS_INFO.turbo.flag;
  [x, y, body] = driveStep(tiles, x, y, body, mx, my, mySpec.speed * (turbo ? TURBO_MULT : 1), DT);
  // treat other tanks as static obstacles
  if (snap) {
    for (const t of snap.T.values()) {
      if (t[0] === myTankId || !(t[5] & 1)) continue;
      const dx = x - t[1], dy = y - t[2];
      const d = Math.hypot(dx, dy);
      const rr = TANK_R + tankRadius(infos.get(t[0])?.kind ?? 'player');
      if (d < rr && d > 1e-4) { x = t[1] + (dx / d) * rr; y = t[2] + (dy / d) * rr; }
    }
  }
  return [x, y, body];
}

function clientTick() {
  const s = controls.sample();
  localFireCd -= DT;
  const last = snaps[snaps.length - 1];
  const meNet = last?.T.get(myTankId);
  if (!meNet || !(meNet[5] & 1)) return;
  const px = pred.x + offset.x, py = pred.y + offset.y;
  if (s.aimAng !== null) aimAng = s.aimAng;
  else if (s.aimX !== null && s.aimY !== null) aimAng = Math.atan2(s.aimY - py, s.aimX - px);
  const playing = phase === 'playing';
  const inp: Input = { s: ++seq, mx: +s.mx.toFixed(3), my: +s.my.toFixed(3), a: +aimAng.toFixed(3), f: s.fire && playing ? 1 : 0, m: s.mine && playing ? 1 : 0 };
  send({ t: 'in', i: [inp] });
  pending.push(inp);
  if (pending.length > 90) pending.shift();
  if (playing) {
    [pred.x, pred.y, pred.body] = predictStep(pred.x, pred.y, pred.body, inp.mx, inp.my);
    const ceasefire = coopLike(currentMode) && enemiesLeft === 0; // the server no longer lets anyone fire
    if (inp.f && localFireCd <= 0 && !ceasefire) {
      let own = 0;
      for (const b of last.B.values()) if (b[6] === myTankId) own++;
      if (own < mySpec.maxBullets) {
        localFireCd = mySpec.fireCd;
        sfx.shot(mySpec.rocket);
        const tip = TANK_R + 0.22;
        renderer.muzzle(px + Math.cos(aimAng) * tip, py + Math.sin(aimAng) * tip, aimAng, mySpec.rocket, myTankId);
      }
    }
  }
}

function sampleAt(tick: number) {
  // find snapshots bracketing tick
  let a: Snap | undefined, b: Snap | undefined;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].k <= tick) { a = snaps[i]; b = snaps[i + 1] ?? snaps[i]; break; }
  }
  if (!a) { a = b = snaps[0]; }
  const u = a && b && b.k > a.k ? Math.min(1, (tick - a.k) / (b.k - a.k)) : 0;
  return { a, b, u };
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpAng = (a: number, b: number, u: number) => a + angDiff(a, b) * u;
/** Interpolation factor between two positions, snapped to 0 or 1 when the move is a portal jump. */
const jumped = (x0: number, y0: number, x1: number, y1: number, u: number) => ((x1 - x0) ** 2 + (y1 - y0) ** 2 > 1.5 ? (u < 0.5 ? 0 : 1) : u);

function onlineFrame(dt: number) {
  if (!snaps.length) return;
  const target = latestK - INTERP;
  renderTick += dt * TICK_RATE;
  if (Math.abs(renderTick - target) > 8) renderTick = target;
  else renderTick += (target - renderTick) * Math.min(1, dt * 3);

  // events
  while (evq.length && evq[0].k <= renderTick) handleEvent(evq.shift()!.e, true);

  const { a, b, u } = sampleAt(renderTick);
  if (!a || !b) return;
  const decay = Math.exp(-dt * 12);
  offset.x *= decay; offset.y *= decay;

  const tanks: RTank[] = [];
  let enemiesAlive = 0;
  for (const ta of a.T.values()) {
    const tb = b.T.get(ta[0]) ?? ta;
    const alive = !!(ta[5] & 1);
    if (infos.get(ta[0])?.team === 99 && alive) enemiesAlive++;
    if (ta[0] === myTankId) {
      const latest = snaps[snaps.length - 1].T.get(myTankId)!;
      tanks.push({ id: ta[0], x: pred.x + offset.x, y: pred.y + offset.y, body: pred.body, turret: latest[5] & 1 ? aimAng : latest[4], alive, invisible: false, fx: latest[5] });
      continue;
    }
    const tw = jumped(ta[1], ta[2], tb[1], tb[2], u); // through a portal: no sliding across the map
    tanks.push({ id: ta[0], x: lerp(ta[1], tb[1], tw), y: lerp(ta[2], tb[2], tw), body: lerpAng(ta[3], tb[3], u), turret: lerpAng(ta[4], tb[4], u), alive, invisible: !!(ta[5] & 2), fx: ta[5] });
  }
  renderer.syncTanks(tanks, myTankId, dt);
  lastTanks = tanks;
  updateBoss(tanks, (id) => a.T.get(id)?.[6] ?? 0, (id) => infos.get(id)?.hp ?? 0);
  $('#hud-enemies').textContent = coopLike(currentMode) ? `${enemiesAlive} ennemi${enemiesAlive > 1 ? 's' : ''}` : '';

  /** Player shells take their shooter's colour (enemy shells stay white). */
  function shellColor(owner: number) {
    const i = infos.get(owner);
    return i?.kind === 'player' ? i.color : undefined;
  }
  // bullets: interpolate everyone else's, extrapolate our own from the freshest state
  const bullets: RBullet[] = [];
  const latest = snaps[snaps.length - 1];
  const ahead = Math.min(0.15, (performance.now() - latest.at) / 1000 + ping / 2000);
  for (const bl of latest.B.values()) {
    if (bl[6] !== myTankId) continue;
    bullets.push({ id: bl[0], x: bl[1] + bl[3] * ahead, y: bl[2] + bl[4] * ahead, vx: bl[3], vy: bl[4], rocket: !!bl[5], color: shellColor(bl[6]) });
  }
  for (const ba of a.B.values()) {
    if (ba[6] === myTankId) continue;
    const bb = b.B.get(ba[0]);
    if (!bb) { bullets.push({ id: ba[0], x: ba[1] + ba[3] * u * DT * (b.k - a.k), y: ba[2] + ba[4] * u * DT * (b.k - a.k), vx: ba[3], vy: ba[4], rocket: !!ba[5], color: shellColor(ba[6]) }); continue; }
    const bw = jumped(ba[1], ba[2], bb[1], bb[2], u);
    bullets.push({ id: ba[0], x: lerp(ba[1], bb[1], bw), y: lerp(ba[2], bb[2], bw), vx: bb[3], vy: bb[4], rocket: !!ba[5], color: shellColor(ba[6]) });
  }
  renderer.syncBullets(bullets, dt);
  lastBullets = bullets;
  const mines: RMine[] = a.M.map((m) => ({ id: m[0], x: m[1], y: m[2], blink: !!m[3] }));
  renderer.syncMines(mines);
  lastMines = mines;
  renderer.syncBonuses(a.P.map((c) => ({ id: c[0], x: c[1], y: c[2], kind: c[3], blink: !!c[4] })));
  updateNameTags(tanks);
  const myFlags = latest.T.get(myTankId)?.[5] ?? 0;
  renderBuffs(myFlags & 1 ? myFlags : 0);
}

function handleEvent(e: GameEvent, audible: boolean) {
  if (online) { eventLog.push([Math.round(renderTick), ...e]); if (eventLog.length > 60) eventLog.shift(); }
  switch (e[0]) {
    case 'shot':
      if (e[5] === myTankId && online) break;
      renderer.muzzle(e[1], e[2], e[3], !!e[4], e[5]);
      if (audible) sfx.shot(!!e[4]);
      break;
    case 'bounce':
      renderer.spark(e[1], e[2]);
      if (audible) sfx.bounce();
      break;
    case 'pop':
      renderer.pop(e[1], e[2]);
      if (audible) sfx.pop();
      break;
    case 'boom':
      if (renderer.tankKind(e[3]) === 'boss') {
        // the boss goes down in a chain of blasts
        renderer.explosion(e[1], e[2], true, renderer.tankColor(e[3]));
        for (let i = 1; i <= 3; i++) setTimeout(() => renderer.explosion(e[1] + (Math.random() - 0.5) * 1.4, e[2] + (Math.random() - 0.5) * 1.4, false, 0xf2c14e), i * 180);
        floater(e[1], e[2], 'Colosse vaincu !', 0xf2c14e);
        if (audible) { sfx.boom(true); setTimeout(() => sfx.boom(false), 250); }
        if (online && bossFight) setMusicIntensity(1);
      } else {
        renderer.explosion(e[1], e[2], false, renderer.tankColor(e[3]));
        if (audible) sfx.boom(false);
      }
      if (e[3] === myTankId && online) toast('Détruit !', 1500);
      break;
    case 'mineSet':
      if (audible) sfx.mineSet();
      break;
    case 'mboom':
      renderer.explosion(e[1], e[2], true);
      if (audible) sfx.boom(true);
      break;
    case 'block':
      renderer.removeBlock(e[1], e[2]);
      if (audible) sfx.block();
      break;
    case 'crate':
      if (audible) sfx.crate();
      break;
    case 'bonus': {
      const kind = BONUS_KINDS[e[3]];
      if (!kind) break;
      const info = BONUS_INFO[kind];
      renderer.bonusBurst(e[1], e[2], info.color);
      floater(e[1], e[2], `${info.label} !`, info.color);
      if (audible) sfx.bonus();
      break;
    }
    case 'shield':
      renderer.bonusBurst(e[1], e[2], BONUS_INFO.shield.color, true);
      floater(e[1], e[2], 'Bouclier brisé !', BONUS_INFO.shield.color);
      if (audible) sfx.shieldBreak();
      break;
    case 'hurt':
      renderer.hurt(e[3], e[1], e[2]);
      floater(e[1], e[2], `${e[4]} / ${e[5]}`, ENEMY_COLORS.boss);
      if (audible) sfx.bossHit();
      break;
    case 'volley':
      renderer.volley(e[1], e[2]);
      if (audible) sfx.volley();
      break;
    case 'warp':
      renderer.warp(e[1], e[2], e[3], e[4], e[5] > 0);
      if (audible) sfx.warp(e[5] > 0);
      break;
    case 'rage':
      renderer.hurt(e[3], e[1], e[2]);
      floater(e[1], e[2], 'En colère !', 0xff3b2f);
      if (audible) sfx.rage();
      $('#boss-bar').classList.add('rage');
      break;
  }
}

// ------------------------------------------------------------------ bonus: floating labels and HUD chips

const floatLayer = $('#floaters');
function floater(x: number, y: number, text: string, color: number) {
  const p = renderer.arenaToScreen(x, y, 1.1);
  const el = document.createElement('div');
  el.className = 'floater';
  el.textContent = text;
  el.style.setProperty('--c', hex(color));
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  floatLayer.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

let buffKey = -1;
function renderBuffs(flags: number) {
  const mask = flags & ~3;
  if (mask === buffKey) return;
  buffKey = mask;
  $('#hud-buffs').innerHTML = (Object.keys(BONUS_INFO) as BonusKind[])
    .filter((k) => mask & BONUS_INFO[k].flag)
    .map((k) => `<span class="buff" style="--c:${hex(BONUS_INFO[k].color)}">${BONUS_INFO[k].label}</span>`)
    .join('');
}

// ------------------------------------------------------------------ boss health bar

let bossFight = false;
let bossKey = '';
const charging = new Set<number>();
const alerted = new Set<number>();
let lastAlert = 0;
/** Health bar of the toughest enemy on the table, and the warning whine when the boss charges a volley. */
function updateBoss(tanks: RTank[], hpOf: (id: number) => number, maxOf: (id: number) => number) {
  let boss: RTank | undefined;
  for (const t of tanks) if (t.alive && maxOf(t.id) > 1) { boss = t; break; }
  const bar = $('#boss-bar');
  for (const t of tanks) {
    const on = !!((t.fx ?? 0) & FLAG_CHARGING) && t.alive;
    if (on && !charging.has(t.id) && online) sfx.bossCharge();
    if (on) charging.add(t.id); else charging.delete(t.id);
    const seen = !!((t.fx ?? 0) & FLAG_ALERT) && t.alive;
    if (seen && !alerted.has(t.id) && online && performance.now() - lastAlert > 400) { sfx.alert(); lastAlert = performance.now(); }
    if (seen) alerted.add(t.id); else alerted.delete(t.id);
  }
  if (!boss || screen !== 'game') {
    if (bossKey) { bar.hidden = true; bar.classList.remove('rage'); bossKey = ''; }
    return;
  }
  const hp = hpOf(boss.id), max = maxOf(boss.id);
  const key = `${boss.id}:${hp}/${max}`;
  if (key === bossKey) return;
  bossKey = key;
  bar.hidden = false;
  bar.classList.toggle('rage', hp <= max / 2);
  $('#boss-name').textContent = SPECS.boss.label;
  $('#boss-hp').textContent = `${hp} / ${max}`;
  $('#boss-fill').style.width = `${(100 * hp) / max}%`;
}

// ------------------------------------------------------------------ name tags

const tagLayer = $('#names');
const tagEls = new Map<number, HTMLDivElement>();
function updateNameTags(tanks: RTank[]) {
  const seen = new Set<number>();
  for (const t of tanks) {
    const info = infos.get(t.id);
    if (!info?.pid || !t.alive || !online) continue;
    seen.add(t.id);
    let el = tagEls.get(t.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tag';
      el.style.setProperty('--c', hex(info.color));
      el.textContent = info.pid === pid ? `${info.name} (toi)` : info.name ?? '';
      tagLayer.appendChild(el);
      tagEls.set(t.id, el);
    }
    const p = renderer.arenaToScreen(t.x, t.y, 0.95);
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
  }
  for (const [id, el] of tagEls) if (!seen.has(id)) { el.remove(); tagEls.delete(id); }
}

// ------------------------------------------------------------------ HUD / lobby / results

function renderHud() {
  const livesEl = $('#hud-lives');
  livesEl.innerHTML = coopLike(currentMode) ? `<span class="tank-ico"></span> × ${lives}` : '';
  const sb = $('#scoreboard');
  if (currentMode === 'versus') {
    sb.innerHTML = lobbyPlayers
      .filter((p) => scores[p.id] !== undefined)
      .sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0))
      .map((p) => `<div class="sb-row"><i style="--c:${hex(p.color)}"></i><span>${escapeHtml(p.name)}</span><b>${scores[p.id] ?? 0}</b></div>`)
      .join('');
  } else sb.innerHTML = '';
  const isHost = lobbyPlayers.find((p) => p.id === pid)?.host;
  $('#menu-lobby').hidden = !isHost;
}

function renderLobby() {
  const me = lobbyPlayers.find((p) => p.id === pid);
  const isHost = !!me?.host;
  $('#room-code').textContent = roomCode;
  $('#lobby-players').innerHTML = Array.from({ length: 4 }, (_, i) => {
    const p = lobbyPlayers[i];
    if (!p) return `<li class="empty"><i></i><span>En attente d'un joueur…</span></li>`;
    const w = p.id === pid ? myWeapon : p.weapon ?? 'canon';
    return `<li style="--c:${hex(p.color)}" class="${p.connected ? '' : 'off'}"><i></i><span>${escapeHtml(p.name)}${p.id === pid ? ' <em>(toi)</em>' : ''}</span><b class="wpn">${WEAPON_INFO[w].label}</b>${p.host ? '<b class="host">Hôte</b>' : ''}</li>`;
  }).join('');
  document.querySelectorAll<HTMLButtonElement>('#mode-select button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === lobbyMode);
    b.disabled = !isHost;
  });
  const start = $<HTMLButtonElement>('#btn-start');
  start.hidden = !isHost;
  $('#lobby-wait').hidden = isHost;
  const n = lobbyPlayers.filter((p) => p.connected).length;
  start.disabled = lobbyMode === 'versus' && n < 2;
  start.textContent = lobbyMode === 'versus' && n < 2 ? 'Il faut 2 joueurs' : phase === 'lobby' ? 'Lancer la partie' : 'Partie en cours…';
  const today = dayNumber();
  $('#mode-desc').textContent = lobbyMode === 'daily'
    ? `Défi du jour (${dayLabel(today)}) : ${DAILY_STAGES} missions générées, les mêmes pour tout le monde aujourd’hui, avec 3 vies et sans vie bonus. Consigne du jour : ${TWIST_INFO[dailyTwist(today)].label.toLowerCase()}. ${TWIST_INFO[dailyTwist(today)].desc} Le chrono décide du classement.`
    : lobbyMode === 'coop'
    ? 'Campagne coopérative : 19 missions faites main puis missions générées à l’infini, avec un boss toutes les 10 missions. Vies partagées, +1 vie toutes les 5 missions. Des caisses bonus tombent pendant les missions.'
    : 'Chacun pour soi : le dernier tank debout marque un point. Premier à 5 manches. Les caisses bonus tombent plus souvent : fonce les chercher !';
  renderWeapons();
  renderCheckpoints(isHost);
  renderHud();
}

/** Top view of a cannon, for the arsenal cards. */
function weaponIcon(w: Weapon, color: number) {
  const c = hex(color), dark = '#2a2b33';
  const hull = `<rect x="4" y="7" width="26" height="16" rx="4" fill="${c}" opacity=".55"/><rect x="3" y="4" width="28" height="4" rx="2" fill="${dark}"/><rect x="3" y="22" width="28" height="4" rx="2" fill="${dark}"/>`;
  const dome = `<circle cx="16" cy="15" r="6.5" fill="${c}" stroke="${dark}" stroke-width="1.2"/>`;
  const parts: Record<Weapon, string> = {
    canon: `<rect x="18" y="13" width="18" height="4" rx="1.5" fill="${dark}"/><rect x="34" y="12" width="4" height="6" rx="1" fill="${dark}"/>`,
    ricochet: `<rect x="18" y="13.5" width="21" height="3" rx="1.2" fill="${dark}"/><rect x="25" y="12" width="2" height="6" rx="1" fill="#ffb43d"/><rect x="31" y="12" width="2" height="6" rx="1" fill="#ffb43d"/><path d="M38 9 l3 3 -3 3" fill="none" stroke="#ffb43d" stroke-width="1.6" stroke-linecap="round"/>`,
    fusee: `<rect x="17" y="11.5" width="17" height="7" rx="3" fill="${dark}"/><path d="M34 11.5 l6 3.5 -6 3.5z" fill="#ff7a1a"/>`,
    sapeur: `<rect x="18" y="13" width="13" height="4" rx="1.5" fill="${dark}"/><circle cx="5" cy="9.5" r="2.6" fill="#f4c542"/><circle cx="5" cy="15" r="2.6" fill="#f4c542"/><circle cx="5" cy="20.5" r="2.6" fill="#f4c542"/>`,
  };
  return `<svg viewBox="0 0 44 30" aria-hidden="true">${hull}${parts[w]}${dome}</svg>`;
}

function renderWeapons() {
  $('#weapon-select').innerHTML = WEAPONS.map((w) =>
    `<button data-w="${w}" class="${w === myWeapon ? 'on' : ''}" title="${WEAPON_INFO[w].desc}">${weaponIcon(w, myColor)}<span>${WEAPON_INFO[w].label}</span><small>${WEAPON_INFO[w].desc}</small></button>`).join('');
}
$('#weapon-select').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-w]');
  if (!b || !isWeapon(b.dataset.w)) return;
  sfx.click();
  myWeapon = b.dataset.w;
  try { localStorage.setItem('tanks.weapon', myWeapon); } catch {}
  send({ t: 'arm', w: myWeapon });
  renderLobby();
});

/** Coop checkpoints (mission 1, 6, 11…): the host picks among those reached on their browser. */
function renderCheckpoints(isHost: boolean) {
  const box = $('#from-select');
  box.hidden = lobbyMode !== 'coop';
  if (box.hidden) return;
  const last = Math.floor((bestMission - 1) / CHECKPOINT_EVERY) * CHECKPOINT_EVERY + 1;
  const list: number[] = [];
  for (let n = 1; n <= Math.max(last, lobbyFrom) + CHECKPOINT_EVERY && list.length < 9; n += CHECKPOINT_EVERY) list.push(n);
  if (list.length >= 9 && !list.includes(lobbyFrom)) list.push(lobbyFrom);
  box.querySelector('.chips')!.innerHTML = list.map((n) => {
    const locked = n > last && n !== lobbyFrom;
    return `<button data-n="${n}" class="${n === lobbyFrom ? 'on' : ''}" ${!isHost || locked ? 'disabled' : ''} title="${locked ? 'Atteins cette mission pour la débloquer' : `Commencer à la mission ${n}`}">${locked ? '🔒 ' : ''}${n}</button>`;
  }).join('');
}
$('#from-select').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-n]');
  if (!b || b.disabled) return;
  sfx.click();
  send({ t: 'from', n: Number(b.dataset.n) });
});

// ------------------------------------------------------------------ daily challenge

/** Running time of the daily run, ticking locally while the fight is on. */
function updateClock() {
  const el = $('#hud-clock');
  el.hidden = !dailyState || !online;
  if (el.hidden || !dailyState) return;
  const extra = phase === 'playing' ? Math.max(0, latestK - dailyK) : 0;
  el.innerHTML = `⏱ ${formatTicks(dailyState.ticks + extra)}<span>${escapeHtml(TWIST_INFO[dailyState.twist]?.label ?? '')}</span>`;
}

const ordinal = (n: number) => `${n}<sup>${n === 1 ? 'er' : 'e'}</sup>`;

function boardHtml(b: BoardDay | undefined, highlight?: number) {
  if (!b) return '<li class="empty">Classement indisponible pour l’instant.</li>';
  if (!b.entries.length) return '<li class="empty">Personne n’a encore relevé ce défi : à toi l’honneur !</li>';
  return b.entries
    .map((e, i) => `<li class="${i + 1 === highlight ? 'me' : ''}"><span class="who">${e.team
      .map((p) => `<i style="--c:${hex(p.color)}"></i>${escapeHtml(p.name)}`)
      .join(', ')}</span><span class="stg">${e.cleared}/${DAILY_STAGES}</span><span class="time">${formatTicks(e.ticks)}</span></li>`)
    .join('');
}

function dailyResultHtml(d: NonNullable<Results['daily']>) {
  const b = d.board;
  const rank = d.cleared > 0 && b?.rank
    ? `${ordinal(b.rank)} sur ${b.total} équipe${b.total > 1 ? 's' : ''} aujourd’hui`
    : d.cleared === 0 ? 'Aucune étape réussie : pas de chrono au classement. Retente ta chance !' : '';
  return `<div class="daily-result">
    <div class="big">${d.cleared}/${d.state.stages} étapes · <em>${formatTicks(d.state.ticks)}</em></div>
    ${rank ? `<p class="muted center">${rank}</p>` : ''}
    <ol class="board">${boardHtml(b, d.cleared > 0 ? b?.rank : undefined)}</ol>
  </div>`;
}

/** The home screen card: today's twist and best runs. */
async function loadDaily() {
  const day = dayNumber();
  const tw = TWIST_INFO[dailyTwist(day)];
  $('#daily-date').textContent = dayLabel(day);
  $('#daily-twist').textContent = tw.label;
  $('#daily-desc').textContent = `${DAILY_STAGES} missions, les mêmes pour tout le monde aujourd’hui. ${tw.desc} 3 vies, seul ou à plusieurs : le chrono décide.`;
  try {
    const b = await fetch('/api/daily').then((r) => (r.ok ? (r.json() as Promise<BoardDay>) : undefined));
    $('#daily-board').innerHTML = boardHtml(b?.entries ? { ...b, entries: b.entries.slice(0, 5) } : undefined);
  } catch {
    $('#daily-board').innerHTML = boardHtml(undefined);
  }
}

function showResults(r: Results) {
  const kinds = Object.keys(SPECS).filter((k) => k !== 'player') as (keyof typeof SPECS)[];
  const title = r.daily
    ? (r.daily.cleared >= r.daily.state.stages ? 'Défi du jour relevé !' : `Défi du jour · ${r.daily.cleared}/${r.daily.state.stages} étapes`)
    : r.mode === 'coop' ? `Partie terminée · Mission ${r.mission}` : `${r.players[0]?.name ?? ''} remporte le versus !`;
  const coop = coopLike(r.mode);
  $('#results-title').textContent = title;
  $('#results-body').innerHTML = `
    <table>
      <thead><tr><th>Joueur</th>${coop ? kinds.map((k) => `<th title="${SPECS[k].label}"><i class="dot" style="--c:${hex(ENEMY_COLORS[k])}"></i></th>`).join('') : '<th>Kills</th>'}<th>Morts</th><th>${coop ? 'Total' : 'Manches'}</th></tr></thead>
      <tbody>${r.players
        .map((p) => {
          const kills = Object.values(p.kills).reduce((s, v) => s + (v ?? 0), 0);
          return `<tr><td><i class="dot" style="--c:${hex(p.color)}"></i>${escapeHtml(p.name)}</td>${
            coop ? kinds.map((k) => `<td>${p.kills[k] ?? '·'}</td>`).join('') : `<td>${kills}</td>`
          }<td>${p.deaths}</td><td><b>${p.score}</b></td></tr>`;
        })
        .join('')}</tbody>
    </table>${r.daily ? dailyResultHtml(r.daily) : ''}`;
  show('results');
}

// ------------------------------------------------------------------ attract mode (background demo)

let attract: Game | undefined;
let attractEnd = 0;
let attractPrev = new Map<number, { x: number; y: number; body: number; turret: number }>();

interface AttractOpts { mission?: number; heroes?: boolean; rich?: boolean; bossHp?: number; night?: boolean; daily?: { day: number; stage: number }; arms?: Weapon[] }
let attractOpts: AttractOpts = {};

function startAttract(opts: AttractOpts = attractOpts) {
  if (attract) return;
  attractOpts = opts;
  const lvl: ParsedLevel = opts.daily ? dailyLevel(opts.daily.day, opts.daily.stage) : getMission(opts.mission ?? 2 + Math.floor(Math.random() * 14));
  const g = new Game(lvl.tiles);
  g.bonusOn = true;
  // the home-screen background sometimes plays in the dark, as a teaser
  g.night = opts.night ?? (!!lvl.night || (!opts.heroes && opts.mission === undefined && Math.random() < 0.25));
  if (opts.rich) { g.bonusNext = 1.2; g.bonusEvery = [2.5, 4]; g.bonusCap = 3; }
  if (opts.daily) applyTwist(g, dailyTwist(opts.daily.day));
  if (opts.heroes) {
    // player-coloured tanks driven by the AI: used by the gameplay videos
    lvl.spawns.forEach(([x, y], i) => {
      const t = g.addTank('player', 1, x, y, PLAYER_COLORS[i % PLAYER_COLORS.length]);
      if (opts.arms?.length) g.arm(t, opts.arms[i % opts.arms.length]);
      g.enableAI(t, { skill: 2, turretSpeed: 5, fireCd: Math.max(0.4, t.spec.fireCd) });
    });
  } else {
    const left = ['pink', 'violet', 'ash'] as const;
    lvl.spawns.forEach(([x, y], i) => g.addTank(left[i % left.length], 1, x, y, 0));
  }
  lvl.enemies.forEach((e) => {
    const t = g.addTank(e.kind === 'white' && !opts.heroes ? 'ash' : e.kind, 2, e.x, e.y, 0);
    if (opts.bossHp && t.maxHp > 1) g.setHp(t, opts.bossHp, t.maxHp);
  });
  g.frozen = false;
  attract = g;
  attractEnd = 0;
  attractPrev.clear();
  renderer.setLevel(g.tiles, g.tankInfos());
  renderer.setNight(g.night);
}
function stopAttract() {
  attract = undefined;
}

let attractAcc = 0;
let attractState: Record<string, unknown> = {};
function attractFrame(dt: number) {
  const g = attract!;
  attractAcc += dt;
  while (attractAcc >= DT) {
    attractAcc -= DT;
    for (const t of g.tanks) attractPrev.set(t.id, { x: t.x, y: t.y, body: t.body, turret: t.turret });
    g.step(new Map());
    for (const e of g.events) handleEvent(e, false);
    g.events = [];
  }
  const u = attractAcc / DT;
  const tanks: RTank[] = g.tanks.map((t) => {
    const p = attractPrev.get(t.id) ?? t;
    const w = jumped(p.x, p.y, t.x, t.y, u);
    return { id: t.id, x: lerp(p.x, t.x, w), y: lerp(p.y, t.y, w), body: lerpAng(p.body, t.body, u), turret: lerpAng(p.turret, t.turret, u), alive: t.alive, invisible: false, fx: g.buffFlags(t) };
  });
  renderer.syncTanks(tanks, -1, dt);
  lastTanks = tanks;
  updateBoss(tanks, (id) => g.tankById(id)?.hp ?? 0, (id) => g.tankById(id)?.maxHp ?? 0);
  renderer.syncBullets(g.bullets.map((b) => {
    const o = g.tankById(b.owner);
    return { id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, rocket: b.rocket, color: o?.kind === 'player' ? o.color : undefined };
  }), dt);
  renderer.syncMines(g.mines.map((m) => ({ id: m.id, x: m.x, y: m.y, blink: m.fuse >= 0 })));
  renderer.syncBonuses(g.bonuses.map((c): RBonus => ({ id: c.id, x: c.x, y: c.y, kind: BONUS_KINDS.indexOf(c.kind), blink: c.t > 13 })));
  if (!attractEnd && (g.aliveCount(1) === 0 || g.aliveCount(2) === 0 || g.tick > TICK_RATE * 90)) attractEnd = g.tick + TICK_RATE * 2.5;
  if (attractEnd && g.tick > attractEnd) { attract = undefined; startAttract(); }
  attractState = { tick: g.tick, heroes: g.aliveCount(1), enemies: g.aliveCount(2), mission: attractOpts.mission };
}

// ------------------------------------------------------------------ main loop

let lastT = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  if (now > lastT) fps += (1000 / (now - lastT) - fps) * 0.05;
  lastT = now;
  if (online) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n++ < 4) { acc -= DT; clientTick(); }
    if (acc > DT) acc = 0;
    onlineFrame(dt);
    updateClock();
  } else if (attract) {
    attractFrame(dt);
    updateNameTags([]);
  }
  renderer.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ wiring

function unlockAudio() {
  initAudio();
  startMusic();
}
addEventListener('pointerdown', unlockAudio, { once: false });
addEventListener('keydown', unlockAudio, { once: false });

async function createRoom(btn: HTMLButtonElement, daily: boolean) {
  sfx.click();
  btn.disabled = true;
  try {
    const r = await fetch('/api/new').then((r) => r.json() as Promise<{ room: string }>);
    wantDaily = daily;
    connect(r.room);
    show('lobby');
  } catch {
    toast('Serveur injoignable');
  } finally {
    btn.disabled = false;
  }
}
$('#btn-create').addEventListener('click', () => createRoom($<HTMLButtonElement>('#btn-create'), false));
$('#btn-daily').addEventListener('click', () => createRoom($<HTMLButtonElement>('#btn-daily'), true));

function joinFromInput() {
  const code = $<HTMLInputElement>('#join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) { toast('Code de salle invalide'); return; }
  connect(code);
  show('lobby');
}
$('#btn-join').addEventListener('click', joinFromInput);
$('#join-code').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') joinFromInput(); });

$('#btn-copy').addEventListener('click', async () => {
  const url = `${location.origin}/r/${roomCode}`;
  try {
    if (navigator.share && controls.touchMode) await navigator.share({ title: 'Tanks!', url });
    else { await navigator.clipboard.writeText(url); toast('Lien copié !'); }
  } catch {}
});
document.querySelectorAll<HTMLButtonElement>('#mode-select button').forEach((b) =>
  b.addEventListener('click', () => { sfx.click(); send({ t: 'mode', mode: b.dataset.mode as Mode }); }),
);
$('#btn-start').addEventListener('click', () => { sfx.click(); send({ t: 'start' }); });
$('#btn-leave').addEventListener('click', () => leaveRoom());
$('#btn-results-ok').addEventListener('click', () => { show(online ? 'game' : roomCode ? 'lobby' : 'home'); });

function toggleMenu(force?: boolean) {
  if (screen !== 'game') return;
  const m = $('#menu');
  m.hidden = force !== undefined ? !force : !m.hidden;
}
$('#btn-menu').addEventListener('click', () => toggleMenu());
$('#menu-resume').addEventListener('click', () => toggleMenu(false));
$('#menu-lobby').addEventListener('click', () => { send({ t: 'stop' }); toggleMenu(false); });
$('#menu-quit').addEventListener('click', () => leaveRoom());
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') toggleMenu();
  if (e.code === 'KeyM' && (e.target as HTMLElement)?.tagName !== 'INPUT') updateMusicBtn(toggleMusic());
});
function updateMusicBtn(on = isMusicOn()) {
  $('#btn-music').textContent = on ? '♪' : '♪̸';
  $('#btn-music').classList.toggle('off', !on);
}
$('#btn-music').addEventListener('click', () => updateMusicBtn(toggleMusic()));
updateMusicBtn();

// ------------------------------------------------------------------ iteration stamp, journal

function renderJournal() {
  $('#journal-list').innerHTML = [...META.journal].reverse().map((j) => `
    <article>
      <header><span class="stamp small">N° ${j.iteration}</span><b>${escapeHtml(j.title)}</b><time>${j.date}</time></header>
      <ul>${j.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
    </article>`).join('');
}
$('#iteration-stamp').textContent = `Itération ${META.iteration}`;
$('#iteration-stamp').title = META.title;
$('#btn-journal').addEventListener('click', () => { renderJournal(); $('#journal').hidden = false; sfx.click(); });
$('#btn-journal-close').addEventListener('click', () => ($('#journal').hidden = true));

// ------------------------------------------------------------------ feedback

const TILE_NAMES = ['vide', 'mur', 'mur haut', 'liège', 'trou'];
function tankLabel(id: number) {
  const info = infos.get(id) ?? attract?.tanks.find((t) => t.id === id);
  if (!info) return { id };
  const kind = info.kind;
  return { id, kind, label: kind === 'player' ? (info.name ?? 'joueur') : SPECS[kind].label, team: info.team, me: id === myTankId || undefined };
}
const r2 = (v: number) => Math.round(v * 100) / 100;

setupFeedback({
  capture: () => renderer.capture(),
  toast,
  onOpen: () => { controls.suspended = true; controls.release(); },
  onClose: () => { controls.suspended = false; },
  describeRegion(r: Region) {
    const inside = (x: number, y: number, h = 0.3) => {
      const p = renderer.arenaToScreen(x, y, h);
      return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
    };
    const map = online ? tiles : attract?.tiles ?? [];
    const cells: { x: number; y: number; type: string }[] = [];
    for (let i = 0; i < map.length; i++) {
      if (!map[i]) continue;
      const x = i % W, y = Math.floor(i / W);
      if (inside(x + 0.5, y + 0.5, 0.4)) cells.push({ x, y, type: TILE_NAMES[map[i]] ?? String(map[i]) });
    }
    const center = renderer.screenToArena((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
    return {
      arenaCenter: center && { x: r2(center.x), y: r2(center.y) },
      tanks: lastTanks.filter((t) => inside(t.x, t.y)).map((t) => ({ ...tankLabel(t.id), x: r2(t.x), y: r2(t.y), alive: t.alive, invisible: t.invisible || undefined })),
      bullets: lastBullets.filter((b) => inside(b.x, b.y, 0.45)).map((b) => ({ x: r2(b.x), y: r2(b.y), rocket: b.rocket || undefined })),
      mines: lastMines.filter((m) => inside(m.x, m.y, 0.1)).map((m) => ({ x: r2(m.x), y: r2(m.y), blinking: m.blink })),
      tiles: cells.slice(0, 40),
    };
  },
  context() {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean).map((p) => p!.id);
    const me = lastTanks.find((t) => t.id === myTankId);
    return {
      game: {
        iteration: META.iteration,
        iterationTitle: META.title,
        screen,
        online,
        room: roomCode || undefined,
        mode: online ? currentMode : 'démo',
        phase: online ? phase : undefined,
        mission: online ? currentMission : attractOpts.mission,
        level: online ? currentLevelName : undefined,
        lives: online && coopLike(currentMode) ? lives : undefined,
        daily: online ? dailyState : undefined,
        scores: online && currentMode === 'versus' ? scores : undefined,
        players: lobbyPlayers.map((p) => ({ name: p.name, host: p.host, connected: p.connected, me: p.id === pid || undefined })),
        me: me ? { x: r2(me.x), y: r2(me.y), alive: me.alive, pendingInputs: pending.length } : undefined,
        tanks: lastTanks.map((t) => ({ ...tankLabel(t.id), x: r2(t.x), y: r2(t.y), alive: t.alive })),
        bullets: lastBullets.length,
        mines: lastMines.length,
        tick: online ? latestK : undefined,
        recentEvents: eventLog.slice(-40),
      },
      network: { pingMs: ping, snapshotsBuffered: snaps.length, socket: ws ? ['connexion', 'ouvert', 'fermeture', 'fermé'][ws.readyState] : 'aucun' },
      perf: { fps: Math.round(fps) },
      device: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        viewport: `${innerWidth}x${innerHeight}`,
        screen: `${screen_.width}x${screen_.height}`,
        dpr: devicePixelRatio,
        touch: controls.touchMode,
        gamepads: pads,
        memoryGb: nav.deviceMemory,
        cores: navigator.hardwareConcurrency,
        gl: renderer.glInfo(),
      },
      errors: errorLog.slice(),
      url: location.href,
      time: new Date().toISOString(),
    };
  },
});
const screen_ = window.screen;

// ------------------------------------------------------------------ debug + demo hooks (smoke tests and videos)

const params = new URLSearchParams(location.search);
(window as unknown as { __debug: unknown }).__debug = {
  get state() {
    return { screen, phase, online, snaps: snaps.length, latestK, myTankId, room: roomCode, iteration: META.iteration, attract: attractState };
  },
};
if (params.has('demo')) {
  document.body.classList.add('demo');
  const demo = {
    meta: META,
    /** `night`: force the mission into the dark (true) or daylight (false); its own setting when omitted. */
    play(mission: number, heroes = true, rich = false, bossHp?: number, night?: boolean, arms?: Weapon[]) {
      attract = undefined;
      startAttract({ mission, heroes, rich, bossHp, night, arms: arms?.filter(isWeapon) });
    },
    /** Show the lobby and its arsenal for a moment, flipping through the cannons (for the videos). */
    arsenal(ms = 6000) {
      const keep = { players: lobbyPlayers, weapon: myWeapon, best: bestMission, room: roomCode };
      const fake = ['canon', 'fusee', 'ricochet', 'sapeur'] as const;
      lobbyPlayers = fake.map((w, i) => ({ id: i ? `demo${i}` : pid, name: i ? FUN_NAMES[(i * 7) % FUN_NAMES.length] + (20 + i * 13) : myName, color: PLAYER_COLORS[i], host: !i, connected: true, score: 0, weapon: w }));
      lobbyMode = 'coop';
      bestMission = 16;
      roomCode = 'DEMO7';
      renderLobby();
      show('lobby');
      let k = 0;
      const flip = setInterval(() => { myWeapon = WEAPONS[++k % WEAPONS.length]; renderLobby(); }, Math.max(700, ms / 6));
      setTimeout(() => {
        clearInterval(flip);
        lobbyPlayers = keep.players; myWeapon = keep.weapon; bestMission = keep.best; roomCode = keep.room;
        show('game');
        $('#hud').hidden = true;
      }, ms);
    },
    /** Play a stage of a daily challenge: today's, or the nearest day that has the given twist. */
    daily(stage = 1, twist?: DailyTwist) {
      let day = dayNumber();
      if (twist) for (let k = 0; k < 7 && dailyTwist(day) !== twist; k++) day++;
      attract = undefined;
      startAttract({ heroes: true, daily: { day, stage } });
      const lvl = dailyLevel(day, stage);
      banner(`Défi du jour · étape ${stage}/${DAILY_STAGES}`, lvl.name, TWIST_INFO[dailyTwist(day)].label, `intro daily${lvl.night ? ' night' : ''}`);
      setTimeout(hideBanner, 2600);
      return day;
    },
    /** Show the home screen (and its daily challenge card) over the demo for a moment. */
    home(ms = 4000) {
      show('home');
      setTimeout(() => { show('game'); $('#hud').hidden = true; }, ms);
    },
    /** Land a hit on the boss (to show its health bar and its anger on camera). */
    hitBoss() {
      for (const t of attract?.tanks ?? []) if (t.alive && t.boss) { t.buffs.invuln = 0; attract!.killTank(t, undefined); }
    },
    /** Make the boss charge its ring of shells right now (to catch it on camera). */
    volley() {
      for (const t of attract?.tanks ?? []) if (t.alive && t.boss && t.boss.warn <= 0) t.boss.volleyT = 0;
    },
    /** Send every hero tank to the nearest portal (to show a jump on camera). */
    portal() {
      if (!attract) return;
      const g = attract;
      const cells = g.tiles.map((t, i) => (isPortal(t) ? i : -1)).filter((i) => i >= 0);
      for (const t of g.tanks) {
        if (!t.alive || t.kind !== 'player' || !t.ai || !cells.length) continue;
        const d = (c: number) => Math.hypot((c % W) + 0.5 - t.x, Math.floor(c / W) + 0.5 - t.y);
        t.ai.goal = cells.reduce((a, b) => (d(a) <= d(b) ? a : b));
        t.ai.path = [];
        t.ai.pathT = 0;
      }
    },
    /** Drop a bonus crate (random kind if omitted) somewhere free in the demo arena. */
    crate(kind?: BonusKind) {
      return !!attract?.spawnBonus(kind && BONUS_KINDS.includes(kind) ? kind : undefined);
    },
    /** Hand a bonus straight to every hero tank (to show it on camera). */
    buff(kind: BonusKind) {
      if (!attract || !BONUS_KINDS.includes(kind)) return;
      for (const t of attract.tanks) if (t.alive && t.kind === 'player') attract.giveBonus(t, kind);
    },
    caption(text: string, sub = '') {
      const c = $('#demo-caption');
      c.innerHTML = text ? `<b>${escapeHtml(text)}</b>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}` : '';
      c.hidden = !text;
    },
    title() {
      banner(`Itération ${META.iteration}`, 'TANKS!', META.title, 'intro');
      setTimeout(hideBanner, 3000);
    },
    get state() { return attractState; },
  };
  (window as unknown as { __demo: unknown }).__demo = demo;
  show('game');
  $('#hud').hidden = true;
  demo.play(Number(params.get('mission')) || 1);
} else {
// boot
const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})/);
startAttract();
void loadDaily();
if (m) {
  connect(m[1].toUpperCase());
  show('lobby');
} else show('home');
}
