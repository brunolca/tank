import { type TankKind, isMirror, isSolidTank as isSolidTankTile, BULLET_SPEED, GATE_COLORS, gateUp, isDrawbridge, isSnowman, reverseBelts, isSolidBullet, MORTAR_MAX, MORTAR_MIN, MORTAR_WARN, EMOTES, EMOTE_GAP, EMOTE_TIME, SEED_BLINK, BONUS_INFO, BONUS_KINDS, ICE, SAND, SNOW, PACKED, QUICK, KO_QUICK, isBossKind, CHECKPOINT_EVERY, DT, ENEMY_COLORS, enemyColor, specOf, FLAG_ALERT, FLAG_CHARGING, FLAG_FROZEN, SHELL_HEAVY, SHELL_GHOST, PLAYER_COLORS, SPECS, TANK_R, TICK_RATE, TURBO_MULT, Tile, W, H, WEAPONS, WEAPON_INFO, isPortal, isTunnel, isWeapon, playerSpec, tankRadius, type BonusKind, type TankSpec, type Weapon } from '../shared/constants';
import { ATELIER_LIVES, ATELIER_SAMPLE, atelierKinds, atelierLevel, decodeAtelier, encodeAtelier } from '../shared/atelier';
import { applyTwist, DAILY_STAGES, DAILY_TWISTS, dailyLevel, dailyTwist, dayLabel, dayNumber, formatTicks, TWIST_INFO, type DailyTwist } from '../shared/daily';
import { EXTRA_LEVELS, LEVELS, getMission, nearestFree, versusArena, type ParsedLevel } from '../shared/levels';
import { CTF_RESPAWN, CTF_ROUND, CTF_TARGET, TEAM_COLORS, TEAM_NAMES, TEAM_TANK_COLORS, ctfArena, ctfTeam, newFlags, type NetFlag } from '../shared/drapeau';
import { GOLD_COLOR, HUNT_GOLD, HUNT_GOLD_AT, HUNT_HURRY, HUNT_RESPAWN, HUNT_ROUND, HUNT_TARGET, huntArena, newHunt, HUNT_CRATES } from '../shared/caisses';
import { CROWN_COLOR, CROWN_HOLD, CROWN_HURRY, CROWN_RESPAWN, CROWN_RETURN, CROWN_ROUND, CROWN_TARGET, crownArena, newCrown } from '../shared/couronne';
import { PETARD_COLOR, PETARD_SPEED, PETARD_TARGET, PETARD_WARN, newPetard, petardArena } from '../shared/petard';
import { BALL_HURRY, BALL_RESPAWN, BALL_ROUND, BALL_TARGET, ballArena, goalOf, newBall } from '../shared/ballon';
import { MAX_RIVALS, RIVAL_LEVELS, RIVAL_NAMES, isRivalId, makeRival, rivalLevel, rivalMode } from '../shared/rivals';
import META from '../shared/meta.json';
import { angDiff, beltStep, castRicochet, floorSpeed, segCircle } from '../shared/physics';
import { BOSS_NAMES, RUSH_DUO_HP, RUSH_LIVES, RUSH_STAGES, rushLevel, rushOrder, rushDuo, weekLabel, weekNumber } from '../shared/rush';
import type { BossKind } from '../shared/levels';
import type { AtelierMap, BoardDay, ClientMsg, DailyState, RushState, GameEvent, Input, Mode, NetBonus, NetBullet, NetMine, NetTank, Phase, PlayerInfo, Results, ServerMsg, TankInfo } from '../shared/protocol';
import { Game, driveStep, slideDrive, type Tank } from '../shared/sim';
import { BRANCHES, TRAINING_SECONDS, XP_PER_GALON, canBuy, cleanRanks, canBuyAny, freeGalons, trainSpec, type Progress, type Ranks } from '../shared/skills';
import { renderTree } from './skills';
import { COUNCIL_SECONDS, TAUPE_MIN_PLAYERS, TAUPE_STAGES, VERDICT_SECONDS, taupeLevel, type CouncilState } from '../shared/taupe';
import { initAudio, isMusicOn, setMusicIntensity, setRain, setVolume, setWind, sfx, startMusic, toggleMusic, volumes, windGust } from './audio';
import { gustAt, windAngle, windWords } from '../shared/wind';
import { SQUALL_WARN, squallIn, whiteoutAt } from '../shared/blizzard';
import { setupFeedback, type Region } from './feedback';
import { Controls } from './input';
import { EMOTE_ICONS, hydrateIcons, icon } from './icons';
import { Reticle, plainEnemies, renderEnemyTokens, renderTeam, type EnemyToken, type Mate } from './hud';
import { Workshop, cellImage, drawMap } from './atelier';
import { Renderer, type RBonus, type RBullet, type RFlag, type RLob, type RMine, type RTank } from './render';
import { Film, REPLAYED, koCaption, type Reel } from './replay';
import { padNav } from './padnav';
import { hideBrief, hideSheet, playSheet, saveStars, sheetLength, sheetWaiting, showBrief, showSheet, starRecord, starTotal, type SheetView } from './bilan';
import { TallyCount, cleanTally, parSeconds, shotBudget, starCount, type Tally } from '../shared/bilan';

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
renderer.onFogHorn = () => { if (screen === 'game') sfx.foghorn(); }; // a foghorn far away, on foggy tables (iteration 26)
const controls = new Controls(canvas, (x, y) => renderer.screenToArena(x, y), $('#mine-btn'));
hydrateIcons(); // « Les finitions » (iteration 46): the SVG icons of the page

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
const coopLike = (m: Mode) => m !== 'versus' && m !== 'drapeau' && m !== 'caisses' && m !== 'couronne' && m !== 'ballon' && m !== 'petard';
/** Free-for-all modes that need at least two tanks (rivals count). */
const needsTwo = (m: Mode) => m === 'versus' || m === 'drapeau' || m === 'caisses' || m === 'couronne' || m === 'ballon' || m === 'petard';
/** Modes played Bleus against Rouges: « Drapeaux » (iteration 24) and « Le ballon » (iteration 55). */
const teamPlay = (m: Mode) => m === 'drapeau' || m === 'ballon';

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

type Screen = 'home' | 'lobby' | 'game' | 'results' | 'atelier';
let screen: Screen = 'home';
function show(s: Screen) {
  if (s === 'home' && screen !== 'home') void loadDaily();
  screen = s;
  $('#home').hidden = s !== 'home';
  $('#lobby').hidden = s !== 'lobby';
  $('#results').hidden = s !== 'results';
  $('#atelier').hidden = s !== 'atelier';
  $('#hud').hidden = s !== 'game';
  document.body.dataset.screen = s;
  if (s !== 'game') { hideBrief(false); hideSheet(); controls.cancelWheel(); }
  renderer.camScreen(s === 'game' || s === 'atelier' ? 'play' : 'shelf'); // « Les finitions » (iteration 46): the camera flies between the screens
  if (s !== 'game') { $('#menu').hidden = true; $('#council').hidden = true; council = undefined; setRain(false); setWind(false); }
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
let wantMode: Mode | undefined; // « Relever le défi » (or « Lancer la ronde », iteration 28) from the home screen: switch the new room to that mode
let quickPlay = false; // « Jouer » on the home screen (iteration 43): the new room starts the campaign at once, with an AI teammate
let quickStarting = false; // … and the lobby stays hidden until the first level arrives
let wantAtelier: AtelierMap | undefined; // « Jouer en ligne » from the workshop: hand the mission to the new room
let lobbyAtelier: AtelierMap | undefined; // the workshop mission of the room (iteration 14)
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
  const sock = new WebSocket(`${proto}://${location.host}/api/room/${roomCode}/ws?pid=${encodeURIComponent(pid)}&v=${META.iteration}`);
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
  quickPlay = quickStarting = false;
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

interface Snap { k: number; a: number; T: Map<number, NetTank>; B: Map<number, NetBullet>; M: NetMine[]; P: NetBonus[]; F: NetFlag[]; L: number[][]; C?: number[]; O?: number[]; D: Map<number, number[]>; at: number } // D: « L’Illusionniste » (iteration 58), its mirages by id: [owner, x, y, body, turret]

let online = false;
let tiles: number[] = [];
let belts: number[] = []; // conveyor belts of the current level (iteration 16), empty when it has none
let infos = new Map<number, TankInfo>();
let myTankId = -1;
let snaps: Snap[] = [];
let evq: { k: number; e: GameEvent }[] = [];
let renderTick = 0;
/** Wind of the mission being played (iteration 23): where it mainly blows, undefined on a calm table. */
let levelWind: number | undefined;
let windSoundT = 0;
/** Fog (iteration 26): the seed of the banks of mist of the current level, undefined on a clear table. */
let levelFog: number | undefined;
/** « Le blizzard » (iteration 54): squalls on this table, and the squall last announced (its starting tick). */
let levelBlizzard = false;
let squallSaid = -1;
let latestK = 0;
let pending: Input[] = [];
let seq = 0;
let pred = { x: 0, y: 0, body: 0, vx: 0, vy: 0 }; // vx, vy: the speed we slide at on the ice (iteration 21)
let iceMap = false; // some floor cells of the current level are ice (or a Givré may frost them, iteration 31)
let mapIce = false; // the map itself has ice (the « Glace » label and hint)
/** « La neige » (iteration 42): the snow cells of the current level (deep or packed, as the snapshots say). */
let snowCells: number[] = [];
/** « Le Givré » (iteration 31): frost cells currently laid over the floor layer (they are ICE in `belts` while they last). */
let frostCells: number[] = [];
let offset = { x: 0, y: 0 };
let tunnelHinted = false; // the « hidden in the tunnel » hint shows once per mission
let aimAng = 0;
let localFireCd = 0;
let mySpec: TankSpec = SPECS.player; // our tank's sheet with its cannon (prediction of speed, ammo, fire rate)
let enemiesLeft = -1; // coop: enemies left according to the last phase message (0: cease-fire)
let currentMode: Mode = 'coop';
let lives = 3;
let scores: Record<string, number> = {};
let teamScores: [number, number] = [0, 0]; // « Drapeaux » (iteration 24): rounds won by the Bleus and the Rouges
let myTeam = 0; // « Drapeaux »: my team (1 Bleus, 2 Rouges), 0 elsewhere
let ctfBases: [number, number][] | undefined; // « Drapeaux »: the bases of the round
let ctfLeft = CTF_ROUND; // « Drapeaux »: seconds left in the round when the last phase message came
let ctfLeftAt = 0;
/** « La chasse aux caisses » (iteration 37): crates of each tank this round (tank id → crates), from the snapshots. */
let huntGot = new Map<number, number>();
let huntKey = '';
const HUNT_RESPAWN_TXT = String(HUNT_RESPAWN).replace('.', ','); // « 2,5 »
/** « La couronne » (iteration 50): its cushion, and each tank's reign this round in tenths of a second (tank id → tenths), from the snapshots. */
/** « Le pétard » (iteration 61): who carries the lit firecracker (0: nobody), its fuse in tenths (when the snapshot came), the fuse it had, and the handovers of each tank this round. */
let petardHudTxt = '';
let petardHolder = 0, petardFuse = 0, petardLen = 0, petardAt = 0, petardKey = '';
let petardPasses = new Map<number, number>();
let crownHome: [number, number] | undefined;
let crownHeld = new Map<number, number>();
let crownHolder = 0;
let crownKey = '';
const CROWN_RESPAWN_TXT = String(CROWN_RESPAWN).replace('.', ',');
/** « Le ballon » (iteration 55): there is a ball on the table this round (it comes with the snapshots). */
let ballOn = false;
const BALL_RESPAWN_TXT = String(BALL_RESPAWN).replace('.', ',');
const INTERP = 3;
let lastTanks: RTank[] = [];
let lastBullets: RBullet[] = [];
let lastMines: RMine[] = [];
let currentMission = 0;
let currentLevelName = '';
let dailyState: DailyState | undefined; // daily challenge in progress (stage, fighting time)
let dailyK = 0; // server tick when dailyState arrived, to run the clock between messages
let rushState: RushState | undefined; // « La ronde des boss » in progress (iteration 28): its clock runs like the daily one
let myRole: boolean | undefined; // mole mode: true when this player is the mole
let council: CouncilState | undefined; // mole mode: the vote in progress
let councilAt = 0; // performance.now() when the council state arrived (its timer runs locally)
let myVote: string | undefined; // our ballot in the council in progress
let prog: Record<string, Progress> = {}; // coop campaign (iteration 19): everyone's experience, galons and skills
let training: string[] = []; // end of a mission: players still choosing their skills
let treeOpen = false; // the skill tree card is on screen
let treeDue = 0; // « Le bilan » (iteration 45): when the skill tree opens, once the sheet has counted (0: not waiting)
let treeAuto = false; // it opened by itself at the end of a mission (and closes with it)
let treeEnd = 0; // performance.now() when the end-of-mission choice runs out
let treeFlash: number | undefined; // branch just bought, for a little pop
let treeDemo: Progress | undefined; // the demo shows a made-up tree

function onMessage(msg: ServerMsg) {
  switch (msg.t) {
    case 'welcome':
      roomCode = msg.room || roomCode;
      $('#room-code').textContent = roomCode;
      // the server is newer (or older) than this tab: ask for a reload instead of playing with mismatched rules
      if (msg.v && msg.v !== META.iteration) toast(`Une nouvelle version de Tanks! est en ligne (itération ${msg.v}) : recharge la page pour en profiter.`, 15000);
      break;
    case 'lobby': {
      lobbyPlayers = msg.players;
      lobbyMode = msg.mode;
      lobbyFrom = msg.from ?? 1;
      phase = msg.phase;
      lobbyAtelier = msg.atelier;
      if (wantMode && msg.players.find((p) => p.id === pid)?.host && msg.phase === 'lobby') {
        if (msg.mode !== wantMode) send({ t: 'mode', mode: wantMode });
        wantMode = undefined;
      }
      if (quickPlay && msg.players.find((p) => p.id === pid)?.host && msg.phase === 'lobby') {
        quickPlay = false;
        quickStarting = true;
        if (msg.mode !== 'coop') send({ t: 'mode', mode: 'coop' });
        if (!msg.players.some((p) => isRivalId(p.id))) send({ t: 'rival', op: 'add' });
        send({ t: 'start' });
        break; // the level follows: no flash of the lobby
      }
      if (wantAtelier && msg.players.find((p) => p.id === pid)?.host && msg.phase === 'lobby') {
        send({ t: 'atelier', ...wantAtelier });
        wantAtelier = undefined;
      }
      renderLobby();
      if (msg.phase === 'lobby' && screen !== 'results' && screen !== 'atelier' && !quickStarting) { online = false; show('lobby'); hideBanner(); startAttract(); }
      break;
    }
    case 'level':
      quickStarting = false;
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
      if (quickStarting) { quickStarting = false; show('lobby'); }
      break;
    case 'role':
      myRole = msg.mole;
      renderRole();
      if (currentMission <= 1 && phase !== 'playing') showRoleBanner(msg.mole);
      break;
  }
}

function startLevel(msg: Extract<ServerMsg, { t: 'level' }>) {
  stopAttract();
  stopReel();
  film.clear();
  clearBubbles();
  online = true;
  currentMode = msg.mode;
  if (msg.mode !== 'taupe') myRole = undefined;
  tiles = msg.tiles.slice();
  belts = Array.isArray(msg.belts) && msg.belts.length === W * H ? msg.belts.map((b) => b | 0) : [];
  mapIce = belts.includes(ICE);
  snowCells = belts.flatMap((b, i) => (b === SNOW || b === PACKED ? [i] : []));
  frostCells = [];
  const frosty = msg.tanks.some((t) => t.kind === 'frost'); // its frost turns the table into an ice table, as on the server
  if (frosty && !belts.length) belts = new Array(W * H).fill(0);
  iceMap = mapIce || frosty;
  infos = new Map(msg.tanks.map((t) => [t.id, t]));
  myTankId = msg.tanks.find((t) => t.pid === pid)?.id ?? -1;
  const myInfo = msg.tanks.find((t) => t.id === myTankId);
  mySpec = trainSpec(playerSpec(myInfo?.w ?? 'canon'), myInfo?.sk); // skills of the campaign tree count too (more shells)
  enemiesLeft = -1;
  if (msg.mode === 'coop' && msg.mission > bestMission) {
    bestMission = msg.mission;
    try { localStorage.setItem('tanks.best', String(bestMission)); } catch {}
  }
  snaps = [];
  evq = [];
  pending = [];
  tunnelHinted = false;
  latestK = renderTick = msg.tick;
  offset = { x: 0, y: 0 };
  lives = msg.lives;
  currentMission = msg.mission;
  currentLevelName = msg.name;
  renderer.setLevel(tiles, msg.tanks, belts, msg.rail);
  renderer.setFrost(undefined);
  huntGot = new Map(); huntKey = '';
  if (msg.mode === 'caisses') { ctfLeft = HUNT_ROUND; ctfLeftAt = performance.now(); }
  // « La couronne » (iteration 50): the crown on its cushion
  const ch = msg.mode === 'couronne' && Array.isArray(msg.crown) && msg.crown.length >= 2 ? [Number(msg.crown[0]), Number(msg.crown[1])] : undefined;
  crownHome = ch && ch.every(Number.isFinite) ? [ch[0], ch[1]] : undefined;
  crownHeld = new Map(); crownHolder = 0; crownKey = '';
  renderer.setCrown(crownHome);
  if (msg.mode === 'couronne') { ctfLeft = CROWN_ROUND; ctfLeftAt = performance.now(); }
  petardHolder = petardFuse = petardLen = 0; petardKey = ''; petardHudTxt = ''; petardPasses = new Map();
  renderer.setPetard(msg.mode === 'petard');
  // « Drapeaux » (iteration 24): the two bases, and a ring of the team's colour under each tank
  const bs = msg.mode === 'drapeau' && Array.isArray(msg.bases) && msg.bases.length >= 4 ? msg.bases.map(Number) : undefined;
  ctfBases = bs && bs.every(Number.isFinite) ? [[bs[0], bs[1]], [bs[2], bs[3]]] : undefined;
  myTeam = ctfBases || msg.mode === 'ballon' ? (myInfo?.team ?? 0) : 0;
  renderer.setCtf(ctfBases, (id) => infos.get(id)?.team);
  // « Le ballon » (iteration 55): the ball on the kick-off spot, the goals, the lines of the pitch
  ballOn = msg.mode === 'ballon' && msg.ball === 1;
  renderer.setBall(ballOn, (id) => infos.get(id)?.team);
  if (ballOn) { ctfLeft = BALL_ROUND; ctfLeftAt = performance.now(); }
  renderer.setNight(!!msg.night);
  renderer.setStorm(!!msg.storm);
  levelWind = typeof msg.wind === 'number' && Number.isFinite(msg.wind) ? msg.wind : undefined;
  renderer.setWind(levelWind);
  // the fog (iteration 26): you see through it around you, and around your teammates (in coop, or in your flag team)
  levelFog = typeof msg.fog === 'number' && Number.isFinite(msg.fog) ? msg.fog : undefined;
  renderer.fogAlly = coopLike(msg.mode) ? (id) => infos.get(id)?.team !== 99 : teamPlay(msg.mode) ? (id) => !!myTeam && infos.get(id)?.team === myTeam : undefined;
  renderer.setFog(levelFog);
  levelBlizzard = msg.blizzard === 1 && levelWind !== undefined;
  renderer.setBlizzard(levelBlizzard);
  squallSaid = -1;
  show('game');
  setRain(!!msg.storm);
  setWind(levelWind !== undefined);
  $('#hud-wind').hidden = levelWind === undefined;
  setMusicIntensity(0);
  dailyState = msg.daily;
  rushState = msg.mode === 'rush' ? msg.rush : undefined;
  dailyK = msg.tick;
  $('#hud-mission').innerHTML = msg.daily
    ? `<b>Défi · étape ${msg.daily.stage}/${msg.daily.stages}</b><span>${escapeHtml(msg.name)}</span>`
    : rushState
    ? `<b>Ronde des boss · ${rushState.stage}/${rushState.stages}</b><span>${escapeHtml(msg.name)}</span>`
    : msg.mode === 'taupe'
    ? `<b>La taupe · étape ${msg.mission}/${TAUPE_STAGES}</b><span>${escapeHtml(msg.name)}</span>`
    : msg.mode === 'coop'
    ? `<b>Mission ${msg.mission}</b><span>${escapeHtml(msg.name)}</span>`
    : msg.mode === 'atelier'
    ? `<b>Atelier</b><span>${escapeHtml(msg.name)}</span>`
    : msg.mode === 'drapeau'
    ? `<b>Manche ${msg.mission}</b><span>Drapeaux · premier à ${CTF_TARGET}</span>`
    : msg.mode === 'caisses'
    ? `<b>Manche ${msg.mission}</b><span>Chasse aux caisses · premier à ${HUNT_TARGET}</span>`
    : msg.mode === 'couronne'
    ? `<b>Manche ${msg.mission}</b><span>La couronne · premier à ${CROWN_TARGET}</span>`
    : msg.mode === 'ballon'
    ? `<b>Manche ${msg.mission}</b><span>Le ballon · premier à ${BALL_TARGET} buts</span>`
    : msg.mode === 'petard'
    ? `<b>Manche ${msg.mission}</b><span>Le pétard · premier à ${PETARD_TARGET}</span>`
    : `<b>Manche ${msg.mission}</b><span>Versus · premier à 5</span>`;
  $('#hud').dataset.mode = msg.mode;
  const enemies = msg.tanks.filter((t) => t.team === 99);
  const wx = `${msg.night ? ' · Nuit' : ''}${msg.storm ? ' · Orage' : ''}${mapIce ? ' · Glace' : ''}${belts.includes(QUICK) ? ' · Sables mouvants' : belts.includes(SAND) ? ' · Sable' : ''}${snowCells.length ? ' · Neige' : ''}${levelWind !== undefined ? ' · Vent' : ''}${levelFog !== undefined ? ' · Brouillard' : ''}${levelBlizzard ? ' · Blizzard' : ''}`;
  const wxCls = `${msg.night ? ' night' : ''}${msg.storm ? ' storm' : ''}${mapIce ? ' ice' : ''}${levelWind !== undefined ? ' wind' : ''}${levelFog !== undefined ? ' fog' : ''}${levelBlizzard ? ' blizzard' : ''}`;
  bossFight = enemies.some((e) => isBossKind(e.kind));
  const drillFight = enemies.some((e) => e.kind === 'drill');
  const thunderFight = enemies.some((e) => e.kind === 'thunder');
  const sowerFight = enemies.some((e) => e.kind === 'sower');
  const bombardFight = enemies.some((e) => e.kind === 'bombard');
  const trainFight = enemies.some((e) => e.kind === 'train');
  const magusFight = enemies.some((e) => e.kind === 'magus');
  if (online && coopLike(msg.mode)) meetEnemies(enemies.map((e) => e.kind));
  if (coopLike(msg.mode)) {
    // « Le bilan » (iteration 45): a full-screen briefing, as in the original, instead of the banner
    const rushSt = rushState?.stage ?? msg.mission;
    const b: { kicker: string; big: string; sub: string; cls: string } = msg.daily
      ? { kicker: 'Défi du jour · étape', big: `${msg.daily.stage}/${msg.daily.stages}`, sub: TWIST_INFO[msg.daily.twist]?.label ?? '', cls: 'daily' }
      : msg.mode === 'rush'
      ? (rushSt >= RUSH_STAGES ? { kicker: 'Ronde des boss · le bouquet final', big: `${rushSt}/${RUSH_STAGES}`, sub: 'Deux boss à la fois : sépare-les, et garde un œil sur chacun !', cls: 'boss rush' }
        : { kicker: 'Ronde des boss · boss', big: `${rushSt}/${RUSH_STAGES}`, sub: bossTip(thunderFight, sowerFight, drillFight, bombardFight, trainFight, magusFight), cls: 'boss rush' })
      : msg.mode === 'taupe' ? { kicker: 'La taupe · étape', big: `${msg.mission}/${TAUPE_STAGES}`, sub: '', cls: 'mole' }
      : msg.mode === 'atelier' ? { kicker: 'Atelier · mission maison', big: '', sub: `${ATELIER_LIVES} vies pour en venir à bout`, cls: 'atelier' }
      : bossFight ? { kicker: 'Mission · Boss', big: String(msg.mission), sub: bossTip(thunderFight, sowerFight, drillFight, bombardFight, trainFight, magusFight), cls: 'boss' }
      : { kicker: 'Mission', big: String(msg.mission), sub: '', cls: '' };
    hideBanner();
    hideSheet();
    showBrief({ ...b, name: msg.name, wx: weatherWords(!!msg.night, !!msg.storm), kinds: kindCounts(enemies.map((e) => e.kind)), total: enemies.length,
      record: msg.mode === 'coop' ? starRecord(msg.mission) : undefined, cls: `${b.cls}${wxCls}` }, briefArt, kindLabel);
  } else if (msg.mode === 'drapeau') {
    banner(`Drapeaux · manche ${msg.mission}${wx}`, msg.name,
      `${myTeam ? `Tu joues chez les ${TEAM_NAMES[myTeam - 1]} (${myTeam === 1 ? 'à gauche' : 'à droite'}) : ` : ''}rapporte le drapeau adverse à ta base !`, `intro ctf team${myTeam}${wxCls}`);
  } else if (msg.mode === 'ballon') {
    banner(`Le ballon · manche ${msg.mission}${wx}`, msg.name,
      `${myTeam ? `Tu joues chez les ${TEAM_NAMES[myTeam - 1]} : marque dans le but ${myTeam === 1 ? 'de droite' : 'de gauche'}, ` : 'Marque dans le but adverse, '}à coups d’obus ou de chenilles !`, `intro ctf ball team${myTeam}${wxCls}`);
  } else if (msg.mode === 'caisses') {
    banner(`Chasse aux caisses · manche ${msg.mission}${wx}`, 'Ramasse un max de caisses !',
      `Chaque caisse vaut un point, la caisse dorée en vaut ${HUNT_GOLD}. Touché ? Tu en lâches une.`, `intro hunt${wxCls}`);
  } else if (msg.mode === 'couronne') {
    banner(`La couronne · manche ${msg.mission}${wx}`, 'Prends la couronne et garde-la !',
      `Porte-la ${CROWN_HOLD} secondes en tout pour gagner la manche. Touché ? Elle tombe de ta tête.`, `intro crown${wxCls}`);
  } else if (msg.mode === 'petard') {
    banner(`Le pétard · manche ${msg.mission}${wx}`, 'Refile le pétard avant qu’il éclate !',
      'Fonce dans un tank ou touche-le d’un obus pour le lui passer. Les obus ne font que sonner. Le dernier debout gagne.', `intro petard${wxCls}`);
  } else {
    banner(`Manche ${msg.mission}${wx}`, 'Versus', 'Le dernier tank debout gagne la manche', `intro${wxCls}`);
  }
  if (myTankId < 0) toast('Partie en cours : tu rejoindras à la prochaine manche.', 4000);
  else if (magusFight) setTimeout(() => toast('Le Grand Illusionniste : d’un coup de baguette, il devient quatre. Un seul est vrai ! Chaque fois que tu le touches, il échange sa place avec un mirage : regarde bien où il réapparaît. Ton tank traverse les mirages…', 6000), 2200);
  else if (sowerFight) setTimeout(() => toast('Le Semeur : ses graines mûres l’épargnent, mais une graine touchée par ton obus explose aussitôt… et le blesse s’il est à côté !', 4600), 2200);
  else if (trainFight) setTimeout(() => toast('Le Tortillard : « Tchou-tchou ! » Ne reste jamais sur les rails devant lui. Son chasse-pierres renvoie les obus de face : vise ses flancs, son dos… ou pose une mine sur la voie ! Quand il siffle à l’arrêt, il repart en marche arrière.', 6000), 2200);
  else if (bombardFight) setTimeout(() => toast('Le Bombardier : sa rangée de cercles rouges tombe d’un bout à l’autre. Cours vers lui ou recule… et file sous un tunnel ! De près, il n’a qu’un petit canon.', 5200), 2200);
  else if (thunderFight) setTimeout(() => toast('Le Grondeur : sa foudre ne le touche jamais, mais elle frappe ses alliés. Les tunnels sont tes seuls abris !', 4400), 2200);
  else if (belts.includes(QUICK)) setTimeout(() => toast('Sables mouvants ! Les tourbillons t’aspirent vers leur centre et t’engloutissent si tu t’y attardes : traverse-les vite, sans t’arrêter. Ils avalent aussi les mines… et les ennemis les contournent.', 5600), 2200);
  else if (enemies.some((e) => e.kind === 'conjurer')) setTimeout(() => toast('L’Illusionniste : « Abracadabra ! » Pouf, il se dédouble en trois tanks identiques. Deux sont des mirages : leurs obus ne font que des étoiles… mais lequel est le vrai ? Un obus suffit à dissiper un mirage, et ton tank passe à travers.', 6200), 2200);
  else if (enemies.some((e) => e.kind === 'spectre')) setTimeout(() => toast('Le Spectre : ses obus passent à travers le premier mur qu’ils touchent. Aucun abri ne te protège ! Écoute le « wouuh » d’un obus qui entre dans le mur… et bouge. Il recharge lentement : fonce-lui dessus.', 5600), 2200);
  else if (enemies.some((e) => e.kind === 'watcher')) setTimeout(() => toast(msg.night ? 'Le Veilleur balaie la nuit de son faisceau. S’il t’éclaire, l’alarme sonne, tous les ennemis savent où tu es… et sa fusée suit la lumière : sors du faisceau !' : 'Le Veilleur balaie la table de son faisceau. S’il t’éclaire, l’alarme sonne et sa fusée suit la lumière : sors du faisceau ! Hors de sa lumière, il ne voit rien.', 5400), 2200);
  else if (levelBlizzard) setTimeout(() => toast(coopLike(msg.mode) ? 'Blizzard : toutes les quinze secondes, une bourrasque blanchit la table. Plus personne ne voit à plus de trois cases… les ennemis non plus ! Profite-en pour avancer, et tire entre deux bourrasques.' : 'Blizzard : pendant les bourrasques, personne ne voit à plus de trois cases. Glisse-toi dans le dos des autres… mais chaque tir te trahit !', 6000), 2200);
  else if (levelFog !== undefined) setTimeout(() => toast(coopLike(msg.mode) ? 'Brouillard : au cœur de la brume, un tank ne se voit que de près… ou quand il tire. Les ennemis aussi te perdent de vue !' : 'Brouillard : cache-toi dans la brume ! Chaque tir trahit ta position.', 4600), 2200);
  else if (levelWind !== undefined) setTimeout(() => toast(`Vent : il souffle ${windWords(levelWind!)} et courbe les obus en vol. Vise en amont… ou tire pendant les accalmies, quand la manche à air retombe !`, 4600), 2200);
  else if (msg.storm) setTimeout(() => toast(msg.night ? 'Orage de nuit : quand l’éclair tombe, tout le monde est visible !' : 'Orage : quand le sol crépite, la foudre va tomber. Écarte-toi !', 4000), 2200);
  else if (msg.night) setTimeout(() => toast(coopLike(msg.mode) ? 'Nuit : les ennemis ne te voient que de près… ou quand tu tires !' : 'Nuit : chaque tir trahit ta position.', 4000), 2200);
  else if (tiles.some(isMirror)) setTimeout(() => toast(tiles.includes(Tile.Switch) ? 'Miroirs : un obus qui touche une vitre repart à angle droit, sans perdre de ricochet. Et à chaque « Clac ! » de l’interrupteur, tous les miroirs pivotent d’un quart de tour !' : 'Miroirs : un obus qui touche une vitre repart à angle droit, sans perdre de ricochet. Tire derrière les coins… mais les ennemis le savent aussi !', 5200), 2200);
  else if (tiles.some(isSnowman)) setTimeout(() => toast('Bonshommes de neige : ils avalent les obus sans ricochet. Un obus leur fait perdre la tête, un deuxième les renverse… Abrite-toi derrière les tiens, et ouvre une brèche dans ceux d’en face !', 5600), 2200);
  else if (enemies.some((e) => e.kind === 'mechanic')) setTimeout(() => toast('Le Mécano répare les épaves de ses amis : quelques secondes de clé à molette et le tank repart ! Vise-le en premier… ou pendant qu’il travaille, quand il ne bouge plus.', 5200), 2200);
  else if (enemies.some((e) => e.kind === 'hopper')) setTimeout(() => toast('La Sauterelle se tasse sur ses ressorts… puis bondit par-dessus les murs pour te prendre à revers. Un anneau vert montre où elle va retomber : vise-le ! En l’air, rien ne la touche.', 5200), 2200);
  else if (enemies.some((e) => e.kind === 'mortar')) setTimeout(() => toast('Le Mortier tire en cloche, par-dessus les murs : quand un cercle rouge se resserre sous toi, file ! De près, il ne peut plus rien contre toi.', 5000), 2200);
  else if (enemies.some((e) => e.kind === 'frost')) setTimeout(() => toast('Le Givré patine sans jamais glisser et laisse du givre partout où il passe : là, ton tank dérape ! Une mine fait fondre le givre, et il fond tout seul une fois le Givré détruit.', 5000), 2200);
  else if (enemies.some((e) => e.kind === 'magnet')) setTimeout(() => toast('L’Aimant : quand son champ bleu brille, il attire et avale tes obus… puis te les renvoie tous d’un coup. Tire quand le champ s’éteint, ou pose une mine !', 4800), 2200);
  else if (enemies.some((e) => e.kind === 'rampart')) setTimeout(() => toast('Le Rempart renvoie tous les obus qui frappent son bouclier. Prends-le de côté, par-derrière… ou à la mine !', 4400), 2200);
  else if (enemies.some((e) => e.kind === 'thief')) setTimeout(() => toast('Le Pilleur file droit sur les caisses et garde les bonus pour lui. Détruis-le : il lâche son butin !', 4200), 2200);
  else if (enemies.some((e) => e.kind === 'mason')) setTimeout(() => toast('Le Maçon bâtit des murs de liège pour s’abriter. Une mine ou un ricochet bien placé, et tout s’écroule !', 4200), 2200);
  else if (drillFight) setTimeout(() => toast('Le Foreur : on ne peut le toucher qu’en surface. Il ronge le liège en passant !', 4000), 2200);
  else if (tiles.some(isDrawbridge)) setTimeout(() => toast('Ponts-levis : un obus sur l’interrupteur, « Clac ! », et les ponts rouges et bleus s’abaissent ou se relèvent. Un pont levé laisse passer les obus, pas les tanks.' + (belts.some((b) => b >= 1 && b <= 4) ? ' Et les tapis roulants changent de sens !' : ''), 5200), 2200);
  else if (snowCells.length) setTimeout(() => toast('Neige : on s’y enfonce et on roule moins vite… mais chaque tank y trace une piste tassée, où l’on file à pleine vitesse jusqu’à ce que la neige la recouvre. Une mine posée dans la neige disparaît dessous, et même les tanks blancs y laissent des traces !', 6000), 2200);
  else if (belts.includes(SAND)) setTimeout(() => toast('Sable : on y roule moins vite. Une mine posée dans le sable s’enfouit : les ennemis ne la voient pas venir !', 4600), 2200);
  else if (mapIce) setTimeout(() => toast('Glace : ton tank glisse et garde son élan. Freine tôt, braque en avance… et profite des glissades pour esquiver !', 4400), 2200);
  else if (belts.some(Boolean)) setTimeout(() => toast('Tapis roulants : ils emportent les tanks, les mines et les caisses. Remonter le courant, ça ralentit !', 4200), 2200);
  else if (tiles.some(isTunnel)) setTimeout(() => toast('Tunnels : roule dedans pour disparaître aux yeux de l’ennemi. Les obus rebondissent dessus, mais on ne peut pas tirer de l’intérieur.', 4200), 2200);
  else if (tiles.some(isPortal)) setTimeout(() => toast('Portails : entre dans l’un, ressors par l’autre. Les obus aussi !', 3500), 2200);
}

/** The wind chip of the HUD says « Blizzard » on such a table, and turns white while a squall blows (iteration 54); it counts down to the next one (iteration 55). */
function windChip(tick: number) {
  const el = $('#hud-wind');
  el.classList.toggle('squall', levelBlizzard && whiteoutAt(tick) > 0.2);
  // and counts down to the next squall (iteration 55): time to cross the open ground, or to find cover
  const next = levelBlizzard ? Math.ceil(squallIn(tick)) : 0;
  const label = !levelBlizzard ? 'Vent' : next > 0 ? `Blizzard · ${next} s` : 'Bourrasque !';
  const sp = el.querySelector('span');
  if (sp && sp.textContent !== label) sp.textContent = label;
}

/**
 * « Le blizzard » (iteration 54): a squall is announced SQUALL_WARN seconds before it rises (« Bourrasque ! » and a howl),
 * once per squall. Everything follows from the tick: no message on the wire.
 */
function squallWatch(tick: number, audible: boolean) {
  const left = squallIn(tick);
  if (left <= 0 || left > SQUALL_WARN) return;
  const start = Math.round(tick + left * TICK_RATE);
  if (Math.abs(start - squallSaid) < TICK_RATE) return;
  squallSaid = start;
  if (!audible || screen !== 'game') return;
  toast('Bourrasque ! Plus personne n’y voit rien…', 2200);
  sfx.squall();
}

/** « Le bilan » (iteration 45): the weather of a table, as words for the briefing. */
function weatherWords(night: boolean | undefined, storm: boolean | undefined, bl: number[] = belts, wind = levelWind, fog = levelFog) {
  const w: string[] = [];
  if (night) w.push('Nuit');
  if (storm) w.push('Orage');
  if (bl.includes(ICE)) w.push('Glace');
  if (bl.includes(SAND)) w.push('Sable');
  if (bl.includes(QUICK)) w.push('Sables mouvants');
  if (bl.includes(SNOW) || bl.includes(PACKED)) w.push('Neige');
  if (wind !== undefined) w.push(levelBlizzard ? 'Blizzard' : 'Vent');
  if (fog !== undefined) w.push('Brouillard');
  return w;
}
/** Enemy kinds and how many of each, bosses first, then in order of appearance. */
function kindCounts(kinds: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const k of kinds) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => Number(isBossKind(b[0])) - Number(isBossKind(a[0])));
}
const briefArt = (k: string) => tankSvg(k, true);
const kindLabel = (k: string) => specOf(k).label;
const sheetSfx = { tick: (i: number) => sfx.tally(i), stamp: () => sfx.stamp(), star: (i: number, on: boolean) => sfx.star(i, on) };

