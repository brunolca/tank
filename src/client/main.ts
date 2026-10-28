import { DT, ENEMY_COLORS, PLAYER_COLORS, SPECS, TANK_R, TICK_RATE, Tile, W } from '../shared/constants';
import { getMission } from '../shared/levels';
import META from '../shared/meta.json';
import { angDiff } from '../shared/physics';
import type { ClientMsg, GameEvent, Input, Mode, NetBullet, NetMine, NetTank, Phase, PlayerInfo, Results, ServerMsg, TankInfo } from '../shared/protocol';
import { Game, driveStep } from '../shared/sim';
import { initAudio, isMusicOn, setMusicIntensity, sfx, startMusic, toggleMusic } from './audio';
import { setupFeedback, type Region } from './feedback';
import { Controls } from './input';
import { Renderer, type RBullet, type RMine, type RTank } from './render';

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

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

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
let phase: Phase = 'lobby';
let ping = 0;

function send(msg: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function sendHello() {
  send({ t: 'hello', name: myName, color: myColor });
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

interface Snap { k: number; a: number; T: Map<number, NetTank>; B: Map<number, NetBullet>; M: NetMine[]; at: number }

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
let currentMode: Mode = 'coop';
let lives = 3;
let scores: Record<string, number> = {};
const INTERP = 3;
let lastTanks: RTank[] = [];
let lastBullets: RBullet[] = [];
let lastMines: RMine[] = [];
let currentMission = 0;
let currentLevelName = '';

function onMessage(msg: ServerMsg) {
  switch (msg.t) {
    case 'welcome':
      roomCode = msg.room || roomCode;
      $('#room-code').textContent = roomCode;
      break;
    case 'lobby': {
      lobbyPlayers = msg.players;
      lobbyMode = msg.mode;
      phase = msg.phase;
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
  snaps = [];
  evq = [];
  pending = [];
  latestK = renderTick = msg.tick;
  offset = { x: 0, y: 0 };
  lives = msg.lives;
  currentMission = msg.mission;
  currentLevelName = msg.name;
  renderer.setLevel(tiles, msg.tanks);
  show('game');
  setMusicIntensity(0);
  $('#hud-mission').innerHTML = msg.mode === 'coop'
    ? `<b>Mission ${msg.mission}</b><span>${escapeHtml(msg.name)}</span>`
    : `<b>Manche ${msg.mission}</b><span>Versus · premier à 5</span>`;
  $('#hud').dataset.mode = msg.mode;
  const enemies = msg.tanks.filter((t) => t.team === 99);
  if (msg.mode === 'coop') {
    const kinds = [...new Set(enemies.map((e) => e.kind))];
    banner(`Mission ${msg.mission}`, msg.name, `Tanks ennemis : ${enemies.length}`, 'intro');
    const sub = $('#banner .b-sub');
    sub.innerHTML += `<div class="b-tanks">${kinds.map((k) => `<span style="--c:${hex(ENEMY_COLORS[k])}">${SPECS[k].label}</span>`).join('')}</div>`;
  } else {
    banner(`Manche ${msg.mission}`, 'Versus', 'Le dernier tank debout gagne la manche', 'intro');
  }
  if (myTankId < 0) toast('Partie en cours : tu rejoindras à la prochaine manche.', 4000);
}

function onPhase(msg: Extract<ServerMsg, { t: 'phase' }>) {
  const prev = phase;
  phase = msg.phase;
  lives = msg.lives;
  if (msg.scores) scores = msg.scores;
  renderHud();
  if (prev === msg.phase && msg.phase === 'playing') return;
  switch (msg.phase) {
    case 'intro':
      sfx.jingle('start');
      break;
    case 'playing':
      hideBanner();
      setMusicIntensity(1);
      break;
    case 'cleared':
      setMusicIntensity(0);
      sfx.jingle('clear');
      banner('Bravo !', 'Mission réussie', msg.mission % 5 === 0 ? 'Vie bonus à la prochaine mission !' : '', 'good');
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
  const s: Snap = { k: msg.k, a: msg.a, T: new Map(msg.T.map((t) => [t[0], t])), B: new Map(msg.B.map((b) => [b[0], b])), M: msg.M, at: performance.now() };
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
  [x, y, body] = driveStep(tiles, x, y, body, mx, my, SPECS.player.speed, DT);
  // treat other tanks as static obstacles
  const snap = s ?? snaps[snaps.length - 1];
  if (snap) {
    for (const t of snap.T.values()) {
      if (t[0] === myTankId || !(t[5] & 1)) continue;
      const dx = x - t[1], dy = y - t[2];
      const d = Math.hypot(dx, dy);
      if (d < TANK_R * 2 && d > 1e-4) { x = t[1] + (dx / d) * TANK_R * 2; y = t[2] + (dy / d) * TANK_R * 2; }
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
    if (inp.f && localFireCd <= 0) {
      let own = 0;
      for (const b of last.B.values()) if (b[6] === myTankId) own++;
      if (own < SPECS.player.maxBullets) {
        localFireCd = SPECS.player.fireCd;
        sfx.shot(false);
        const tip = TANK_R + 0.22;
        renderer.muzzle(px + Math.cos(aimAng) * tip, py + Math.sin(aimAng) * tip, aimAng, false, myTankId);
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
      tanks.push({ id: ta[0], x: pred.x + offset.x, y: pred.y + offset.y, body: pred.body, turret: latest[5] & 1 ? aimAng : latest[4], alive, invisible: false });
      continue;
    }
    tanks.push({ id: ta[0], x: lerp(ta[1], tb[1], u), y: lerp(ta[2], tb[2], u), body: lerpAng(ta[3], tb[3], u), turret: lerpAng(ta[4], tb[4], u), alive, invisible: !!(ta[5] & 2) });
  }
  renderer.syncTanks(tanks, myTankId, dt);
  lastTanks = tanks;
  $('#hud-enemies').textContent = currentMode === 'coop' ? `${enemiesAlive} ennemi${enemiesAlive > 1 ? 's' : ''}` : '';

  // bullets: interpolate everyone else's, extrapolate our own from the freshest state
  const bullets: RBullet[] = [];
  const latest = snaps[snaps.length - 1];
  const ahead = Math.min(0.15, (performance.now() - latest.at) / 1000 + ping / 2000);
  for (const bl of latest.B.values()) {
    if (bl[6] !== myTankId) continue;
    bullets.push({ id: bl[0], x: bl[1] + bl[3] * ahead, y: bl[2] + bl[4] * ahead, vx: bl[3], vy: bl[4], rocket: !!bl[5] });
  }
  for (const ba of a.B.values()) {
    if (ba[6] === myTankId) continue;
    const bb = b.B.get(ba[0]);
    if (!bb) { bullets.push({ id: ba[0], x: ba[1] + ba[3] * u * DT * (b.k - a.k), y: ba[2] + ba[4] * u * DT * (b.k - a.k), vx: ba[3], vy: ba[4], rocket: !!ba[5] }); continue; }
    bullets.push({ id: ba[0], x: lerp(ba[1], bb[1], u), y: lerp(ba[2], bb[2], u), vx: bb[3], vy: bb[4], rocket: !!ba[5] });
  }
  renderer.syncBullets(bullets, dt);
  lastBullets = bullets;
  const mines: RMine[] = a.M.map((m) => ({ id: m[0], x: m[1], y: m[2], blink: !!m[3] }));
  renderer.syncMines(mines);
  lastMines = mines;
  updateNameTags(tanks);
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
      renderer.explosion(e[1], e[2], false, renderer.tankColor(e[3]));
      if (audible) sfx.boom(false);
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
  }
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
  livesEl.innerHTML = currentMode === 'coop' ? `<span class="tank-ico"></span> × ${lives}` : '';
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
    return `<li style="--c:${hex(p.color)}" class="${p.connected ? '' : 'off'}"><i></i><span>${escapeHtml(p.name)}${p.id === pid ? ' <em>(toi)</em>' : ''}</span>${p.host ? '<b class="host">Hôte</b>' : ''}</li>`;
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
  $('#mode-desc').textContent = lobbyMode === 'coop'
    ? 'Campagne coopérative : 16 missions faites main puis missions générées à l’infini. Vies partagées, +1 vie toutes les 5 missions.'
    : 'Chacun pour soi : le dernier tank debout marque un point. Premier à 5 manches.';
  renderHud();
}

function showResults(r: Results) {
  const kinds = Object.keys(SPECS).filter((k) => k !== 'player') as (keyof typeof SPECS)[];
  const title = r.mode === 'coop' ? `Partie terminée · Mission ${r.mission}` : `${r.players[0]?.name ?? ''} remporte le versus !`;
  $('#results-title').textContent = title;
  $('#results-body').innerHTML = `
    <table>
      <thead><tr><th>Joueur</th>${r.mode === 'coop' ? kinds.map((k) => `<th title="${SPECS[k].label}"><i class="dot" style="--c:${hex(ENEMY_COLORS[k])}"></i></th>`).join('') : '<th>Kills</th>'}<th>Morts</th><th>${r.mode === 'coop' ? 'Total' : 'Manches'}</th></tr></thead>
      <tbody>${r.players
        .map((p) => {
          const kills = Object.values(p.kills).reduce((s, v) => s + (v ?? 0), 0);
          return `<tr><td><i class="dot" style="--c:${hex(p.color)}"></i>${escapeHtml(p.name)}</td>${
            r.mode === 'coop' ? kinds.map((k) => `<td>${p.kills[k] ?? '·'}</td>`).join('') : `<td>${kills}</td>`
          }<td>${p.deaths}</td><td><b>${p.score}</b></td></tr>`;
        })
        .join('')}</tbody>
    </table>`;
  show('results');
}

// ------------------------------------------------------------------ attract mode (background demo)

let attract: Game | undefined;
let attractEnd = 0;
let attractPrev = new Map<number, { x: number; y: number; body: number; turret: number }>();

interface AttractOpts { mission?: number; heroes?: boolean }
let attractOpts: AttractOpts = {};

function startAttract(opts: AttractOpts = attractOpts) {
  if (attract) return;
  attractOpts = opts;
  const lvl = getMission(opts.mission ?? 2 + Math.floor(Math.random() * 14));
  const g = new Game(lvl.tiles);
  if (opts.heroes) {
    // player-coloured tanks driven by the AI: used by the gameplay videos
    lvl.spawns.forEach(([x, y], i) => {
      const t = g.addTank('player', 1, x, y, PLAYER_COLORS[i % PLAYER_COLORS.length]);
      g.enableAI(t, { skill: 2, turretSpeed: 5, fireCd: 0.4 });
    });
  } else {
    const left = ['pink', 'violet', 'ash'] as const;
    lvl.spawns.forEach(([x, y], i) => g.addTank(left[i % left.length], 1, x, y, 0));
  }
  lvl.enemies.forEach((e) => g.addTank(e.kind === 'white' && !opts.heroes ? 'ash' : e.kind, 2, e.x, e.y, 0));
  g.frozen = false;
  attract = g;
  attractEnd = 0;
  attractPrev.clear();
  renderer.setLevel(g.tiles, g.tankInfos());
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
    return { id: t.id, x: lerp(p.x, t.x, u), y: lerp(p.y, t.y, u), body: lerpAng(p.body, t.body, u), turret: lerpAng(p.turret, t.turret, u), alive: t.alive, invisible: false };
  });
  renderer.syncTanks(tanks, -1, dt);
  lastTanks = tanks;
  renderer.syncBullets(g.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, rocket: b.rocket })), dt);
  renderer.syncMines(g.mines.map((m) => ({ id: m.id, x: m.x, y: m.y, blink: m.fuse >= 0 })));
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

$('#btn-create').addEventListener('click', async () => {
  sfx.click();
  const btn = $<HTMLButtonElement>('#btn-create');
  btn.disabled = true;
  try {
    const r = await fetch('/api/new').then((r) => r.json() as Promise<{ room: string }>);
    connect(r.room);
    show('lobby');
  } catch {
    toast('Serveur injoignable');
  } finally {
    btn.disabled = false;
  }
});

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
        lives: online && currentMode === 'coop' ? lives : undefined,
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
    play(mission: number, heroes = true) {
      attract = undefined;
      startAttract({ mission, heroes });
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
if (m) {
  connect(m[1].toUpperCase());
  show('lobby');
} else show('home');
}