/** The end-of-mission sheet (iteration 45): it waits behind the replay, then counts. Campaign stars are kept on this device. */
let runStars = { stars: 0, missions: 0 }; // the stars of the game being played (shown with its results)
function openSheet(v: SheetView, mission?: number) {
  if (mission !== undefined) v.best = saveStars(mission, starCount(v.tally));
  if (online) { runStars.stars += starCount(v.tally); runStars.missions++; }
  hideBanner();
  showSheet(v, briefArt, kindLabel, sheetSfx);
}

/** One line on how to beat the boss of the table (the intro banner of a boss fight). */
function bossTip(thunder: boolean, sower: boolean, drill: boolean, bombard = false, train = false, magus = false) {
  return magus ? 'Il devient quatre d’un coup de baguette, et chaque coup reçu l’échange avec un mirage. Garde l’œil sur le vrai !'
    : train ? 'Il fait le tour de la table sur ses rails et écrase tout ce qui traîne sur la voie. Vise-le de côté ou par-derrière !'
    : bombard ? 'Il pilonne des rangées entières de boulets. Ne longe pas la rangée : avance vers lui ou recule !'
    : thunder ? 'Il appelle la foudre sur toi. Quand son nuage gronde, bouge… ou file sous un tunnel !'
    : sower ? 'Il sème des graines géantes qui explosent. Tire sur celles qui poussent à ses pieds !'
    : drill ? 'Il creuse sous la table et jaillit sous tes chenilles. Quand le sol tremble, file !'
    : 'Il encaisse plusieurs coups. Gare à sa salve circulaire !';
}

function onPhase(msg: Extract<ServerMsg, { t: 'phase' }>) {
  const prev = phase;
  phase = msg.phase;
  lives = msg.lives;
  if (msg.scores) scores = msg.scores;
  if (Array.isArray(msg.teams)) teamScores = [msg.teams[0] | 0, msg.teams[1] | 0];
  if (typeof msg.left === 'number' && Number.isFinite(msg.left)) { ctfLeft = msg.left; ctfLeftAt = performance.now(); }
  if (msg.daily) { dailyState = msg.daily; dailyK = latestK; }
  if (msg.rush && currentMode === 'rush') { rushState = msg.rush; dailyK = latestK; }
  enemiesLeft = msg.enemies;
  const tally = msg.phase === 'cleared' ? cleanTally(msg.tally) : undefined;
  if (msg.phase !== 'cleared') hideSheet();
  if (msg.phase !== 'intro') hideBrief(msg.phase === 'playing');
  onProgress(msg, prev, tally);
  renderHud();
  if (msg.phase === 'council' && msg.council) {
    if (!council || prev !== 'council') myVote = undefined;
    const wasDone = prev === 'council' && !!council?.done;
    council = msg.council;
    councilAt = performance.now();
    renderCouncil(council, lobbyPlayers, pid, myVote);
    if (prev !== 'council') { hideBanner(); sfx.jingle('start'); }
    if (msg.council.done && !wasDone) councilVerdictSfx(msg.council);
    return;
  }
  if (council) { council = undefined; $('#council').hidden = true; }
  if (prev === msg.phase && msg.phase === 'playing') return;
  if (prev === 'playing' && (msg.phase === 'cleared' || msg.phase === 'failed' || (msg.phase === 'roundEnd' && currentMode !== 'caisses' && currentMode !== 'couronne' && currentMode !== 'ballon'))) queueReel(); // (the film has no ball in it: no replay of a goal)
  else if (msg.phase !== 'cleared' && msg.phase !== 'failed' && msg.phase !== 'roundEnd') stopReel();
  switch (msg.phase) {
    case 'intro':
      sfx.jingle('start');
      break;
    case 'playing':
      hideBanner();
      setMusicIntensity(bossFight ? 2 : 1);
      break;
    case 'cleared': {
      if (prev === 'cleared') break; // the same pause, told again (a galon bought): the sheet is already out
      setMusicIntensity(0);
      sfx.jingle('clear');
      if (treeOpen && treeAuto) break; // the skill tree card opened instead of the banner (iteration 19)
      let c: [string, string, string];
      if (msg.daily) {
        const last = msg.daily.stage >= msg.daily.stages;
        c = ['Bravo !', last ? 'Défi relevé !' : `Étape ${msg.daily.stage} réussie`, `Chrono : ${formatTicks(msg.daily.ticks)}`];
      } else if (msg.rush && currentMode === 'rush') {
        const r = msg.rush;
        const split = r.splits[r.splits.length - 1];
        const last = r.stage >= r.stages;
        const who = r.bosses.map((b) => BOSS_NAMES[b as BossKind] ?? 'le boss');
        c = [last ? 'La ronde est bouclée !' : `Boss ${r.stage}/${r.stages} vaincu !`, last ? 'Les quatre boss sont tombés… et le duo aussi !' : `${cap(who.join(' et '))} ${who.length > 1 ? 'sont tombés' : 'est tombé'}`,
          `${split !== undefined ? `En ${formatTicks(split)} · ` : ''}chrono : ${formatTicks(r.ticks)}${!last && r.stage + 1 >= r.stages ? ' · Prochain : le bouquet final !' : ''}`];
      } else if (currentMode === 'atelier') c = ['Bravo !', 'Mission réussie', currentLevelName];
      else c = ['Bravo !', 'Mission réussie', msg.mission % 5 === 0 ? 'Vie bonus à la prochaine mission !' : ''];
      // « Le bilan » (iteration 45): the sheet of the mission, when the room sends its count (older rooms: the banner)
      if (tally) {
        const kick = currentMode === 'coop' ? `Mission ${msg.mission} · ${currentLevelName}` : currentMode === 'atelier' ? `Atelier · ${currentLevelName}` : currentLevelName;
        const plain = currentMode === 'coop' || currentMode === 'atelier'; // the stamp says « Réussie »: the level's name is the title
        openSheet({ kicker: plain ? kick.split(' · ')[0] : kick, title: plain ? currentLevelName : c[0] === 'Bravo !' ? c[1] : c[0], sub: plain ? c[2] : c[0] === 'Bravo !' ? c[2] : `${c[1]} · ${c[2]}`, tally }, currentMode === 'coop' ? msg.mission : undefined);
      } else banner(c[0], c[1], c[2], 'good');
      break;
    }
    case 'failed':
      setMusicIntensity(0);
      sfx.jingle('fail');
      banner('Aïe…', 'Mission échouée', msg.lives > 0 ? `Vies restantes : ${msg.lives}` : 'Plus de vies', 'bad');
      break;
    case 'roundEnd':
      setMusicIntensity(0);
      sfx.jingle('clear');
      if (currentMode === 'drapeau') {
        const w = msg.win ?? 0;
        banner(w ? (w === myTeam ? 'Manche gagnée !' : myTeam ? 'Manche perdue…' : 'Fin de manche') : 'Fin de manche', msg.text ?? '',
          `Bleus ${teamScores[0]} · ${teamScores[1]} Rouges`, `${w && myTeam && w !== myTeam ? 'bad' : 'good'} ctf team${w}`);
      } else if (currentMode === 'ballon') {
        const w = msg.win ?? 0;
        banner(w ? (w === myTeam ? 'But !' : myTeam ? 'But encaissé…' : 'But !') : 'Fin de manche', msg.text ?? '',
          `Bleus ${teamScores[0]} · ${teamScores[1]} Rouges`, `${w && myTeam && w !== myTeam ? 'bad' : 'good'} ctf ball team${w}`);
      } else if (currentMode === 'caisses') {
        const mine = huntGot.get(myTankId);
        banner('Temps écoulé !', msg.text ?? '', mine !== undefined ? `Tu as ramassé ${mine} caisse${mine > 1 ? 's' : ''}` : '', 'good hunt');
      } else if (currentMode === 'couronne') {
        const mine = crownHeld.get(myTankId);
        const won = /règne/.test(msg.text ?? '');
        banner(won ? 'Vive le roi !' : 'Fin du règne', msg.text ?? '', mine !== undefined ? `Tu as porté la couronne ${Math.floor(mine / 10)} s` : '', 'good crown');
      } else if (currentMode === 'petard') {
        const mine = petardPasses.get(myTankId) ?? 0;
        banner(/dernier/.test(msg.text ?? '') ? 'Boum !' : 'Fin de manche', msg.text ?? '', `Tu as refilé le pétard ${mine} fois`, 'good petard');
      } else banner('Fin de manche', msg.text ?? '', '', 'good');
      break;
    case 'gameover':
      setMusicIntensity(0);
      sfx.jingle('over');
      hideBanner();
      if (msg.results) showResults(msg.results);
      break;
    case 'lobby':
      runStars = { stars: 0, missions: 0 };
      online = false;
      if (screen !== 'results') show('lobby');
      break;
  }
}

/** « L’Illusionniste » (iteration 58): the flat list of its mirages, [id, owner, x, y, body, turret…], by id. */
function netDecoys(d: unknown): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!Array.isArray(d)) return out;
  for (let i = 0; i + 5 < d.length; i += 6) {
    const r = d.slice(i, i + 6) as number[];
    if (r.every(Number.isFinite)) out.set(r[0], r.slice(1));
  }
  return out;
}
function onSnap(msg: Extract<ServerMsg, { t: 'snap' }>) {
  const s: Snap = { k: msg.k, a: msg.a, T: new Map(msg.T.map((t) => [t[0], t])), B: new Map(msg.B.map((b) => [b[0], b])), M: msg.M, P: msg.P ?? [], F: Array.isArray(msg.F) ? msg.F : [], L: Array.isArray(msg.L) ? msg.L.filter((l) => Array.isArray(l) && l.length >= 7) : [], C: Array.isArray(msg.C) && msg.C.length >= 5 ? msg.C : undefined, O: Array.isArray(msg.O) && msg.O.length >= 4 && msg.O.every(Number.isFinite) ? msg.O : undefined, D: netDecoys(msg.D), at: performance.now() };
  snaps.push(s);
  if (snaps.length > 40) snaps.shift();
  latestK = msg.k;
  applyFrost(msg.I);
  applySnow(msg.N);
  if (Array.isArray(msg.H)) {
    const key = msg.H.join(',');
    if (key !== huntKey) {
      huntKey = key;
      huntGot = new Map();
      for (let k = 0; k + 1 < msg.H.length; k += 2) huntGot.set(msg.H[k] | 0, Math.max(0, msg.H[k + 1] | 0));
      renderHud();
    }
  }
  if (Array.isArray(msg.Q) && msg.Q.length >= 3) {
    // « Le pétard » (iteration 61): who carries it, the fuse, and the handovers for the scoreboard
    petardFuse = Math.max(0, Number(msg.Q[1]) || 0); petardLen = Math.max(1, Number(msg.Q[2]) || 1); petardAt = performance.now();
    const key = msg.Q.filter((_, i) => i !== 1 && i !== 2).join(',');
    if (key !== petardKey) {
      petardKey = key;
      petardHolder = msg.Q[0] | 0;
      petardPasses = new Map();
      for (let k = 3; k + 1 < msg.Q.length; k += 2) petardPasses.set(msg.Q[k] | 0, Math.max(0, msg.Q[k + 1] | 0));
      renderHud();
    }
  }
  if (s.C) {
    // « La couronne » (iteration 50): the scoreboard follows the reigns, second by second
    const key = `${s.C[2]}|${s.C.slice(5).map((v, i) => (i % 2 ? Math.floor(v / 10) : v)).join(',')}`;
    if (key !== crownKey) {
      crownKey = key;
      crownHolder = s.C[3] === 1 ? s.C[2] | 0 : 0;
      crownHeld = new Map();
      for (let k = 5; k + 1 < s.C.length; k += 2) crownHeld.set(s.C[k] | 0, Math.max(0, s.C[k + 1] | 0));
      renderHud();
    }
  }
  for (const e of msg.E) {
    evq.push({ k: msg.k, e });
    if (e[0] === 'block') tiles[e[2] * W + e[1]] = Tile.Empty; // prediction sees the freshest map
    else if (e[0] === 'snowman') tiles[e[2] * W + e[1]] = Tile.SnowLow; // a headless snowman (iteration 53): still in the way
    else if (e[0] === 'build') tiles[e[2] * W + e[1]] = Tile.Cork; // the Maçon's new block stops my tank right away
    else if (e[0] === 'bridge') tiles[e[2] * W + e[1]] = Tile.Hole; // a bridge gave way (iteration 33): no driving over it any more
    else if (e[0] === 'gate') tiles[e[2] * W + e[1]] = e[3]; // « Les interrupteurs » (iteration 40): a gate rose or sank
    else if (e[0] === 'mirror') tiles[e[2] * W + e[1]] = e[3]; // « Les miroirs » (iteration 57): a mirror turned (the reticle's ray follows it)
    else if (e[0] === 'flip' && belts.length) reverseBelts(belts); // « Les ponts-levis » (iteration 48): the belts turn round, as on the server
  }
  // reconcile own tank
  const me = s.T.get(myTankId);
  if (me) {
    pending = pending.filter((p) => p.s > msg.a);
    let x = me[1], y = me[2], body = me[3], vx = me[7] ?? 0, vy = me[8] ?? 0;
    if (me[5] & 1 && phase === 'playing') {
      for (const p of pending) [x, y, body, vx, vy] = predictStep(x, y, body, vx, vy, p.mx, p.my, s);
    }
    const ex = pred.x + offset.x - x, ey = pred.y + offset.y - y;
    if (Math.hypot(ex, ey) < 1.5) { offset.x = ex; offset.y = ey; } else { offset.x = offset.y = 0; }
    pred = { x, y, body, vx, vy };
  }
}

/** « Le Givré » (iteration 31): lay the frost of the latest snapshot over the floor layer (prediction and drawing). */
function applyFrost(I: unknown) {
  const pairs = Array.isArray(I) ? I : [];
  if (!pairs.length && !frostCells.length) return;
  if (belts.length !== W * H) belts = new Array(W * H).fill(0);
  for (const c of frostCells) if (belts[c] === ICE) belts[c] = 0;
  frostCells = [];
  const shown: [number, number][] = [];
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const c = pairs[k] | 0, life = +pairs[k + 1] / 10;
    if (c < 0 || c >= W * H || belts[c] || !Number.isFinite(life)) continue; // never over a belt or the map's own ice
    belts[c] = ICE;
    frostCells.push(c);
    shown.push([c, life]);
  }
  if (frostCells.length) iceMap = true;
  renderer.setFrost(shown);
}

/**
 * « La neige » (iteration 42): the packed trails of the latest snapshot (one bit per cell, in hexadecimal) over the
 * floor layer, for the prediction (deep snow slows us down) and the drawing (the snowfall covers the old trails).
 */
function applySnow(N: unknown) {
  if (!snowCells.length || typeof N !== 'string' || belts.length !== W * H) return;
  const packed: number[] = [];
  for (const c of snowCells) {
    const d = parseInt(N[c >> 2] ?? '0', 16) || 0;
    const on = (d >> (c & 3)) & 1;
    belts[c] = on ? PACKED : SNOW;
    if (on) packed.push(c);
  }
  renderer.setPacked(packed);
}

function predictStep(x: number, y: number, body: number, vx: number, vy: number, mx: number, my: number, s?: Snap): [number, number, number, number, number] {
  const snap = s ?? snaps[snaps.length - 1];
  const fl = snap?.T.get(myTankId)?.[5] ?? 0;
  const turbo = fl & BONUS_INFO.turbo.flag;
  const speed = mySpec.speed * (turbo ? TURBO_MULT : 1) * (petardHolder && petardHolder === myTankId && currentMode === 'petard' ? PETARD_SPEED : 1) * (belts.length ? floorSpeed(belts, x, y) : 1); // sand slows us down, as on the server (iteration 36)
  if (fl & FLAG_FROZEN) { // « Gel » (iteration 29): stuck in the ice cube, only a belt moves it, as on the server
    if (belts.length) [x, y] = beltStep(tiles, belts, x, y, TANK_R, DT);
    return [x, y, body, 0, 0];
  }
  if (iceMap) [x, y, body, vx, vy] = slideDrive(tiles, belts, x, y, body, vx, vy, mx, my, speed, DT); // the ice keeps our momentum, as on the server
  else [x, y, body] = driveStep(tiles, x, y, body, mx, my, speed, DT);
  if (belts.length) [x, y] = beltStep(tiles, belts, x, y, TANK_R, DT); // the belt carries us after each drive step, as on the server
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
  return [x, y, body, vx, vy];
}

/** AI teammates in the coop campaign (iteration 20): in the lobby list, they are the players with a level. */
function hasMates() {
  return online && currentMode === 'coop' && lobbyPlayers.some((p) => p.bot !== undefined);
}

/** « Suis-moi ! »: the AI teammates come to my tank for a few seconds (the room answers with a 'rally' event). */
function callRally() {
  if (!hasMates() || phase !== 'playing') return;
  send({ t: 'order' });
}
$('#hud-rally').addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); callRally(); });

function clientTick() {
  const s = controls.sample();
  if (s.emote >= 0) sayEmote(s.emote); // the d-pad (iteration 30), even from the wreck
  localFireCd -= DT;
  const last = snaps[snaps.length - 1];
  const meNet = last?.T.get(myTankId);
  if (!meNet || !(meNet[5] & 1)) return;
  const px = pred.x + offset.x, py = pred.y + offset.y;
  if (s.aimAng !== null) aimAng = s.aimAng;
  else if (s.aimX !== null && s.aimY !== null) aimAng = Math.atan2(s.aimY - py, s.aimX - px);
  const playing = phase === 'playing';
  if (s.rally && playing) callRally();
  if (playing && !tunnelHinted && isTunnel(tiles[Math.floor(py) * W + Math.floor(px)] ?? 0)) {
    tunnelHinted = true;
    toast('Caché dans le tunnel : l’ennemi te perd de vue… mais ton canon touche le plafond.', 3200);
  }
  const inp: Input = { s: ++seq, mx: +s.mx.toFixed(3), my: +s.my.toFixed(3), a: +aimAng.toFixed(3), f: s.fire && playing ? 1 : 0, m: s.mine && playing ? 1 : 0 };
  send({ t: 'in', i: [inp] });
  pending.push(inp);
  if (pending.length > 90) pending.shift();
  if (playing) {
    [pred.x, pred.y, pred.body, pred.vx, pred.vy] = predictStep(pred.x, pred.y, pred.body, pred.vx, pred.vy, inp.mx, inp.my);
    const ceasefire = coopLike(currentMode) && enemiesLeft === 0; // the server no longer lets anyone fire
    const frozen = !!(meNet[5] & FLAG_FROZEN);
    if (inp.f && localFireCd <= 0 && !ceasefire && !frozen) {
      let own = 0;
      for (const b of last.B.values()) if (b[6] === myTankId) own++;
      if (own < mySpec.maxBullets && shellsOut() < mySpec.maxBullets) {
        localFireCd = mySpec.fireCd;
        localShots.push(performance.now());
        if (meNet[5] & BONUS_INFO.heavy.flag) sfx.heavyShot(); else sfx.shot(mySpec.rocket);
        if (meNet[5] & BONUS_INFO.ghost.flag) sfx.ghostShot(); // « Passe-muraille » (iteration 52)
        const tip = TANK_R + 0.22;
        renderer.muzzle(px + Math.cos(aimAng) * tip, py + Math.sin(aimAng) * tip, aimAng, mySpec.rocket, myTankId);
      } else dryFire();
    }
  }
}

// ------------------------------------------------------------------ « Le réticule » (iteration 44)
// The reticle under the mouse carries the shells ready (an arc of pips), the mines left and the reload ring.
const reticle = new Reticle();
let reticleOn = (() => { try { return localStorage.getItem('tanks.reticle') !== '0'; } catch { return true; } })();
/** Shells fired here that the room has not shown yet (performance.now() of each), so the pips answer at once. */
let localShots: number[] = [];
const seenShells = new Set<number>();
/** My shells in the air: those of the freshest state, plus the ones just fired and not in it yet. */
function shellsOut() {
  const last = snaps[snaps.length - 1];
  if (!last) return 0;
  let own = 0;
  for (const b of last.B.values()) {
    if (b[6] !== myTankId) continue;
    own++;
    if (!seenShells.has(b[0])) { seenShells.add(b[0]); localShots.shift(); } // it arrived: no longer « just fired »
  }
  if (seenShells.size > 64) for (const id of seenShells) if (!last.B.has(id)) seenShells.delete(id);
  const now = performance.now();
  while (localShots.length && now - localShots[0] > ping + 300) localShots.shift();
  return Math.min(mySpec.maxBullets, own + localShots.length);
}
let reticleFrame = false; // the reticle was drawn this frame (otherwise it hides)
let lastDry = 0;
let wasEmpty = false;
/** A shot with every shell out: the trigger clicks, the pips shake. */
function dryFire() {
  const now = performance.now();
  if (now - lastDry < 140) return;
  lastDry = now;
  sfx.dry();
  reticle.dry();
}
/** « Gare au tir ami » (iteration 54): was the reticle red last frame, and when it last beeped. */
let friendWas = false, friendBeep = 0;
/**
 * « Gare au tir ami » (iteration 53): would a shell fired from (x, y) along `ang` hit a teammate (or come back on its shooter)
 * before any foe? The reticle then turns red. Same ricochet ray as the AI, walls, portals and snowmen included.
 */
function friendlyAim(x: number, y: number, ang: number, bounces: number, meId: number, others: { id: number; x: number; y: number; r: number; foe: boolean }[]) {
  const segs = castRicochet(tiles, x + Math.cos(ang) * 0.5, y + Math.sin(ang) * 0.5, ang, bounces, 40);
  for (let i = 0; i < segs.length; i++) {
    let best = Infinity, friend = false;
    for (const o of others) {
      if (o.id === meId && i === 0) continue; // the first stretch leaves the barrel: it cannot hit its own tank
      const u = segCircle(segs[i], o.x, o.y, o.r + 0.09);
      if (u >= 0 && u < best) { best = u; friend = !o.foe; }
    }
    if (best < Infinity) return friend;
  }
  return false;
}
function reticleAllowed() {
  return reticleOn && screen === 'game' && $('#menu').hidden && !council && !treeOpen && !reel && $('#feedback').hidden && $('#options').hidden;
}
/** Where the reticle goes: under the mouse, or (gamepad, touch) a few cells ahead of the tank along its aim. */
function reticleSpot(x: number, y: number, ang: number, ahead = 2.6) {
  const p = controls.pointer();
  if (p) return p;
  return renderer.arenaToScreen(x + Math.cos(ang) * ahead, y + Math.sin(ang) * ahead, 0.3);
}
function updateReticleOnline(latest: Snap) {
  const me = latest.T.get(myTankId);
  const info = infos.get(myTankId);
  if (!me || !(me[5] & 1) || !info || !reticleAllowed() || (phase !== 'playing' && phase !== 'intro')) { reticle.hide(); return; }
  const out = shellsOut();
  let mines = 0;
  for (const m of latest.M) if (m[5] === myTankId) mines++;
  const ready = mySpec.maxBullets - out;
  if (ready > 0 && wasEmpty) sfx.reload();
  wasEmpty = ready <= 0;
  const spot = reticleSpot(pred.x + offset.x, pred.y + offset.y, aimAng);
  reticleFrame = true;
  let friend = false;
  if (coopLike(currentMode) && phase === 'playing') {
    const others: { id: number; x: number; y: number; r: number; foe: boolean }[] = [];
    for (const t of latest.T.values()) {
      const ti = infos.get(t[0]);
      if (!ti || !(t[5] & 1)) continue;
      const mine = t[0] === myTankId;
      others.push({ id: t[0], x: mine ? pred.x : t[1], y: mine ? pred.y : t[2], r: tankRadius(ti.kind), foe: ti.team !== info.team });
    }
    friend = friendlyAim(pred.x, pred.y, aimAng, mySpec.bounces, myTankId, others);
  }
  // and a soft double beep when it turns red (iteration 54), at most every second and a half
  const now = performance.now();
  if (friend && !friendWas && now - friendBeep > 1500) { friendBeep = now; sfx.friendWarn(); }
  friendWas = friend;
  reticle.update({
    x: spot.x, y: spot.y, max: mySpec.maxBullets, ready, mines: mySpec.mines, minesLeft: Math.max(0, mySpec.mines - mines),
    reload: mySpec.fireCd > 0 ? Math.max(0, localFireCd) / mySpec.fireCd : 0,
    off: phase !== 'playing' || (coopLike(currentMode) && enemiesLeft === 0) || !!(me[5] & FLAG_FROZEN), color: info.color, friend,
  });
}
/** The enemies up top (tokens) and the team at the bottom, from what is on the table. */
function updateTeamOnline(a: Snap) {
  if (!coopLike(currentMode)) { renderTeam($('#hud-team'), []); return; }
  const enemies: EnemyToken[] = [];
  const mates: Mate[] = [];
  for (const t of a.T.values()) {
    const info = infos.get(t[0]);
    if (!info) continue;
    const alive = !!(t[5] & 1);
    if (info.team === 99) { if (alive) enemies.push({ color: info.color, boss: isBossKind(info.kind) }); }
    else if (info.kind === 'player') mates.push({ id: info.id, name: info.name ?? '?', color: info.color, alive, me: info.id === myTankId, bot: isRivalId(info.pid) });
  }
  renderEnemyTokens($('#hud-enemies'), enemies);
  renderTeam($('#hud-team'), mates.length > 1 ? mates : []);
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
  renderer.windTick = renderer.fogTick = renderTick; // the gust is a function of the tick: the same as the server's
  if (levelWind !== undefined && (windSoundT -= dt) <= 0) {
    windSoundT = 0.15;
    const k = gustAt(renderTick);
    windGust(levelBlizzard ? Math.min(1.5, k + whiteoutAt(renderTick) * 0.8) : k); // a squall howls (iteration 54)
    $<HTMLElement>('#hud-wind i').style.transform = `rotate(${((windAngle(levelWind, renderTick) * 180) / Math.PI).toFixed(1)}deg)`;
    $<HTMLElement>('#hud-wind u').style.width = `${Math.round(k * 100)}%`;
    windChip(renderTick);
  }

  if (levelBlizzard) squallWatch(renderTick, true);
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
      tanks.push({ id: ta[0], x: pred.x + offset.x, y: pred.y + offset.y, body: pred.body, turret: latest[5] & 1 && !(latest[5] & FLAG_FROZEN) ? aimAng : latest[4], alive, invisible: false, fx: latest[5] });
      continue;
    }
    const tw = jumped(ta[1], ta[2], tb[1], tb[2], u); // through a portal: no sliding across the map
    tanks.push({ id: ta[0], x: lerp(ta[1], tb[1], tw), y: lerp(ta[2], tb[2], tw), body: lerpAng(ta[3], tb[3], u), turret: lerpAng(ta[4], tb[4], u), alive, invisible: !!(ta[5] & 2), fx: ta[5], hp: ta[6] ?? undefined });
  }
  // « L’Illusionniste » (iteration 58): its mirages, drawn like it (and wand raised when it raises its own)
  for (const [id, da] of a.D) {
    const db = b.D.get(id) ?? da;
    const fx = a.T.get(da[0])?.[5] ?? 1;
    tanks.push({ id, x: lerp(da[1], db[1], u), y: lerp(da[2], db[2], u), body: lerpAng(da[3], db[3], u), turret: lerpAng(da[4], db[4], u), alive: true, invisible: false, fx: fx | 1, decoy: da[0] });
  }
  renderer.syncTanks(tanks, myTankId, dt);
  lastTanks = tanks;
  updateBoss(tanks, (id) => a.T.get(id)?.[6] ?? 0, (id) => infos.get(id)?.hp ?? 0);
  if (currentMode === 'drapeau' || currentMode === 'caisses' || currentMode === 'couronne' || currentMode === 'ballon') {
    // the round clock: it runs while the round is being played (« La chasse aux caisses » too, iteration 37)
    const left = Math.max(0, Math.ceil(phase === 'playing' ? ctfLeft - (performance.now() - ctfLeftAt) / 1000 : ctfLeft));
    $('#hud-enemies').textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('#hud-enemies').classList.toggle('hurry', left <= (currentMode === 'caisses' ? HUNT_HURRY : currentMode === 'couronne' ? CROWN_HURRY : currentMode === 'ballon' ? BALL_HURRY : 30) && phase === 'playing');
  } else if (currentMode === 'petard') {
    // « Le pétard » (iteration 61): whose back it burns on, and the last seconds of the fuse
    const left = petardHolder ? Math.max(0, petardFuse / 10 - (phase === 'playing' ? (performance.now() - petardAt) / 1000 : 0)) : 0;
    const who = petardHolder === myTankId ? 'sur toi !' : petardHolder ? `chez ${infos.get(petardHolder)?.name ?? '?'}` : '…';
    const txt = `${who}${petardHolder && left <= PETARD_WARN ? ` · ${Math.ceil(left)}` : ''}`;
    if (txt !== petardHudTxt) { petardHudTxt = txt; $('#hud-enemies').innerHTML = `${icon('petard')} ${escapeHtml(txt)}`; }
    $('#hud-enemies').classList.toggle('hurry', !!petardHolder && left <= PETARD_WARN && phase === 'playing');
  } else if (!coopLike(currentMode)) {
    plainEnemies($('#hud-enemies'), '');
    $('#hud-enemies').classList.remove('hurry');
  }
  void enemiesAlive; // (the tokens of updateTeamOnline count them)

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
    bullets.push({ id: bl[0], x: bl[1] + bl[3] * ahead, y: bl[2] + bl[4] * ahead, vx: bl[3], vy: bl[4], rocket: !!(bl[5] & 1), heavy: !!(bl[5] & SHELL_HEAVY), ghost: !!(bl[5] & SHELL_GHOST), color: shellColor(bl[6]) });
  }
  for (const ba of a.B.values()) {
    if (ba[6] === myTankId) continue;
    const bb = b.B.get(ba[0]);
    if (!bb) { bullets.push({ id: ba[0], x: ba[1] + ba[3] * u * DT * (b.k - a.k), y: ba[2] + ba[4] * u * DT * (b.k - a.k), vx: ba[3], vy: ba[4], rocket: !!(ba[5] & 1), heavy: !!(ba[5] & SHELL_HEAVY), ghost: !!(ba[5] & SHELL_GHOST), color: shellColor(ba[6]) }); continue; }
    const bw = jumped(ba[1], ba[2], bb[1], bb[2], u);
    bullets.push({ id: ba[0], x: lerp(ba[1], bb[1], bw), y: lerp(ba[2], bb[2], bw), vx: bb[3], vy: bb[4], rocket: !!(ba[5] & 1), heavy: !!(ba[5] & SHELL_HEAVY), ghost: !!(ba[5] & SHELL_GHOST), color: shellColor(ba[6]) });
  }
  renderer.syncBullets(bullets, dt);
  lastBullets = bullets;
  const mines: RMine[] = a.M.map((m) => ({ id: m[0], x: m[1], y: m[2], blink: !!m[3], seed: m[4] ? (m[4] - 1) / 10 : undefined, remote: m[6] === 1 }));
  renderer.syncMines(mines);
  lastMines = mines;
  const bonuses: RBonus[] = a.P.map((c) => ({ id: c[0], x: c[1], y: c[2], kind: c[3], blink: !!c[4], gold: c[5] === 1 }));
  renderer.syncBonuses(bonuses);
  const flags: RFlag[] | undefined = ctfBases ? a.F.map((f) => ({ team: f[0], x: f[1], y: f[2], carrier: f[3], state: f[4], left: f[5] })) : undefined;
  if (flags) renderer.syncFlags(flags);
  if (currentMode === 'petard') renderer.syncPetard(petardHolder, petardHolder ? Math.max(0, petardFuse / 10 - (phase === 'playing' ? (performance.now() - petardAt) / 1000 : 0)) : 0, petardLen / 10);
  if (crownHome && a.C) renderer.syncCrown({ x: a.C[0], y: a.C[1], holder: a.C[2], state: a.C[3], left: a.C[4] / 10 });
  if (ballOn && a.O) {
    // « Le ballon » (iteration 55): it rolls between two snapshots like the tanks do
    const o = b.O ?? a.O;
    renderer.syncBall(lerp(a.O[0], o[0], u), lerp(a.O[1], o[1], u), dt);
  }
  // the Mortier's cannonballs (iteration 34): their time in the air runs on between two snapshots, like everything else
  const lobs: RLob[] = a.L.map((l) => ({ id: l[0], x0: l[1], y0: l[2], x1: l[3], y1: l[4], t: l[5] + u * DT * (b.k - a.k), dur: l[6] }));
  renderer.syncLobs(lobs);
  film.frame(dt, tanks, bullets, mines, bonuses, flags, lobs);
  updateNameTags(tanks);
  updateTeamOnline(a);
  updateReticleOnline(latest);
  const myFlags = latest.T.get(myTankId)?.[5] ?? 0;
  renderBuffs(myFlags & 1 ? myFlags : 0);
}

const crateTips = new Set<BonusKind>();
function handleEvent(e: GameEvent, audible: boolean) {
  if (!reel) film.event(e); // « Le ralenti » (iteration 32): everything that happens goes on film
  if (online) { eventLog.push([Math.round(renderTick), ...e]); if (eventLog.length > 60) eventLog.shift(); }
  switch (e[0]) {
    case 'shot':
      if (e[5] === myTankId && online) break;
      renderer.muzzle(e[1], e[2], e[3], !!(e[4] & 1), e[5]);
      if (audible) { if (e[4] & SHELL_HEAVY) sfx.heavyShot(); else sfx.shot(!!(e[4] & 1)); if (e[4] & SHELL_GHOST) sfx.ghostShot(); }
      break;
    case 'abra': // « L’Illusionniste » (iteration 58) raises its wand
      floater(e[1], e[2], 'Abracadabra !', enemyColor('conjurer'));
      if (audible) sfx.abra();
      break;
    case 'conjure':
      renderer.conjure(e[1], e[2], (e as number[]).slice(4));
      if (audible) sfx.conjure();
      break;
    case 'swap': // « Le Grand Illusionniste » (iteration 60): hit, it swaps places with one of its mirages
      renderer.swapPuff(e[1], e[2], e[3], e[4]);
      floater(e[3], e[4], 'Escamoté !', enemyColor('magus'));
      if (audible) sfx.conjure();
      break;
    case 'poof':
      renderer.starPuff(e[1], e[2], e[3] === 0 ? 1 : 0.45);
      if (e[3] === 0) floater(e[1], e[2], 'Pouf !', enemyColor('conjurer'));
      if (audible) sfx.poof(e[3] === 0);
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
      if (online && audible && currentMode === 'drapeau' && e[3] === myTankId) toast(`Touché ! Retour à la base dans ${CTF_RESPAWN} secondes…`, 2600);
      if (online && audible && currentMode === 'caisses' && e[3] === myTankId) toast(`Touché ! Retour dans ton coin dans ${HUNT_RESPAWN_TXT} secondes…`, 2400);
      if (online && audible && currentMode === 'couronne' && e[3] === myTankId) toast(`Touché ! Retour dans ton coin dans ${CROWN_RESPAWN_TXT} secondes…`, 2400);
      if (online && audible && currentMode === 'ballon' && e[3] === myTankId) toast(`Touché ! Retour sur ton terrain dans ${BALL_RESPAWN_TXT} secondes…`, 2400);
      if (isBossKind(renderer.tankKind(e[3]) ?? '')) {
        // the boss goes down in a chain of blasts
        const kind = renderer.tankKind(e[3])!;
        renderer.explosion(e[1], e[2], true, renderer.tankColor(e[3]));
        for (let i = 1; i <= 3; i++) setTimeout(() => renderer.explosion(e[1] + (Math.random() - 0.5) * 1.4, e[2] + (Math.random() - 0.5) * 1.4, false, kind === 'drill' ? 0x8a5a33 : kind === 'thunder' ? 0x8fc0ff : kind === 'sower' ? 0x7fd05a : kind === 'bombard' ? 0xc9a66b : kind === 'train' ? 0x8a8a8a : kind === 'magus' ? 0xc9a7f2 : 0xf2c14e), i * 180);
        if (kind === 'magus') { renderer.doves(e[1], e[2]); renderer.starPuff(e[1], e[2], 1.6); if (audible) setTimeout(() => sfx.tada(), 420); } // « Le Grand Illusionniste » (iteration 60): doves fly out of its hat
        floater(e[1], e[2], `${specOf(kind).label} vaincu !`, 0xf2c14e);
        if (audible) { sfx.boom(true); setTimeout(() => sfx.boom(false), 250); }
        if (online && bossFight) setMusicIntensity(1);
      } else {
        renderer.explosion(e[1], e[2], false, renderer.tankColor(e[3]));
        if (audible) sfx.boom(false);
      }
      if (e[3] === myTankId && online) { toast('Détruit !', 1500); controls.rumble(1, 320); }
      break;
    case 'gulp': // « Les sables mouvants » (iteration 59): 0 a mine swallowed, 1 a tank half sunk
      renderer.gulp(e[1], e[2], e[3]);
      if (e[3] === 1) floater(e[1], e[2], e[4] === myTankId && online ? 'Tu t’enlises !' : 'Glub !', 0xc98a3e);
      else floater(e[1], e[2], 'Avalée !', 0xc98a3e);
      if (audible) sfx.gulp(e[3]);
      if (e[3] === 1 && e[4] === myTankId && online) controls.rumble(0.4, 200);
      break;
    case 'ko': // who did it (iteration 32): the film keeps it for the replay's caption
      if (e[3] === KO_QUICK) { // « Les sables mouvants » (iteration 59)
        const p = renderer.swallow(e[1]);
        if (p) floater(p[0], p[1], 'Englouti !', 0xc98a3e);
        if (audible) sfx.gulp(2);
      }
      if (e[1] === reelWanted && !online) { reelWanted = -1; queueReel(true); }
      break;
    case 'mineSet':
      if (audible) { sfx.mineSet(); if (e[3]) sfx.remoteSet(); }
      break;
    case 'detonate': // « Détonateur » (iteration 52): its owner pressed the button
      renderer.detonate(e[1], e[2]);
      if (audible) sfx.detonate();
      break;
    case 'ghost': // « Passe-muraille » (iteration 52): a ghost shell goes into a wall (0), comes out (1) or fades inside (2)
      renderer.ghostPuff(e[1], e[2], e[3]);
      if (audible && e[3] === 0) sfx.ghostPass();
      break;
    case 'ff': {
      const victim = tankName(e[3]), killer = tankName(e[4]);
      floater(e[1], e[2], e[3] === e[4] ? 'Oups !' : 'Tir ami !', 0xc77dff);
      if (online && victim && killer) toast(e[3] === e[4] ? `${victim} s’est fait sauter tout seul…` : `${killer} a détruit ${victim} !`, 2600);
      break;
    }
    case 'mboom':
      renderer.explosion(e[1], e[2], true);
      if (e[3]) {
        // a seed of the Semeur bursts (iteration 25): a much wider blast
        renderer.seedBurst(e[1], e[2], e[3]);
        floater(e[1], e[2], 'Pataboum !', 0x7fd05a);
        if (audible) sfx.seedBurst();
      } else if (audible) sfx.boom(true);
      break;
    case 'sow':
      renderer.sow(e[1], e[2], e[3]);
      floater(e[1], e[2], 'Il sème !', enemyColor('sower'));
      if (audible) sfx.sow(e[4]);
      break;
    case 'block':
      if (renderer.hasSnowman(e[1], e[2])) { // « Les bonshommes de neige » (iteration 53): it falls into a heap of snow
        renderer.removeBlock(e[1], e[2]);
        if (audible) sfx.snowFall();
        break;
      }
      renderer.removeBlock(e[1], e[2]);
      if (audible) sfx.block();
      break;
    case 'snowman': // a shell knocked its head off (iteration 53)
      renderer.knockSnowman(e[1], e[2], e[3], e[4]);
      floater(e[1] + 0.5, e[2] + 0.5, 'Pouf !', 0xbfe3ff);
      if (audible) sfx.snowHit();
      break;
    case 'lob': // « Le Mortier » (iteration 34): the barrel thumps, the cannonball is on its way (its ring shows where)
      renderer.lobShot(e[6], e[1], e[2], e[3], e[4]);
      // the Bombardier's barrage (iteration 35) fires a whole row in one go: one thump is enough
      if (audible && performance.now() - lastLobSound > 90) { sfx.lob(); lastLobSound = performance.now(); }
      break;
    case 'land':
      renderer.lobLand(e[1], e[2]);
      floater(e[1], e[2], 'Badaboum !', enemyColor('mortar'));
      if (audible) sfx.lobLand();
      break;
    case 'hop': // « La Sauterelle » (iteration 41): it leaps, a ring shows where it will land
      renderer.hopShot(e[6], e[1], e[2], e[3], e[4]);
      if (audible) sfx.hop();
      break;
    case 'hopLand':
      renderer.hopLand(e[3], e[1], e[2]);
      floater(e[1], e[2], 'Boing !', enemyColor('hopper'));
      if (audible) sfx.hopLand();
      break;
    case 'fix': // « Le Mécano » (iteration 51): it starts work on a wreck, a ring fills up around it
      renderer.startRepair(e[3], e[4], e[1], e[2], e[5]);
      floater(e[1], e[2], 'Clic, clac…', enemyColor('mechanic'));
      if (audible) sfx.ratchet();
      break;
    case 'fixed': // the wreck rolls again
      renderer.repaired(e[3], e[1], e[2]);
      floater(e[1], e[2], 'Réparé !', 0xffc040);
      if (audible) sfx.fixed();
      break;
    case 'spot': // « Le Veilleur » (iteration 47): it caught someone in its light, the alarm rings
      floater(e[1], e[2], 'Repéré !', 0xff4a30);
      if (audible) sfx.spot(e[4] === myTankId);
      break;
    case 'flip': // « Les interrupteurs » (iteration 40): a shell hit a switch, every gate flips
      renderer.flipSwitches(e[1], e[2], e[3]);
      renderer.reverseBelts();
      floater(e[1] + 0.5, e[2] + 0.5, 'Clac !', GATE_COLORS[e[3] ? 1 : 0]);
      if (audible) sfx.flip(e[3]);
      break;
    case 'glint': // « Les miroirs » (iteration 57): a shell turned on the glass
      renderer.glint(e[1], e[2], e[3], e[4]);
      if (audible) sfx.glint();
      break;
    case 'mirror': // every mirror turns a quarter turn on its pivot (one sound for the whole table)
      renderer.turnMirror(e[1], e[2], e[3]);
      if (audible && performance.now() - lastMirrorSound > 150) { lastMirrorSound = performance.now(); sfx.mirrorTurn(); }
      break;
    case 'gate':
      renderer.setGate(e[1], e[2], e[3]);
      // a whole row moves at once: one sound is enough
      if (audible && performance.now() - lastGateSound > 150) { lastGateSound = performance.now(); if (isDrawbridge(e[3])) sfx.drawbridge(gateUp(e[3])); else sfx.gate(gateUp(e[3])); }
      break;
    case 'bridge': // « Les ponts » (iteration 33): the planks fall into the pit
      if (renderer.collapseBridge(e[1], e[2])) floater(e[1] + 0.5, e[2] + 0.5, 'Crac !', 0xc98f55);
      if (audible) sfx.bridge();
      break;
    case 'build':
      renderer.addBlock(e[1], e[2], e[3]);
      floater(e[1] + 0.5, e[2] + 0.5, 'Hop, un mur !', 0xc98f55); // the knock, written: readable without the sound
      if (audible) sfx.build();
      break;
    case 'crate':
      if (audible) sfx.crate();
      break;
    case 'hunt': {
      // « La chasse aux caisses » (iteration 37): [x, y, tankId, points, total]
      const [, x, y, who, pts, total] = e;
      if (!who) {
        renderer.bonusBurst(x, y, GOLD_COLOR, true);
        floater(x, y, 'La caisse dorée !', GOLD_COLOR);
        if (audible) sfx.gold();
        if ((online && audible) || (attractHunt && document.body.classList.contains('demo') && screen === 'game')) toast(`La caisse dorée est tombée : elle vaut ${HUNT_GOLD} points !`, 3000);
        break;
      }
      const me = online && who === myTankId;
      if (attract) renderAttractHunt();
      if (pts < 0) {
        floater(x, y - 0.4, me ? 'Tu perds une caisse !' : '−1 caisse', 0xff8a5c);
        if (audible) sfx.hunt(-1, me);
        break;
      }
      const color = online ? infos.get(who)?.color : attract?.tankById(who)?.color;
      floater(x, y - 0.5, pts > 1 ? `+${pts} ! (${total})` : `+1 (${total})`, pts > 1 ? GOLD_COLOR : color ?? 0xffffff);
      if (audible) sfx.hunt(pts, me);
      break;
    }
    case 'ball': {
      // « Le ballon » (iteration 55): [x, y, what, a, b] 0 a shell kicks it, 1 a goal, 2 back to the middle, 3 off a wall, 4 a blast throws it
      const [, x, y, what, a, bb] = e;
      if (what === 0) {
        renderer.ballKick(x, y, renderer.tankColor(a));
        if (audible) sfx.ball(0);
      } else if (what === 1) {
        const team = a === 1 || a === 2 ? a : 0;
        const color = team ? TEAM_COLORS[team - 1] : 0xffffff;
        renderer.goal(team, x, y);
        const who = online ? infos.get(bb)?.name : attract?.tankById(bb)?.name;
        const scorerTeam = online ? infos.get(bb)?.team : attract?.tankById(bb)?.team;
        const own = scorerTeam !== undefined && scorerTeam !== team; // the last touch was the other team's
        floater(x + (x < W / 2 ? 2.2 : -2.2), y - 0.6, 'BUT !', color);
        if (who && !own) setTimeout(() => floater(x + (x < W / 2 ? 2.2 : -2.2), y + 0.4, who, color), 260);
        else if (own) setTimeout(() => floater(x + (x < W / 2 ? 2.2 : -2.2), y + 0.4, 'contre son camp', color), 260);
        if (audible) sfx.ball(1, !!myTeam && team === myTeam);
        if (online && audible && myTeam) toast(team === myTeam ? 'Buuut ! Ton équipe marque !' : 'Aïe, but pour l’équipe d’en face…', 2600);
      } else if (what === 2) {
        renderer.bonusBurst(a, bb, 0xfff4dc);
        floater(a, bb - 0.7, 'Remise en jeu', 0xfff4dc);
        if (audible) sfx.ball(2);
      } else if (what === 3) {
        if (audible) sfx.ball(3, false, a / 10);
      }
      break;
    }
    case 'crown': {
      // « La couronne » (iteration 50): [x, y, tankId, what] 0 put on, 1 knocked off, 2 back on its cushion, 3 a full reign, 4 five seconds left
      const [, x, y, who, what] = e;
      const me = online && who === myTankId;
      const demoOn = !!attractCrown && document.body.classList.contains('demo') && screen === 'game';
      const name = (online ? infos.get(who)?.name : attract?.tankById(who)?.name) ?? '';
      const color = (online ? infos.get(who)?.color : attract?.tankById(who)?.color) ?? CROWN_COLOR;
      if (what === 0) {
        renderer.bonusBurst(x, y, CROWN_COLOR, true);
        floater(x, y - 0.5, me ? 'À toi la couronne !' : name ? `La couronne pour ${name} !` : 'La couronne est prise !', CROWN_COLOR);
        if (audible) sfx.crown(0, me);
        if (online && audible && me) toast(`Tu as la couronne ! Garde-la ${CROWN_HOLD} secondes en tout… tout le monde va te courir après.`, 3200);
        if (me) controls.rumble(0.4, 120);
      } else if (what === 1) {
        renderer.bonusBurst(x, y, color);
        floater(x, y - 0.4, me ? 'Ta couronne tombe !' : 'La couronne tombe !', 0xff8a5c);
        if (audible) sfx.crown(1, me);
      } else if (what === 2) {
        renderer.bonusBurst(x, y, CROWN_COLOR);
        floater(x, y - 0.5, 'Retour sur le coussin', CROWN_COLOR);
        if (audible) sfx.crown(2, false);
      } else if (what === 3) {
        renderer.bonusBurst(x, y, CROWN_COLOR, true);
        renderer.explosion(x, y, false, CROWN_COLOR);
        floater(x, y - 0.6, 'Vive le roi !', CROWN_COLOR);
        if (audible) sfx.crown(3, me);
      } else if (what === 4) {
        floater(x, y - 0.6, 'Plus que 5 s !', 0xff6a4a);
        if (audible) sfx.crown(4, me);
        if ((online && audible) || demoOn) toast(me ? 'Plus que 5 secondes de règne : tiens bon !' : `${name || 'Le roi'} n’est plus qu’à 5 secondes du trône : arrêtez-le !`, 2600);
      }
      if (attract) renderAttractCrown();
      break;
    }
    case 'petard': {
      // « Le pétard » (iteration 61): [x, y, tankId, what, fromId] 0 lit, 1-2-4 handed over, 3 fuse nearly out, 5 dazed, 6 bang
      const [, x, y, who, what, from] = e;
      const me = online && who === myTankId;
      const tankOf = (id: number) => (online ? infos.get(id) : attract?.tankById(id));
      const name = tankOf(who)?.name ?? '';
      const fromName = tankOf(from)?.name ?? '';
      const demoOn = !!attractVs?.petard && document.body.classList.contains('demo') && screen === 'game';
      if (what === 0) {
        renderer.bonusBurst(x, y, PETARD_COLOR, true);
        floater(x, y - 0.5, me ? 'Le pétard est sur toi !' : name ? `Pétard allumé chez ${name} !` : 'Pétard allumé !', PETARD_COLOR);
        if (audible) sfx.petard(0, me);
        if (online && audible && me) toast('Le pétard est allumé sur ton dos ! Fonce dans un tank ou touche-le d’un obus pour le lui refiler.', 3200);
        if (me) controls.rumble(0.3, 120);
      } else if (what === 1 || what === 2 || what === 4) {
        renderer.bonusBurst(x, y, PETARD_COLOR);
        const how = what === 4 ? 'En bande !' : what === 2 ? 'Passe !' : 'Refilé !';
        floater(x, y - 0.5, me ? `${how} À toi le pétard !` : online && from === myTankId ? `${how} Bon débarras !` : how, what === 4 ? 0xffd45a : PETARD_COLOR);
        if (audible) sfx.petard(what, me || (online && from === myTankId));
        if (me) controls.rumble(0.5, 140);
        if (demoOn && what === 4 && fromName) toast(`${fromName} le refile en bande à ${name || 'un rival'} !`, 2000);
      } else if (what === 3) {
        floater(x, y - 0.6, 'Tsss…', 0xff6a4a);
        if (audible) sfx.petard(3, me);
        if (online && audible && me) toast('La mèche est presque consumée : refile-le, vite !', 2200);
      } else if (what === 5) {
        renderer.starPuff(x, y, 0.5);
        floater(x, y - 0.4, me ? 'Sonné !' : 'Bing !', 0xffe27a);
        if (audible) sfx.petard(5, me);
        if (me) controls.rumble(0.4, 160);
      } else if (what === 6) {
        renderer.explosion(x, y, true, PETARD_COLOR);
        renderer.bonusBurst(x, y, 0xffd45a, true);
        floater(x, y - 0.7, 'BOUM !', PETARD_COLOR);
        if (audible) sfx.petard(6, me);
        if (online && audible && me) toast(fromName ? `Le pétard t’éclate au nez ! Merci qui ? Merci ${fromName}…` : 'Le pétard t’éclate au nez ! Tu es hors de la manche.', 3000);
        else if ((online && audible) || demoOn) toast(name ? `${name} saute avec le pétard !` : 'Boum !', 2000);
        if (me) controls.rumble(1, 300);
      }
      if (attract && attractVs?.petard) renderVsBoard();
      else renderHud();
      break;
    }
    case 'bonus': {
      const kind = BONUS_KINDS[e[3]];
      if (!kind) break;
      const info = BONUS_INFO[kind];
      renderer.bonusBurst(e[1], e[2], info.color);
      if (renderer.tankKind(e[4]) === 'thief') {
        // a Pilleur got there first (iteration 15)
        renderer.steal(e[4]);
        floater(e[1], e[2], `Volé : ${info.label.toLowerCase()} !`, enemyColor('thief'));
        if (audible) sfx.steal();
        break;
      }
      floater(e[1], e[2], `${info.label} !`, info.color);
      if (audible && kind !== 'freeze') sfx.bonus(); // the frost has its own sound
      // the two crates of iteration 52 explain themselves the first time one is grabbed
      if (online && e[4] === myTankId && (kind === 'ghost' || kind === 'remote') && !crateTips.has(kind)) {
        crateTips.add(kind);
        toast(kind === 'ghost' ? 'Passe-muraille : pendant 10 secondes, tes obus traversent le premier mur qu’ils touchent !' : 'Détonateur : tes mines ne sautent plus au passage… Rappuie sur la touche des mines pour les faire sauter !', 4200);
      }
      break;
    }
    case 'freeze': // « Gel » (iteration 29): a wave of frost from the one who grabbed it
      renderer.frostWave(e[1], e[2]);
      if (audible) sfx.freeze();
      if (e[4] > 0) floater(e[1], e[2] - 0.6, e[4] > 1 ? `${e[4]} tanks gelés !` : 'Un tank gelé !', BONUS_INFO.freeze.color);
      if (renderer.tankKind(e[3]) !== 'player' && online) toast('Brrr ! Un ennemi a pris le gel : te voilà pris dans la glace.', 3000);
      break;
    case 'thaw':
      if (renderer.petardOn) break; // « Le pétard »: the dazed tank comes to its senses (no ice cube to break)
      renderer.thaw(e[1], e[2]);
      if (audible) sfx.thaw();
      break;
    case 'loot': {
      const kind = BONUS_KINDS[e[3]];
      floater(e[1], e[2], 'Le butin !', kind ? BONUS_INFO[kind].color : 0xffc94a);
      break;
    }
    case 'shield':
      renderer.bonusBurst(e[1], e[2], BONUS_INFO.shield.color, true);
      floater(e[1], e[2], 'Bouclier brisé !', BONUS_INFO.shield.color);
      if (audible) sfx.shieldBreak();
      if (e[3] === myTankId && online) controls.rumble(0.5, 140);
      break;
    case 'hurt':
      if (renderer.tankKind(e[3]) === 'steel') {
        // a steel tank loses its armour (the plates fly off when the snapshot says so)
        floater(e[1], e[2], 'Clang ! Blindage arraché', 0x3f6fae);
        if (audible) sfx.clang();
        break;
      }
      renderer.hurt(e[3], e[1], e[2]);
      floater(e[1], e[2], `${e[4]} / ${e[5]}`, enemyColor(renderer.tankKind(e[3]) ?? 'boss'));
      if (audible) sfx.bossHit();
      break;
    case 'flag': {
      // « Drapeaux » (iteration 24): [x, y, flagTeam, tankId, what] what: 0 grabbed, 1 dropped, 2 sent home, 3 brought home
      const [, x, y, team, who, what] = e;
      if (what === 5) { if (online && audible) { toast('Plus que 30 secondes pour rapporter un drapeau !', 3000); sfx.alert(); } break; }
      const color = TEAM_COLORS[team - 1] ?? 0xffffff;
      if (what === 4) {
        // a destroyed tank is back at its base (or its corner, in a hunt)
        renderer.bonusBurst(x, y, currentMode === 'caisses' || currentMode === 'couronne' || attractHunt || attractCrown ? renderer.tankColor(who) ?? color : color);
        if (online && who === myTankId) floaterOnMe('De retour !');
        break;
      }
      const ours = online && team === myTeam;
      renderer.bonusBurst(x, y, what === 3 ? TEAM_COLORS[2 - team] ?? color : color, what === 3);
      floater(x, y, ['Drapeau pris !', 'Drapeau lâché !', 'Drapeau rentré', 'Capturé !'][what] ?? '', what === 3 ? TEAM_COLORS[2 - team] ?? color : color);
      if (audible) sfx.flag(what, ours);
      if (online && audible) {
        if (what === 0 && who === myTankId) toast('Tu as le drapeau ! Rapporte-le à ta base, sans te faire toucher.', 3200);
        else if (what === 0 && ours) toast('Alerte : ils ont pris notre drapeau !', 2600);
        else if (what === 1 && ours) toast('Notre drapeau est à terre : touche-le pour le renvoyer à la base !', 3000);
        else if (what === 1 && myTeam) toast('Leur drapeau est à terre : reprends-le avant qu’il ne rentre !', 2800);
      }
      break;
    }
    case 'catch':
      // the Aimant's magnet caught a shell (iteration 27)
      renderer.magnetCatch(e[3], e[1], e[2]);
      if (e[4] === 1) floater(e[1], e[2], 'Clac !', 0x6fbaff);
      if (audible) sfx.magnetCatch(e[4]);
      break;
    case 'unload':
      // and throws them all back (iteration 27)
      renderer.magnetUnload(e[3], e[1], e[2]);
      if (e[4] > 0) floater(e[1], e[2], e[4] > 1 ? `Retour à l’envoyeur ×${e[4]} !` : 'Retour à l’envoyeur !', 0x6fbaff);
      if (audible) sfx.magnetUnload(e[4]);
      break;
    case 'deflect':
      // a shell bounced off the Rempart's shield (iteration 22)
      renderer.deflect(e[3], e[1], e[2]);
      floater(e[1], e[2], 'Clang !', 0xd9a441);
      if (audible) sfx.deflect();
      break;
    case 'volley':
      renderer.volley(e[1], e[2]);
      if (audible) sfx.volley();
      break;
    case 'warp':
      renderer.warp(e[1], e[2], e[3], e[4], e[5] > 0);
      if (audible) sfx.warp(e[5] > 0);
      break;
    case 'zap':
      renderer.zap(e[1], e[2], e[3]);
      if (audible) sfx.zap();
      break;
    case 'bolt':
      renderer.bolt(e[1], e[2]);
      floater(e[1], e[2], 'Craac !', 0xcfe0ff); // the thunder, written: readable without the sound
      if (audible) sfx.thunder();
      break;
    case 'dig':
      renderer.dig(e[1], e[2]);
      floater(e[1], e[2], 'Il creuse !', 0xd9822b);
      if (audible) sfx.dig();
      break;
    case 'quake':
      renderer.quake(e[1], e[2], e[3]);
      floater(e[1], e[2], 'Le sol tremble !', 0xff8a2a); // the rumble, written: readable without the sound
      if (audible) sfx.quake(e[3]);
      break;
    case 'erupt':
      renderer.erupt(e[1], e[2]);
      floater(e[1], e[2], 'Broum !', 0xd9822b);
      if (audible) sfx.erupt();
      break;
    case 'emote':
      // « Les bulles » (iteration 30): a quick-chat bubble above the tank
      showBubble(e[3], e[4], e[1], e[2]);
      if (audible || attract) sfx.emote(e[4]);
      break;
    case 'rally': {
      // « Suis-moi ! » (iteration 20): a horn, a ring around the leader, and the teammates answer
      // the demo has no tank list from a room: its own game knows the teams
      const who = (id: number): { team: number; pid?: string; color: number } | undefined => attract?.tanks.find((t) => t.id === id) ?? infos.get(id);
      const lead = who(e[3]);
      rallies++;
      floater(e[1], e[2], 'Suis-moi !', lead?.color ?? 0xffd23a);
      renderer.bonusBurst(e[1], e[2], lead?.color ?? 0xffd23a, false);
      if (audible || attract) sfx.rally();
      const mates = lastTanks.filter((t) => t.id !== e[3] && t.alive && who(t.id)?.team === lead?.team && isRivalId(who(t.id)?.pid));
      mates.forEach((t, k) => setTimeout(() => floater(t.x, t.y - 0.3, MATE_LINES[(e[4] + k + e[3]) % MATE_LINES.length], who(t.id)?.color ?? 0xffffff), 380 + k * 220));
      break;
    }
    case 'call':
      renderer.call(e[3], e[1], e[2]);
      floater(e[1], e[2], 'Il appelle la foudre !', 0x8fc0ff);
      if (audible) sfx.call();
      break;
    case 'toot':
      // « Le Tortillard » (iteration 49): the whistle, written for those playing without the sound
      floater(e[1], e[2], 'Tchou-tchou !', 0xffffff);
      if (audible || attract) sfx.whistle();
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
let rallies = 0; // « Suis-moi ! » calls seen (the smoke test checks the round trip)
const MATE_LINES = ['Compris !', 'J’arrive !', 'Je te couvre !', 'En route !', 'À tes ordres !'];

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
let lastLobSound = 0;
let lastGateSound = 0; // « Les interrupteurs » (iteration 40)
let lastMirrorSound = 0; // « Les miroirs » (iteration 57)
const charging = new Set<number>();
const alerted = new Set<number>();
let lastAlert = 0;
/** Health bar of the toughest enemy on the table, and the warning whine when the boss charges a volley. */
function updateBoss(tanks: RTank[], hpOf: (id: number) => number, maxOf: (id: number) => number) {
  // the finale of « La ronde des boss » (iteration 28) has two bosses: the bar adds them up
  const bosses = tanks.filter((t) => t.alive && maxOf(t.id) > 1 && isBossKind(renderer.tankKind(t.id) ?? ''));
  const boss: RTank | undefined = bosses[0];
  const bar = $('#boss-bar');
  for (const t of tanks) {
    const on = !!((t.fx ?? 0) & FLAG_CHARGING) && t.alive;
    if (on && !charging.has(t.id) && online && (renderer.tankKind(t.id) === 'boss' || renderer.tankKind(t.id) === 'sower' || renderer.tankKind(t.id) === 'bombard')) sfx.bossCharge();
    if (on) charging.add(t.id); else charging.delete(t.id);
    const seen = !!((t.fx ?? 0) & FLAG_ALERT) && t.alive;
    if (seen && !alerted.has(t.id) && online && performance.now() - lastAlert > 400) { sfx.alert(); lastAlert = performance.now(); }
    if (seen) alerted.add(t.id); else alerted.delete(t.id);
  }
  if (!boss || screen !== 'game') {
    if (bossKey) { bar.hidden = true; bar.classList.remove('rage'); bossKey = ''; }
    return;
  }
  let hp = 0, max = 0;
  for (const b of bosses) { hp += hpOf(b.id); max += maxOf(b.id); }
  const key = `${bosses.map((b) => b.id).join('+')}:${hp}/${max}`;
  if (key === bossKey) return;
  bossKey = key;
  bar.hidden = false;
  bar.classList.toggle('rage', bosses.some((b) => hpOf(b.id) <= maxOf(b.id) / 2));
  const bossKind = renderer.tankKind(boss.id) ?? 'boss';
  $('#boss-name').textContent = bosses.map((b) => specOf(renderer.tankKind(b.id) ?? 'boss').label).join(' + ');
  bar.classList.toggle('duo', bosses.length > 1);
  bar.classList.toggle('drill', bossKind === 'drill');
  bar.classList.toggle('thunder', bossKind === 'thunder');
  bar.classList.toggle('sower', bossKind === 'sower');
  bar.classList.toggle('bombard', bossKind === 'bombard');
  bar.classList.toggle('train', bossKind === 'train');
  bar.classList.toggle('magus', bossKind === 'magus');
  $('#boss-hp').textContent = `${hp} / ${max}`;
  $('#boss-fill').style.width = `${(100 * hp) / max}%`;
}

// ------------------------------------------------------------------ « Les bulles » (iteration 30): quick chat

const bubbles = new Map<number, { el: HTMLDivElement; until: number; x: number; y: number }>();
let bubblesShown = 0;

/** A comic-strip bubble above a tank, in its colour, that follows it for EMOTE_TIME seconds. */
function showBubble(id: number, n: number, x: number, y: number) {
  const text = EMOTES[n];
  if (!text) return;
  bubbles.get(id)?.el.remove();
  const el = document.createElement('div');
  el.className = 'bubble';
  el.style.setProperty('--c', hex(attract?.tankById(id)?.color ?? renderer.tankColor(id) ?? infos.get(id)?.color ?? 0xffffff));
  const inner = document.createElement('span');
  inner.className = `e${n}`;
  inner.innerHTML = `${icon(EMOTE_ICONS[n] ?? 'chat')} ${escapeHtml(text)}`; // « Les finitions » (iteration 46): each line has its icon
  el.appendChild(inner);
  floatLayer.appendChild(el);
  bubbles.set(id, { el, until: performance.now() + EMOTE_TIME * 1000, x, y });
  bubblesShown++;
  placeBubbles();
}

function placeBubbles() {
  if (!bubbles.size) return;
  const now = performance.now();
  for (const [id, b] of bubbles) {
    if (now > b.until) { b.el.remove(); bubbles.delete(id); continue; }
    const t = lastTanks.find((k) => k.id === id);
    if (t) { b.x = t.x; b.y = t.y; }
    const p = renderer.arenaToScreen(b.x, b.y, 1.2);
    b.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    if (now > b.until - 300) b.el.classList.add('out');
  }
}

function clearBubbles() {
  for (const b of bubbles.values()) b.el.remove();
  bubbles.clear();
}

let lastEmoteAt = 0;
/** Ask the room to show line n above my tank (keys 1 to 6, the d-pad or the « Bulles » button). */
function sayEmote(n: number) {
  closeEmotePad();
  if (!online || screen !== 'game' || !EMOTES[n]) return;
  const now = performance.now();
  if (now - lastEmoteAt < EMOTE_GAP * 1000) return;
  lastEmoteAt = now;
  send({ t: 'emote', n });
}

const emotePad = $('#emote-pad');
emotePad.innerHTML = EMOTES.map((t, i) => `<button data-emote="${i}" class="e${i}"><kbd>${i + 1}</kbd>${icon(EMOTE_ICONS[i])} ${t}</button>`).join('');
function closeEmotePad() { $('#emote-pad').hidden = true; } // (safe before the pad is filled)
$('#hud-emote').addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  emotePad.hidden = !emotePad.hidden;
  if (!emotePad.hidden) sfx.click();
});
emotePad.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-emote]');
  if (b) { b.blur(); sayEmote(Number(b.dataset.emote)); }
});

// « La roue des bulles » (iteration 46): hold the right button over the table, slide toward a line, let go.
// A quick right click still lays a mine. The wheel stays on the screen side of the pointer, never outside the window.
const WHEEL_R = 96;
const wheelEl = document.createElement('div');
wheelEl.id = 'emote-wheel';
wheelEl.hidden = true;
wheelEl.innerHTML = `<div class="w-disc"></div><div class="w-pointer"></div>${EMOTES.map((t, i) => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / EMOTES.length;
  return `<div class="w-item e${i}" style="--x:${(Math.cos(a) * WHEEL_R).toFixed(1)}px;--y:${(Math.sin(a) * WHEEL_R).toFixed(1)}px">${icon(EMOTE_ICONS[i])}<span>${t}</span></div>`;
}).join('')}<div class="w-hub">${icon('chat')}</div>`;
document.body.appendChild(wheelEl);
const wheel = { x: 0, y: 0, sel: -1, opened: 0 };
/** Which line the pointer points at, -1 in the middle of the wheel. */
function wheelPick(px: number, py: number) {
  const dx = px - wheel.x, dy = py - wheel.y;
  if (Math.hypot(dx, dy) < 26) return -1;
  const step = (2 * Math.PI) / EMOTES.length;
  return ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / step) % EMOTES.length) + EMOTES.length) % EMOTES.length;
}
function wheelSelect(n: number) {
  if (n === wheel.sel) return;
  wheel.sel = n;
  wheelEl.querySelectorAll('.w-item').forEach((el, i) => el.classList.toggle('on', i === n));
  wheelEl.classList.toggle('picked', n >= 0);
  if (n >= 0) { wheelEl.style.setProperty('--a', `${(n * 360) / EMOTES.length}deg`); sfx.wheelTick(n); }
}
function openWheel(x: number, y: number) {
  const m = WHEEL_R + 62;
  wheel.x = Math.max(m, Math.min(innerWidth - m, x));
  wheel.y = Math.max(m - 20, Math.min(innerHeight - m + 20, y));
  wheel.sel = -2;
  wheelSelect(-1);
  wheelEl.style.left = `${wheel.x}px`;
  wheelEl.style.top = `${wheel.y}px`;
  wheelEl.hidden = false;
  wheelEl.classList.remove('out');
  wheel.opened = performance.now();
  document.body.classList.add('wheel-open');
  sfx.wheelOpen();
}
function closeWheel(say: boolean) {
  if (wheelEl.hidden) return -1;
  const n = wheel.sel;
  document.body.classList.remove('wheel-open');
  wheelEl.classList.add('out');
  setTimeout(() => { if (wheelEl.classList.contains('out')) wheelEl.hidden = true; }, 160);
  if (!say || n < 0) { sfx.wheelClose(); return -1; }
  return n;
}
controls.wheel = (phase, x, y) => {
  if (phase === 'open') {
    if (!online || screen !== 'game' || council || treeOpen || reel || !$('#menu').hidden) return false;
    closeEmotePad();
    openWheel(x, y);
    return true;
  }
  if (phase === 'move') { wheelSelect(wheelPick(x, y)); return true; }
  const n = closeWheel(phase === 'close');
  if (n >= 0) sayEmote(n);
  return true;
};

addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.repeat || council || treeOpen || !online || screen !== 'game') return;
  const m = e.code.match(/^(?:Digit|Numpad)([1-6])$/);
  if (m) sayEmote(Number(m[1]) - 1);
});

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

/** Player name of a tank (online: from the level infos; demo: from the local game). */
function tankName(id: number) {
  return infos.get(id)?.name ?? attract?.tankById(id)?.name;
}

// ------------------------------------------------------------------ mole mode (iteration 8)

function renderRole() {
  const el = $('#hud-role');
  el.hidden = myRole === undefined || !online || currentMode !== 'taupe';
  el.className = myRole ? 'mole' : 'loyal';
  el.innerHTML = myRole ? `${icon('mask')} Tu es la taupe` : `${icon('shield')} Loyal`;
}

function showRoleBanner(mole: boolean) {
  if (mole) banner('Rôle secret', 'Tu es la taupe !', 'Fais échouer les missions sans te faire démasquer. Un ricochet « malheureux » est vite arrivé…', 'intro mole');
  else banner('Rôle secret', 'Tu es loyal', 'Une taupe se cache parmi vous : finissez les 3 missions ou démasquez-la au conseil.', 'intro loyal');
}

/** The council card: vote buttons while it runs, then the ballots and the verdict. Also used by the demo with made-up players. */
function renderCouncil(c: CouncilState, players: PlayerInfo[], me: string, vote: string | undefined) {
  const el = $('#council');
  el.hidden = false;
  el.dataset.done = c.done ? '1' : '';
  const byId = new Map(players.map((p) => [p.id, p]));
  const canVote = !c.done && c.voters.includes(me);
  el.querySelector('.c-kicker')!.textContent = `Conseil · ${c.why === 'cleared' ? 'mission réussie' : 'mission échouée'}`;
  el.querySelector('.c-title')!.textContent = c.done ? 'Le conseil a tranché' : 'Qui est la taupe ?';
  el.querySelector('.c-sub')!.textContent = c.done
    ? ''
    : canVote ? 'Accuse un joueur (touches 1 à 4) ou personne (0). Une erreur coûte une vie !' : 'Les joueurs votent…';
  const tally = new Map<string, string[]>();
  if (c.done && c.votes) for (const [v, t] of Object.entries(c.votes)) if (t) tally.set(t, [...(tally.get(t) ?? []), v]);
  const row = (id: string, i: number) => {
    const p = byId.get(id);
    const name = p ? escapeHtml(p.name) : '?';
    const cls = [vote === id && !c.done ? 'on' : '', c.done && c.accused === id ? (c.wasMole ? 'unmasked' : 'accused') : ''].join(' ');
    const by = (tally.get(id) ?? []).map((v) => `<i class="dot" style="--c:${hex(byId.get(v)?.color ?? 0x888888)}"></i>`).join('');
    const right = c.done ? `<span class="by">${by}</span>` : c.voted.includes(id) ? '<span class="ok">✓ a voté</span>' : '<span class="tally">réfléchit…</span>';
    return `<button data-v="${escapeHtml(id)}" class="${cls}" ${!canVote || id === me ? 'disabled' : ''}><i class="dot" style="--c:${hex(p?.color ?? 0x888888)}"></i><span class="nm">${name}${id === me ? ' <em>(toi)</em>' : ''}</span>${canVote && id !== me ? `<kbd>${i + 1}</kbd>` : ''}${right}</button>`;
  };
  const nobody = c.done ? '' : `<button data-v="" class="${vote === '' ? 'on' : ''}" ${canVote ? '' : 'disabled'}><span class="nm">Personne</span>${canVote ? '<kbd>0</kbd>' : ''}</button>`;
  el.querySelector('.c-votes')!.innerHTML = c.voters.map(row).join('') + nobody;
  $<HTMLElement>('#council .c-timer i').style.width = `${(100 * c.left) / (c.done ? VERDICT_SECONDS : COUNCIL_SECONDS)}%`;
  const v = el.querySelector('.c-verdict')!;
  if (!c.done) { v.textContent = ''; v.className = 'c-verdict'; return; }
  const acc = c.accused ? byId.get(c.accused)?.name ?? '?' : '';
  v.className = `c-verdict ${c.accused ? (c.wasMole ? 'good' : 'bad') : ''}`;
  v.textContent = !c.accused
    ? 'Pas de majorité : personne n’est accusé.'
    : c.wasMole ? `${acc} était la taupe ! Démasquée !` : `${acc} était loyal… Vous perdez une vie.`;
}

function councilVerdictSfx(c: CouncilState) {
  if (!c.accused) sfx.click();
  else if (c.wasMole) sfx.jingle('clear');
  else sfx.jingle('fail');
}

/** Council timer bar, run locally between messages. */
function updateCouncilTimer() {
  if (!council || $('#council').hidden) return;
  const total = council.done ? VERDICT_SECONDS : COUNCIL_SECONDS;
  const left = Math.max(0, council.left - (performance.now() - councilAt) / 1000);
  $<HTMLElement>('#council .c-timer i').style.width = `${(100 * left) / total}%`;
}

function castVote(who: string) {
  if (!council || council.done || !council.voters.includes(pid) || who === pid) return;
  myVote = who;
  sfx.click();
  send({ t: 'vote', who });
  renderCouncil(council, lobbyPlayers, pid, myVote);
}
$('#council').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
  if (b && !b.disabled && online) castVote(b.dataset.v ?? '');
});
// a gamepad plugged in mid-game: say how it plays (iteration 13, players asked for it)
addEventListener('gamepadconnected', () => {
  toast('Manette prête : stick gauche pour rouler, stick droit pour viser, gâchette droite (ou X) pour tirer, gâchette gauche (ou A) pour une mine.', 5000);
});

addEventListener('keydown', (e) => {
  if (!council || !online || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
  const m = e.code.match(/^(?:Digit|Numpad)([0-4])$/);
  if (!m) return;
  const n = Number(m[1]);
  if (n === 0) castVote('');
  else if (council.voters[n - 1]) castVote(council.voters[n - 1]);
});

// ------------------------------------------------------------------ coop campaign: galons and the skill tree (iteration 19)

function myProg(): Progress | undefined {
  return treeDemo ?? prog[pid];
}

function onProgress(msg: Extract<ServerMsg, { t: 'phase' }>, prev: Phase, tally?: Tally) {
  const before = prog[pid];
  prog = msg.prog ?? {};
  training = msg.training ?? [];
  const now = prog[pid];
  if (now && before && now.g > before.g) {
    const free = freeGalons(now);
    floaterOnMe(now.g - before.g > 1 ? `+${now.g - before.g} galons !` : '+1 galon !');
    if (msg.phase === 'playing') toast(`Nouveau galon ! ${free} à dépenser : touche K ou bouton ★ (effet à la mission suivante).`, 3200);
    sfx.bonus();
  }
  if (!now && !treeDemo) { if (treeOpen) closeTree(); return; }
  if (msg.phase === 'cleared' && training.includes(pid) && prev !== 'cleared') {
    // « Le bilan » (iteration 45): the sheet first (the room gave it the time), then the skill tree
    const wait = tally ? sheetLength() + 600 : 0;
    treeEnd = performance.now() + TRAINING_SECONDS * 1000 + wait;
    if (wait) treeDue = performance.now() + wait;
    else openTree(true);
  } else if (msg.phase !== 'cleared' && (treeAuto || treeDue)) { treeDue = 0; closeTree(); }
  else if (treeOpen) drawTree();
}

function floaterOnMe(text: string) {
  const me = lastTanks.find((t) => t.id === myTankId);
  if (me) floater(me.x, me.y - 0.4, text, 0xffd23a);
}

function drawTree() {
  const p = myProg();
  if (!p) return;
  const isTraining = treeAuto && (training.includes(pid) || !!treeDemo) && (phase === 'cleared' || !!treeDemo);
  renderTree($('#skills'), { prog: p, training: isTraining, left: Math.max(0, (treeEnd - performance.now()) / 1000), total: TRAINING_SECONDS, flash: treeFlash });
  treeFlash = undefined;
}

function openTree(auto = false) {
  if (!myProg()) return;
  treeOpen = true;
  treeAuto = auto;
  if (auto) hideBanner(); // the card says « Mission réussie » itself
  drawTree();
  if (!auto) sfx.click();
}

function closeTree() {
  treeOpen = false;
  treeAuto = false;
  $('#skills').hidden = true;
}

function buySkill(b: number) {
  const p = myProg();
  if (!p || !canBuy(p, b)) return;
  sfx.build();
  treeFlash = b;
  if (treeDemo) { treeDemo.r[b]++; drawTree(); return; }
  send({ t: 'skill', b });
}

function treeReady() {
  if (!treeDemo && training.includes(pid)) send({ t: 'skill', b: -1 });
  closeTree();
}

function updateTreeTimer() {
  if (!treeOpen || !treeAuto) return;
  const bar = document.querySelector<HTMLElement>('#skills .s-timer i');
  if (bar) bar.style.width = `${(100 * Math.max(0, treeEnd - performance.now())) / (TRAINING_SECONDS * 1000)}%`;
}

$('#skills').addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const node = el.closest<HTMLButtonElement>('button[data-b]');
  if (node && !node.disabled) { buySkill(Number(node.dataset.b)); return; }
  if (el.closest('button[data-ready]')) treeReady();
});
$('#hud-galons').addEventListener('click', () => (treeOpen ? treeReady() : openTree()));
addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || council) return;
  if (e.code === 'KeyK' && !e.repeat && (online && currentMode === 'coop' || treeDemo)) { if (treeOpen) treeReady(); else openTree(); return; }
  if (!treeOpen) return;
  const m = e.code.match(/^(?:Digit|Numpad)([1-3])$/);
  if (m) buySkill(Number(m[1]) - 1);
});

function renderGalons() {
  const el = $<HTMLButtonElement>('#hud-galons');
  const p = prog[pid];
  el.hidden = !(online && currentMode === 'coop' && p);
  if (!p || el.hidden) return;
  const free = freeGalons(p);
  el.classList.toggle('has', canBuyAny(p));
  el.innerHTML = `★ <b>${free}</b><i style="width:${(100 * (p.xp % XP_PER_GALON)) / XP_PER_GALON}%"></i>`;
  el.title = `${free} galon${free > 1 ? 's' : ''} à dépenser · ${p.xp} XP (touche K : l’arbre des galons)`;
}

function renderHud() {
  renderGalons();
  const livesEl = $('#hud-lives');
  livesEl.innerHTML = coopLike(currentMode) ? `<span class="tank-ico"></span> × ${lives}` : '';
  livesEl.title = coopLike(currentMode) ? `${lives} vie${lives > 1 ? 's' : ''} pour toute l’équipe` : '';
  const myColor = infos.get(myTankId)?.color;
  if (myColor !== undefined) $('#hud').style.setProperty('--me', hex(myColor));
  renderRole();
  $('#hud-rally').hidden = !hasMates();
  $('#hud-emote').hidden = !online;
  if (!online) closeEmotePad();
  const sb = $('#scoreboard');
  if (teamPlay(currentMode)) {
    sb.innerHTML = TEAM_NAMES.map((n, i) => `<div class="sb-row ctf${myTeam === i + 1 ? ' mine' : ''}"><i style="--c:${hex(TEAM_COLORS[i])}"></i><span>${n}</span><b>${teamScores[i]}</b></div>`).join('');
  } else if (currentMode === 'caisses') {
    // « La chasse aux caisses » (iteration 37): crates this round, then rounds won
    sb.innerHTML = [...infos.values()]
      .filter((t) => t.kind === 'player')
      .map((t) => ({ t, n: huntGot.get(t.id) ?? 0 }))
      .sort((a, b) => b.n - a.n)
      .map(({ t, n }) => `<div class="sb-row hunt${t.id === myTankId ? ' mine' : ''}"><i style="--c:${hex(t.color)}"></i><span>${escapeHtml(t.name ?? '?')}${isRivalId(t.pid ?? '') ? ' <em>IA</em>' : ''}</span><em class="crates" title="Caisses de la manche">▣ ${n}</em><b title="Manches gagnées">${scores[t.pid ?? ''] ?? 0}</b></div>`)
      .join('');
  } else if (currentMode === 'couronne') {
    // « La couronne » (iteration 50): the reign of each tank this round (a gauge up to the throne), then rounds won
    sb.innerHTML = crownRows([...infos.values()].filter((t) => t.kind === 'player').map((t) => ({
      id: t.id, name: t.name ?? '?', color: t.color, bot: isRivalId(t.pid ?? ''), tenths: crownHeld.get(t.id) ?? 0, rounds: scores[t.pid ?? ''] ?? 0, mine: t.id === myTankId, king: t.id === crownHolder,
    })));
  } else if (currentMode === 'petard') {
    // « Le pétard » (iteration 61): who carries it, who is out, handovers this round, then rounds won
    const snap = snaps[snaps.length - 1];
    sb.innerHTML = petardRows([...infos.values()].filter((t) => t.kind === 'player').map((t) => ({
      name: t.name ?? '?', color: t.color, bot: isRivalId(t.pid ?? ''), passes: petardPasses.get(t.id) ?? 0, rounds: scores[t.pid ?? ''] ?? 0, mine: t.id === myTankId,
      hot: t.id === petardHolder, out: !!snap && !((snap.T.get(t.id)?.[5] ?? 1) & 1),
    })));
  } else if (currentMode === 'versus') {
    sb.innerHTML = lobbyPlayers
      .filter((p) => scores[p.id] !== undefined)
      .sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0))
      .map((p) => `<div class="sb-row"><i style="--c:${hex(p.color)}"></i><span>${escapeHtml(p.name)}${p.bot !== undefined ? ' <em>IA</em>' : ''}</span><b>${scores[p.id] ?? 0}</b></div>`)
      .join('');
  } else sb.innerHTML = '';
  const isHost = lobbyPlayers.find((p) => p.id === pid)?.host;
  $('#menu-lobby').hidden = !isHost;
}

/** « Le pétard » (iteration 61): the scoreboard rows, most rounds first; the carrier's row burns, the blown-up ones are struck out. */
function petardRows(rows: { name: string; color: number; bot: boolean; passes: number; rounds: number; mine: boolean; hot: boolean; out: boolean }[]) {
  return rows.sort((a, b) => b.rounds - a.rounds || Number(a.out) - Number(b.out))
    .map((r) => `<div class="sb-row petard${r.mine ? ' mine' : ''}${r.hot ? ' hot' : ''}${r.out ? ' out' : ''}"><i style="--c:${hex(r.color)}"></i><span>${r.hot ? `${icon('petard')} ` : ''}${escapeHtml(r.name)}${r.bot ? ' <em>IA</em>' : ''}</span><em class="passes" title="Pétards refilés cette manche">⇄ ${r.passes}</em><b title="Manches gagnées">${r.rounds}</b></div>`)
    .join('');
}

/** « La couronne » (iteration 50): the scoreboard rows, longest reign first; the crowned tank's row glows. */
function crownRows(rows: { id: number; name: string; color: number; bot: boolean; tenths: number; rounds: number; mine: boolean; king: boolean }[]) {
  return rows.sort((a, b) => b.tenths - a.tenths)
    .map((r) => `<div class="sb-row crown${r.mine ? ' mine' : ''}${r.king ? ' king' : ''}"><i style="--c:${hex(r.color)}"></i><span>${escapeHtml(r.name)}${r.bot ? ' <em>IA</em>' : ''}</span><em class="reign" title="Secondes de règne (${CROWN_HOLD} pour gagner la manche)"><u style="width:${Math.min(100, r.tenths / (CROWN_HOLD * 10) * 100).toFixed(1)}%"></u>${Math.floor(r.tenths / 10)} s</em><b title="Manches gagnées">${r.rounds}</b></div>`)
    .join('');
}

function renderLobby() {
  const me = lobbyPlayers.find((p) => p.id === pid);
  const isHost = !!me?.host;
  $('#room-code').textContent = roomCode;
  // « Drapeaux » (iteration 24): the tanks of the list take turns, one for the Bleus, one for the Rouges
  const order = lobbyPlayers.filter((p) => p.connected);
  const teamTag = (p: PlayerInfo) => {
    if (!teamPlay(lobbyMode)) return '';
    const k = order.indexOf(p);
    return k < 0 ? '' : `<b class="team-tag" style="--c:${hex(TEAM_COLORS[ctfTeam(k) - 1])}">${TEAM_NAMES[ctfTeam(k) - 1]}</b>`;
  };
  $('#lobby-players').innerHTML = Array.from({ length: 4 }, (_, i) => {
    const p = lobbyPlayers[i];
    if (!p) return `<li class="empty"><i></i><span>En attente d'un joueur…</span></li>`;
    const w = p.id === pid ? myWeapon : p.weapon ?? 'canon';
    if (p.bot !== undefined) {
      // a versus rival (iteration 17) or a coop teammate (iteration 20): the host changes its level with a click, or sends it home
      const lvl = RIVAL_LEVELS[rivalLevel(p.bot)];
      const who = lobbyMode === 'coop' ? 'ce coéquipier' : 'ce rival';
      return `<li style="--c:${hex(p.color)}" class="rival"><i></i><span>${escapeHtml(p.name)} <em>(IA)</em></span>${teamTag(p)}<b class="wpn">${WEAPON_INFO[w].label}</b>`
        + `<button class="rival-lvl lv${rivalLevel(p.bot)}" data-rival-lvl="${escapeHtml(p.id)}" ${isHost ? '' : 'disabled'} title="${lvl.desc}${isHost ? ' (clique pour changer)' : ''}">${lvl.label}</button>`
        + (isHost ? `<button class="rival-del" data-rival-del="${escapeHtml(p.id)}" title="Retirer ${who}" aria-label="Retirer ${who}">×</button>` : '') + '</li>';
    }
    return `<li style="--c:${hex(p.color)}" class="${p.connected ? '' : 'off'}"><i></i><span>${escapeHtml(p.name)}${p.id === pid ? ' <em>(toi)</em>' : ''}</span>${teamTag(p)}<b class="wpn">${WEAPON_INFO[w].label}</b>${p.host ? '<b class="host">Hôte</b>' : ''}</li>`;
  }).join('');
  const rivalBox = $('#rival-select');
  rivalBox.hidden = !rivalMode(lobbyMode) || !isHost;
  const mates = lobbyMode === 'coop';
  rivalBox.querySelector('.kicker')!.textContent = mates ? 'Coéquipiers' : 'Rivaux';
  $('#btn-rival').textContent = mates ? '+ Ajouter un coéquipier (IA)' : '+ Ajouter un rival (IA)';
  const full = lobbyPlayers.filter((p) => p.connected).length >= 4 || lobbyPlayers.filter((p) => p.bot !== undefined).length >= MAX_RIVALS;
  $<HTMLButtonElement>('#btn-rival').disabled = full || phase !== 'lobby';
  document.querySelectorAll<HTMLButtonElement>('#mode-select button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === lobbyMode);
    b.disabled = !isHost;
  });
  const start = $<HTMLButtonElement>('#btn-start');
  start.hidden = !isHost;
  $('#lobby-wait').hidden = isHost;
  const n = lobbyPlayers.filter((p) => p.connected).length;
  const need = needsTwo(lobbyMode) ? 2 : lobbyMode === 'taupe' ? TAUPE_MIN_PLAYERS : 1;
  const noMap = lobbyMode === 'atelier' && !lobbyAtelier;
  start.disabled = n < need || noMap;
  start.textContent = n < need ? (needsTwo(lobbyMode) ? 'Ajoute un rival ou invite un ami' : `Il faut ${need} joueurs`) : noMap ? 'Dessine d’abord ta mission' : phase === 'lobby' ? 'Lancer la partie' : 'Partie en cours…';
  renderLobbyAtelier(isHost);
  const today = dayNumber();
  $('#mode-desc').textContent = lobbyMode === 'daily'
    ? `Défi du jour (${dayLabel(today)}) : ${DAILY_STAGES} missions générées, les mêmes pour tout le monde aujourd’hui, avec 3 vies et sans vie bonus. Consigne du jour : ${TWIST_INFO[dailyTwist(today)].label.toLowerCase()}. ${TWIST_INFO[dailyTwist(today)].desc} Le chrono décide du classement.`
    : lobbyMode === 'rush'
    ? `La ronde des boss : ${cap(rushOrder(weekNumber(today)).map((b) => BOSS_NAMES[b]).join(', '))}, l’un après l’autre, puis le bouquet final : ${BOSS_NAMES[rushDuo(weekNumber(today))[0]]} et ${BOSS_NAMES[rushDuo(weekNumber(today))[1]]} ensemble. ${RUSH_LIVES} vies, sans vie bonus ; les coups portés restent acquis quand on recommence. L’ordre change chaque lundi, et le chrono décide du classement de la semaine.`
    : lobbyMode === 'taupe'
    ? `La taupe (${TAUPE_MIN_PLAYERS} ou 4 joueurs) : ${TAUPE_STAGES} missions en coop… mais l’un de vous, tiré au sort en secret, veut les faire échouer. Après chaque mission, le conseil vote : démasquez la taupe pour gagner, mais accuser un innocent coûte une vie. La taupe gagne si vous perdez vos 3 vies.`
    : lobbyMode === 'atelier'
    ? (lobbyAtelier
      ? `Atelier : « ${lobbyAtelier.name} », une mission dessinée par l’hôte, à jouer en coop avec ${ATELIER_LIVES} vies.${lobbyAtelier.night ? ' De nuit.' : ''}${lobbyAtelier.storm ? ' Sous l’orage.' : ''}${lobbyAtelier.wind ? ' Dans le vent.' : ''}${lobbyAtelier.fog ? ' Dans le brouillard.' : ''}`
      : 'Atelier : l’hôte dessine sa propre mission (murs, liège, trous, tunnels, portails, ennemis et même un boss), puis vous la jouez en coop.')
    : lobbyMode === 'coop'
    ? `Campagne coopérative : ${LEVELS.length + Object.keys(EXTRA_LEVELS).length} missions faites main, mêlées aux missions générées à l’infini, avec un boss toutes les 10 missions. Vies partagées, +1 vie toutes les 5 missions. Des caisses bonus tombent pendant les missions. Pas assez de monde ? Ajoute jusqu’à 3 coéquipiers pilotés par l’ordinateur.`
    : lobbyMode === 'drapeau'
    ? `Drapeaux : les Bleus contre les Rouges (les tanks de la liste sont répartis un sur deux). Chaque équipe a son drapeau planté à sa base : file prendre celui d’en face et rapporte-le chez toi pour gagner la manche. Un tank touché revient à sa base ${CTF_RESPAWN} secondes plus tard ; le porteur touché lâche le drapeau, et un coéquipier le renvoie à la base d’un simple contact. Sans drapeau rapporté en ${Math.floor(CTF_ROUND / 60)} min ${CTF_ROUND % 60}, c’est l’égalité. Première équipe à ${CTF_TARGET} manches. Les rivaux pilotés par l’ordinateur complètent les équipes.`
    : lobbyMode === 'caisses'
    ? `La chasse aux caisses : chacun pour soi, ${HUNT_ROUND} secondes par manche, et les caisses pleuvent. Chaque caisse ramassée vaut un point (et son bonus). Un tank touché lâche une de ses caisses et revient dans son coin ${HUNT_RESPAWN_TXT} secondes plus tard. À ${HUNT_GOLD_AT} secondes de la fin tombe la caisse dorée : ${HUNT_GOLD} points d’un coup ! Le plus gros tas gagne la manche, premier à ${HUNT_TARGET} manches. Ajoute des rivaux pilotés par l’ordinateur si vous êtes peu.`
    : lobbyMode === 'ballon'
    ? `Le ballon : les Bleus contre les Rouges (les tanks de la liste sont répartis un sur deux), un gros ballon de plage au milieu de la table et un but de chaque côté. Chaque obus qui frappe le ballon le fait rouler, chaque tank qui fonce dedans le pousse, et le souffle d’une mine l’envoie valser. Un but gagne la manche, et la première équipe à ${BALL_TARGET} buts remporte le match. Un tank touché revient sur son terrain ${BALL_RESPAWN_TXT} secondes plus tard. Gare aux ricochets : le tir ami compte ! Pas assez de joueurs ? Ajoute des rivaux.`
    : lobbyMode === 'petard'
    ? `Le pétard : chacun pour soi, et un pétard allumé sur le dos de l’un des tanks. Ici, les obus ne détruisent personne : ils sonnent une seconde. Pour te débarrasser du pétard, fonce dans un autre tank ou touche-le d’un obus (en bande, c’est plus beau). Quand la mèche est consumée : boum, son porteur sort de la manche et un nouveau pétard s’allume. Le dernier debout gagne. Premier à ${PETARD_TARGET} manches. Seul ou à deux ? Ajoute des rivaux pilotés par l’ordinateur.`
    : lobbyMode === 'couronne'
    ? `La couronne : chacun pour soi, et une seule couronne posée sur son coussin au milieu de la table. Roule dessus pour la mettre : chaque seconde passée couronné compte, et ${CROWN_HOLD} secondes en tout font gagner la manche. Touché ? Elle tombe là où tu es, et le premier qui passe la ramasse ; laissée à terre ${CROWN_RETURN} secondes, elle rentre sur son coussin. Un tank touché revient dans son coin ${CROWN_RESPAWN_TXT} secondes plus tard. Au bout de ${Math.floor(CROWN_ROUND / 60)} min ${CROWN_ROUND % 60}, le plus long règne l’emporte. Premier à ${CROWN_TARGET} manches. Ajoute des rivaux pilotés par l’ordinateur si vous êtes peu.`
    : 'Chacun pour soi : le dernier tank debout marque un point. Premier à 5 manches. Les caisses bonus tombent plus souvent : fonce les chercher ! Seul ou à deux ? Ajoute des rivaux pilotés par l’ordinateur.';
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

// versus rivals (iteration 17): add one, change its level, send it home
$('#btn-rival').addEventListener('click', () => { sfx.click(); send({ t: 'rival', op: 'add' }); });
$('#lobby-players').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-rival-lvl], button[data-rival-del]');
  if (!b || b.disabled) return;
  sfx.click();
  if (b.dataset.rivalLvl) send({ t: 'rival', op: 'lvl', id: b.dataset.rivalLvl });
  else send({ t: 'rival', op: 'del', id: b.dataset.rivalDel });
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

// ------------------------------------------------------------------ the workshop (iteration 14)

let workshopBack: Screen = 'home'; // where « Fermer » goes back to
const workshop = new Workshop($('#atelier'), {
  click: () => sfx.click(),
  place: (ch) => (ch === '.' ? sfx.click() : sfx.build()),
  close: () => { sfx.click(); show(roomCode ? 'lobby' : workshopBack === 'atelier' ? 'home' : workshopBack); },
  share: async (a) => {
    sfx.click();
    const url = `${location.origin}/#atelier=${encodeAtelier(a)}`;
    try {
      if (navigator.share && controls.touchMode) await navigator.share({ title: `Tanks! · ${a.name}`, url });
      else { await navigator.clipboard.writeText(url); toast('Lien de la mission copié : envoie-le à tes amis !'); }
    } catch {}
  },
  play: (a) => {
    sfx.click();
    const me = lobbyPlayers.find((p) => p.id === pid);
    if (roomCode && ws?.readyState === WebSocket.OPEN) {
      if (!me?.host) { toast('Seul l’hôte de la salle choisit la mission. Copie le lien pour la partager !'); return; }
      if (phase !== 'lobby') { toast('Une partie est en cours : attends le retour au salon.'); return; }
      send({ t: 'atelier', ...a });
      show('lobby');
      return;
    }
    wantAtelier = a;
    void createRoom($<HTMLButtonElement>('#btn-atelier'));
  },
});

function openWorkshop(a?: AtelierMap) {
  if (screen !== 'atelier') workshopBack = screen;
  if (a) workshop.set(a);
  show('atelier');
  workshop.open();
}

/** Lobby: preview of the room's workshop mission, with a button to edit it (host) or copy it (others). */
function renderLobbyAtelier(isHost: boolean) {
  const box = $('#lobby-atelier');
  box.hidden = lobbyMode !== 'atelier';
  if (box.hidden) return;
  const cv = box.querySelector('canvas')!;
  cv.hidden = !lobbyAtelier;
  if (lobbyAtelier) {
    requestAnimationFrame(() => drawMap(cv, lobbyAtelier!.map));
    const kinds = atelierKinds(lobbyAtelier.map);
    box.querySelector('.la-tanks')!.innerHTML = kinds.map((k) => `<span style="--c:${hex(enemyColor(k))}">${specOf(k).label}</span>`).join('');
  } else box.querySelector('.la-tanks')!.innerHTML = '';
  const btn = box.querySelector<HTMLButtonElement>('button')!;
  btn.textContent = isHost ? (lobbyAtelier ? 'Modifier dans l’atelier' : 'Ouvrir l’atelier') : 'Copier dans mon atelier';
  btn.disabled = !isHost && !lobbyAtelier;
}
$('#lobby-atelier button').addEventListener('click', () => {
  sfx.click();
  const host = lobbyPlayers.find((p) => p.id === pid)?.host;
  openWorkshop(lobbyAtelier);
  if (!host && lobbyAtelier) toast('Copie gardée dans ton atelier : tu peux la modifier et la partager.');
});
$('#btn-atelier').addEventListener('click', () => { sfx.click(); openWorkshop(); });


// ------------------------------------------------------------------ daily challenge

/** Running time of the daily run, ticking locally while the fight is on. */
function updateClock() {
  const el = $('#hud-clock');
  const st = dailyState ?? rushState;
  el.hidden = !st || !online;
  if (el.hidden || !st) return;
  const extra = phase === 'playing' ? Math.max(0, latestK - dailyK) : 0;
  const label = dailyState ? TWIST_INFO[dailyState.twist]?.label ?? '' : `Semaine du ${weekLabel(rushState!.week)}`;
  el.innerHTML = `⏱ ${formatTicks(st.ticks + extra)}<span>${escapeHtml(label)}</span>`;
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

const ordinal = (n: number) => `${n}<sup>${n === 1 ? 'er' : 'e'}</sup>`;

function boardHtml(b: BoardDay | undefined, highlight?: number, stages = DAILY_STAGES, rush = false) {
  if (!b) return '<li class="empty">Classement indisponible pour l’instant.</li>';
  if (!b.entries.length) return !rush ? '<li class="empty">Personne n’a encore relevé ce défi : à toi l’honneur !</li>' : '<li class="empty">Personne n’a encore bouclé la ronde cette semaine : à toi l’honneur !</li>';
  return b.entries
    .map((e, i) => `<li class="${i + 1 === highlight ? 'me' : ''}"><span class="who">${e.team
      .map((p) => `<i style="--c:${hex(p.color)}"></i>${escapeHtml(p.name)}`)
      .join(', ')}</span><span class="stg">${e.cleared}/${stages}</span><span class="time">${formatTicks(e.ticks)}</span></li>`)
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

/** « La ronde des boss » (iteration 28): the time of each boss, then the weekly board. */
function rushResultHtml(d: NonNullable<Results['rush']>) {
  const b = d.board;
  const rank = d.cleared > 0 && b?.rank
    ? `${ordinal(b.rank)} sur ${b.total} équipe${b.total > 1 ? 's' : ''} cette semaine`
    : d.cleared === 0 ? 'Aucun boss vaincu : pas de chrono au classement. Retente ta chance !' : '';
  const order = rushStagesOf(d.state.week);
  const splits = order.map((bosses, i) => {
    const t = d.state.splits[i];
    return `<li class="${t === undefined ? 'todo' : 'done'}">${rushChip(bosses)}<span>${escapeHtml(cap(bosses.map((k) => BOSS_NAMES[k]).join(' et ')))}</span><em>${t === undefined ? '—' : formatTicks(t)}</em></li>`;
  }).join('');
  return `<div class="daily-result rush-result">
    <div class="big">${d.cleared}/${d.state.stages} boss · <em>${formatTicks(d.state.ticks)}</em></div>
    <ol class="rush-splits">${splits}</ol>
    ${rank ? `<p class="muted center">${rank}</p>` : ''}
    <ol class="board">${boardHtml(b, d.cleared > 0 ? b?.rank : undefined, RUSH_STAGES, true)}</ol>
  </div>`;
}

/** The bosses of each stage of a week: one by one, then the duo. */
function rushStagesOf(week: number): BossKind[][] { return [...rushOrder(week).map((b) => [b]), rushDuo(week)]; }
/** A round badge in the colours of the boss (two halves for the duo). */
function rushChip(bosses: BossKind[]) {
  const [a, b = a] = bosses.map((k) => hex(enemyColor(k)));
  return `<i class="rush-chip${bosses.length > 1 ? ' duo' : ''}" style="--a:${a};--b:${b}"></i>`;
}

/** The home screen card of « La ronde des boss »: this week's order and best runs. */
async function loadRush() {
  const week = weekNumber(dayNumber());
  $('#rush-week').textContent = `Semaine du ${weekLabel(week)}`;
  $('#rush-order').innerHTML = rushStagesOf(week).map((bs, i) =>
    `<li title="${escapeHtml(cap(bs.map((k) => BOSS_NAMES[k]).join(' et ')))}">${rushChip(bs)}<span>${i < 4 ? escapeHtml(specOf(bs[0]).label) : 'Duo'}</span></li>`).join('<li class="arrow">›</li>');
  try {
    const b = await fetch('/api/rush').then((r) => (r.ok ? (r.json() as Promise<BoardDay>) : undefined));
    $('#rush-board').innerHTML = boardHtml(b?.entries ? { ...b, entries: b.entries.slice(0, 3) } : undefined, undefined, RUSH_STAGES, true);
  } catch {
    $('#rush-board').innerHTML = boardHtml(undefined, undefined, RUSH_STAGES, true);
  }
}

/** The home screen card: today's twist and best runs. */
async function loadDaily() {
  void loadRush();
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

function taupeResultHtml(t: NonNullable<Results['taupe']>, players: Results['players']) {
  const mole = players.find((p) => p.id === t.mole);
  const why = t.why === 'demasquee' ? 'Le conseil l’a démasquée !'
    : t.why === 'missions' ? `Les ${t.stages} missions sont accomplies malgré elle.`
    : `Plus de vies : le sabotage a réussi (${t.cleared}/${t.stages} missions).`;
  const mine = t.mole === pid;
  const verdict = (t.winner === 'taupe') === mine ? 'Victoire !' : 'Défaite…';
  return `<div class="taupe-result">
    <div class="kicker">La taupe était</div>
    <div class="reveal"><i class="dot" style="--c:${hex(mole?.color ?? 0x888888)}"></i>${escapeHtml(mole?.name ?? '?')}${mine ? ' (toi)' : ''}</div>
    <p class="muted">${why}</p>
    ${online || mole ? `<p class="win">${verdict}</p>` : ''}
  </div>`;
}

/** « Le bilan » (iteration 45): the stars of the game, and (campaign) all those kept on this device. */
function starsResultHtml(campaign: boolean) {
  const all = starTotal();
  return `<p class="run-stars"><span class="st">★</span> <b>${runStars.stars}</b> étoile${runStars.stars > 1 ? 's' : ''} sur ${3 * runStars.missions} possibles pendant cette partie${campaign && all.missions ? ` · ton carnet en compte <b>${all.stars}</b> sur ${all.missions} mission${all.missions > 1 ? 's' : ''}` : ''}</p>`;
}

function showResults(r: Results) {
  const kinds = Object.keys(SPECS).filter((k) => k !== 'player') as (keyof typeof SPECS)[];
  const title = r.daily
    ? (r.daily.cleared >= r.daily.state.stages ? 'Défi du jour relevé !' : `Défi du jour · ${r.daily.cleared}/${r.daily.state.stages} étapes`)
    : r.rush ? (r.rush.cleared >= r.rush.state.stages ? 'La ronde des boss est bouclée !' : `Ronde des boss · ${r.rush.cleared}/${r.rush.state.stages} boss`)
    : r.taupe ? (r.taupe.winner === 'taupe' ? 'La taupe l’emporte !' : 'Les loyaux l’emportent !')
    : r.atelier ? (r.atelier.won ? `« ${r.atelier.name} » réussie !` : `« ${r.atelier.name} » : plus de vies…`)
    : r.mode === 'ballon' && r.drapeau ? (r.drapeau.winner ? `Les ${TEAM_NAMES[r.drapeau.winner - 1]} remportent le match ! (${r.drapeau.teams[0]} à ${r.drapeau.teams[1]})` : `Match nul (${r.drapeau.teams[0]} à ${r.drapeau.teams[1]})`)
    : r.drapeau ? (r.drapeau.winner ? `Les ${TEAM_NAMES[r.drapeau.winner - 1]} remportent les drapeaux ! (${r.drapeau.teams[0]} à ${r.drapeau.teams[1]})` : `Égalité aux drapeaux (${r.drapeau.teams[0]} à ${r.drapeau.teams[1]})`)
    : r.mode === 'caisses' ? `${r.players[0]?.name ?? ''} remporte la chasse aux caisses !`
    : r.mode === 'couronne' ? `${r.players[0]?.name ?? ''} règne sur la table !`
    : r.mode === 'petard' ? `${r.players[0]?.name ?? ''} n’a jamais sauté !`
    : r.mode === 'coop' ? `Partie terminée · Mission ${r.mission}` : `${r.players[0]?.name ?? ''} remporte le versus !`;
  const ctf = !!r.drapeau;
  const hunt = r.mode === 'caisses';
  const reign = r.mode === 'couronne';
  const hot = r.mode === 'petard'; // « Le pétard » (iteration 61): firecrackers handed over
  const coop = coopLike(r.mode);
  const ff = coop && r.players.some((p) => p.ff !== undefined);
  const gal = r.players.some((p) => p.g !== undefined);
  $('#results-title').textContent = title;
  $('#results-body').innerHTML = `
    <table>
      <thead><tr><th>Joueur</th>${coop ? kinds.map((k) => `<th title="${specOf(k).label}"><i class="dot" style="--c:${hex(enemyColor(k))}"></i></th>`).join('') : '<th>Kills</th>'}${ff ? '<th title="Coéquipiers détruits">Tirs amis</th>' : ''}${gal ? '<th title="Galons gagnés pendant la campagne">★</th>' : ''}${ctf ? (r.mode === 'ballon' ? '<th title="Buts marqués">Buts</th>' : '<th title="Drapeaux rapportés à la base">Drapeaux</th>') : ''}${hunt ? '<th title="Caisses ramassées pendant la partie">Caisses</th>' : ''}${reign ? '<th title="Secondes passées couronné pendant la partie">Règne</th>' : ''}${hot ? '<th title="Pétards refilés pendant la partie">Passes</th>' : ''}<th>Morts</th><th>${coop ? 'Total' : 'Manches'}</th></tr></thead>
      <tbody>${r.players
        .map((p) => {
          const kills = Object.values(p.kills).reduce((s, v) => s + (v ?? 0), 0);
          const team = ctf && (p.team === 1 || p.team === 2) ? ` <em class="ia" style="color:${hex(TEAM_COLORS[p.team - 1])}">${TEAM_NAMES[p.team - 1]}</em>` : '';
          return `<tr><td><i class="dot" style="--c:${hex(p.color)}"></i>${escapeHtml(p.name)}${team}${p.bot !== undefined ? ` <em class="ia">IA ${RIVAL_LEVELS[rivalLevel(p.bot)].label.toLowerCase()}</em>` : ''}</td>${
            coop ? kinds.map((k) => `<td>${p.kills[k] ?? '·'}</td>`).join('') : `<td>${kills}</td>`
          }${ff ? `<td>${p.ff || '·'}</td>` : ''}${gal ? `<td>${p.g ?? '·'}</td>` : ''}${ctf ? `<td>${p.caps || '·'}</td>` : ''}${hunt ? `<td>${p.crates || '·'}</td>` : ''}${reign ? `<td>${p.crown ? `${p.crown} s` : '·'}</td>` : ''}${hot ? `<td>${p.passes || '·'}</td>` : ''}<td>${p.deaths}</td><td><b>${p.score}</b></td></tr>`;
        })
        .join('')}</tbody>
    </table>${coop && runStars.missions ? starsResultHtml(r.mode === 'coop') : ''}${r.daily ? dailyResultHtml(r.daily) : ''}${r.rush ? rushResultHtml(r.rush) : ''}${r.taupe ? taupeResultHtml(r.taupe, r.players) : ''}`;
  runStars = { stars: 0, missions: 0 };
  const over = online && phase === 'gameover';
  $('#btn-results-ok').textContent = over ? 'Retour au salon' : 'Continuer';
  const again = $<HTMLButtonElement>('#btn-results-again');
  again.hidden = !over || !lobbyPlayers.find((p) => p.id === pid)?.host;
  again.disabled = false;
  show('results');
}

// ------------------------------------------------------------------ attract mode (background demo)

let attract: Game | undefined;
let attractEnd = 0;
let demoBilan = false; // « Le bilan » (iteration 45): the videos show the briefing and the sheet around the demo missions
let attractTally: TallyCount | undefined;
let attractBriefUntil = 0;
let attractName = '';
let attractPrev = new Map<number, { x: number; y: number; body: number; turret: number }>();

/** A versus of AI rivals (iteration 17): the videos, and now and then the home-screen background. */
interface AttractVersus { round: number; levels?: number[]; scores?: number[]; chain?: boolean; petard?: boolean; fuse?: number } // petard: « Le pétard » (iteration 61), its rules on its arenas; fuse: seconds of the first fuse (videos)
/** « Drapeaux » (iteration 24): two teams of AI rivals, for the videos and the home-screen background. */
interface AttractFlags { round: number; levels?: number[]; teams?: [number, number]; chain?: boolean; carry?: boolean } // carry: the round opens with a Bleu already holding the red flag, by the Rouges' base (videos)
/** « La chasse aux caisses » (iteration 37): four AI rivals racing for the crates, for the videos and the home-screen background. */
interface AttractHunt { round: number; levels?: number[]; scores?: number[]; chain?: boolean; seconds?: number } // seconds: how long the round lasts (videos)
/** « La couronne » (iteration 50): four AI rivals fighting over the crown, for the videos and the home-screen background. */
interface AttractCrown { round: number; levels?: number[]; scores?: number[]; chain?: boolean; seconds?: number; head?: number } // seconds: how long the round lasts at most (videos); head: seconds of reign every rival starts with
/** « Le ballon » (iteration 55): two AI rivals against two, a ball and two goals, for the videos and the home-screen background. */
interface AttractBall { round: number; levels?: number[]; teams?: [number, number]; chain?: boolean; seconds?: number } // seconds: how long the round lasts at most (videos)
interface AttractOpts { ballon?: AttractBall; couronne?: AttractCrown; caisses?: AttractHunt; drapeau?: AttractFlags; versus?: AttractVersus; atelier?: AtelierMap; mission?: number; heroes?: boolean; rich?: boolean; bossHp?: number; night?: boolean; storm?: boolean; daily?: { day: number; stage: number }; rush?: { week: number; stage: number }; arms?: Weapon[]; taupe?: { seed: number; stage: number }; ranks?: Ranks }
let attractOpts: AttractOpts = {};

function attractMission() {
  const r = Math.random();
  // the flea market of the Pilleurs too (iteration 15), and the toy factory's belts (iteration 16)
  // and the ice of the rink and the frozen lake (iteration 21)
  return r < 0.1 ? 21 : r < 0.2 ? 22 + Math.floor(Math.random() * 2) : r < 0.28 ? 24 : r < 0.4 ? 25 + Math.floor(Math.random() * 2) : r < 0.54 ? 27 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 14);
}

function startAttract(opts: AttractOpts = attractOpts) {
  if (attract) return;
  stopReel();
  hideSheet();
  hideBrief(false);
  attractTally = undefined;
  attractBriefUntil = 0;
  reelWanted = -1;
  film.clear();
  clearBubbles();
  renderer.setPetard(false);
  attractOpts = opts;
  // now and then, the home-screen background is a versus of AI rivals (iteration 17)
  if (!opts.versus && !opts.drapeau && !opts.caisses && !opts.couronne && !opts.ballon && !opts.heroes && opts.mission === undefined && !opts.atelier && !opts.daily && !opts.taupe && !opts.rush) {
    const r = Math.random();
    if (r < 0.1) { startAttractVersus({ round: Math.floor(Math.random() * 12), levels: [1, 2, 1, 2] }); return; }
    if (r < 0.2) { startAttractFlags({ round: Math.floor(Math.random() * 12), levels: [1, 2, 2, 1] }); return; } // and, from iteration 24, a flag round
    if (r < 0.3) { startAttractHunt({ round: Math.floor(Math.random() * 12), levels: [1, 2, 1, 2] }); return; } // and, from iteration 37, a crate hunt
    if (r < 0.4) { startAttractCrown({ round: Math.floor(Math.random() * 12), levels: [1, 2, 1, 2] }); return; } // and, from iteration 50, a fight over the crown
    if (r < 0.58 && r >= 0.5) { startAttractVersus({ round: Math.floor(Math.random() * 12), levels: [1, 2, 1, 2], petard: true }); return; } // and, from iteration 61, a firecracker
    if (r < 0.5) { startAttractBall({ round: Math.floor(Math.random() * 12), levels: [2, 2, 1, 2] }); return; } // and, from iteration 55, a match
  }
  if (opts.ballon) { startAttractBall(opts.ballon, opts.arms); return; }
  attractBall = undefined;
  if (opts.couronne) { startAttractCrown(opts.couronne, opts.arms); return; }
  attractCrown = undefined;
  renderer.setCrown(undefined);
  if (opts.caisses) { startAttractHunt(opts.caisses, opts.arms); return; }
  attractHunt = undefined;
  if (opts.versus) { attractHunt = undefined; startAttractVersus(opts.versus, opts.arms); return; }
  if (opts.drapeau) { attractHunt = undefined; startAttractFlags(opts.drapeau, opts.arms); return; }
  attractCtf = undefined;
  if (document.body.classList.contains('vs-demo')) { document.body.classList.remove('vs-demo'); $('#hud').hidden = true; }
  const lvl: ParsedLevel = opts.atelier ? atelierLevel(opts.atelier) : opts.taupe ? taupeLevel(opts.taupe.seed, opts.taupe.stage) : opts.daily ? dailyLevel(opts.daily.day, opts.daily.stage) : opts.rush ? rushLevel(opts.rush.week, opts.rush.stage) : getMission(opts.mission ?? attractMission()); // now and then, the Maçon's building site or the tunnels
  const g = new Game(lvl.tiles, lvl.belts);
  g.setRail(lvl.rail); // « Le Tortillard » (iteration 49)
  g.bonusOn = true;
  // the home-screen background sometimes plays in the dark, as a teaser
  g.night = opts.night ?? (!!lvl.night || (!opts.heroes && opts.mission === undefined && Math.random() < 0.25));
  // and sometimes under a storm
  g.storm = opts.storm ?? (!!lvl.storm || (!opts.heroes && opts.mission === undefined && Math.random() < 0.18));
  // the wind (iteration 23): its own setting, and sometimes on the home screen
  g.wind = lvl.wind ?? (!opts.heroes && opts.mission === undefined && !opts.atelier && Math.random() < 0.16 ? Math.floor(Math.random() * 8) * (Math.PI / 4) : undefined);
  g.blizzard = !!lvl.blizzard && g.wind !== undefined; // « Le blizzard » (iteration 54)
  // the fog (iteration 26): its own setting, and sometimes on the home screen (on calm, daylit tables)
  g.fog = lvl.fog ?? (!opts.heroes && opts.mission === undefined && !opts.atelier && !g.night && g.wind === undefined && Math.random() < 0.16 ? 1 + Math.floor(Math.random() * 999) : undefined);
  if (lvl.crates?.length) { g.bonusKinds = lvl.crates; g.bonusNext = 3; g.bonusEvery = [7, 10]; } // a mission's own crates (iteration 52)
  if (opts.rich) { g.bonusNext = 1.2; g.bonusEvery = [2.5, 4]; g.bonusCap = 3; }
  if (opts.daily) applyTwist(g, dailyTwist(opts.daily.day));
  if (opts.heroes) {
    // player-coloured tanks driven by the AI: used by the gameplay videos
    lvl.spawns.forEach(([x, y], i) => {
      const t = g.addTank('player', 1, x, y, PLAYER_COLORS[i % PLAYER_COLORS.length]);
      if (opts.arms?.length) g.arm(t, opts.arms[i % opts.arms.length]);
      if (opts.ranks) g.train(t, opts.ranks); // skills of the campaign tree (iteration 19): chevrons, starting shield…
      g.enableAI(t, { skill: 2, turretSpeed: 5, fireCd: Math.max(0.4, t.spec.fireCd) });
    });
  } else {
    const left = ['pink', 'violet', 'ash'] as const;
    lvl.spawns.forEach(([x, y], i) => g.addTank(left[i % left.length], 1, x, y, 0));
  }
  lvl.enemies.forEach((e) => {
    const t = g.addTank(e.kind === 'white' && !opts.heroes ? 'ash' : e.kind, 2, e.x, e.y, 0);
    if (opts.bossHp && t.maxHp > 1) g.setHp(t, opts.bossHp, t.maxHp);
    else if (opts.rush && opts.rush.stage >= RUSH_STAGES && t.boss) g.setHp(t, RUSH_DUO_HP, RUSH_DUO_HP); // the finale's lighter bosses
  });
  // friendly fire between heroes: the same « Tir ami ! » as online
  g.onKill = (v, k) => {
    if (v.kind === 'player' && k?.kind === 'player') g.events.push(['ff', v.x, v.y, v.id, k.id]);
    if (attractTally && !attractEnd) { if (v.team === 2) attractTally.kill(v.kind); else if (v.kind === 'player') attractTally.falls++; } // « Le bilan » (iteration 45)
  };
  g.frozen = false;
  attract = g;
  if (demoBilan && opts.heroes) {
    // « Le bilan » (iteration 45), in the videos: the briefing over a frozen table, then the count of the mission
    const foes = g.tanks.filter((t) => t.team === 2);
    const heroes = g.tanks.filter((t) => t.team === 1).length;
    attractTally = new TallyCount(opts.mission ?? 0, parSeconds(foes.map((t) => ({ boss: !!t.boss }))), shotBudget(foes.reduce((n, t) => n + t.maxHp, 0), heroes));
    attractName = lvl.name;
    g.frozen = true;
    attractBriefUntil = performance.now() + 3000;
    const boss = foes.some((t) => !!t.boss);
    showBrief({ kicker: boss ? 'Mission · Boss' : 'Mission', big: String(opts.mission ?? 1), name: lvl.name, sub: boss ? bossTip(foes.some((t) => t.kind === 'thunder'), foes.some((t) => t.kind === 'sower'), foes.some((t) => t.kind === 'drill'), foes.some((t) => t.kind === 'bombard'), foes.some((t) => t.kind === 'train'), foes.some((t) => t.kind === 'magus')) : '',
      wx: weatherWords(g.night, g.storm, g.belts, g.wind, g.fog), kinds: kindCounts(foes.map((t) => t.kind)), total: foes.length, cls: `${boss ? 'boss' : ''}${g.night ? ' night' : ''}${g.storm ? ' storm' : ''}` }, briefArt, kindLabel);
  }
  attractEnd = 0;
  attractPrev.clear();
  renderer.setLevel(g.tiles, g.tankInfos(), g.belts, lvl.rail);
  renderer.setNight(g.night);
  renderer.setStorm(g.storm);
  renderer.setWind(g.wind);
  renderer.fogAlly = (id) => g.tankById(id)?.team === 1; // the camera sees through the mist around the heroes
  renderer.setFog(g.fog);
  renderer.setBlizzard(g.blizzard); squallSaid = -1;
}
function stopAttract() {
  attract = undefined;
  attractCrown = undefined;
}

const VS_ARMS: Weapon[] = ['ricochet', 'canon', 'fusee', 'sapeur'];
let attractVs: (AttractVersus & { scores: number[]; names: string[] }) | undefined;
/** « Le pétard » in the videos: the fuse the first firecracker gets once it is lit (0: a normal one). */
let petardFirstFuse = 0;

/** Four rivals, one team each, on a versus arena: the last one standing scores (and, in the videos, the next round follows). */
function startAttractVersus(vs: AttractVersus, arms?: Weapon[]) {
  const lvl = vs.petard ? petardArena(vs.round) : versusArena(vs.round);
  const g = new Game(lvl.tiles, lvl.belts);
  g.bonusOn = true;
  g.bonusNext = 3; g.bonusEvery = [6, 9];
  if (vs.petard) {
    // « Le pétard » (iteration 61): the same rules as online
    g.petard = newPetard();
    g.bonusKinds = ['shield', 'bounce', 'fan', 'heavy'];
    if (vs.fuse) { g.petard.wait = 0.8; petardFirstFuse = vs.fuse; } else petardFirstFuse = 0;
  }
  renderer.setPetard(!!vs.petard);
  g.night = !!lvl.night;
  g.storm = !!lvl.storm;
  g.wind = lvl.wind;
  g.fog = lvl.fog;
  g.blizzard = !!lvl.blizzard && g.wind !== undefined;
  const names = [0, 1, 2, 3].map((i) => RIVAL_NAMES[(vs.round + i * 3) % RIVAL_NAMES.length]);
  lvl.spawns.slice(0, 4).forEach(([x, y], i) => {
    const t = g.addTank('player', i + 1, x, y, PLAYER_COLORS[i], `ia:${i + 1}`, names[i]);
    g.arm(t, (arms?.length ? arms : VS_ARMS)[i % (arms?.length || VS_ARMS.length)]);
    t.body = t.turret = Math.atan2(8.5 - y, 11 - x);
    makeRival(g, t, vs.levels?.[i] ?? 2);
  });
  g.frozen = false;
  attract = g;
  attractOpts = { versus: vs, arms };
  attractCtf = undefined;
  attractVs = { ...vs, scores: vs.scores ?? [0, 0, 0, 0], names };
  attractEnd = 0;
  attractPrev.clear();
  renderer.setLevel(g.tiles, g.tankInfos(), g.belts);
  renderer.setNight(g.night);
  renderer.setStorm(g.storm);
  renderer.setWind(g.wind);
  renderer.fogAlly = () => true; // the camera follows everybody: the mist only hides them from each other
  renderer.setFog(g.fog);
  renderer.setBlizzard(g.blizzard); squallSaid = -1;
  renderVsBoard();
}

let attractCtf: (AttractFlags & { teams: [number, number] }) | undefined;
let attractHunt: (AttractHunt & { scores: number[]; names: string[] }) | undefined;

/** « La chasse aux caisses » (iteration 37): four rivals, one per corner, racing for the crates until the clock runs out. */
function startAttractHunt(h: AttractHunt, arms?: Weapon[]) {
  const lvl = huntArena(h.round);
  const g = new Game(lvl.tiles, lvl.belts);
  g.bonusOn = true;
  g.bonusNext = HUNT_CRATES.first; g.bonusEvery = HUNT_CRATES.every; g.bonusCap = HUNT_CRATES.cap;
  g.night = !!lvl.night;
  g.wind = lvl.wind;
  g.hunt = newHunt();
  // a shorter round for the videos: the clock starts part-way (the golden crate still drops HUNT_GOLD_AT seconds before the end)
  g.hunt.time = Math.max(0, HUNT_ROUND - (h.seconds ?? HUNT_ROUND));
  const names = [0, 1, 2, 3].map((i) => RIVAL_NAMES[(h.round + i * 3 + 1) % RIVAL_NAMES.length]);
  lvl.spawns.slice(0, 4).forEach(([x, y], i) => {
    const t = g.addTank('player', i + 1, x, y, PLAYER_COLORS[i], `ia:${i + 1}`, names[i]);
    g.arm(t, (arms?.length ? arms : VS_ARMS)[i % (arms?.length || VS_ARMS.length)]);
    t.body = t.turret = Math.atan2(8.5 - y, 11 - x);
    makeRival(g, t, h.levels?.[i] ?? 2);
  });
  g.frozen = false;
  attract = g;
  attractOpts = { caisses: h, arms };
  attractVs = undefined;
  attractCtf = undefined;
  attractHunt = { ...h, scores: h.scores ?? [0, 0, 0, 0], names };
  attractEnd = 0;
  attractPrev.clear();
  renderer.setLevel(g.tiles, g.tankInfos(), g.belts);
  renderer.setNight(g.night);
  renderer.setStorm(false);
  renderer.setWind(g.wind);
  renderer.fogAlly = () => true;
  renderer.setFog(undefined);
  renderer.setBlizzard(false);
  renderAttractHunt();
}

function renderAttractHunt() {
  const h = attractHunt, g = attract;
  if (!h || !g?.hunt || !document.body.classList.contains('demo') || screen !== 'game') return;
  document.body.classList.add('vs-demo');
  $('#hud').hidden = false;
  $('#scoreboard').innerHTML = g.tanks
    .filter((t) => t.kind === 'player')
    .map((t, i) => ({ t, i, n: g.hunt!.got.get(t.id) ?? 0 }))
    .sort((a, b) => b.n - a.n)
    .map(({ t, i, n }) => `<div class="sb-row hunt"><i style="--c:${hex(t.color)}"></i><span>${escapeHtml(t.name ?? '')} <em>IA</em></span><em class="crates">▣ ${n}</em><b>${h.scores[i]}</b></div>`)
    .join('');
}

/** The hunt's clock in the demo (the scoreboard follows the crates as they are picked up). */
function attractHuntClock(g: Game) {
  const left = Math.max(0, Math.ceil(HUNT_ROUND - (g.hunt?.time ?? 0)));
  const el = $('#hud-enemies');
  el.textContent = `Chasse aux caisses · ⏱ 0:${String(left).padStart(2, '0')}`;
  el.classList.toggle('hurry', left <= HUNT_HURRY && !attractEnd);
}

function endAttractHunt(g: Game) {
  const h = attractHunt!;
  const tanks = g.tanks.filter((t) => t.kind === 'player');
  let best = 0, w = -1, tie = false;
  tanks.forEach((t, i) => {
    const n = g.hunt?.got.get(t.id) ?? 0;
    if (n > best) { best = n; w = i; tie = false; } else if (n === best && n > 0) tie = true;
  });
  if (tie) w = -1;
  if (w >= 0) { h.scores[w]++; g.cheer(tanks[w].team); }
  renderAttractHunt();
  if (document.body.classList.contains('demo') && screen === 'game') {
    banner(`Chasse aux caisses · manche ${h.round + 1}`, w >= 0 ? `${h.names[w]} gagne la manche !` : 'Égalité !', w >= 0 ? `${best} caisse${best > 1 ? 's' : ''} ramassée${best > 1 ? 's' : ''}` : '', 'intro hunt');
    setTimeout(hideBanner, 2400);
  }
}

let attractCrown: (AttractCrown & { scores: number[]; names: string[] }) | undefined;

/** « La couronne » (iteration 50): four rivals, one per corner, and the crown on its cushion in the middle. */
function startAttractCrown(c: AttractCrown, arms?: Weapon[]) {
  const lvl = crownArena(c.round);
  const g = new Game(lvl.tiles, lvl.belts);
  g.setRail(lvl.rail);
  g.bonusOn = true;
  g.bonusNext = 4; g.bonusEvery = [7, 10];
  g.night = !!lvl.night;
  g.wind = lvl.wind;
  g.crown = newCrown(lvl.crown[0], lvl.crown[1]);
  g.crown.time = Math.max(0, CROWN_ROUND - (c.seconds ?? CROWN_ROUND)); // a shorter round for the videos
  const names = [0, 1, 2, 3].map((i) => RIVAL_NAMES[(c.round + i * 3 + 2) % RIVAL_NAMES.length]);
  lvl.spawns.slice(0, 4).forEach(([x, y], i) => {
    const t = g.addTank('player', i + 1, x, y, PLAYER_COLORS[i], `ia:${i + 1}`, names[i]);
    g.arm(t, (arms?.length ? arms : VS_ARMS)[i % (arms?.length || VS_ARMS.length)]);
    t.body = t.turret = Math.atan2(8.5 - y, 11 - x);
    makeRival(g, t, c.levels?.[i] ?? 2);
  });
  if (c.head) for (const t of g.tanks) g.crown.held.set(t.id, Math.min(CROWN_HOLD - 1, c.head)); // the videos: a reign that ends within the shot
  g.frozen = false;
  attract = g;
  attractOpts = { couronne: c, arms };
  attractVs = undefined;
  attractCtf = undefined;
  attractHunt = undefined;
  attractCrown = { ...c, scores: c.scores ?? [0, 0, 0, 0], names };
  attractEnd = 0;
  attractPrev.clear();
  renderer.setLevel(g.tiles, g.tankInfos(), g.belts, lvl.rail);
  renderer.setCrown(lvl.crown);
  renderer.setNight(g.night);
  renderer.setStorm(false);
  renderer.setWind(g.wind);
  renderer.fogAlly = () => true;
  renderer.setFog(undefined);
  renderer.setBlizzard(false);
  renderAttractCrown();
}

function renderAttractCrown() {
  const c = attractCrown, g = attract;
  if (!c || !g?.crown || !document.body.classList.contains('demo') || screen !== 'game') return;
  document.body.classList.add('vs-demo');
  $('#hud').hidden = false;
  const cr = g.crown;
  $('#scoreboard').innerHTML = crownRows(g.tanks.filter((t) => t.kind === 'player').map((t, i) => ({
    id: t.id, name: t.name ?? '', color: t.color, bot: true, tenths: Math.floor((cr.held.get(t.id) ?? 0) * 10), rounds: c.scores[i], mine: false, king: cr.state === 1 && cr.holder === t.id,
  })));
}

/** The crown's clock in the demo (and the scoreboard, once a second). */
let attractCrownSec = -1;
function attractCrownClock(g: Game) {
  const left = Math.max(0, Math.ceil(CROWN_ROUND - (g.crown?.time ?? 0)));
  const el = $('#hud-enemies');
  el.textContent = `La couronne · ⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  el.classList.toggle('hurry', left <= CROWN_HURRY && !attractEnd);
  const sec = Math.floor(g.crown?.time ?? 0);
  if (sec !== attractCrownSec) { attractCrownSec = sec; renderAttractCrown(); }
}

function endAttractCrown(g: Game) {
  const c = attractCrown!, cr = g.crown!;
  const tanks = g.tanks.filter((t) => t.kind === 'player');
  let best = 0, w = -1, tie = false;
  tanks.forEach((t, i) => {
    const n = Math.floor((cr.held.get(t.id) ?? 0) * 10);
    if (cr.winner === t.id) { best = n; w = i; tie = false; return; }
    if (cr.winner) return;
    if (n > best) { best = n; w = i; tie = false; } else if (n === best && n > 0) tie = true;
  });
  if (tie) w = -1;
  if (w >= 0) { c.scores[w]++; g.cheer(tanks[w].team); }
  renderAttractCrown();
  if (document.body.classList.contains('demo') && screen === 'game') {
    banner(`La couronne · manche ${c.round + 1}`, w >= 0 ? (cr.winner ? `${c.names[w]} règne ${CROWN_HOLD} secondes !` : `${c.names[w]} gagne la manche !`) : 'Égalité !', w >= 0 ? `${Math.floor(best / 10)} secondes de règne` : '', 'intro crown');
    setTimeout(hideBanner, 2400);
  }
}

let attractBall: (AttractBall & { teams: [number, number] }) | undefined;
let attractBallPrev: [number, number] = [W / 2, H / 2];

/** « Le ballon » (iteration 55): two AI rivals against two on a pitch, the ball on the kick-off spot. */
function startAttractBall(c: AttractBall, arms?: Weapon[]) {
  const lvl = ballArena(c.round);
  const g = new Game(lvl.tiles, lvl.belts);
  g.bonusOn = true;
  g.bonusNext = 5; g.bonusEvery = [8, 12];
  g.ball = newBall();
  g.ball.time = Math.max(0, BALL_ROUND - (c.seconds ?? BALL_ROUND)); // a shorter round for the videos
  attractBallPrev = [g.ball.x, g.ball.y];
  lvl.spawns.slice(0, 4).forEach(([x, y], i) => {
    const team = ctfTeam(i);
    const t = g.addTank('player', team, x, y, TEAM_TANK_COLORS[team - 1][Math.floor(i / 2) % 2], `ia:${i + 1}`, RIVAL_NAMES[(c.round + i * 3 + 1) % RIVAL_NAMES.length]);
    g.arm(t, (arms?.length ? arms : VS_ARMS)[i % (arms?.length || VS_ARMS.length)]);
    t.body = t.turret = Math.atan2(8.5 - y, 11 - x);
    makeRival(g, t, c.levels?.[i] ?? 2);
  });
  g.frozen = false;
  attract = g;
  attractOpts = { ballon: c, arms };
  attractVs = undefined;
  attractCtf = undefined;
  attractBall = { ...c, teams: c.teams ?? [0, 0] };
  attractEnd = 0;
  attractPrev.clear();
  renderer.setLevel(g.tiles, g.tankInfos(), g.belts);
  renderer.setBall(true, (id) => g.tankById(id)?.team);
  renderer.setNight(false);
  renderer.setStorm(false);
  renderer.setWind(undefined);
  renderer.setFog(undefined);
  renderer.setBlizzard(false);
  renderBallBoard(g);
}

/** The score of the demo match and its clock (once a second). */
let ballBoardKey = '';
function renderBallBoard(g?: Game) {
  const c = attractBall;
  if (!c || !document.body.classList.contains('demo') || screen !== 'game') return;
  const left = Math.max(0, Math.ceil(BALL_ROUND - (g?.ball?.time ?? 0)));
  const key = `${c.round}|${c.teams.join(',')}|${left}`;
  if (key === ballBoardKey && document.body.classList.contains('vs-demo')) return;
  ballBoardKey = key;
  document.body.classList.add('vs-demo');
  $('#hud').hidden = false;
  $('#hud-enemies').textContent = `Le ballon · manche ${c.round + 1} · ⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('#hud-enemies').classList.toggle('hurry', left <= BALL_HURRY && !attractEnd);
  $('#scoreboard').innerHTML = TEAM_NAMES.map((n, i) => `<div class="sb-row ctf"><i style="--c:${hex(TEAM_COLORS[i])}"></i><span>${n} <em>IA</em></span><b>${c.teams[i]}</b></div>`).join('');
}

function endAttractBall(g: Game) {
  const c = attractBall!, b = g.ball!;
  const w = b.scored;
  if (w) { c.teams[w - 1]++; g.cheer(w); } // the scorers celebrate
  ballBoardKey = '';
  renderBallBoard(g);
  if (document.body.classList.contains('demo') && screen === 'game') {
    const scorer = g.tankById(b.scorer);
    banner(w ? 'But !' : `Le ballon · manche ${c.round + 1}`, w ? (scorer?.name ? `${scorer.name} marque pour les ${TEAM_NAMES[w - 1]} !` : `Un point pour les ${TEAM_NAMES[w - 1]} !`) : 'Pas de but : égalité !',
      `Bleus ${c.teams[0]} · ${c.teams[1]} Rouges`, `intro ctf ball team${w}`);
    setTimeout(hideBanner, 2400);
  }
}

/** Two AI rivals against two on a flag arena (iteration 24): a flag brought home takes the round (tanks come back at their base). */
function startAttractFlags(c: AttractFlags, arms?: Weapon[]) {
  const lvl = ctfArena(c.round);
  const g = new Game(lvl.tiles, lvl.belts);
  g.bonusOn = true;
  g.bonusNext = 4; g.bonusEvery = [7, 10];
  g.night = !!lvl.night;
  g.wind = lvl.wind;
  g.flags = newFlags(lvl.bases);
  lvl.spawns.slice(0, 4).forEach(([x, y], i) => {
    const team = ctfTeam(i);
    const t = g.addTank('player', team, x, y, TEAM_TANK_COLORS[team - 1][Math.floor(i / 2) % 2], `ia:${i + 1}`, RIVAL_NAMES[(c.round + i * 3) % RIVAL_NAMES.length]);
    g.arm(t, (arms?.length ? arms : VS_ARMS)[i % (arms?.length || VS_ARMS.length)]);
    t.body = t.turret = Math.atan2(8.5 - y, 11 - x);
    makeRival(g, t, c.levels?.[i] ?? 2);
  });
  if (c.carry && g.tanks[0] && g.flags[1]) {
    const t = g.tanks[0], [bx, by] = lvl.bases[1];
    [t.x, t.y] = nearestFree(g.tiles, Math.floor(bx) - 2, Math.floor(by), g.tanks.map((o): [number, number] => [o.x, o.y]));
    t.body = t.turret = Math.PI;
    Object.assign(g.flags[1], { state: 1, carrier: t.id, x: t.x, y: t.y });
  }
  g.frozen = false;
  attract = g;
  attractOpts = { drapeau: c, arms };
  attractVs = undefined;
  attractCtf = { ...c, teams: c.teams ?? [0, 0] };
  attractEnd = 0;
  attractPrev.clear();
  renderer.setLevel(g.tiles, g.tankInfos(), g.belts);
  renderer.setCtf(lvl.bases, (id) => g.tankById(id)?.team);
  renderer.setNight(g.night);
  renderer.setStorm(false);
  renderer.setWind(g.wind);
  renderer.setFog(undefined);
  renderer.setBlizzard(false);
  renderCtfBoard();
}

function renderCtfBoard() {
  const c = attractCtf;
  if (!c || !document.body.classList.contains('demo') || screen !== 'game') return;
  document.body.classList.add('vs-demo');
  $('#hud').hidden = false;
  $('#hud-enemies').textContent = `Drapeaux · manche ${c.round + 1} · premier à ${CTF_TARGET}`;
  $('#scoreboard').innerHTML = TEAM_NAMES.map((n, i) => `<div class="sb-row ctf"><i style="--c:${hex(TEAM_COLORS[i])}"></i><span>${n} <em>IA</em></span><b>${c.teams[i]}</b></div>`).join('');
}

function endAttractFlags(g: Game) {
  const c = attractCtf!;
  const standing = [1, 2].filter((k) => g.aliveCount(k) > 0);
  const w = g.ctfWinner || (standing.length === 1 ? standing[0] : 0);
  if (w) { c.teams[w - 1]++; g.cheer(w); } // the winners celebrate (iteration 30)
  renderCtfBoard();
  if (document.body.classList.contains('demo') && screen === 'game') {
    const carrier = g.ctfWinner ? g.tankById(g.flags?.find((f) => f.team !== w)?.carrier ?? -1) : undefined;
    banner(`Drapeaux · manche ${c.round + 1}`, w ? `Les ${TEAM_NAMES[w - 1]} gagnent la manche !` : 'Égalité !', carrier?.name ? `${carrier.name} rapporte le drapeau` : w ? 'Plus personne en face' : '', `intro ctf team${w}`);
    setTimeout(hideBanner, 2200);
  }
}

function renderVsBoard() {
  const vs = attractVs;
  if (!vs || !document.body.classList.contains('demo') || screen !== 'game') return;
  document.body.classList.add('vs-demo');
  $('#hud').hidden = false;
  const g = attract;
  if (vs.petard && g?.petard) {
    const p = g.petard;
    const holder = p.holder ? g.tankById(p.holder) : undefined;
    $('#hud-enemies').innerHTML = `${icon('petard')} ${escapeHtml(holder ? `chez ${holder.name ?? '?'}` : `Le pétard · manche ${vs.round + 1}`)}`;
    $('#scoreboard').innerHTML = petardRows(g.tanks.filter((t) => t.kind === 'player').map((t, i) => ({
      name: t.name ?? '', color: t.color, bot: true, passes: p.passes.get(t.id) ?? 0, rounds: vs.scores[i] ?? 0, mine: false, hot: t.id === p.holder, out: !t.alive,
    })));
    return;
  }
  $('#hud-enemies').textContent = `Manche ${vs.round + 1} · premier à 5`;
  $('#scoreboard').innerHTML = vs.names
    .map((n, i) => ({ n, i, s: vs.scores[i] }))
    .sort((a, b) => b.s - a.s)
    .map((e) => `<div class="sb-row"><i style="--c:${hex(PLAYER_COLORS[e.i])}"></i><span>${escapeHtml(e.n)} <em>IA</em></span><b>${e.s}</b></div>`)
    .join('');
}

/** End of a rivals' round: the winner scores, then the next round (videos) or another background. */
function endAttractVersus(g: Game) {
  const vs = attractVs!;
  const alive = g.tanks.filter((t) => t.alive && t.kind === 'player');
  const w = alive.length === 1 ? alive[0].team - 1 : -1;
  if (w >= 0) { vs.scores[w]++; g.cheer(alive[0].team); }
  renderVsBoard();
  if (document.body.classList.contains('demo') && screen === 'game') {
    if (vs.petard) banner(`Le pétard · manche ${vs.round + 1}`, w >= 0 ? `${vs.names[w]} est le dernier debout !` : 'Égalité !', w >= 0 ? `${vs.scores[w]} manche${vs.scores[w] > 1 ? 's' : ''} gagnée${vs.scores[w] > 1 ? 's' : ''}` : '', 'intro petard');
    else banner(`Versus · manche ${vs.round + 1}`, w >= 0 ? `${vs.names[w]} gagne la manche !` : 'Égalité !', w >= 0 ? `${vs.scores[w]} point${vs.scores[w] > 1 ? 's' : ''}` : '', 'intro');
    setTimeout(hideBanner, 2200);
  }
}

/**
 * The demo's bridge trap (« Les ponts », iteration 33): until that tick, the first enemy seen in the middle of a
 * bridge gets a mine with a short fuse beside it in the pit, just out of its blast: the planks give way under it.
 */
let bridgeTrapUntil = 0;
function bridgeTrap(g: Game) {
  const hero = g.tanks.find((t) => t.alive && t.kind === 'player');
  if (!hero) return;
  for (const f of g.tanks) {
    if (!f.alive || f.team === hero.team || isBossKind(f.kind)) continue;
    const cx = Math.floor(f.x), cy = Math.floor(f.y), i = cy * W + cx;
    if (g.tiles[i] !== Tile.Bridge || Math.hypot(f.x - cx - 0.5, f.y - cy - 0.5) > 0.3) continue;
    const across = g.tiles[i - 1] === Tile.Hole || g.tiles[i + 1] === Tile.Hole;
    for (const k of [-1, 1]) {
      const mx = cx + 0.5 + (across ? k * 1.85 : 0), my = cy + 0.5 + (across ? 0 : k * 1.85);
      if (mx < 0.5 || my < 0.5 || mx > W - 0.5 || my > H - 0.5) continue;
      g.mines.push({ id: 920000 + g.tick, owner: hero.id, team: hero.team, x: mx, y: my, t: 0, fuse: 0.08, dead: false });
      reelWanted = f.id;
      bridgeTrapUntil = 0;
      return;
    }
  }
}

// « Le réticule » (iteration 44), for the videos: the HUD of a coop mission over the demo, the first hero playing « me »
let demoHud = false;
const demoAim = { x: 0, y: 0, d: 4, set: false };
/** « Gare au tir ami » (iteration 53): until then (performance.now()), the demo reticle shows red, for the film. */
let demoFriend = 0;
function updateDemoHud(g: Game, tanks: RTank[], dt: number) {
  if (screen !== 'game' || !attractOpts.heroes || attractOpts.versus || attractOpts.drapeau || attractOpts.caisses) return;
  const heroes = g.tanks.filter((t) => t.kind === 'player');
  const me = heroes[0];
  if (!me) return;
  $('#hud').hidden = false;
  const lvl = attractOpts.mission;
  const ticket = `<b>Mission ${lvl ?? 1}</b><span>${escapeHtml(getMission(lvl ?? 1).name)}</span>`;
  const mission = $('#hud-mission');
  if (mission.innerHTML !== ticket) mission.innerHTML = ticket;
  $('#hud').style.setProperty('--me', hex(me.color));
  const lives = `<span class="tank-ico"></span> × 3`;
  if ($('#hud-lives').innerHTML !== lives) $('#hud-lives').innerHTML = lives;
  $('#hud-galons').hidden = true;
  $('#hud-rally').hidden = heroes.length < 2;
  $('#hud-emote').hidden = false;
  renderEnemyTokens($('#hud-enemies'), g.tanks.filter((t) => t.alive && t.team !== me.team).map((t) => ({ color: enemyColor(t.kind), boss: isBossKind(t.kind) })));
  renderTeam($('#hud-team'), heroes.length > 1 ? heroes.map((t, i) => ({ id: t.id, name: t.name ?? (i ? FUN_NAMES[(i * 7) % FUN_NAMES.length] + (20 + i * 13) : myName), color: t.color, alive: t.alive, me: i === 0, bot: false })) : []);
  const rt = tanks.find((t) => t.id === me.id);
  if (!me.alive || !rt || g.frozen || reel) return;
  // the reticle follows the turret, out to the enemy it is looking at
  let d = 4;
  let best = Infinity;
  for (const f of g.tanks) {
    if (!f.alive || f.team === me.team) continue;
    const dd = Math.hypot(f.x - me.x, f.y - me.y);
    const off = Math.abs(angDiff(Math.atan2(f.y - me.y, f.x - me.x), rt.turret));
    if (off < 0.5 && dd < best) { best = dd; d = dd; }
  }
  demoAim.d += (Math.min(9, Math.max(2, d)) - demoAim.d) * Math.min(1, dt * 4);
  const p = renderer.arenaToScreen(rt.x + Math.cos(rt.turret) * demoAim.d, rt.y + Math.sin(rt.turret) * demoAim.d, 0.3);
  if (!demoAim.set) { demoAim.x = p.x; demoAim.y = p.y; demoAim.set = true; }
  demoAim.x += (p.x - demoAim.x) * Math.min(1, dt * 14);
  demoAim.y += (p.y - demoAim.y) * Math.min(1, dt * 14);
  const out = g.bullets.filter((b) => b.owner === me.id).length;
  const mines = g.mines.filter((m) => m.owner === me.id && !m.dead).length;
  reticleFrame = true;
  reticle.update({
    x: demoAim.x, y: demoAim.y, max: me.spec.maxBullets, ready: Math.max(0, me.spec.maxBullets - out), mines: me.spec.mines, minesLeft: Math.max(0, me.spec.mines - mines),
    reload: me.spec.fireCd > 0 ? Math.max(0, Math.min(1, me.fireCd / me.spec.fireCd)) : 0, off: false, color: me.color,
    friend: demoFriend > performance.now() || friendlyAim(me.x, me.y, rt.turret, me.spec.bounces, me.id, g.tanks.filter((t) => t.alive).map((t) => ({ id: t.id, x: t.x, y: t.y, r: t.r, foe: t.team !== me.team }))),
  });
}

let attractAcc = 0;
let attractState: Record<string, unknown> = {};
function attractFrame(dt: number) {
  const g = attract!;
  if (attractBriefUntil && performance.now() >= attractBriefUntil) { attractBriefUntil = 0; g.frozen = false; hideBrief(); }
  attractAcc += dt;
  while (attractAcc >= DT) {
    attractAcc -= DT;
    for (const t of g.tanks) attractPrev.set(t.id, { x: t.x, y: t.y, body: t.body, turret: t.turret });
    for (const d of g.decoys) attractPrev.set(d.id, { x: d.x, y: d.y, body: d.body, turret: d.turret });
    if (g.ball) attractBallPrev = [g.ball.x, g.ball.y];
    g.step(new Map());
    if (attractTally && !g.frozen && !attractEnd) {
      attractTally.ticks++;
      for (const e of g.events) if (e[0] === 'shot' && g.tankById(e[5] as number)?.team === 1) attractTally.shots++;
    }
    for (const e of g.events) handleEvent(e, false);
    g.events = [];
    if (bridgeTrapUntil && g.tick <= bridgeTrapUntil) bridgeTrap(g);
  }
  const u = attractAcc / DT;
  renderer.windTick = renderer.fogTick = g.tick + u;
  if (g.blizzard) squallWatch(g.tick + u, document.body.classList.contains('demo') && screen === 'game');
  const tanks: RTank[] = g.tanks.map((t) => {
    const p = attractPrev.get(t.id) ?? t;
    const w = jumped(p.x, p.y, t.x, t.y, u);
    return { id: t.id, x: lerp(p.x, t.x, w), y: lerp(p.y, t.y, w), body: lerpAng(p.body, t.body, u), turret: lerpAng(p.turret, t.turret, u), alive: t.alive, invisible: false, fx: g.buffFlags(t), hp: t.maxHp > 1 ? t.hp : undefined };
  });
  for (const d of g.decoys) { // « L’Illusionniste » (iteration 58): its mirages
    const p = attractPrev.get(d.id) ?? d;
    const o = g.tankById(d.owner);
    tanks.push({ id: d.id, x: lerp(p.x, d.x, u), y: lerp(p.y, d.y, u), body: lerpAng(p.body, d.body, u), turret: lerpAng(p.turret, d.turret, u), alive: true, invisible: false, fx: (o ? g.buffFlags(o) : 0) | 1, decoy: d.owner });
  }
  renderer.syncTanks(tanks, -1, dt);
  renderer.setFrost(g.frost.size || renderer.frostShown ? [...g.frost] : undefined); // the Givré's frost (iteration 31)
  if (g.snowy) renderer.setPacked(g.packed.keys()); // the trails in the snow (iteration 42)
  lastTanks = tanks;
  updateBoss(tanks, (id) => g.tankById(id)?.hp ?? 0, (id) => g.tankById(id)?.maxHp ?? 0);
  const bullets: RBullet[] = g.bullets.map((b) => {
    const o = g.tankById(b.owner);
    return { id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, rocket: b.rocket, heavy: b.heavy, ghost: !!b.ghost, color: o?.kind === 'player' ? o.color : undefined };
  });
  renderer.syncBullets(bullets, dt);
  const mines: RMine[] = g.mines.map((m) => ({ id: m.id, x: m.x, y: m.y, blink: m.fuse >= 0 || (m.seed !== undefined && m.t > m.seed - SEED_BLINK), seed: m.seed !== undefined ? m.t : undefined, remote: !!m.remote }));
  renderer.syncMines(mines);
  const bonuses: RBonus[] = g.bonuses.map((c): RBonus => ({ id: c.id, x: c.x, y: c.y, kind: BONUS_KINDS.indexOf(c.kind), blink: c.t > 13 && !c.gold, gold: c.gold }));
  renderer.syncBonuses(bonuses);
  const flags: RFlag[] | undefined = g.flags ? g.netFlags()!.map((f): RFlag => ({ team: f[0], x: f[1], y: f[2], carrier: f[3], state: f[4], left: f[5] })) : undefined;
  if (flags) renderer.syncFlags(flags);
  if (g.petard) {
    if (petardFirstFuse && g.petard.holder) { g.petard.fuse = g.petard.len = petardFirstFuse; petardFirstFuse = 0; } // the videos: a shorter first fuse
    renderer.syncPetard(g.petard.holder, g.petard.fuse, g.petard.len);
  }
  if (g.crown) renderer.syncCrown({ x: g.crown.x, y: g.crown.y, holder: g.crown.holder, state: g.crown.state, left: CROWN_RETURN - g.crown.dropT });
  if (g.ball) renderer.syncBall(lerp(attractBallPrev[0], g.ball.x, u), lerp(attractBallPrev[1], g.ball.y, u), dt);
  const lobs: RLob[] = g.lobs.map((l) => ({ id: l.id, x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, t: l.t + u * DT, dur: l.dur }));
  renderer.syncLobs(lobs);
  film.frame(dt, tanks, bullets, mines, bonuses, flags, lobs);
  if (demoHud) updateDemoHud(g, tanks, dt);
  const ended = !!attractEnd;
  if (attractOpts.drapeau && attractCtf) {
    const standing = [1, 2].filter((k) => g.aliveCount(k) > 0).length;
    if (!attractEnd && (g.ctfWinner || standing <= 1 || g.tick > TICK_RATE * 75)) { attractEnd = g.tick + TICK_RATE * 2.5; g.frozen = !!g.ctfWinner; endAttractFlags(g); }
    if (attractEnd && g.tick > attractEnd) { // a frozen table still counts its ticks
      const c = attractCtf;
      attract = undefined;
      if (c.chain && Math.max(...c.teams) < CTF_TARGET) startAttract({ drapeau: { ...c, round: c.round + 1, teams: c.teams, carry: false }, arms: attractOpts.arms });
      else { attractOpts = {}; startAttract({}); }
    }
  } else if (attractOpts.ballon && attractBall) {
    renderBallBoard(g);
    if (!attractEnd && g.ball && (g.ball.scored || g.ball.time >= BALL_ROUND)) { attractEnd = g.tick + TICK_RATE * 3; g.frozen = true; endAttractBall(g); }
    if (attractEnd && g.tick > attractEnd) {
      const c = attractBall;
      attract = undefined;
      if (c.chain && Math.max(...c.teams) < BALL_TARGET) startAttract({ ballon: { ...c, round: c.round + 1, teams: c.teams }, arms: attractOpts.arms });
      else { attractOpts = {}; attractBall = undefined; startAttract({}); }
    }
  } else if (attractOpts.couronne && attractCrown) {
    attractCrownClock(g);
    if (!attractEnd && (g.crown?.winner || (g.crown?.time ?? 0) >= CROWN_ROUND)) { attractEnd = g.tick + TICK_RATE * 3; endAttractCrown(g); }
    if (attractEnd && g.tick > attractEnd) {
      const c = attractCrown;
      attract = undefined;
      if (c.chain && Math.max(...c.scores) < CROWN_TARGET) startAttract({ couronne: { ...c, round: c.round + 1, scores: c.scores, head: 0 }, arms: attractOpts.arms });
      else { attractOpts = {}; attractCrown = undefined; startAttract({}); }
    }
  } else if (attractOpts.caisses && attractHunt) {
    attractHuntClock(g);
    if (!attractEnd && (g.hunt?.time ?? 0) >= HUNT_ROUND) { attractEnd = g.tick + TICK_RATE * 2.5; g.frozen = true; endAttractHunt(g); }
    if (attractEnd && g.tick > attractEnd) {
      const h = attractHunt;
      attract = undefined;
      if (h.chain && Math.max(...h.scores) < HUNT_TARGET) startAttract({ caisses: { ...h, round: h.round + 1, scores: h.scores }, arms: attractOpts.arms });
      else { attractOpts = {}; attractHunt = undefined; startAttract({}); }
    }
  } else if (attractOpts.versus) {
    const alive = g.tanks.filter((t) => t.alive && t.kind === 'player').length;
    if (!attractEnd && (alive <= 1 || g.tick > TICK_RATE * (attractVs?.petard ? 90 : 60))) { attractEnd = g.tick + TICK_RATE * 2.5; endAttractVersus(g); }
    if (attractEnd && g.tick > attractEnd) {
      const vs = attractVs!;
      attract = undefined;
      if (vs.chain && Math.max(...vs.scores) < 5) startAttract({ versus: { ...vs, round: vs.round + 1, scores: vs.scores }, arms: attractOpts.arms });
      else { attractOpts = {}; startAttract({}); }
    }
  } else {
    if (!attractEnd && (g.aliveCount(1) === 0 || g.aliveCount(2) === 0 || g.tick > TICK_RATE * 90)) {
      attractEnd = g.tick + TICK_RATE * 2.5;
      if (g.aliveCount(2) === 0) g.cheer(1); // the heroes cheer the mission won (iteration 30)
      if (attractTally && g.aliveCount(2) === 0) {
        attractEnd = g.tick + TICK_RATE * 8; // the replay, then the sheet
        openSheet({ kicker: `Mission ${attractOpts.mission ?? 1}`, title: attractName, sub: '', tally: attractTally.sheet(TICK_RATE) });
      }
    }
    if (attractEnd && g.tick > attractEnd) { attract = undefined; startAttract(); }
  }
  if (!ended && attractEnd && attract === g && !attractOpts.couronne && !attractOpts.ballon) queueReel(); // a crown round does not end on a shot: no replay (nor a goal: the film has no ball)
  attractState = { tick: g.tick, heroes: g.aliveCount(1), enemies: g.aliveCount(2), mission: attractOpts.mission, flags: g.flags?.map((f) => f.state), teams: attractCtf?.teams, replays };
}

// ------------------------------------------------------------------ « Le ralenti » (iteration 32)

const film = new Film();
let reel: Reel | undefined;
let reelDue = 0; // performance.now() when the queued replay starts (0: none)
let replays = 0; // replays played (the smoke test and the videos check it)
let reelWanted = -1; // the demo's trick shot: replay as soon as this tank falls
let replayOn = (() => { try { return localStorage.getItem('tanks.ralenti') !== '0'; } catch { return true; } })();

/** The mission (or round) is over: the replay starts a moment later, once the last snapshots have been drawn. */
function queueReel(force = false) {
  if ((!replayOn && !force) || reel || screen !== 'game' || treeDue) return; // not behind the home screen or the lobby (nor before the skill tree)
  reelDue = performance.now() + (online ? 350 : 450);
  reelTries = 0;
}
let reelTries = 0;

function reelName(id: number) {
  const info = infos.get(id);
  if (online && info) return info.kind === 'player' ? info.name : enemyName(info.kind);
  const t = attract?.tankById(id);
  if (t) return t.kind === 'player' ? t.name : enemyName(t.kind);
  const kind = renderer.tankKind(id);
  return kind ? enemyName(kind) : undefined;
}
/** An enemy as the replay names it (iteration 49): « le tank gris », « l’Aimant », « la Sauterelle », « un wagon »… */
const COLOUR_KINDS = new Set(['brown', 'ash', 'marine', 'yellow', 'pink', 'green', 'violet', 'white', 'black']);
function enemyName(kind: string) {
  const label = specOf(kind).label;
  if (COLOUR_KINDS.has(kind)) return `le tank ${label.toLowerCase()}`;
  if (kind === 'steel') return 'le tank d’acier';
  if (kind === 'wagon') return 'un wagon';
  if (kind === 'hopper') return 'la Sauterelle';
  if (kind === 'magnet') return 'l’Aimant';
  if (kind === 'mechanic') return 'le Mécano';
  if (kind === 'spectre') return 'le Spectre';
  if (kind === 'conjurer') return 'l’Illusionniste';
  return `le ${label}`;
}

function startReel(force = false) {
  reelDue = 0;
  if (reel || (!force && !replayOn) || (treeOpen && treeAuto) || treeDue || screen === 'results') return false;
  const r = film.reel(force ? 4.5 : 3.5);
  if (!r) {
    // the last blast may not be drawn yet (the table runs a few ticks behind the server): look again a little later
    if (!force && reelTries++ < 8) reelDue = performance.now() + 200;
    return false;
  }
  reel = r;
  replays++;
  const [big, small] = koCaption(r, reelName, (id) => isBossKind(renderer.tankKind(id) ?? ''));
  const el = $('#replay');
  el.querySelector('b')!.textContent = big;
  el.querySelector('span')!.textContent = small;
  el.hidden = false;
  el.classList.remove('on');
  void el.offsetWidth; // restart the bars' animation
  el.classList.add('on');
  document.body.classList.add('replaying');
  sfx.rewind();
  return true;
}

function stopReel() {
  reelDue = 0;
  if (!reel) return;
  reel = undefined;
  renderer.replayCam = undefined;
  $('#replay').hidden = true;
  $('#replay').classList.remove('on');
  document.body.classList.remove('replaying');
  renderTick = latestK - INTERP; // online: back to the live table at once
  const b = $('#banner');
  if (!b.hidden) { b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; } // the banner pops in now
}

/** One frame of the replay; returns the (slowed down) time step for the effects. */
function reelFrame(dt: number): number {
  const r = reel!;
  const f = r.step(dt);
  const wasOnline = online;
  online = false; // what was said (toasts, rumble, counters) is not said twice
  try {
    for (const e of f.events) if (REPLAYED.has(e[0])) handleEvent(e, wasOnline);
  } finally { online = wasOnline; }
  renderer.syncTanks(f.tanks, wasOnline ? myTankId : -1, f.dt);
  renderer.syncBullets(f.bullets, f.dt);
  renderer.syncMines(f.mines);
  renderer.syncLobs(f.lobs);
  renderer.syncBonuses(f.bonuses);
  if (f.flags) renderer.syncFlags(f.flags);
  updateNameTags(f.tanks);
  renderer.replayCam = { x: r.x, y: r.y, k: r.zoom() };
  if (r.done) stopReel();
  return f.dt;
}

// « Passer › » (iteration 33): the replay can be skipped with a tap, Space, Enter, Escape or B on a gamepad
function skipReel() {
  if (!reel || screen !== 'game') return false;
  stopReel();
  return true;
}
$('#replay .r-skip').addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); skipReel(); });
addEventListener('keydown', (e) => {
  if (e.repeat || !reel || (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Escape')) return;
  if (skipReel()) { e.preventDefault(); e.stopImmediatePropagation(); }
}, { capture: true });
let padSkipHeld = true; // a button already down when the replay starts does not skip it
function padSkip() {
  const pads = navigator.getGamepads?.() ?? [];
  let down = false;
  for (const p of pads) if (p && (p.buttons[1]?.pressed || p.buttons[9]?.pressed)) down = true;
  if (down && !padSkipHeld) skipReel();
  padSkipHeld = down;
}

const replayLabel = () => ($('#menu-replay').textContent = `Ralenti des fins de manche : ${replayOn ? 'oui' : 'non'}`);
/** The replay switch lives in the pause menu and in the options (iteration 43). */
function setReplayOn(on: boolean) {
  replayOn = on;
  try { localStorage.setItem('tanks.ralenti', replayOn ? '1' : '0'); } catch {}
  if (!replayOn) stopReel();
  replayLabel();
}
replayLabel();
$('#menu-replay').addEventListener('click', () => setReplayOn(!replayOn));

// ------------------------------------------------------------------ main loop

let lastT = performance.now();
const demoMode = new URLSearchParams(location.search).has('demo');
let acc = 0;
function frame(now: number) {
  const lastT0 = lastT;
  const dt = Math.min(0.05, (now - lastT) / 1000);
  if (now > lastT) fps += (1000 / (now - lastT) - fps) * 0.05;
  lastT = now;
  if (reelDue && now >= reelDue) startReel();
  if (sheetWaiting() && !reel && !reelDue) playSheet(); // « Le bilan » (iteration 45): the count starts once the replay is over
  if (treeDue && now >= treeDue) { treeDue = 0; if (phase === 'cleared' && training.includes(pid)) { hideSheet(); openTree(true); } }
  let rdt = dt;
  if (reel) padSkip();
  else padSkipHeld = true;
  if (reel) rdt = reelFrame(demoMode ? Math.min(0.25, Math.max(0, (now - lastT0) / 1000)) : dt); // the videos: real time, as for the demo
  if (online) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n++ < 4) { acc -= DT; clientTick(); }
    if (acc > DT) acc = 0;
    if (!reel) onlineFrame(dt);
    updateClock();
    updateCouncilTimer();
    updateTreeTimer();
  } else if (attract && !reel) {
    updateTreeTimer();
    // the videos are filmed on machines without a GPU: let the demo catch up on slow frames so it plays in real time
    attractFrame(demoMode ? Math.min(0.25, Math.max(0, (now - lastT0) / 1000)) : dt);
    updateNameTags([]);
  }
  if (!reticleFrame) reticle.hide();
  reticleFrame = false;
  placeBubbles();
  controls.padMenu = screen === 'game' && !$('#menu').hidden;
  if (!demoMode) navStep(now);
  renderer.render(rdt);
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

async function createRoom(btn: HTMLButtonElement, mode?: Mode, quick = false) {
  sfx.click();
  btn.disabled = true;
  try {
    const r = await fetch('/api/new').then((r) => r.json() as Promise<{ room: string }>);
    wantMode = mode;
    quickPlay = quick;
    connect(r.room);
    if (quick) {
      // the campaign starts by itself; if it does not (an error, a slow server), the lobby shows up after a moment
      btn.classList.add('busy');
      setTimeout(() => { btn.classList.remove('busy'); if (roomCode && screen === 'home') { quickPlay = quickStarting = false; show('lobby'); } }, 4000);
      return;
    }
    show('lobby');
  } catch {
    toast('Serveur injoignable');
  } finally {
    btn.disabled = false;
  }
}
$('#btn-create').addEventListener('click', () => createRoom($<HTMLButtonElement>('#btn-create')));
$('#btn-play').addEventListener('click', () => createRoom($<HTMLButtonElement>('#btn-play'), undefined, true));
$('#btn-daily').addEventListener('click', () => createRoom($<HTMLButtonElement>('#btn-daily'), 'daily'));
$('#btn-rush').addEventListener('click', () => createRoom($<HTMLButtonElement>('#btn-rush'), 'rush'));

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
  b.addEventListener('click', () => {
    sfx.click();
    // the workshop without a mission yet: open the editor, « Jouer en ligne » hands the mission over
    if (b.dataset.mode === 'atelier' && !lobbyAtelier) openWorkshop();
    else send({ t: 'mode', mode: b.dataset.mode as Mode });
  }),
);
$('#btn-start').addEventListener('click', () => { sfx.click(); send({ t: 'start' }); });
$('#btn-leave').addEventListener('click', () => leaveRoom());
// the end of a game (iteration 30, players asked for it): no more waiting on the frozen table, straight back to the lobby
$('#btn-results-ok').addEventListener('click', () => {
  if (online && phase === 'gameover') { send({ t: 'stop' }); show('lobby'); return; }
  show(online ? 'game' : roomCode ? 'lobby' : 'home');
});
$('#btn-results-again').addEventListener('click', () => {
  sfx.click();
  send({ t: 'again' });
  $<HTMLButtonElement>('#btn-results-again').disabled = true;
});

function toggleMenu(force?: boolean) {
  if (screen !== 'game') return;
  const m = $('#menu');
  m.hidden = force !== undefined ? !force : !m.hidden;
}
$('#btn-menu').addEventListener('click', () => toggleMenu());
$('#menu-resume').addEventListener('click', () => toggleMenu(false));
$('#menu-lobby').addEventListener('click', () => { send({ t: 'stop' }); toggleMenu(false); });
$('#menu-quit').addEventListener('click', () => leaveRoom());
$('#menu-options').addEventListener('click', () => openOptions());
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { if (closeOptions()) return; if (treeOpen) { treeReady(); return; } toggleMenu(); }
  if (e.code === 'KeyM' && (e.target as HTMLElement)?.tagName !== 'INPUT') updateMusicBtn(toggleMusic());
});
function updateMusicBtn(on = isMusicOn()) {
  $('#btn-music').innerHTML = icon(on ? 'music' : 'mute');
  $('#btn-music').classList.toggle('off', !on);
}
$('#btn-music').addEventListener('click', () => updateMusicBtn(toggleMusic()));
updateMusicBtn();

// ------------------------------------------------------------------ full screen (iteration 15, a player's report: the big address bar in landscape on iPhone)
{
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void; webkitFullscreenEnabled?: boolean };
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const installed = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // an iPhone has no full-screen mode for web pages: only a shortcut on the home screen hides the address bar
  const canFull = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled) && !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const howTo = 'Sur iPhone, la barre d’adresse ne se cache pas dans le navigateur. Pour jouer en plein écran : bouton Partager, puis « Sur l’écran d’accueil », et lance Tanks! depuis l’icône.';
  const btn = $('#btn-full');
  if (installed || new URLSearchParams(location.search).has('demo')) btn.hidden = true;
  btn.addEventListener('click', async () => {
    if (!canFull) { toast(howTo, 7000); return; }
    try {
      if (doc.fullscreenElement || doc.webkitFullscreenElement) await (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      else {
        await (root.requestFullscreen?.({ navigationUI: 'hide' }) ?? root.webkitRequestFullscreen?.());
        await (window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => {});
      }
    } catch { toast('Le plein écran n’est pas disponible ici.', 3000); }
  });
  // in landscape on a phone, say it once per visit
  let told = false;
  const hint = () => {
    if (told || installed || canFull || !(controls.touchMode || matchMedia('(pointer: coarse)').matches) || innerWidth <= innerHeight || innerHeight > 520) return;
    told = true;
    setTimeout(() => toast(howTo, 7000), 1200);
  };
  addEventListener('resize', hint);
  addEventListener('touchstart', hint, { once: true, passive: true });
}

// ------------------------------------------------------------------ iteration stamp, journal

function renderJournal() {
  $('#journal-list').innerHTML = [...META.journal].reverse().map((j) => `
    <article>
      <header><span class="stamp small">N° ${j.iteration}</span><b>${escapeHtml(j.title)}</b><time>${j.date}</time></header>
      <ul>${j.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
    </article>`).join('');
}
// the bestiary (iteration 25): every enemy, in the order players meet them, and what its colour says
const BESTIARY: [TankKind, string][] = [
  ['brown', 'immobile, il tire lentement'],
  ['ash', 'roule et tire tout droit'],
  ['marine', 'lance des fusées rapides, sans rebond'],
  ['yellow', 'sème des mines en fuyant'],
  ['pink', 'tire en rafale et vise les ricochets'],
  ['green', 'immobile, fusées à deux rebonds : un tireur d’élite'],
  ['violet', 'rapide, mines et rafales'],
  ['white', 'invisible ! seules ses traces le trahissent, même sur la glace'],
  ['black', 'le plus rapide de tous, fusées sans rebond'],
  ['steel', 'son blindage encaisse un coup, puis il s’énerve'],
  ['mason', 'bâtit des murs de liège entre toi et lui'],
  ['thief', 'file voler les caisses bonus avant toi'],
  ['rampart', 'son bouclier renvoie les obus : prends-le de côté'],
  ['magnet', 'son champ avale les obus et te les renvoie : tire quand il s’éteint'],
  ['frost', 'patine et givre le sol derrière lui : là, tout le monde dérape'],
  ['mortar', 'tire en cloche par-dessus les murs : fuis le cercle rouge, fonce-lui dessus'],
  ['hopper', 'saute par-dessus les murs pour te prendre à revers : vise l’anneau vert où elle va retomber'],
  ['watcher', 'son faisceau balaie la table : s’il t’éclaire, sa fusée suit la lumière ; hors du faisceau, il ne voit rien'],
  ['mechanic', 'répare les épaves de ses amis, qui repartent rafistolés : abats-le en premier, ou pendant qu’il travaille'],
  ['spectre', 'ses obus traversent le premier mur qu’ils touchent : aucun abri ne tient, alors bouge, et fonce pendant qu’il recharge'],
  ['conjurer', 'd’un coup de baguette, il devient trois : deux mirages aux obus d’étoiles et un seul vrai tank ; ton tank traverse les mirages'],
  ['boss', 'boss : salves d’obus tout autour de lui'],
  ['drill', 'boss : creuse sous la table et jaillit sous toi'],
  ['thunder', 'boss : appelle la foudre sur ta tête'],
  ['sower', 'boss : sème des graines géantes qui explosent'],
  ['bombard', 'boss : pilonne des rangées entières de boulets, d’un bout à l’autre'],
  ['wagon', 'accroché derrière le Tortillard, son petit canon tire sur les côtés de la voie'],
  ['train', 'boss : fait le tour de la table sur ses rails et écrase tout ce qui est sur la voie ; de face, son chasse-pierres renvoie les obus'],
  ['magus', 'boss : devient quatre d’un coup de baguette, et chaque coup reçu l’échange avec un de ses mirages'],
];
// the crates (iteration 29): what each bonus does, in its colour
const CRATES: [BonusKind, string][] = [
  ['shield', 'une bulle encaisse un coup à ta place'],
  ['bounce', 'tes obus rebondissent une fois de plus'],
  ['turbo', 'tes chenilles vont bien plus vite'],
  ['fan', 'trois obus d’un coup, en éventail'],
  ['freeze', 'tous tes adversaires gèlent sur place, pris dans un cube de glace'],
  ['heavy', 'de gros obus qui traversent le liège et brisent les obus d’en face'],
  ['ghost', 'tes obus passent à travers le premier mur qu’ils touchent, puis ricochent comme d’habitude'],
  ['remote', 'tes mines ne sautent plus au passage : elles attendent que tu rappuies sur la touche des mines'],
];
// enemies met in the campaign, the challenges, the boss rush… (iteration 35): the others are greyed out in the bestiary
const MET_KEY = 'tanks.vus';
const metKinds = new Set<string>((() => { try { const v = JSON.parse(localStorage.getItem(MET_KEY) ?? '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } })());
function meetEnemies(kinds: string[]) {
  const fresh: string[] = [];
  for (const k of kinds) if (BESTIARY.some(([b]) => b === k) && !metKinds.has(k)) { metKinds.add(k); fresh.push(k); }
  if (!fresh.length) return;
  try { localStorage.setItem(MET_KEY, JSON.stringify([...metKinds])); } catch {}
  renderBestiary();
  // the first ever met (an empty notebook) needs no fanfare: everybody is new on the first mission
  if (metKinds.size > fresh.length) newcomerCards(fresh);
}
/** « Nouveau au bestiaire ! » (iteration 38): a paper card pinned on the side of the table for each enemy met for the first time. */
function newcomerCards(kinds: string[], delay = 1800) {
  kinds.slice(0, 3).forEach((k, i) => setTimeout(() => {
    const line = BESTIARY.find(([b]) => b === k)?.[1] ?? '';
    const el = document.createElement('div');
    el.className = 'newcomer';
    el.style.setProperty('--c', hex(enemyColor(k)));
    el.innerHTML = `<small>Nouveau au bestiaire !</small><b><i></i>${escapeHtml(specOf(k).label)}</b><span>${escapeHtml(line)}</span>`;
    let box = document.getElementById('newcomers');
    if (!box) { box = document.createElement('div'); box.id = 'newcomers'; document.body.appendChild(box); }
    box.appendChild(el);
    if (i === 0) sfx.newcomer();
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 5800);
  }, delay + i * 450));
}
// ------------------------------------------------------------------ « Le manuel » (iteration 39)
// A player asked for menus without drop-down panels: the controls, the modes, the crates and the bestiary now live in a ring binder
// with paper tabs, opened on the right page straight from the home screen. Keyboard: ← → to turn the pages, Échap to close;
// gamepad: LB / RB, and B to close (see padnav.ts).
type ManualTab = 'commandes' | 'modes' | 'caisses' | 'bestiaire' | 'terrain';
const MANUAL_TABS: ManualTab[] = ['commandes', 'modes', 'caisses', 'bestiaire', 'terrain'];
const MANUAL_TITLES: Record<ManualTab, string> = { commandes: 'Prendre les commandes', modes: 'Les modes de jeu', caisses: 'Les caisses bonus', bestiaire: 'Le bestiaire', terrain: 'Le terrain' };
let manualTab: ManualTab = 'commandes';
const metOrDemo = (k: string) => demoMode || metKinds.has(k);

/** Top view of a wooden tank in the colour of its kind, for the bestiary cards (a dark silhouette when not met yet). */
function tankSvg(kind: string, known: boolean) {
  const boss = isBossKind(kind);
  const c = known ? hex(enemyColor(kind)) : '#2a1d12';
  const dark = known ? '#2a1d12' : '#1a120b';
  const ring = boss && known ? '<circle cx="24" cy="24" r="21" fill="none" stroke="#f2c14e" stroke-width="2" stroke-dasharray="4 3"/>' : '';
  const s = specOf(kind);
  const barrel = s.maxBullets === 0
    ? `<circle cx="24" cy="24" r="5" fill="${dark}"/><circle cx="24" cy="24" r="3" fill="${c}" opacity=".6"/>` // a mortar: a wide round mouth
    : `<rect x="24" y="${s.rocket ? 21 : 22}" width="${s.rocket ? 19 : 17}" height="${s.rocket ? 6 : 4}" rx="2" fill="${dark}"/>`;
  const extra = !known ? '<text x="24" y="29" text-anchor="middle" font-size="15" font-weight="900" fill="#c9b391">?</text>'
    : kind === 'rampart' ? '<path d="M37 13 q6 11 0 22" fill="none" stroke="#e8b04a" stroke-width="3" stroke-linecap="round"/>'
    : kind === 'magnet' ? '<path d="M36 17 v-4 h4 v4 m0 14 v4 h-4 v-4" fill="none" stroke="#d8392f" stroke-width="2.4"/>'
    : kind === 'hopper' ? '<path d="M14 9 l-7 -5 l-4 7 M14 39 l-7 5 l-4 -7" fill="none" stroke="#2a1d12" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="29" cy="20" r="2.6" fill="#fff"/><circle cx="29" cy="28" r="2.6" fill="#fff"/>'
    : kind === 'train' ? '<rect x="10" y="17" width="18" height="14" rx="3" fill="#2a1d12" opacity=".35"/><circle cx="31" cy="24" r="3.4" fill="#2a1d12"/><path d="M40 14 l5 10 l-5 10" fill="none" stroke="#f2c14e" stroke-width="2.6" stroke-linejoin="round"/>'
    : kind === 'wagon' ? '<rect x="7" y="22" width="4" height="4" fill="#2a1d12"/><rect x="37" y="22" width="4" height="4" fill="#2a1d12"/>'
    : kind === 'mechanic' ? '<path d="M14 24 H34" stroke="#dfe5ea" stroke-width="4" stroke-linecap="round"/><path d="M36 19.5 a5 5 0 1 0 0 9" fill="none" stroke="#dfe5ea" stroke-width="3.4"/><rect x="5" y="19" width="7" height="10" rx="1.5" fill="#d8392f" stroke="#2a1d12" stroke-width="1"/>'
    : kind === 'spectre' ? '<path d="M15 31 V20 a9 9 0 0 1 18 0 V31 l-3 -2.5 l-3 2.5 l-3 -2.5 l-3 2.5 l-3 -2.5 Z" fill="#f4fffb" stroke="#2a1d12" stroke-width="1.1" opacity=".92"/><ellipse cx="21" cy="21" rx="1.6" ry="2.4" fill="#1d2b28"/><ellipse cx="27" cy="21" rx="1.6" ry="2.4" fill="#1d2b28"/><circle cx="24" cy="26.5" r="1.4" fill="#1d2b28"/>'
    : kind === 'magus' ? '<path d="M5 14 Q2 24 5 34 L13 30 V18 Z" fill="#2c1d4a" opacity=".85"/><rect x="17" y="12" width="14" height="14" rx="1.5" fill="#1e1a26"/><rect x="14" y="25" width="20" height="3" rx="1.5" fill="#1e1a26"/><rect x="17" y="21.5" width="14" height="2.6" fill="#f2c14e"/><path d="M34 11 L43 4" stroke="#1e1a26" stroke-width="2.2" stroke-linecap="round"/><path d="M43 1.5 l1.2 2.6 l2.8 .3 l-2.1 1.9 l.6 2.8 l-2.5 -1.4 l-2.5 1.4 l.6 -2.8 l-2.1 -1.9 l2.8 -.3 Z" fill="#ffd34d"/>'
    : kind === 'conjurer' ? '<rect x="18" y="15" width="12" height="11" rx="1.5" fill="#1e1a26"/><rect x="15" y="25" width="18" height="3" rx="1.5" fill="#1e1a26"/><rect x="18" y="22" width="12" height="2.4" fill="#c9a7f2"/><path d="M33 12 L41 6" stroke="#1e1a26" stroke-width="2"/><path d="M42 2.5 l1.2 2.6 l2.8 .3 l-2.1 1.9 l.6 2.8 l-2.5 -1.4 l-2.5 1.4 l.6 -2.8 l-2.1 -1.9 l2.8 -.3 Z" fill="#ffd34d"/>'
    : kind === 'watcher' ? '<path d="M24 24 L46 15 L46 33 Z" fill="#ffd648" opacity=".55"/><circle cx="24" cy="24" r="4" fill="#ffe680" stroke="#2a1d12" stroke-width="1.2"/>'
    : kind === 'steel' ? '<rect x="12" y="13" width="24" height="22" rx="4" fill="none" stroke="#dfe6ee" stroke-width="1.6" stroke-dasharray="3 2"/>'
    : '';
  return `<svg viewBox="0 0 48 48" aria-hidden="true">${ring}
    <rect x="9" y="9" width="30" height="5" rx="2.5" fill="${dark}"/><rect x="9" y="34" width="30" height="5" rx="2.5" fill="${dark}"/>
    <rect x="10" y="12" width="28" height="24" rx="5" fill="${c}" stroke="${dark}" stroke-width="1.4"${s.invisible && known ? ' opacity=".55" stroke-dasharray="3 2"' : ''}/>
    ${known ? barrel : ''}<circle cx="24" cy="24" r="${known ? 7.5 : 8}" fill="${c}" stroke="${dark}" stroke-width="1.4" style="filter:brightness(1.12)"/>${extra}</svg>`;
}
const pips = (n: number, of = 5) => `<span class="pips" aria-label="${n} sur ${of}">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(Math.max(0, of - n))}</span>`;
/** The sheet of an enemy: what its colour says, in a few pips and labels. */
function enemySheet(kind: string) {
  const s = specOf(kind);
  const speed = kind === 'train' || kind === 'wagon' ? 3 : s.speed <= 0 ? 0 : Math.max(1, Math.min(5, Math.round((s.speed / 3.3) * 5))); // the Tortillard's rails drive it (iteration 49)
  const rate = Math.max(1, Math.min(5, Math.round(5 - (s.fireCd - 0.65) / 0.6)));
  const tags: string[] = [];
  if (kind === 'train') tags.push('Pas de canon');
  else if (s.maxBullets === 0) tags.push('Tirs en cloche');
  else tags.push(`${s.maxBullets} obus à la fois`, s.rocket ? `Fusées${s.bounces ? ` · ${s.bounces} rebond${s.bounces > 1 ? 's' : ''}` : ' sans rebond'}` : `${s.bounces} rebond${s.bounces > 1 ? 's' : ''}`);
  if (s.mines) tags.push(`${s.mines} mine${s.mines > 1 ? 's' : ''}`);
  if (isBossKind(kind)) tags.push(`Boss : ${s.hp ?? 1} coups`);
  else if ((s.hp ?? 1) > 1) tags.push(`Blindé : ${s.hp} coups`);
  if (s.invisible) tags.push('Invisible');
  if (kind === 'hopper') tags.push('Saute les murs');
  if (kind === 'watcher') tags.push('Phare tournant');
  if (kind === 'mechanic') tags.push('Répare les épaves', 'Une fois par tank');
  if (kind === 'spectre') tags.push('Obus fantômes', 'Traverse les murs');
  if (kind === 'conjurer') tags.push('Deux mirages', 'Obus d’étoiles');
  if (kind === 'magus') tags.push('Trois mirages', 'Escamotage');
  if (kind === 'train') tags.push('Roule sur des rails', 'Chasse-pierres');
  if (kind === 'wagon') tags.push('Suit la locomotive');
  return `<dl><dt>Vitesse</dt><dd>${speed ? pips(speed) : '<em>immobile</em>'}</dd><dt>Cadence</dt><dd>${pips(rate)}</dd></dl><p class="tags">${tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</p>`;
}
const MODES: [string, string, string, string][] = [
  ['tank', 'Campagne coop', '1 à 4', 'Des missions faites main puis générées à l’infini, un boss toutes les 10 missions, des vies partagées. Chaque mission réussie rapporte jusqu’à trois étoiles : personne ne tombe, sous le chrono, sans gaspiller ses obus. Des coéquipiers pilotés par l’ordinateur complètent l’équipe.'],
  ['calendar', 'Défi du jour', '1 à 4', `${DAILY_STAGES} missions, les mêmes pour tout le monde aujourd’hui, avec une consigne qui change chaque jour. Le chrono fait le classement.`],
  ['crown', 'Ronde des boss', '1 à 4', 'Les boss l’un après l’autre, puis deux à la fois. L’ordre change chaque lundi : le meilleur chrono de la semaine gagne.'],
  ['swords', 'Versus', '2 à 4', 'Chacun pour soi : le dernier tank debout marque un point, premier à 5 manches. Seul ? Ajoute des rivaux pilotés par l’ordinateur.'],
  ['flag', 'Drapeaux', '2 à 4', `Les Bleus contre les Rouges : prends le drapeau d’en face et rapporte-le chez toi. Première équipe à ${CTF_TARGET} manches.`],
  ['ball', 'Le ballon', '2 à 4', `Les Bleus contre les Rouges, un ballon de plage et deux buts : pousse-le à coups d’obus, de chenilles ou de mines. Première équipe à ${BALL_TARGET} buts.`],
  ['crate', 'La chasse aux caisses', '2 à 4', `Les caisses pleuvent, chacune vaut un point, et la caisse dorée en vaut ${HUNT_GOLD}. Premier à ${HUNT_TARGET} manches.`],
  ['petard', 'Le pétard', '2 à 4', `Un pétard allumé à refiler : fonce dans un tank ou touche-le d’un obus. Les obus ne font que sonner. Quand la mèche est consumée, son porteur saute ! Le dernier debout gagne, premier à ${PETARD_TARGET} manches.`],
  ['crown', 'La couronne', '2 à 4', `Une seule couronne au milieu de la table : mets-la et garde-la ${CROWN_HOLD} secondes. Touché ? Elle tombe de ta tête. Premier à ${CROWN_TARGET} manches.`],
  ['mask', 'La taupe', `${TAUPE_MIN_PLAYERS} ou 4`, 'Une campagne coop… avec un traître tiré au sort en secret. Après chaque mission, le conseil vote pour le démasquer.'],
  ['hammer', 'L’atelier', '1 à 4', 'Dessine ta mission case par case (murs, liège, tunnels, portails, ennemis, météo), puis jouez-la ensemble.'],
];
const KEYS: [string, [string, string][]][] = [
  ['Clavier et souris', [
    ['<kbd>ZQSD</kbd> <kbd>WASD</kbd> <kbd>↑←↓→</kbd>', 'rouler'],
    ['Souris', 'viser : le réticule compte tes obus prêts (en haut), tes mines (en bas) et la recharge (l’anneau)'],
    ['<kbd>Clic</kbd> <kbd>E</kbd> <kbd>Maj</kbd> <kbd>Entrée</kbd>', 'tirer'],
    ['<kbd>Espace</kbd> clic droit', 'poser une mine'],
    ['<kbd>K</kbd> puis <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>', 'l’arbre des galons (campagne)'],
    ['<kbd>T</kbd>', '« Suis-moi ! » aux coéquipiers'],
    ['<kbd>1</kbd> à <kbd>6</kbd>', 'une bulle au-dessus de ton tank'],
    ['Clic droit maintenu', 'la roue des bulles : glisse vers une bulle et lâche (un clic droit bref pose toujours la mine)'],
    ['<kbd>M</kbd> · <kbd>F</kbd> · <kbd>Échap</kbd>', 'musique · ton avis · menu'],
  ]],
  ['Manette', [
    ['Stick gauche', 'rouler'],
    ['Stick droit', 'viser'],
    ['<kbd>RT</kbd> ou <kbd>X</kbd>', 'tirer'],
    ['<kbd>LT</kbd> ou <kbd>A</kbd>', 'poser une mine'],
    ['<kbd>Y</kbd> · croix', '« Suis-moi ! » · les bulles'],
    ['Dans les menus', 'croix ou stick pour choisir, A pour valider, B pour revenir, LB et RB pour les onglets'],
  ]],
  ['Écran tactile', [
    ['Pouce gauche', 'le joystick pour rouler'],
    ['Pouce droit', 'touche pour viser et tirer'],
    ['Bouton MINE', 'poser une mine'],
  ]],
];
/** « Le terrain » (iteration 40): every kind of cell of the table, drawn as in the workshop. */
const TERRAIN: [string, string, string, boolean?][] = [
  ['#', 'Mur', 'Arrête les tanks, et les obus y ricochent.'],
  ['H', 'Mur haut', 'Comme un mur, en plus haut : il cache ce qu’il y a derrière.'],
  ['o', 'Liège', 'Un bloc tendre : une mine le fait voler en éclats, et certains obus aussi.'],
  ['_', 'Trou', 'Les tanks n’y passent pas, mais les obus volent au-dessus.'],
  [':', 'Pont', 'On roule dessus pour franchir un trou. Une mine tout près le fait tomber… avec ceux qui sont dessus !'],
  ['=', 'Tunnel', 'Un passage couvert : on s’y cache, les obus rebondissent sur son toit.'],
  ['*+', 'Portails', 'Entre dans l’un, ressors par l’autre de la même couleur. Les obus aussi.'],
  ['>', 'Tapis roulant', 'Il emporte les tanks, les mines et les caisses dans le sens de la flèche.'],
  ['~', 'Glace', 'On y glisse : pour tourner, il faut s’y prendre tôt.'],
  [',', 'Sable', 'On y roule moins vite, et une mine posée dans le sable s’y enfouit.'],
  ['&', 'Neige', 'On s’y enfonce et on y roule moins vite, mais chaque tank y trace une piste tassée, rapide, que la neige finit par recouvrir. Une mine posée dans la neige disparaît dessous, et les tanks blancs y laissent des traces.'],
  ['%', 'Interrupteur', 'Tire dessus : toutes les barrières basculent. Les ennemis aussi peuvent le toucher…'],
  ['[]', 'Barrières', 'Les rouges sont levées au départ, les bleues baissées. Une barrière levée arrête tout ; elle attend que la place soit libre pour monter.'],
  ['{}', 'Ponts-levis', 'Au-dessus d’un trou. Les rouges sont levés au départ, les bleus baissés, et l’interrupteur les fait basculer. Levé, il laisse passer les obus mais pas les tanks. Et à chaque « Clac ! », les tapis roulants changent de sens.'],
  ['8', 'Bonhomme de neige', 'Il arrête les tanks et avale les obus, sans ricochet. Le premier obus lui fait perdre la tête, le deuxième le renverse dans la neige. Une mine le fait tomber d’un coup. Et il te suit des yeux…'],
  ['/', 'Miroir', 'Il arrête les tanks, mais un obus qui touche sa vitre repart à angle droit, sans perdre de ricochet : de quoi tirer derrière les coins. À chaque « Clac ! » d’un interrupteur, tous les miroirs pivotent d’un quart de tour.'],
  ['@', 'Sables mouvants', 'Un tourbillon de sable : on y roule deux fois moins vite, il t’aspire vers son centre et t’engloutit si tu t’y attardes trois secondes. Traverse sans t’arrêter ! Les mines qu’on y pose disparaissent, les obus passent au-dessus, et les caisses s’y laissent attirer.', true],
];
/** « Le temps qu’il fait » (iteration 41): the weathers of the table, on the same page as the terrain. */
const WEATHER: [string, string, string, boolean?][] = [
  ['moon', 'Nuit', 'Les ennemis ne te voient que de près… ou quand tu tires. Tes phares éclairent devant toi.'],
  ['bolt', 'Orage', 'Quand le sol crépite, la foudre va tomber : écarte-toi ! Chaque éclair montre tout le monde.'],
  ['wind', 'Vent', 'Il courbe les obus en vol : vise en amont, ou tire quand la manche à air retombe.'],
  ['fog', 'Brouillard', 'Des bancs de brume dérivent sur la table : on n’y voit que ses voisins proches.'],
  ['snowflake', 'Blizzard', 'Neige et vent : toutes les quinze secondes, une bourrasque blanchit la table. Plus personne ne voit à plus de trois cases, le vent redouble et les pistes se comblent vite.'],
];
function manualPage(tab: ManualTab) {
  if (tab === 'commandes') return `<div class="keys">${KEYS.map(([h, rows]) => `<section><h3>${escapeHtml(h)}</h3><ul>${rows.map(([k, v]) => `<li><span>${k}</span><b>${escapeHtml(v)}</b></li>`).join('')}</ul></section>`).join('')}</div>
    <p class="tip">Les obus rebondissent une fois sur les murs : attention à tes propres ricochets !</p>`;
  if (tab === 'modes') return `<ul class="modes">${MODES.map(([i, n, p, d]) => `<li><i>${icon(i)}</i><div><b>${escapeHtml(n)}</b><small>${escapeHtml(p)} joueurs</small><span>${escapeHtml(d)}</span></div></li>`).join('')}</ul>
    <p class="tip">Crée une salle, choisis le mode dans le salon et partage le code : tes amis n’ont qu’à le taper.</p>`;
  if (tab === 'caisses') return `<ul class="crates">${CRATES.map(([k, line]) => `<li style="--c:${hex(BONUS_INFO[k].color)}"><i></i><div><b>${escapeHtml(BONUS_INFO[k].label)}</b><span>${escapeHtml(line)}</span></div></li>`).join('')}</ul>
    <p class="tip">Les caisses tombent du ciel pendant les missions : roule dessus pour les ouvrir. Le Pilleur, lui aussi, les convoite.</p>`;
  if (tab === 'terrain') return `<ul class="terrain">${TERRAIN.map(([chs, n, d, fresh]) => `<li class="${fresh ? 'new' : ''}">${[...chs].map((c) => `<img src="${cellImage(c)}" alt="">`).join('')}<div><b>${escapeHtml(n)}</b><span>${escapeHtml(d)}</span></div></li>`).join('')}</ul>
    <h3 class="weather-h">Le temps qu’il fait</h3>
    <ul class="terrain weather">${WEATHER.map(([i, n, d, fresh]) => `<li class="${fresh ? 'new' : ''}"><i class="wx">${icon(i)}</i><div><b>${escapeHtml(n)}</b><span>${escapeHtml(d)}</span></div></li>`).join('')}</ul>
    <p class="tip">Tous ces terrains t’attendent aussi dans l’atelier, pour dessiner tes propres missions, avec la météo de ton choix.</p>`;
  const n = BESTIARY.filter(([k]) => metOrDemo(k)).length;
  return `<p class="count">${n >= BESTIARY.length ? 'Collection complète' : 'Rencontrés'} : <b>${n} / ${BESTIARY.length}</b></p>
    <ul class="fiches">${BESTIARY.map(([k, line], i) => {
      const known = metOrDemo(k);
      return `<li data-k="${k}" class="${isBossKind(k) ? 'boss' : ''}${known ? '' : ' unmet'}" style="--c:${hex(enemyColor(k))}"><small class="num">N° ${String(i + 1).padStart(2, '0')}</small>${tankSvg(k, known)}
        <div><b>${known ? escapeHtml(specOf(k).label) : '???'}</b><span>${known ? escapeHtml(line) : 'Pas encore croisé : il t’attend plus loin.'}</span>${known ? enemySheet(k) : ''}</div></li>`;
    }).join('')}</ul>`;
}
function renderManual(tab = manualTab) {
  manualTab = tab;
  $('#manual-title').textContent = MANUAL_TITLES[tab];
  document.querySelectorAll<HTMLButtonElement>('#manual-tabs button').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  const page = $('#manual-page');
  page.innerHTML = manualPage(tab);
  page.scrollTop = 0;
  page.classList.remove('turn');
  void page.offsetWidth;
  page.classList.add('turn');
}
function openManual(tab: ManualTab = manualTab) {
  renderManual(tab);
  $('#manual').hidden = false;
  // with a gamepad, the frame jumps onto the open tab (the shelf behind no longer has the gamepad)
  if (document.body.classList.contains('pad-nav')) $<HTMLButtonElement>(`#manual-tabs button[data-tab="${tab}"]`).focus({ preventScroll: true });
}
function closeManual() {
  if ($('#manual').hidden) return false;
  $('#manual').hidden = true;
  if (screen === 'home') $<HTMLButtonElement>('#btn-manual').focus({ preventScroll: true });
  return true;
}
function turnManual(dir: number) {
  if ($('#manual').hidden) return;
  renderManual(MANUAL_TABS[(MANUAL_TABS.indexOf(manualTab) + dir + MANUAL_TABS.length) % MANUAL_TABS.length]);
  if ((document.activeElement as HTMLElement | null)?.closest('#manual-tabs')) $<HTMLButtonElement>(`#manual-tabs button[data-tab="${manualTab}"]`).focus({ preventScroll: true });
  sfx.page();
}
$('#btn-manual').addEventListener('click', () => openManual());
document.querySelectorAll<HTMLButtonElement>('#manual-tabs button').forEach((b) => b.addEventListener('click', () => { sfx.page(); renderManual(b.dataset.tab as ManualTab); }));
$('#btn-manual-close').addEventListener('click', () => closeManual());
$('#manual').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeManual(); }); // a tap beside the binder closes it
addEventListener('keydown', (e) => {
  if ($('#manual').hidden) return;
  if (e.code === 'Escape') { closeManual(); e.stopImmediatePropagation(); }
  else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') { turnManual(e.code === 'ArrowRight' ? 1 : -1); e.preventDefault(); }
}, { capture: true });
// ------------------------------------------------------------------ « Les options » (iteration 43)
// A real settings board: the profile moves here from the home screen, with the volumes, the quality of the picture, the shake and the replays.
const readPref = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writePref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };
let quality: 'auto' | 'eco' = readPref('tanks.quality') === 'eco' ? 'eco' : 'auto';
let shakeOn = readPref('tanks.shake') !== '0';
renderer.setQuality(quality);
renderer.shakeScale = shakeOn ? 1 : 0;
const pickSeg = (id: string, v: string) => document.querySelectorAll<HTMLButtonElement>(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
function renderOptions() {
  for (const k of ['music', 'sfx'] as const) {
    const v = Math.round(volumes()[k] * 100);
    $<HTMLInputElement>(`#opt-${k}`).value = String(v);
    $(`#opt-${k}-v`).textContent = `${v} %`;
  }
  pickSeg('opt-quality', quality);
  pickSeg('opt-shake', shakeOn ? '1' : '0');
  pickSeg('opt-reticle', reticleOn ? '1' : '0');
  pickSeg('opt-replay', replayOn ? '1' : '0');
  pickSeg('opt-camfx', renderer.camFx ? '1' : '0');
  pickSeg('opt-wheel', controls.wheelOn ? '1' : '0');
}
function openOptions() {
  renderOptions();
  $('#options').hidden = false;
  if (document.body.classList.contains('pad-nav')) $<HTMLInputElement>('#options .profile input').focus({ preventScroll: true });
}
function closeOptions() {
  if ($('#options').hidden) return false;
  $('#options').hidden = true;
  if (screen === 'home') $<HTMLButtonElement>('#btn-options').focus({ preventScroll: true });
  return true;
}
for (const k of ['music', 'sfx'] as const) {
  const input = $<HTMLInputElement>(`#opt-${k}`);
  input.addEventListener('input', () => {
    const v = Number(input.value) / 100;
    setVolume(k, v);
    if (k === 'music' && v > 0 && !isMusicOn()) updateMusicBtn(toggleMusic()); // raising the music switches it back on
    $(`#opt-${k}-v`).textContent = `${input.value} %`;
  });
  if (k === 'sfx') input.addEventListener('change', () => sfx.click()); // hear the new volume
}
$('#opt-quality').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.v;
  if (v !== 'auto' && v !== 'eco') return;
  quality = v;
  writePref('tanks.quality', v);
  renderer.setQuality(v);
  sfx.click();
  renderOptions();
});
$('#opt-shake').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.v;
  if (!v) return;
  shakeOn = v === '1';
  writePref('tanks.shake', v);
  renderer.shakeScale = shakeOn ? 1 : 0;
  sfx.toggle(shakeOn);
  renderOptions();
});
$('#opt-reticle').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.v;
  if (!v) return;
  reticleOn = v === '1';
  writePref('tanks.reticle', v);
  if (!reticleOn) reticle.hide();
  sfx.toggle(reticleOn);
  renderOptions();
});
$('#opt-replay').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.v;
  if (!v) return;
  setReplayOn(v === '1');
  sfx.toggle(v === '1');
  renderOptions();
});
// « Les finitions » (iteration 46): the camera that flies between the screens, and the wheel of the right button
renderer.camFx = readPref('tanks.camfx') === '1' || (readPref('tanks.camfx') === null && !matchMedia?.('(prefers-reduced-motion: reduce)').matches); // follows the system's « reduce motion » until chosen
controls.wheelOn = readPref('tanks.wheel') !== '0';
$('#opt-camfx').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.v;
  if (!v) return;
  renderer.camFx = v === '1';
  writePref('tanks.camfx', v);
  sfx.toggle(v === '1');
  renderOptions();
});
$('#opt-wheel').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.v;
  if (!v) return;
  controls.wheelOn = v === '1';
  writePref('tanks.wheel', v);
  sfx.toggle(v === '1');
  renderOptions();
});
// the panels slide out of the box and back in with a rustle of paper (whoever opens them)
for (const id of ['manual', 'options', 'journal', 'menu', 'feedback']) {
  const el = document.getElementById(id);
  if (!el) continue;
  let was = el.hidden;
  new MutationObserver(() => {
    if (el.hidden === was) return;
    was = el.hidden;
    if (el.hidden) sfx.paperOut(); else sfx.paperIn();
  }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
}
$('#btn-options').addEventListener('click', openOptions);
$('#btn-options-close').addEventListener('click', () => closeOptions());
$('#btn-options-ok').addEventListener('click', () => { sfx.clac(); closeOptions(); });
$('#options').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOptions(); });
// « Le nouvel accueil » (iteration 43): the planks knock softly under the pointer
{
  let lastToc = 0;
  document.querySelectorAll<HTMLElement>('.planks .plank').forEach((b) => b.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' || performance.now() - lastToc < 70) return;
    lastToc = performance.now();
    sfx.toc();
  }));
}

// the scenes of the videos on the home screen (iteration 39): a new scene cancels the timers of the one before,
// so a late « back to the table » of the previous scene never hides the next one on a slow machine
let sceneTimers: ReturnType<typeof setTimeout>[] = [];
let sceneRoll = () => {};
const later = (f: () => void, ms: number) => { sceneTimers.push(setTimeout(f, ms)); };
function clearScene() {
  sceneTimers.forEach(clearTimeout);
  sceneTimers = [];
  closeWheel(false);
  sceneRoll();
  $('#manual').hidden = true;
  $('#options').hidden = true;
  document.body.classList.remove('pad-nav', 'caption-side');
}
// « Les menus à la manette » (iteration 39): which panel the gamepad drives, and what B does there
const navStep = padNav({
  root() {
    if (!$('#feedback').hidden) return $('#feedback');
    if (!$('#options').hidden) return $('#options');
    if (!$('#manual').hidden) return $('#manual');
    if (!$('#journal').hidden) return $('#journal');
    if (treeOpen || reel) return null; // the skill tree and the replay have their own buttons
    if (screen === 'game') return $('#menu').hidden ? null : $('#menu');
    return $(`#${screen}`);
  },
  back() {
    if (!$('#feedback').hidden) { $<HTMLButtonElement>('#fb-cancel').click(); return true; }
    if (closeOptions()) return true;
    if (closeManual()) return true;
    if (!$('#journal').hidden) { $('#journal').hidden = true; return true; }
    if (screen === 'game' && !$('#menu').hidden) { toggleMenu(false); return true; }
    return false;
  },
  tab(dir) {
    if (!$('#manual').hidden) turnManual(dir);
  },
  start() {
    if (screen === 'game' && !reel && !treeOpen) toggleMenu(true);
  },
});
function renderBestiary() {
  const n = BESTIARY.filter(([k]) => metOrDemo(k)).length;
  $('#bestiary-count').textContent = `${n} / ${BESTIARY.length}`;
  if (!$('#manual').hidden && manualTab === 'bestiaire') renderManual('bestiaire');
}
renderBestiary();
$('#iteration-stamp').textContent = `Itération ${META.iteration}`;
$('#iteration-stamp').title = `${META.title} : ouvrir le carnet de bord`;
$('#iteration-stamp').addEventListener('click', () => $<HTMLButtonElement>('#btn-journal').click());
$('#btn-journal').addEventListener('click', () => { renderJournal(); $('#journal').hidden = false; });
$('#btn-journal-close').addEventListener('click', () => ($('#journal').hidden = true));
// Échap closes the journal too (iteration 39)
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !$('#journal').hidden) { $('#journal').hidden = true; e.stopImmediatePropagation(); }
}, { capture: true });

// ------------------------------------------------------------------ feedback

const TILE_NAMES = ['vide', 'mur', 'mur haut', 'liège', 'trou', 'portail bleu', 'portail rose', 'tunnel'];
function tankLabel(id: number) {
  const info = infos.get(id) ?? attract?.tanks.find((t) => t.id === id);
  if (!info) return { id };
  const kind = info.kind;
  return { id, kind, label: kind === 'player' ? (info.name ?? 'joueur') : specOf(kind).label, team: info.team, me: id === myTankId || undefined };
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
      tanks: lastTanks.filter((t) => inside(t.x, t.y)).map((t) => ({ ...tankLabel(t.id), x: r2(t.x), y: r2(t.y), alive: t.alive, invisible: t.invisible || undefined, mirage: t.decoy ? true : undefined })),
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
        scores: online && needsTwo(currentMode) ? scores : undefined,
        teams: online && currentMode === 'drapeau' ? teamScores : undefined,
        players: lobbyPlayers.map((p) => ({ name: p.name, host: p.host, connected: p.connected, me: p.id === pid || undefined })),
        me: me ? { x: r2(me.x), y: r2(me.y), alive: me.alive, pendingInputs: pending.length } : undefined,
        tanks: lastTanks.map((t) => ({ ...tankLabel(t.id), x: r2(t.x), y: r2(t.y), alive: t.alive, mirage: t.decoy ? true : undefined })),
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
/** How far the other tanks went over the buffered snapshots (about a second): the smoke test checks that the rivals drive. */
function debugMoved() {
  const a = snaps[0], b = snaps[snaps.length - 1];
  if (!a || !b) return 0;
  let best = 0;
  for (const [id, t] of b.T) {
    const o = a.T.get(id);
    if (o && id !== myTankId) best = Math.max(best, Math.hypot(t[1] - o[1], t[2] - o[2]));
  }
  return r2(best);
}
(window as unknown as { __debug: unknown }).__debug = {
  get state() {
    return { screen, phase, online, replays, replaying: !!reel, snaps: snaps.length, latestK, myTankId, room: roomCode, iteration: META.iteration, attract: attractState, mole: myRole, lives, mission: currentMission, council, belts: belts.filter(Boolean).length, ice: belts.filter((b) => b === ICE).length, slide: Math.hypot(pred.vx, pred.vy), pred: { x: pred.x + offset.x, y: pred.y + offset.y }, tanks: infos.size, moved: debugMoved(), galons: prog[pid], tree: treeOpen, rallies, bubbles: bubblesShown, emoteBtn: !$('#hud-emote').hidden, rallyBtn: !$('#hud-rally').hidden, reticle: reticleFrame || $('#reticle').classList.contains('on') ? { out: shellsOut(), max: mySpec.maxBullets, pips: document.querySelectorAll('#reticle .shells rect.full').length, mines: document.querySelectorAll('#reticle .mines circle.full').length } : undefined, ctf: currentMode === 'drapeau' ? { bases: !!ctfBases, team: myTeam, flags: snaps[snaps.length - 1]?.F.length ?? 0, teams: teamScores, board: $('#scoreboard').children.length } : undefined, crown: currentMode === 'couronne' || attractCrown ? { home: !!crownHome || !!attract?.crown, holder: attract?.crown ? attract.crown.holder : crownHolder, state: attract?.crown ? attract.crown.state : snaps[snaps.length - 1]?.C?.[3], held: Object.fromEntries(attract?.crown ? [...attract.crown.held].map(([k, v]) => [k, Math.floor(v * 10)]) : crownHeld), board: $('#scoreboard').children.length } : undefined, hunt: currentMode === 'caisses' || attractHunt ? { got: Object.fromEntries(attractHunt && attract?.hunt ? attract.hunt.got : huntGot), board: $('#scoreboard').children.length, gold: (attract?.bonuses ?? []).some((c) => c.gold) || (snaps[snaps.length - 1]?.P ?? []).some((c) => c[5] === 1) } : undefined, ball: currentMode === 'ballon' || attractBall ? { on: ballOn || !!attract?.ball, team: myTeam, teams: attractBall ? attractBall.teams : teamScores, pos: attract?.ball ? [attract.ball.x, attract.ball.y] : snaps[snaps.length - 1]?.O?.slice(0, 2), board: $('#scoreboard').children.length } : undefined, petard: currentMode === 'petard' || (attract && attractVs?.petard) ? { on: renderer.petardOn, holder: attract?.petard ? attract.petard.holder : petardHolder, fuse: attract?.petard ? attract.petard.fuse : petardFuse / 10, passes: Object.fromEntries(attract?.petard ? attract.petard.passes : petardPasses), bangs: attract?.petard?.bangs, board: $('#scoreboard').children.length, hud: $('#hud-enemies').innerText } : undefined, rush: currentMode === 'rush' && rushState ? { stage: rushState.stage, bosses: rushState.bosses, clock: !$('#hud-clock').hidden, bar: !$('#boss-bar').hidden } : undefined };
  },
};
if (params.has('demo')) {
  document.body.classList.add('demo');
  const demo = {
    meta: META,
    /** `night`: force the mission into the dark (true) or daylight (false); its own setting when omitted. Same for `storm`. */
    play(mission: number, heroes = true, rich = false, bossHp?: number, night?: boolean, arms?: Weapon[], storm?: boolean, ranks?: number[]) {
      attract = undefined;
      startAttract({ mission, heroes, rich, bossHp, night, arms: arms?.filter(isWeapon), storm, ranks: ranks ? cleanRanks(ranks) : undefined });
    },
    /**
     * The skill tree of the campaign (iteration 19), as it opens between two missions: a made-up player with galons
     * to spend buys `buys` (branch indices) one by one, then the card closes after `ms`.
     */
    skills(ms = 8000, start: number[] = [1, 0, 0], galons = 7, buys: number[] = [2, 0, 1, 2]) {
      treeDemo = { xp: 5 * galons - 2 + 3, g: galons, r: cleanRanks(start) };
      treeEnd = performance.now() + ms;
      openTree(true);
      const step = (ms * 0.7) / Math.max(1, buys.length);
      buys.forEach((b, k) => setTimeout(() => buySkill(b), step * (k + 0.8)));
      setTimeout(() => { closeTree(); treeDemo = undefined; }, ms);
      return BRANCHES.map((b) => b.label);
    },
    /**
     * Versus with AI rivals (iteration 17): four rivals on the arena of that round, one team each.
     * `levels`: their level (0 Novice, 1 Malin, 2 Redoutable), `chain`: the next rounds follow, with the scores.
     */
    versus(round = 0, levels?: number[], arms?: Weapon[], chain = true) {
      show('game');
      attract = undefined;
      startAttract({ versus: { round, levels, chain }, arms: arms?.filter(isWeapon) });
      return attractVs?.names;
    },
    /**
     * « Drapeaux » (iteration 24): two AI rivals against two on the flag arena of that round. `levels`: their level
     * (0 Novice, 1 Malin, 2 Redoutable), `chain`: the next rounds follow, with the team scores.
     */
    /**
     * « Le ballon » (iteration 55): two AI rivals against two on the pitch of that round. `seconds`: how long the round
     * lasts at most (shorter for the videos), `chain`: the next rounds follow, with the score.
     */
    ballon(round = 0, levels?: number[], arms?: Weapon[], seconds?: number, chain = false) {
      show('game');
      attract = undefined;
      startAttract({ ballon: { round, levels, chain, seconds }, arms: arms?.filter(isWeapon) });
      return ballArena(round).name;
    },
    /**
     * « Le ballon »: a Bleu lines up a shot, the ball between it and the goal on the right, and fires (for the videos).
     * Returns the striker's tank id (0: no match on the table).
     */
    goalShot() {
      const g = attract;
      const b = g?.ball;
      if (!g || !b || b.scored) return 0;
      const t = g.tanks.find((o) => o.alive && o.kind === 'player' && o.team === 1);
      if (!t) return 0;
      const [gx, gy] = goalOf(1);
      const busy = g.tanks.filter((o) => o !== t && o.alive).map((o): [number, number] => [o.x, o.y]);
      const [bx, by] = nearestFree(g.tiles, Math.floor(gx - 6), Math.floor(gy), busy);
      b.x = bx; b.y = by; b.vx = b.vy = 0;
      [t.x, t.y] = nearestFree(g.tiles, Math.floor(bx - 2.6), Math.floor(by), busy);
      t.vx = t.vy = 0;
      t.body = t.turret = Math.atan2(by - t.y, bx - t.x);
      t.fireCd = 0;
      if (t.ai) { t.ai.kick = t.turret; t.ai.hesitate = 0; }
      g.tryFire(t);
      return t.id;
    },
    drapeau(round = 0, levels?: number[], arms?: Weapon[], chain = true, carry = false) {
      show('game');
      attract = undefined;
      startAttract({ drapeau: { round, levels, chain, carry }, arms: arms?.filter(isWeapon) });
      return ctfArena(round).name;
    },
    /**
     * « La chasse aux caisses » (iteration 37): four AI rivals racing for the crates on the arena of that round.
     * `seconds`: how long the round lasts (shorter for the videos; the golden crate still drops near the end),
     * `chain`: the next rounds follow, with the scores.
     */
    caisses(round = 0, levels?: number[], arms?: Weapon[], seconds?: number, chain = false) {
      show('game');
      attract = undefined;
      startAttract({ caisses: { round, levels, chain, seconds }, arms: arms?.filter(isWeapon) });
      return huntArena(round).name;
    },
    /**
     * « La couronne » (iteration 50): four AI rivals fighting over the crown on the arena of that round. `seconds`: how
     * long the round lasts at most (shorter for the videos), `head`: seconds of reign every rival starts with,
     * `chain`: the next rounds follow, with the scores.
     */
    couronne(round = 0, levels?: number[], arms?: Weapon[], seconds?: number, chain = false, head = 0) {
      show('game');
      attract = undefined;
      startAttract({ couronne: { round, levels, chain, seconds, head }, arms: arms?.filter(isWeapon) });
      return attractCrown?.names;
    },
    /** « La couronne »: the crown goes straight onto the head of the rival nearest to it (for the videos). */
    crown() {
      const g = attract;
      if (!g?.crown || g.crown.state === 1) return 0;
      const t = g.tanks.filter((o) => o.alive && o.kind === 'player').sort((a, b) => Math.hypot(a.x - g.crown!.x, a.y - g.crown!.y) - Math.hypot(b.x - g.crown!.x, b.y - g.crown!.y))[0];
      if (!t) return 0;
      g.crown.x = t.x; g.crown.y = t.y; g.crown.cool = 0;
      return t.id;
    },
    /**
     * « Suis-moi ! » (iteration 20): the first hero of the demo calls the others, who drop everything and come along
     * (they become AI teammates for the occasion). Returns how many answered.
     */
    /**
     * « Les bulles » (iteration 30): a tank of the demo says line n (or each AI tank in turn says a line, n omitted).
     * Returns how many bubbles went up.
     */
    emote(n?: number) {
      const g = attract;
      if (!g) return 0;
      const talkers = g.tanks.filter((t) => t.kind === 'player' && t.alive);
      let k = 0;
      talkers.forEach((t, i) => {
        if (n !== undefined && i > 0) return;
        if (g.emote(t, n ?? [0, 3, 5, 1][i % 4], 0)) k++;
      });
      return k;
    },
    rally() {
      const g = attract;
      if (!g) return 0;
      const heroes = g.tanks.filter((t) => t.kind === 'player' && t.alive && t.team === 1);
      if (heroes.length < 2) return 0;
      for (const t of heroes.slice(1)) {
        t.pid ??= `ia:h${t.id}`;
        const info = infos.get(t.id);
        if (info) info.pid = t.pid;
      }
      return g.rally(heroes[0]);
    },
    /**
     * « Le pétard » (iteration 61): four AI rivals handing a lit firecracker round on the arena of that round. `fuse`:
     * seconds of the first fuse (a short one for the videos). Returns the rivals' names.
     */
    petard(round = 0, levels?: number[], arms?: Weapon[], fuse = 0, chain = false) {
      show('game');
      attract = undefined;
      startAttract({ versus: { round, levels, chain, petard: true, fuse }, arms: arms?.filter(isWeapon) });
      return attractVs?.names;
    },
    /** « Le pétard »: the carrier hands it over at once to the tank nearest to it, by a ricochet if `bank` (for the videos). Returns 1 when done. */
    pass(bank = true) {
      const g = attract;
      const p = g?.petard;
      if (!g || !p || !p.holder) return 0;
      const from = g.tankById(p.holder)!;
      const to = g.tanks.filter((o) => o.alive && o.kind === 'player' && o !== from).sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
      if (!to) return 0;
      p.holder = to.id; p.last = from.id; p.cool = 0.9;
      p.passes.set(from.id, (p.passes.get(from.id) ?? 0) + 1);
      g.events.push(['petard', to.x, to.y, to.id, bank ? 4 : 1, from.id]);
      return 1;
    },
    /** Show a versus lobby (or, iteration 20, a coop one) with a player and AI tanks for a moment, the host adding them one by one (for the videos). */
    rivals(ms = 6000, mode: Mode = 'versus') {
      const keep = { players: lobbyPlayers, mode: lobbyMode, room: roomCode, phase };
      const me: PlayerInfo = { id: pid, name: myName, color: PLAYER_COLORS[0], host: true, connected: true, score: 0, weapon: myWeapon };
      const bots: PlayerInfo[] = [0, 1, 2].map((i) => ({ id: `ia:${i + 1}`, name: RIVAL_NAMES[i * 3], color: PLAYER_COLORS[i + 1], host: false, connected: true, score: 0, weapon: VS_ARMS[i], bot: i }));
      lobbyPlayers = [me];
      lobbyMode = mode === 'coop' || mode === 'drapeau' || mode === 'caisses' || mode === 'couronne' || mode === 'ballon' || mode === 'petard' ? mode : 'versus';
      roomCode = 'SOLO7';
      phase = 'lobby';
      renderLobby();
      show('lobby');
      const step = Math.max(600, ms / 5);
      bots.forEach((b, i) => setTimeout(() => { lobbyPlayers = [...lobbyPlayers, b]; renderLobby(); sfx.click(); }, step * (i + 0.6)));
      setTimeout(() => {
        lobbyPlayers = keep.players; lobbyMode = keep.mode; roomCode = keep.room; phase = keep.phase;
        show('game');
        if (attractOpts.versus) renderVsBoard(); else if (attractOpts.ballon) { ballBoardKey = ''; renderBallBoard(attract); } else if (attractOpts.drapeau) renderCtfBoard(); else if (attractOpts.caisses) renderAttractHunt(); else if (attractOpts.couronne) renderAttractCrown(); else $('#hud').hidden = true;
      }, ms);
    },
    /** « Le réticule » (iteration 44): the coop HUD and the reticle over the demo mission (the first hero is « me »). */
    hud(on = true) {
      demoHud = on;
      demoAim.set = false;
      if (!on && !document.body.classList.contains('vs-demo')) $('#hud').hidden = true;
      return demoHud;
    },
    /** « Le bilan » (iteration 45): the next demo missions open on their briefing and close on their sheet. */
    bilan(on = true) {
      demoBilan = on;
      return on;
    },
    /** A dry shot for the videos: the trigger clicks on an empty barrel. */
    dry() { dryFire(); },
    /**
     * « La roue des bulles » (iteration 46): the first hero of the demo holds the right button: the wheel opens beside
     * its tank, the pointer goes round the lines, then lands on line n (« Bravo ! » by default) and the bubble goes up.
     * Returns whether the wheel opened.
     */
    wheel(ms = 2600, n = 0) {
      const g = attract;
      const hero = g?.tanks.find((t) => t.kind === 'player' && t.alive);
      if (!g || !hero) return false;
      const p = renderer.arenaToScreen(hero.x, hero.y, 0.5);
      openWheel(p.x, p.y);
      const path = [3, 4, 5, 0, 1, 2, 3, 4, 5].slice(0, 6).concat([n]);
      const step = Math.max(120, (ms - 500) / path.length);
      path.forEach((k, i) => later(() => {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / EMOTES.length;
        wheelSelect(wheelPick(wheel.x + Math.cos(a) * 60, wheel.y + Math.sin(a) * 60));
      }, 250 + i * step));
      later(() => { closeWheel(true); if (attract === g) g.emote(hero, n, 0); }, 250 + path.length * step + 350);
      return true;
    },
    /** Storm: announce a lightning strike right next to the first enemy still standing (or any tank). */
    bolt() {
      const g = attract;
      if (!g) return false;
      const t = g.tanks.find((o) => o.alive && o.kind !== 'player') ?? g.tanks.find((o) => o.alive);
      return !!g.spawnBolt(t ? { x: t.x + 0.6, y: t.y } : undefined);
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
      if (twist) for (let k = 0; k < DAILY_TWISTS.length && dailyTwist(day) !== twist; k++) day++;
      attract = undefined;
      startAttract({ heroes: true, daily: { day, stage } });
      const lvl = dailyLevel(day, stage);
      banner(`Défi du jour · étape ${stage}/${DAILY_STAGES}`, lvl.name, TWIST_INFO[dailyTwist(day)].label, `intro daily${lvl.night ? ' night' : ''}`);
      setTimeout(hideBanner, 2600);
      return day;
    },
    /**
     * « La ronde des boss » (iteration 28): play a stage of this week's run (or of `week`) with the heroes,
     * with its banner and the HUD clock. Stage 5 is the finale, two bosses at once.
     */
    rush(stage = 1, arms?: Weapon[], week = weekNumber(dayNumber()), bossHp?: number) {
      attract = undefined;
      startAttract({ heroes: true, rush: { week, stage }, arms: arms?.filter(isWeapon), bossHp });
      const lvl = rushLevel(week, stage);
      const finale = stage >= RUSH_STAGES;
      banner(finale ? 'Ronde des boss · le bouquet final' : `Ronde des boss · boss ${stage}/${RUSH_STAGES}`, lvl.name,
        finale ? 'Deux boss à la fois : sépare-les, et garde un œil sur chacun !' : `Puis ${stage + 1 >= RUSH_STAGES ? 'le bouquet final' : `boss ${stage + 1}`} : le chrono tourne`, `intro boss rush${lvl.night ? ' night' : ''}`);
      setTimeout(hideBanner, 2600);
      return lvl.name;
    },
    /** « La ronde des boss »: made-up results over the demo (the time of each boss and the weekly board), for the videos. */
    rushResults(ms = 5000, week = weekNumber(dayNumber())) {
      const splits = [1712, 2380, 1954, 2655, 4120];
      const ticks = splits.reduce((n, v) => n + v, 0);
      const team = (k: number) => [0, 1].map((i) => ({ name: FUN_NAMES[(k * 3 + i * 5) % FUN_NAMES.length] + (11 + k * 17 + i * 23), color: PLAYER_COLORS[(k + i * 2) % PLAYER_COLORS.length] }));
      const entries = [ticks - 1460, ticks, ticks + 905, ticks + 2210].map((t, k) => ({ team: k === 1 ? [{ name: myName, color: myColor }, team(9)[1]] : team(k), cleared: RUSH_STAGES, ticks: t, lives: 1 + (k % 2) }));
      showResults({
        mode: 'rush', mission: RUSH_STAGES,
        players: [{ id: pid, name: myName, color: myColor, kills: { thunder: 1, boss: 1, sower: 1, violet: 2, pink: 1 }, deaths: 1, score: 6, ff: 0 },
          { id: 'demo2', name: team(9)[1].name, color: team(9)[1].color, kills: { drill: 2, sower: 1, green: 2, black: 1 }, deaths: 1, score: 6, ff: 0 }],
        rush: { state: { week, stage: RUSH_STAGES, stages: RUSH_STAGES, ticks, splits, bosses: rushDuo(week) }, cleared: RUSH_STAGES, board: { day: week, twist: dailyTwist(0), entries, total: 23, rank: 2 } },
      });
      setTimeout(() => { show('game'); $('#hud').hidden = true; }, ms);
    },
    /** Mole mode: play a stage of a mole game (heroes driven by the AI, arsenal optional). */
    taupe(stage = 1, seed = 8, arms?: Weapon[]) {
      attract = undefined;
      startAttract({ heroes: true, taupe: { seed, stage }, arms: arms?.filter(isWeapon) });
      return taupeLevel(seed, stage).name;
    },
    /** Mole mode: the secret role card (as the mole, or as a loyal player). */
    role(mole = true, ms = 3500) {
      showRoleBanner(mole);
      setTimeout(hideBanner, ms);
    },
    /**
     * Mole mode: a made-up council over the demo. The ballots come in one by one, then the verdict:
     * `accused` (index of the player put aside, -1 for nobody), `wasMole` whether they were the mole.
     */
    council(ms = 9000, accused = 2, wasMole = true, why: 'cleared' | 'failed' = 'failed') {
      const names = ['Chenille42', 'Obus27', 'Mortier61', 'Tourelle88'];
      const players: PlayerInfo[] = names.map((name, i) => ({ id: `demo${i}`, name, color: PLAYER_COLORS[i], host: !i, connected: true, score: 0 }));
      const voters = players.map((p) => p.id);
      // ballots: everyone points at the accused (who points elsewhere), or a split vote
      const target = (i: number) => accused < 0 ? voters[(i + 1) % 4] : i === accused ? voters[(i + 1) % 4] : voters[accused];
      const c: CouncilState = { why, left: COUNCIL_SECONDS, voters, voted: [] };
      const me = 'demo0';
      hideBanner();
      renderCouncil(c, players, me, undefined);
      const voteAt = (ms * 0.62) / 4;
      const order = [3, 1, 0, 2];
      order.forEach((i, k) => setTimeout(() => {
        c.voted = [...c.voted, voters[i]];
        c.left = COUNCIL_SECONDS * (1 - (k + 1) / 5);
        renderCouncil(c, players, me, i === 0 ? target(0) : undefined);
        sfx.click();
      }, voteAt * (k + 1)));
      setTimeout(() => {
        c.done = true;
        c.left = VERDICT_SECONDS * 0.7;
        c.votes = Object.fromEntries(voters.map((v, i) => [v, target(i)]));
        c.accused = accused >= 0 ? voters[accused] : undefined;
        c.wasMole = c.accused !== undefined && wasMole;
        renderCouncil(c, players, me, undefined);
        councilVerdictSfx(c);
      }, ms * 0.7);
      setTimeout(() => ($('#council').hidden = true), ms);
    },
    /** The workshop: paint the showcase mission cell by cell in the editor, for `ms`, then leave it on screen. */
    atelier(ms = 9000, a: AtelierMap = ATELIER_SAMPLE) {
      clearScene(); // a manual still open from the shot before (iteration 48) would hide the workshop when it closes
      attract = undefined; // the table behind stays still: all the machine's time goes to the painting
      openWorkshop();
      workshop.animate(a, ms);
      return a.name;
    },
    /** The showcase mission of the workshop. */
    atelierSample: () => ({ ...ATELIER_SAMPLE, map: ATELIER_SAMPLE.map.slice() }),
    /** A handmade mission as a workshop map (iteration 48: the montage paints « L’usine à bascule » in the workshop). */
    missionAtelier(n: number): AtelierMap | undefined {
      const def = n >= 1 && n <= LEVELS.length ? LEVELS[n - 1] : EXTRA_LEVELS[n];
      return def ? { name: def.name, map: def.map.slice(), night: def.night || undefined } : undefined;
    },
    /** Play a workshop mission (the showcase one by default) with the heroes. */
    playAtelier(a: AtelierMap = ATELIER_SAMPLE, arms?: Weapon[]) {
      show('game');
      $('#hud').hidden = true;
      attract = undefined;
      startAttract({ heroes: true, atelier: a, arms: arms?.filter(isWeapon) });
      const wx = `${a.night ? ' · Nuit' : ''}${a.storm ? ' · Orage' : ''}${a.wind ? ' · Vent' : ''}${a.fog ? ' · Brouillard' : ''}`;
      banner(`Atelier · mission maison${wx}`, a.name, `Tanks ennemis : ${atelierLevel(a).enemies.length}`, `intro atelier${a.night ? ' night' : ''}${a.storm ? ' storm' : ''}${a.wind ? ' wind' : ''}${a.fog ? ' fog' : ''}`);
      setTimeout(hideBanner, 2600);
      return a.name;
    },
    /** « Nouveau au bestiaire ! » (iteration 38): pin the cards of these enemies on the side of the table. */
    newcomer(kinds: TankKind[] = ['white']) {
      newcomerCards(kinds, 0);
    },
    /** « Le manuel » (iteration 39): the home screen, then the manual opened on `tabs` one after the other (the bestiary page scrolls slowly). */
    manual(ms = 8000, tabs: ManualTab[] = ['bestiaire'], focusKind = 'spectre') {
      clearScene();
      show('home');
      const lead = Math.min(1500, ms / 4), each = (ms - lead - 400) / tabs.length;
      let roll: ReturnType<typeof setInterval> | undefined;
      tabs.forEach((t, i) => later(() => {
        clearInterval(roll);
        openManual(t);
        const page = $('#manual-page');
        // the bestiary jumps to the newest card (« Le Tortillard », iteration 49), the terrain page rolls down to the weather
        if (t === 'bestiaire') later(() => page.querySelector(`[data-k="${focusKind}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 900);
        else if (t === 'modes') later(() => [...page.querySelectorAll('.modes li')].find((li) => /pétard/.test(li.textContent ?? ''))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 900); // « Le pétard » (iteration 61)
        else if (t === 'terrain') {
          // the newest cell (« Les ponts-levis », iteration 48) comes into view; without one, the page rolls down to the weather
          const fresh = page.querySelector('li.new');
          if (fresh) later(() => fresh.scrollIntoView({ block: 'center', behavior: 'smooth' }), 900);
          else later(() => (roll = setInterval(() => (page.scrollTop += 2), 24)), 1200);
        }
      }, lead + i * each));
      sceneRoll = () => clearInterval(roll);
      later(() => { clearInterval(roll); $('#manual').hidden = true; show('game'); $('#hud').hidden = true; }, ms - 200);
    },
    /** « Les menus à la manette » (iteration 39): the golden frame hops along the home screen as with a gamepad, opens the bestiary and turns the pages back. */
    padTour(ms = 9000) {
      clearScene();
      show('home');
      document.body.classList.add('pad-nav', 'caption-side'); // the caption moves aside: the shelf of the home screen stays in sight
      const steps: (() => void)[] = [
        () => $('#btn-play').focus(),
        () => $('#btn-create').focus(),
        () => $('#btn-atelier').focus(),
        () => $('#btn-manual').focus(),
        () => { sfx.click(); openManual('bestiaire'); },
        () => turnManual(-1),
        () => turnManual(-1),
      ];
      const gap = (ms - 1200) / steps.length;
      steps.forEach((f, i) => later(f, 600 + i * gap));
      later(() => { $('#manual').hidden = true; document.body.classList.remove('pad-nav', 'caption-side'); (document.activeElement as HTMLElement | null)?.blur(); show('game'); $('#hud').hidden = true; }, ms - 200);
    },
    /** The bestiary of the manual for a moment (iteration 25, a page of the manual since iteration 39). */
    bestiary(ms = 5000) {
      this.manual(ms, ['bestiaire']);
    },
    /** The crates page of the manual for a moment (iteration 29). */
    crates(ms = 5000) {
      this.manual(ms, ['caisses']);
    },
    /** « Gel » (iteration 29): the first hero grabs the frost, every enemy freezes on camera. */
    freeze() {
      const h = attract?.tanks.find((t) => t.alive && t.kind === 'player');
      if (!attract || !h) return 0;
      attract.giveBonus(h, 'freeze');
      return attract.tanks.filter((t) => t.chill !== undefined).length;
    },
    /** Show the home screen (and its daily challenge card) over the demo for a moment. */
    home(ms = 4000) {
      show('home');
      setTimeout(() => { show('game'); $('#hud').hidden = true; }, ms);
    },
    /** « La boîte à jouets » (iteration 38): the home screen, then the journal opened on it, for a moment. */
    journal(ms = 6000) {
      show('home');
      setTimeout(() => { renderJournal(); $('#journal').hidden = false; }, Math.min(2500, ms / 2));
      setTimeout(() => { $('#journal').hidden = true; show('game'); $('#hud').hidden = true; }, ms);
    },
    /** « Le nouvel accueil » (iteration 43): the home screen, the pointer runs down the planks, then the options board opens. */
    options(ms = 8000) {
      clearScene();
      stopReel(); // the replay of the shot before must not run on behind the home screen
      show('home');
      document.body.classList.add('caption-side');
      const planks = ['#btn-play', '#btn-create', '#btn-atelier', '#btn-manual', '#btn-options'];
      planks.forEach((id, i) => later(() => { document.querySelectorAll('.plank.hover').forEach((e) => e.classList.remove('hover')); $(id).classList.add('hover'); sfx.toc(); }, 500 + i * 450));
      later(() => { document.querySelectorAll('.plank.hover').forEach((e) => e.classList.remove('hover')); openOptions(); }, 500 + planks.length * 450 + 200);
      later(() => { $('#options').hidden = true; document.body.classList.remove('caption-side'); show('game'); $('#hud').hidden = true; }, ms - 200);
    },
    /** Land a hit on the boss (to show its health bar and its anger on camera). */
    hitBoss() {
      for (const t of attract?.tanks ?? []) if (t.alive && t.boss) { t.buffs.invuln = 0; attract!.killTank(t, undefined); }
    },
    /** Blow the armour off the steel tanks still wearing it (to show it on camera). */
    armor() {
      let n = 0;
      for (const t of attract?.tanks ?? []) if (t.alive && t.kind === 'steel' && t.hp > 1) { t.buffs.invuln = 0; attract!.killTank(t, undefined); n++; }
      return n;
    },
    /**
     * The Aimant (iteration 27): its field comes on, every hero fires a shell just beside it (to show the shells
     * bending into the magnet), and the field drops a couple of seconds later, throwing them back on camera.
     */
    magnetShot() {
      const g = attract;
      if (!g) return 0;
      let n = 0;
      for (const m of g.tanks) {
        if (!m.alive || !m.mag) continue;
        if (!m.mag.on) m.mag.on = true;
        m.mag.t = 2.6;
        for (const h of g.tanks) {
          if (!h.alive || h.kind !== 'player' || Math.hypot(h.x - m.x, h.y - m.y) > 12) continue;
          const keep = h.turret;
          const d = Math.hypot(m.x - h.x, m.y - h.y);
          h.turret = Math.atan2(m.y - h.y, m.x - h.x) + Math.min(0.35, 1.3 / Math.max(1, d)) * (n % 2 ? 1 : -1);
          h.fireCd = 0;
          if (g.tryFire(h)) n++;
          h.turret = keep;
        }
      }
      return n;
    },
    /**
     * The Givré (iteration 31): a mine with a short fuse on the thickest patch of frost away from the heroes, to show
     * a blast melting it on camera. Returns the number of frost cells it sits on (0: no mine).
     */
    frostMine() {
      const g = attract;
      if (!g || !g.frost.size) return 0;
      const heroes = g.tanks.filter((t) => t.alive && t.kind === 'player');
      let best = -1, score = 0;
      for (const i of g.frost.keys()) {
        const x = (i % W) + 0.5, y = Math.floor(i / W) + 0.5;
        if (heroes.some((h) => Math.hypot(h.x - x, h.y - y) < 2.6)) continue;
        let n = 0;
        for (const j of g.frost.keys()) if (Math.hypot((j % W) + 0.5 - x, Math.floor(j / W) + 0.5 - y) < 1.6) n++;
        if (n > score) { score = n; best = i; }
      }
      if (best < 0 || !heroes.length) return 0;
      g.mines.push({ id: 900000 + g.tick, owner: heroes[0].id, team: heroes[0].team, x: (best % W) + 0.5, y: Math.floor(best / W) + 0.5, t: 0, fuse: 0.9, dead: false });
      return score;
    },
    /**
     * « Les ponts » (iteration 33): a mine with a short fuse at the end of the bridge nearest to an enemy (on it, if one
     * is crossing), away from the heroes: the bridge comes down on camera. Returns the distance to that enemy (0: no mine).
     */
    /** Watch the bridges for the next few seconds: the first enemy to cross one falls (see bridgeTrap). */
    bridgeTrap(seconds = 8) { if (attract) bridgeTrapUntil = attract.tick + Math.round(seconds / DT); return !!attract; },
    /**
     * « Les dunes » (iteration 36), and « La neige » (iteration 42): a hero's mine is buried in the sand (or the snow) just ahead of a moving enemy, on its way: it does
     * not see it and drives into the trap (its fall plays again in slow motion). Returns how far ahead it lies (0: none).
     */
    /**
     * « Les sables mouvants » (iteration 59): the moving enemy nearest to a whirl drives into it and stays there (the
     * hook keeps steering it back for a few seconds), until the sand swallows it. Returns its id (0: none).
     */
    quickLure(hold = 4.5) {
      const g = attract;
      if (!g) return 0;
      const cells = g.belts.flatMap((b, i) => (b === QUICK && g.tiles[i] === Tile.Empty ? [i] : []));
      const heroes = g.tanks.filter((t) => t.alive && t.kind === 'player');
      const foes = g.tanks.filter((t) => t.alive && t.ai && t.team !== heroes[0]?.team && g.sinks(t) && t.spec.speed > 0 && !t.watch && !t.rail);
      let best: { foe: (typeof foes)[number]; c: number; d: number } | undefined;
      for (const f of foes) for (const c of cells) {
        const d = Math.hypot(f.x - (c % W) - 0.5, f.y - Math.floor(c / W) - 0.5);
        if (!best || d < best.d) best = { foe: f, c, d };
      }
      if (!best) return 0;
      const { foe, c } = best;
      const until = performance.now() + hold * 1000;
      const iv = setInterval(() => {
        if (attract !== g || !foe.alive || performance.now() > until || !foe.ai) { clearInterval(iv); return; }
        foe.ai.path = [c]; foe.ai.pathT = 1; foe.ai.dodgeT = 0; foe.ai.goal = undefined;
      }, 15);
      reelWanted = foe.id;
      return foe.id;
    },
    /** « Les sables mouvants »: a hero's mine laid in the whirl nearest to the heroes (it is swallowed, harmlessly). */
    quickMine() {
      const g = attract;
      if (!g) return 0;
      const hero = g.tanks.find((t) => t.alive && t.kind === 'player');
      if (!hero) return 0;
      const cells = g.belts.flatMap((b, i) => (b === QUICK && g.tiles[i] === Tile.Empty ? [i] : []));
      cells.sort((a, b) => Math.hypot(hero.x - (a % W), hero.y - Math.floor(a / W)) - Math.hypot(hero.x - (b % W), hero.y - Math.floor(b / W)));
      const c = cells[0];
      if (c === undefined) return 0;
      g.mines.push({ id: 921000 + g.tick, owner: hero.id, team: hero.team, x: (c % W) + 0.35, y: Math.floor(c / W) + 0.6, t: 0.5, fuse: -1, dead: false });
      return 1;
    },
    sandTrap() {
      const g = attract;
      if (!g) return 0;
      const sandAt = (c: number) => c >= 0 && c < W * H && (g.belts[c] === SAND || g.belts[c] === SNOW || g.belts[c] === PACKED) && g.tiles[c] === Tile.Empty; // the snow buries mines too (iteration 42)
      const heroes = g.tanks.filter((t) => t.alive && t.kind === 'player');
      const foes = g.tanks.filter((t) => t.alive && t.team !== heroes[0]?.team && !isBossKind(t.kind) && t.spec.speed > 0);
      if (!heroes.length || !foes.length) return 0;
      let best: { x: number; y: number; d: number; foe: number } | undefined;
      for (const f of foes) {
        const cands = (f.ai?.path ?? []).slice(0, 4);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) cands.push((Math.floor(f.y) + dy) * W + Math.floor(f.x) + dx);
        for (const c of cands) {
          if (!sandAt(c)) continue;
          const x = (c % W) + 0.5, y = Math.floor(c / W) + 0.5, d = Math.hypot(f.x - x, f.y - y);
          if (d < 0.6 || d > 1.5 || heroes.some((h) => Math.hypot(h.x - x, h.y - y) < 2.6)) continue;
          if (g.mines.some((m) => Math.hypot(m.x - x, m.y - y) < 1)) continue;
          const onWay = (f.ai?.path ?? []).includes(c) ? -1 : 0; // on its planned way first
          if (!best || d + onWay < best.d) best = { x, y, d: d + onWay, foe: f.id };
        }
      }
      if (!best) return 0;
      g.mines.push({ id: 920000 + g.tick, owner: heroes[0].id, team: heroes[0].team, x: best.x, y: best.y, t: 0.3, fuse: -1, dead: false });
      reelWanted = best.foe;
      return Math.max(0.01, best.d + 1);
    },
    bridgeMine() {
      const g = attract;
      if (!g) return 0;
      const heroes = g.tanks.filter((t) => t.alive && t.kind === 'player');
      const foes = g.tanks.filter((t) => t.alive && t.team !== heroes[0]?.team && !isBossKind(t.kind));
      if (!heroes.length || !foes.length) return 0;
      let best: { x: number; y: number; d: number; foe: number } | undefined;
      for (let i = 0; i < W * H; i++) {
        if (g.tiles[i] !== Tile.Bridge) continue;
        const bx = (i % W) + 0.5, by = Math.floor(i / W) + 0.5;
        // the mine sits in the pit next to the bridge (beside it, along the ravine): the blast reaches the planks, not too far round
        const side = g.tiles[i - 1] === Tile.Hole || g.tiles[i + 1] === Tile.Hole ? [1, 0] : [0, 1];
        for (const k of [-1, 1]) {
          const mx = bx + side[0] * k * 1.2, my = by + side[1] * k * 1.2;
          if (heroes.some((h) => Math.hypot(h.x - mx, h.y - my) < 2.8)) continue;
          for (const f of foes) {
            const d = Math.hypot(f.x - bx, f.y - by);
            if (!best || d < best.d) best = { x: mx, y: my, d, foe: f.id };
          }
        }
      }
      if (!best) return 0;
      g.mines.push({ id: 910000 + g.tick, owner: heroes[0].id, team: heroes[0].team, x: best.x, y: best.y, t: 0, fuse: 0.7, dead: false });
      if (best.d < 0.6) reelWanted = best.foe; // it is on the bridge: its fall plays again in slow motion
      return Math.max(0.01, best.d);
    },
    /**
     * The Mortier (iteration 34): each Mortier on the table lobs a cannonball at once, a little ahead of the nearest hero
     * in its range (so the ring, the flight and the dodge show on camera). Returns the number of cannonballs.
     */
    lob() {
      const g = attract;
      if (!g) return 0;
      let n = 0;
      for (const m of g.tanks) {
        if (!m.alive || !m.mortar || m.mortar.warn > 0) continue;
        let best: Tank | undefined, bd = Infinity;
        for (const h of g.tanks) {
          if (!h.alive || h.kind !== 'player') continue;
          const d = Math.hypot(h.x - m.x, h.y - m.y);
          if (d >= MORTAR_MIN && d <= MORTAR_MAX && d < bd) { bd = d; best = h; }
        }
        if (!best) continue;
        m.mortar.x = Math.max(0.6, Math.min(W - 0.6, best.x + Math.cos(best.body) * 0.6));
        m.mortar.y = Math.max(0.6, Math.min(H - 0.6, best.y + Math.sin(best.body) * 0.6));
        m.mortar.warn = MORTAR_WARN;
        n++;
      }
      return n;
    },
    /**
     * « Le Veilleur » (iteration 47): every Veilleur still sweeping turns its beam just short of the nearest hero it could
     * light up (so the beam sweeps onto it, turns red and the alarm rings on camera). Returns how many.
     */
    /** « Le Tortillard » (iteration 49): the train stops whistling, then sets off the other way. */
    reverse() {
      for (const t of attract?.tanks ?? []) if (t.alive && t.rail && t.boss && t.boss.warn <= 0) { t.rail.next = 0; return 1; }
      return 0;
    },
    /** And a hero lays a mine on the track a little ahead of the locomotive: the train runs onto it. */
    trainMine() {
      const g = attract;
      const loco = g?.tanks.find((t) => t.alive && t.rail);
      const hero = g?.tanks.find((t) => t.alive && t.kind === 'player');
      if (!g || !loco?.rail || !hero) return 0;
      const ahead = Math.sign(loco.rail.v || loco.rail.dir) * (Math.abs(loco.rail.v) * 1.1 + 1.6);
      const [x, y] = g.railAt(loco.rail.s + ahead);
      g.mines.push({ id: 900000 + g.tick, owner: hero.id, team: hero.team, x, y, t: 1, fuse: -1, dead: false });
      g.events.push(['mineSet', x, y]);
      return 1;
    },
    watch() {
      const g = attract;
      if (!g) return 0;
      let n = 0;
      for (const w of g.tanks) {
        if (!w.alive || !w.watch || w.watch.foe || w.chill !== undefined) continue;
        let best: (typeof g.tanks)[number] | undefined, bd = Infinity;
        for (const o of g.tanks) {
          if (!o.alive || o.team === w.team) continue;
          const d = Math.hypot(o.x - w.x, o.y - w.y);
          if (d < bd && d < 8 && g.lineClear(w.x, w.y, o.x, o.y)) { bd = d; best = o; }
        }
        if (!best) continue;
        w.turret = Math.atan2(best.y - w.y, best.x - w.x) - w.watch.dir * 0.55;
        n++;
      }
      return n;
    },
    /**
     * « Le Mécano » (iteration 51): the nearest friend of every Mécano on the table is moved next to it and blown up,
     * and the Mécano is untouchable for a few seconds, so the drive there, the spanner and the ring that
     * fills up all show on camera. Returns how many.
     */
    wreck(safe = 6) {
      const g = attract;
      if (!g) return 0;
      let n = 0;
      for (const m of g.tanks) {
        if (!m.alive || m.kind !== 'mechanic') continue;
        let best: (typeof g.tanks)[number] | undefined, bd = Infinity;
        for (const o of g.tanks) {
          if (!o.alive || o === m || o.team !== m.team || o.boss || o.rail || o.car || o.patched) continue;
          const d = Math.hypot(o.x - m.x, o.y - m.y);
          if (d < bd) { bd = d; best = o; }
        }
        if (!best) continue;
        // for the camera: the friend is moved right next to the Mécano first (the work starts at once)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const cx = Math.floor(m.x) + dx, cy = Math.floor(m.y) + dy;
          if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1 || isSolidTankTile(g.tiles[cy * W + cx])) continue;
          if (g.tanks.some((o) => o.alive && o !== best && Math.hypot(o.x - cx - 0.5, o.y - cy - 0.5) < 0.8)) continue;
          best.x = cx + 0.5; best.y = cy + 0.5;
          break;
        }
        best.buffs.invuln = 0;
        best.buffs.shield = false;
        best.hp = 1;
        g.killTank(best, undefined);
        if (best.alive) continue;
        m.buffs.invuln = Math.max(m.buffs.invuln, safe);
        if (m.fix) m.fix.look = 0;
        n++;
      }
      return n;
    },
    /** « Le Mécano » (iteration 51): where each Mécano of the table is and how its work goes (for the tools). */
    repairs() {
      return (attract?.tanks ?? []).filter((m) => m.kind === 'mechanic').map((m) => ({ alive: m.alive, x: +m.x.toFixed(2), y: +m.y.toFixed(2), wreck: m.fix?.wreck ?? 0, t: +(m.fix?.t ?? 0).toFixed(2) }));
    },
    /**
     * « La Sauterelle » (iteration 41): every Sauterelle on the table on the ground crouches at once for a leap at the
     * nearest hero it can find a spot for (so the crouch, the ring and the flight show on camera). Returns how many.
     */
    hop() {
      const g = attract;
      if (!g) return 0;
      let n = 0;
      for (const h of g.tanks) {
        if (!h.alive || !h.hop || h.hop.air >= 0 || h.hop.warn > 0 || h.chill !== undefined) continue;
        const spot = g.hopSpot(h, true);
        if (!spot) continue;
        g.crouch(h, spot.x, spot.y, spot.foe);
        n++;
      }
      return n;
    },
    /** A hero fires straight into each Rempart's shield (to catch the shell bouncing back on camera). */
    /**
     * « Les interrupteurs » (iteration 40): the hero nearest to a switch with a clear line fires at it; when no hero has
     * one, a hero's shell is sent in from the side of the switch facing the heroes. Returns 1 when a shell is on its way.
     */
    switchShot() {
      const g = attract;
      if (!g || !g.gates) return 0;
      const heroes = g.tanks.filter((t) => t.alive && t.kind === 'player');
      if (!heroes.length) return 0;
      const sws: [number, number][] = [];
      g.tiles.forEach((t, i) => { if (t === Tile.Switch) sws.push([(i % W) + 0.5, Math.floor(i / W) + 0.5]); });
      let best: { h: (typeof heroes)[number]; x: number; y: number; d: number } | undefined;
      for (const h of heroes) for (const [x, y] of sws) {
        const ang = Math.atan2(y - h.y, x - h.x);
        const seg = castRicochet(g.tiles, h.x, h.y, ang, 0)[0];
        const d = Math.hypot(x - h.x, y - h.y);
        if (seg && Math.hypot(seg.x1 - x, seg.y1 - y) < 0.75 && (!best || d < best.d)) best = { h, x, y, d };
      }
      if (best) {
        const { h } = best;
        const keep = h.turret;
        h.turret = Math.atan2(best.y - h.y, best.x - h.x);
        h.fireCd = 0;
        const ok = g.tryFire(h);
        h.turret = keep;
        if (ok) return 1;
      }
      // no clear line: a shell of the nearest hero comes in from the side of the switch facing it
      const h = heroes[0];
      const [x, y] = sws.reduce((a, b) => (Math.hypot(a[0] - h.x, a[1] - h.y) <= Math.hypot(b[0] - h.x, b[1] - h.y) ? a : b));
      const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const free = dirs.filter(([dx, dy]) => !isSolidBullet(g.tiles[(Math.floor(y) + dy) * W + Math.floor(x) + dx] ?? Tile.Wall));
      if (!free.length) return 0;
      const [dx, dy] = free.reduce((a, b) => ((h.x - x) * b[0] + (h.y - y) * b[1] > (h.x - x) * a[0] + (h.y - y) * a[1] ? b : a));
      g.bullets.push({ id: 900000 + g.tick, owner: h.id, x: x + dx * 1.3, y: y + dy * 1.3, vx: -dx * BULLET_SPEED, vy: -dy * BULLET_SPEED, bounces: 0, rocket: false, dead: false });
      return 1;
    },
    shieldShot() {
      const g = attract;
      if (!g) return 0;
      let n = 0;
      for (const r of g.tanks) {
        if (!r.alive || r.kind !== 'rampart') continue;
        const heroes = g.tanks.filter((t) => t.alive && t.kind === 'player');
        if (!heroes.length) break;
        const h = heroes.reduce((a, b) => (Math.hypot(a.x - r.x, a.y - r.y) <= Math.hypot(b.x - r.x, b.y - r.y) ? a : b));
        r.turret = Math.atan2(h.y - r.y, h.x - r.x);
        const keep = h.turret;
        h.turret = Math.atan2(r.y - h.y, r.x - h.x);
        h.fireCd = 0;
        if (g.tryFire(h)) n++;
        h.turret = keep;
      }
      return n;
    },
    /**
     * The wind (iteration 23): every hero fires one shell straight across the wind, toward the middle of the table,
     * so the video shows the shells bending. Returns the number of shells fired (0 on a calm table).
     */
    gustShot() {
      const g = attract;
      if (!g || g.wind === undefined) return 0;
      let n = 0;
      const across = g.wind + Math.PI / 2;
      for (const h of g.tanks) {
        if (!h.alive || h.kind !== 'player') continue;
        const toMid = Math.atan2(H / 2 - h.y, W / 2 - h.x);
        const keep = h.turret;
        h.turret = Math.abs(angDiff(across, toMid)) < Math.PI / 2 ? across : across + Math.PI;
        h.fireCd = 0;
        if (g.tryFire(h)) n++;
        h.turret = keep;
      }
      return n;
    },
    /** Make every Maçon lay its next block right now (to catch the masonry on camera). */
    build() {
      let n = 0;
      for (const t of attract?.tanks ?? []) if (t.alive && t.build) { t.build.t = 0; n++; }
      return n;
    },
    /** Make the Foreur dig in right now (to catch its trip under the table on camera). */
    dig() {
      let n = 0;
      for (const t of attract?.tanks ?? []) if (t.alive && t.kind === 'drill' && t.boss && t.boss.dig === 0) { t.boss.digT = 0; n++; }
      return n;
    },
    /** Make the Semeur sow right now (iteration 25, to catch its seeds flying on camera). */
    sow() {
      let n = 0;
      for (const t of attract?.tanks ?? []) if (t.alive && t.kind === 'sower' && t.boss && t.boss.warn <= 0) { t.boss.volleyT = 0; n++; }
      return n;
    },
    /**
     * A hero shoots the landed seed nearest to the Semeur (iteration 25, to film the blast that hurts it).
     * Returns true when a shell left.
     */
    seedShot() {
      const g = attract;
      const sw = g?.tanks.find((t) => t.alive && t.kind === 'sower');
      if (!g || !sw) return false;
      const seeds = g.mines.filter((m) => !m.dead && m.seed !== undefined && m.t > 0.6);
      const heroes = g.tanks.filter((t) => t.alive && t.kind === 'player');
      if (!seeds.length || !heroes.length) return false;
      const m = seeds.reduce((a, b) => (Math.hypot(a.x - sw.x, a.y - sw.y) <= Math.hypot(b.x - sw.x, b.y - sw.y) ? a : b));
      for (const h of heroes.sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))) {
        const ang = Math.atan2(m.y - h.y, m.x - h.x);
        if (g.traceShot(h, ang, 0).len + 0.4 < Math.hypot(m.x - h.x, m.y - h.y) - h.r) continue; // a wall in the way
        const keep = h.turret;
        h.turret = ang;
        h.fireCd = 0;
        const ok = g.tryFire(h);
        h.turret = keep;
        if (ok) return true;
      }
      return false;
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
    /** Send every hero tank into the nearest tunnel (to show them hiding on camera). */
    tunnel() {
      if (!attract) return 0;
      const g = attract;
      const cells = g.tiles.map((t, i) => (isTunnel(t) ? i : -1)).filter((i) => i >= 0);
      let n = 0;
      for (const t of g.tanks) {
        if (!t.alive || t.kind !== 'player' || !t.ai || !cells.length) continue;
        const d = (c: number) => Math.hypot((c % W) + 0.5 - t.x, Math.floor(c / W) + 0.5 - t.y);
        t.ai.goal = cells.reduce((a, b) => (d(a) <= d(b) ? a : b));
        t.ai.path = [];
        t.ai.pathT = 0;
        n++;
      }
      return n;
    },
    /** Drop a bonus crate (random kind if omitted) somewhere free in the demo arena. */
    crate(kind?: BonusKind) {
      return !!attract?.spawnBonus(kind && BONUS_KINDS.includes(kind) ? kind : undefined);
    },
    /** Drop a crate a few steps from a Pilleur, on the far side from the heroes (to film the theft). */
    bait(kind?: BonusKind) {
      const th = attract?.tanks.find((t) => t.alive && t.kind === 'thief');
      const c = attract?.spawnBonus(kind && BONUS_KINDS.includes(kind) ? kind : undefined);
      if (!th || !c || !attract) return !!c;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, x = Math.floor(th.x + Math.cos(a) * 2.6) + 0.5, y = Math.floor(th.y + Math.sin(a) * 2.6) + 0.5;
        if (x < 1 || y < 1 || x > W - 1 || y > H - 1 || attract.tiles[Math.floor(y) * W + Math.floor(x)] !== Tile.Empty) continue;
        c.x = x; c.y = y;
        break;
      }
      return true;
    },
    /** Drop a crate right onto a conveyor belt, away from the tanks (to film it riding along). */
    beltCrate(kind?: BonusKind) {
      const g = attract;
      if (!g || !g.belts.length) return false;
      const cells = g.belts.map((b, i) => (b && g.tiles[i] === Tile.Empty ? i : -1)).filter((i) => i >= 0);
      for (let k = 0; k < 30 && cells.length; k++) {
        const i = cells[Math.floor(Math.random() * cells.length)];
        const x = (i % W) + 0.5, y = Math.floor(i / W) + 0.5;
        if (g.tanks.some((t) => t.alive && Math.hypot(t.x - x, t.y - y) < 2.5) || g.bonuses.some((c) => Math.hypot(c.x - x, c.y - y) < 2)) continue;
        const c = g.spawnBonus(kind && BONUS_KINDS.includes(kind) ? kind : undefined);
        if (!c) return false;
        c.x = x; c.y = y;
        return true;
      }
      return false;
    },
    /** Hand a bonus straight to every hero tank (to show it on camera). */
    buff(kind: BonusKind) {
      if (!attract || !BONUS_KINDS.includes(kind)) return;
      for (const t of attract.tanks) if (t.alive && t.kind === 'player') attract.giveBonus(t, kind);
    },
    /** « Le ralenti » (iteration 32): play the last destruction again now (true when there was one in the last seconds). */
    replay() { stopReel(); return startReel(true); },
    /** A hero fires a ricochet (two bounces if it can) at a foe it cannot hit straight; its fall plays again in slow motion. */
    /** « Passe-muraille » (iteration 52): a hero fires a ghost shell straight through a wall at a foe hidden behind it. */
    ghostShot() {
      const g = attract;
      if (!g) return 0;
      for (const h of g.tanks) {
        if (!h.alive || h.kind !== 'player') continue;
        const had = h.buffs.ghost;
        h.buffs.ghost = undefined;
        let best: { ang: number; d: number; foe: number } | undefined;
        for (const f of g.tanks) {
          if (!f.alive || f.team === h.team || f.kind === 'train') continue;
          const ang = Math.atan2(f.y - h.y, f.x - h.x), d = Math.hypot(f.x - h.x, f.y - h.y);
          if (g.traceShot(h, ang, 0).hit === f) continue; // in plain sight: no need for a ghost
          h.buffs.ghost = 1;
          const through = g.traceShot(h, ang, 0).hit === f;
          h.buffs.ghost = undefined;
          if (through && (!best || d < best.d)) best = { ang, d, foe: f.id };
        }
        h.buffs.ghost = Math.max(had ?? 0, 2);
        if (!best) continue;
        const keep = h.turret;
        h.turret = best.ang;
        h.fireCd = 0;
        const fired = g.tryFire(h);
        h.turret = keep;
        if (fired) { reelWanted = best.foe; return 1; }
      }
      return 0;
    },
    /** « L’Illusionniste » (iteration 58): every Illusionniste with no mirage out raises its wand now (the trick follows). */
    conjure() {
      const g = attract;
      if (!g) return 0;
      let n = 0;
      for (const c of g.tanks) {
        if (!c.alive || !c.conj || c.conj.warn > 0 || g.decoys.some((d) => d.owner === c.id)) continue;
        c.conj.t = 0;
        c.conj.warn = 0.7;
        g.events.push(['abra', Math.round(c.x * 100) / 100, Math.round(c.y * 100) / 100, c.id]);
        n++;
      }
      return n;
    },
    /**
     * « Le Grand Illusionniste » (iteration 60): the hero with the best clear line to the real one fires at it (it swaps
     * places with a mirage, « Escamoté ! »); with no clear line, it just takes the hit (to show the swap on camera).
     */
    magusShot() {
      const g = attract;
      if (!g) return 0;
      const m = g.tanks.find((t) => t.alive && t.kind === 'magus');
      if (!m) return 0;
      let best: { h: Tank; ang: number; d: number } | undefined;
      for (const h of g.tanks) {
        if (!h.alive || h.kind !== 'player' || h.fireCd > 0.3) continue;
        const dist = Math.hypot(m.x - h.x, m.y - h.y);
        if (dist > 13 || !g.lineClear(h.x, h.y, m.x, m.y)) continue;
        if (!best || dist < best.d) best = { h, ang: Math.atan2(m.y - h.y, m.x - h.x), d: dist };
      }
      if (best) {
        best.h.turret = best.ang;
        if (best.h.ai) best.h.ai.aim = best.ang;
        best.h.fireCd = 0;
        if (g.tryFire(best.h)) return 1;
      }
      m.buffs.invuln = 0;
      g.killTank(m, undefined);
      return 2;
    },
    /** « L’Illusionniste » (iteration 58): the hero with the best clear line to a mirage fires at it (« Pouf ! »). */
    decoyShot() {
      const g = attract;
      if (!g) return 0;
      let best: { h: Tank; ang: number; d: number } | undefined;
      for (const h of g.tanks) {
        if (!h.alive || h.kind !== 'player' || h.fireCd > 0.3) continue;
        for (const d of g.decoys) {
          const dist = Math.hypot(d.x - h.x, d.y - h.y);
          if (dist > 12 || !g.lineClear(h.x, h.y, d.x, d.y)) continue;
          if (!best || dist < best.d) best = { h, ang: Math.atan2(d.y - h.y, d.x - h.x), d: dist };
        }
      }
      if (!best) return 0;
      best.h.turret = best.ang;
      if (best.h.ai) best.h.ai.aim = best.ang;
      best.h.fireCd = 0;
      return g.tryFire(best.h) ? 1 : 0;
    },
    /** « Le Spectre » (iteration 56): every Spectre fires now, straight through a wall, at the nearest hero hidden behind it. */
    spook() {
      const g = attract;
      if (!g) return 0;
      let n = 0;
      for (const s of g.tanks) {
        if (!s.alive || s.kind !== 'spectre') continue;
        let best: { ang: number; d: number } | undefined;
        for (const h of g.tanks) {
          if (!h.alive || h.team === s.team) continue;
          const ang = Math.atan2(h.y - s.y, h.x - s.x), d = Math.hypot(h.x - s.x, h.y - s.y);
          const seg = castRicochet(g.tiles, s.x, s.y, ang, 0, 45, false)[0];
          if (!seg || Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0) > d - h.r) continue; // in plain sight: no wall to go through
          if (g.traceShot(s, ang, 0).hit !== h) continue;
          if (!best || d < best.d) best = { ang, d };
        }
        if (!best) continue;
        s.turret = best.ang;
        if (s.ai) s.ai.aim = best.ang;
        s.fireCd = 0;
        if (g.tryFire(s)) n++;
      }
      return n;
    },
    /** « Les bonshommes de neige » (iteration 53): a hero fires straight at the nearest snowman in its line (its head flies off). */
    snowShot() {
      const g = attract;
      if (!g) return 0;
      let best: { h: Tank; ang: number; d: number } | undefined;
      for (const h of g.tanks) {
        if (!h.alive || h.kind !== 'player') continue;
        for (let c = 0; c < W * H; c++) {
          if (!isSnowman(g.tiles[c])) continue;
          const x = (c % W) + 0.5, y = Math.floor(c / W) + 0.5, d = Math.hypot(x - h.x, y - h.y);
          if (d > 9 || (best && d >= best.d)) continue;
          const ang = Math.atan2(y - h.y, x - h.x);
          const res = g.traceShot(h, ang, 0);
          if (res.hit) continue;
          const end = h.r + 0.22 + res.len + 0.2;
          if (Math.floor(h.y + Math.sin(ang) * end) * W + Math.floor(h.x + Math.cos(ang) * end) !== c) continue; // something else in the way
          best = { h, ang, d };
        }
      }
      if (!best) return 0;
      const keep = best.h.turret;
      best.h.turret = best.ang;
      best.h.fireCd = 0;
      const fired = g.tryFire(best.h);
      best.h.turret = keep;
      return fired ? 1 : 0;
    },
    /** « Gare au tir ami » (iteration 53): the demo reticle shows red for that long (as when a teammate is in the line). */
    friendAim(ms = 2500) { demoFriend = performance.now() + ms; },
    /**
     * « Le blizzard » (iteration 54): on a blizzard table, the next squall rises in `inS` seconds (for the videos: the
     * cycle is moved on, never back). Returns the seconds it had to wait, or -1 when the table has no blizzard.
     */
    squall(inS = 1.8) {
      const g = attract;
      if (!g?.blizzard) return -1;
      const wait = squallIn(g.tick);
      if (wait > inS) g.tick += Math.round((wait - inS) * TICK_RATE);
      return wait;
    },
    /** « Le blizzard »: the squall of this frame, as the screen draws it (0 clear, 1 white). */
    get whiteout() { return renderer.whiteNow; },
    /** « Détonateur » (iteration 52): a hero's remote mine on the way of the nearest enemy (the hero sets it off when it rolls on). */
    remoteTrap() {
      const g = attract;
      if (!g) return 0;
      const heroes = g.tanks.filter((t) => t.alive && t.kind === 'player');
      const foes = g.tanks.filter((t) => t.alive && t.team !== heroes[0]?.team && !isBossKind(t.kind) && t.spec.speed > 0 && !t.car);
      if (!heroes.length || !foes.length) return 0;
      let best: { x: number; y: number; d: number; foe: number; hero: Tank } | undefined;
      for (const f of foes) {
        const cands = (f.ai?.path ?? []).slice(1, 5);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) cands.push((Math.floor(f.y) + dy) * W + Math.floor(f.x) + dx);
        for (const c of cands) {
          if (c < 0 || c >= W * H || g.tiles[c] !== Tile.Empty) continue;
          const x = (c % W) + 0.5, y = Math.floor(c / W) + 0.5, d = Math.hypot(f.x - x, f.y - y);
          if (d < 1.3 || d > 2.6 || heroes.some((h) => Math.hypot(h.x - x, h.y - y) < 3.2)) continue;
          if (g.mines.some((m) => Math.hypot(m.x - x, m.y - y) < 1)) continue;
          const onWay = (f.ai?.path ?? []).includes(c) ? -2 : 0; // on its planned way first
          const hero = heroes.reduce((a, b) => (Math.hypot(a.x - x, a.y - y) <= Math.hypot(b.x - x, b.y - y) ? a : b));
          if (!best || d + onWay < best.d) best = { x, y, d: d + onWay, foe: f.id, hero };
        }
      }
      if (!best) return 0;
      g.giveBonus(best.hero, 'remote');
      g.mines.push({ id: 930000 + g.tick, owner: best.hero.id, team: best.hero.team, x: best.x, y: best.y, t: 0.5, fuse: -1, dead: false, remote: true });
      g.events.push(['mineSet', best.x, best.y, 1]);
      reelWanted = best.foe;
      return 1;
    },
    trickShot() {
      const g = attract;
      if (!g) return 0;
      for (const h of g.tanks) {
        if (!h.alive || h.kind !== 'player') continue;
        let best: { ang: number; n: number; foe: number } | undefined;
        const most = Math.min(2, h.spec.bounces);
        for (let i = 0; i < 720; i++) {
          const ang = (i / 720) * Math.PI * 2;
          for (let n = most; n >= 1; n--) {
            if (best && n <= best.n) break;
            const hit = g.traceShot(h, ang, n).hit;
            if (!hit || hit.team === h.team || g.traceShot(h, ang, n - 1).hit === hit) continue;
            best = { ang, n, foe: hit.id };
          }
        }
        if (!best) continue;
        const keep = h.turret;
        h.turret = best.ang;
        h.fireCd = 0;
        const fired = g.tryFire(h);
        h.turret = keep;
        if (fired) { reelWanted = best.foe; return best.n; }
      }
      return 0;
    },
    /** « Les miroirs » (iteration 57): a hero fires a shell that a mirror turns onto an enemy (and the slow motion shows it). */
    mirrorShot() {
      const g = attract;
      if (!g) return false;
      for (const h of g.tanks) {
        if (!h.alive || h.kind !== 'player') continue;
        const tip = h.r + 0.22;
        for (let i = 0; i < 1440; i++) {
          const ang = (i / 1440) * Math.PI * 2;
          const hit = g.traceShot(h, ang, 0).hit;
          if (!hit || hit.team === h.team) continue;
          if (castRicochet(g.tiles, h.x + Math.cos(ang) * tip, h.y + Math.sin(ang) * tip, ang, 0).length < 2) continue; // straight at it: no mirror on the way
          const keep = h.turret;
          h.turret = ang;
          h.fireCd = 0;
          const fired = g.tryFire(h);
          h.turret = keep;
          if (fired) { reelWanted = hit.id; return true; }
        }
      }
      return false;
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
const shared = location.hash.startsWith('#atelier=') ? decodeAtelier(location.hash.slice(9)) : undefined;
if (m) {
  connect(m[1].toUpperCase());
  show('lobby');
} else if (shared) {
  // a mission shared by link: open it in the workshop, ready to play
  history.replaceState(null, '', '/');
  show('home');
  openWorkshop(shared);
  toast(`Mission partagée : « ${shared.name} ». Clique sur « Jouer en ligne » !`, 4500);
} else show('home');
}
