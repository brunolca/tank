import { type TankKind, EMOTES, EMOTE_GAP, EMOTE_TIME, SEED_BLINK, BONUS_INFO, BONUS_KINDS, ICE, isBossKind, CHECKPOINT_EVERY, DT, ENEMY_COLORS, enemyColor, specOf, FLAG_ALERT, FLAG_CHARGING, FLAG_FROZEN, SHELL_HEAVY, PLAYER_COLORS, SPECS, TANK_R, TICK_RATE, TURBO_MULT, Tile, W, H, WEAPONS, WEAPON_INFO, isPortal, isTunnel, isWeapon, playerSpec, tankRadius, type BonusKind, type TankSpec, type Weapon } from '../shared/constants';
import { ATELIER_LIVES, ATELIER_SAMPLE, atelierKinds, atelierLevel, decodeAtelier, encodeAtelier } from '../shared/atelier';
import { applyTwist, DAILY_STAGES, dailyLevel, dailyTwist, dayLabel, dayNumber, formatTicks, TWIST_INFO, type DailyTwist } from '../shared/daily';
import { EXTRA_LEVELS, LEVELS, getMission, nearestFree, versusArena, type ParsedLevel } from '../shared/levels';
import { CTF_RESPAWN, CTF_ROUND, CTF_TARGET, TEAM_COLORS, TEAM_NAMES, TEAM_TANK_COLORS, ctfArena, ctfTeam, newFlags, type NetFlag } from '../shared/drapeau';
import { MAX_RIVALS, RIVAL_LEVELS, RIVAL_NAMES, isRivalId, makeRival, rivalLevel, rivalMode } from '../shared/rivals';
import META from '../shared/meta.json';
import { angDiff, beltStep } from '../shared/physics';
import { BOSS_NAMES, RUSH_DUO_HP, RUSH_LIVES, RUSH_STAGES, rushLevel, rushOrder, rushDuo, weekLabel, weekNumber } from '../shared/rush';
import type { BossKind } from '../shared/levels';
import type { AtelierMap, BoardDay, ClientMsg, DailyState, RushState, GameEvent, Input, Mode, NetBonus, NetBullet, NetMine, NetTank, Phase, PlayerInfo, Results, ServerMsg, TankInfo } from '../shared/protocol';
import { Game, driveStep, slideDrive } from '../shared/sim';
import { BRANCHES, TRAINING_SECONDS, XP_PER_GALON, canBuy, cleanRanks, canBuyAny, freeGalons, trainSpec, type Progress, type Ranks } from '../shared/skills';
import { renderTree } from './skills';
import { COUNCIL_SECONDS, TAUPE_MIN_PLAYERS, TAUPE_STAGES, VERDICT_SECONDS, taupeLevel, type CouncilState } from '../shared/taupe';
import { initAudio, isMusicOn, setMusicIntensity, setRain, setWind, sfx, startMusic, toggleMusic, windGust } from './audio';
import { gustAt, windAngle, windWords } from '../shared/wind';
import { setupFeedback, type Region } from './feedback';
import { Controls } from './input';
import { Workshop, drawMap } from './atelier';
import { Renderer, type RBonus, type RBullet, type RFlag, type RMine, type RTank } from './render';
import { Film, REPLAYED, koCaption, type Reel } from './replay';

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
const coopLike = (m: Mode) => m !== 'versus' && m !== 'drapeau';

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

interface Snap { k: number; a: number; T: Map<number, NetTank>; B: Map<number, NetBullet>; M: NetMine[]; P: NetBonus[]; F: NetFlag[]; at: number }

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
let latestK = 0;
let pending: Input[] = [];
let seq = 0;
let pred = { x: 0, y: 0, body: 0, vx: 0, vy: 0 }; // vx, vy: the speed we slide at on the ice (iteration 21)
let iceMap = false; // some floor cells of the current level are ice (or a Givré may frost them, iteration 31)
let mapIce = false; // the map itself has ice (the « Glace » label and hint)
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
      if (wantAtelier && msg.players.find((p) => p.id === pid)?.host && msg.phase === 'lobby') {
        send({ t: 'atelier', ...wantAtelier });
        wantAtelier = undefined;
      }
      renderLobby();
      if (msg.phase === 'lobby' && screen !== 'results' && screen !== 'atelier') { online = false; show('lobby'); hideBanner(); startAttract(); }
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
  renderer.setLevel(tiles, msg.tanks, belts);
  renderer.setFrost(undefined);
  // « Drapeaux » (iteration 24): the two bases, and a ring of the team's colour under each tank
  const bs = msg.mode === 'drapeau' && Array.isArray(msg.bases) && msg.bases.length >= 4 ? msg.bases.map(Number) : undefined;
  ctfBases = bs && bs.every(Number.isFinite) ? [[bs[0], bs[1]], [bs[2], bs[3]]] : undefined;
  myTeam = ctfBases ? (myInfo?.team ?? 0) : 0;
  renderer.setCtf(ctfBases, (id) => infos.get(id)?.team);
  renderer.setNight(!!msg.night);
  renderer.setStorm(!!msg.storm);
  levelWind = typeof msg.wind === 'number' && Number.isFinite(msg.wind) ? msg.wind : undefined;
  renderer.setWind(levelWind);
  // the fog (iteration 26): you see through it around you, and around your teammates (in coop, or in your flag team)
  levelFog = typeof msg.fog === 'number' && Number.isFinite(msg.fog) ? msg.fog : undefined;
  renderer.fogAlly = coopLike(msg.mode) ? (id) => infos.get(id)?.team !== 99 : msg.mode === 'drapeau' ? (id) => !!myTeam && infos.get(id)?.team === myTeam : undefined;
  renderer.setFog(levelFog);
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
    : `<b>Manche ${msg.mission}</b><span>Versus · premier à 5</span>`;
  $('#hud').dataset.mode = msg.mode;
  const enemies = msg.tanks.filter((t) => t.team === 99);
  const wx = `${msg.night ? ' · Nuit' : ''}${msg.storm ? ' · Orage' : ''}${mapIce ? ' · Glace' : ''}${levelWind !== undefined ? ' · Vent' : ''}${levelFog !== undefined ? ' · Brouillard' : ''}`;
  const wxCls = `${msg.night ? ' night' : ''}${msg.storm ? ' storm' : ''}${mapIce ? ' ice' : ''}${levelWind !== undefined ? ' wind' : ''}${levelFog !== undefined ? ' fog' : ''}`;
  bossFight = enemies.some((e) => isBossKind(e.kind));
  const drillFight = enemies.some((e) => e.kind === 'drill');
  const thunderFight = enemies.some((e) => e.kind === 'thunder');
  const sowerFight = enemies.some((e) => e.kind === 'sower');
  if (coopLike(msg.mode)) {
    const kinds = [...new Set(enemies.map((e) => e.kind))];
    if (msg.daily) {
      const tw = TWIST_INFO[msg.daily.twist];
      banner(`Défi du jour · étape ${msg.daily.stage}/${msg.daily.stages}${wx}`, msg.name,
        `${tw ? `${tw.label} · ` : ''}Tanks ennemis : ${enemies.length}`, `intro daily${wxCls}${bossFight ? ' boss' : ''}`);
    } else if (msg.mode === 'rush') {
      const st = rushState?.stage ?? msg.mission;
      const finale = st >= RUSH_STAGES;
      banner(finale ? `Ronde des boss · le bouquet final${wx}` : `Ronde des boss · boss ${st}/${RUSH_STAGES}${wx}`, msg.name,
        finale ? 'Deux boss à la fois : sépare-les, et garde un œil sur chacun !' : bossTip(thunderFight, sowerFight, drillFight), `intro boss rush${wxCls}`);
    } else if (msg.mode === 'taupe') {
      banner(`La taupe · étape ${msg.mission}/${TAUPE_STAGES}`, msg.name, `Tanks ennemis : ${enemies.length}`, 'intro mole');
    } else if (msg.mode === 'atelier') {
      banner(`Atelier · mission maison${wx}`, msg.name, `Tanks ennemis : ${enemies.length} · ${ATELIER_LIVES} vies`, `intro atelier${wxCls}${bossFight ? ' boss' : ''}`);
    } else if (bossFight) banner(`Mission ${msg.mission} · Boss`, msg.name, bossTip(thunderFight, sowerFight, drillFight), `intro boss${thunderFight ? ' storm' : ''}`);
    else banner(`Mission ${msg.mission}${wx}`, msg.name, `Tanks ennemis : ${enemies.length}`, `intro${wxCls}`);
    const sub = $('#banner .b-sub');
    sub.innerHTML += `<div class="b-tanks">${kinds.map((k) => `<span style="--c:${hex(enemyColor(k))}">${specOf(k).label}</span>`).join('')}</div>`;
  } else if (msg.mode === 'drapeau') {
    banner(`Drapeaux · manche ${msg.mission}${wx}`, msg.name,
      `${myTeam ? `Tu joues chez les ${TEAM_NAMES[myTeam - 1]} (${myTeam === 1 ? 'à gauche' : 'à droite'}) : ` : ''}rapporte le drapeau adverse à ta base !`, `intro ctf team${myTeam}${wxCls}`);
  } else {
    banner(`Manche ${msg.mission}${wx}`, 'Versus', 'Le dernier tank debout gagne la manche', `intro${wxCls}`);
  }
  if (myTankId < 0) toast('Partie en cours : tu rejoindras à la prochaine manche.', 4000);
  else if (sowerFight) setTimeout(() => toast('Le Semeur : ses graines mûres l’épargnent, mais une graine touchée par ton obus explose aussitôt… et le blesse s’il est à côté !', 4600), 2200);
  else if (thunderFight) setTimeout(() => toast('Le Grondeur : sa foudre ne le touche jamais, mais elle frappe ses alliés. Les tunnels sont tes seuls abris !', 4400), 2200);
  else if (levelFog !== undefined) setTimeout(() => toast(coopLike(msg.mode) ? 'Brouillard : au cœur de la brume, un tank ne se voit que de près… ou quand il tire. Les ennemis aussi te perdent de vue !' : 'Brouillard : cache-toi dans la brume ! Chaque tir trahit ta position.', 4600), 2200);
  else if (levelWind !== undefined) setTimeout(() => toast(`Vent : il souffle ${windWords(levelWind!)} et courbe les obus en vol. Vise en amont… ou tire pendant les accalmies, quand la manche à air retombe !`, 4600), 2200);
  else if (msg.storm) setTimeout(() => toast(msg.night ? 'Orage de nuit : quand l’éclair tombe, tout le monde est visible !' : 'Orage : quand le sol crépite, la foudre va tomber. Écarte-toi !', 4000), 2200);
  else if (msg.night) setTimeout(() => toast(coopLike(msg.mode) ? 'Nuit : les ennemis ne te voient que de près… ou quand tu tires !' : 'Nuit : chaque tir trahit ta position.', 4000), 2200);
  else if (enemies.some((e) => e.kind === 'frost')) setTimeout(() => toast('Le Givré patine sans jamais glisser et laisse du givre partout où il passe : là, ton tank dérape ! Une mine fait fondre le givre, et il fond tout seul une fois le Givré détruit.', 5000), 2200);
  else if (enemies.some((e) => e.kind === 'magnet')) setTimeout(() => toast('L’Aimant : quand son champ bleu brille, il attire et avale tes obus… puis te les renvoie tous d’un coup. Tire quand le champ s’éteint, ou pose une mine !', 4800), 2200);
  else if (enemies.some((e) => e.kind === 'rampart')) setTimeout(() => toast('Le Rempart renvoie tous les obus qui frappent son bouclier. Prends-le de côté, par-derrière… ou à la mine !', 4400), 2200);
  else if (enemies.some((e) => e.kind === 'thief')) setTimeout(() => toast('Le Pilleur file droit sur les caisses et garde les bonus pour lui. Détruis-le : il lâche son butin !', 4200), 2200);
  else if (enemies.some((e) => e.kind === 'mason')) setTimeout(() => toast('Le Maçon bâtit des murs de liège pour s’abriter. Une mine ou un ricochet bien placé, et tout s’écroule !', 4200), 2200);
  else if (drillFight) setTimeout(() => toast('Le Foreur : on ne peut le toucher qu’en surface. Il ronge le liège en passant !', 4000), 2200);
  else if (mapIce) setTimeout(() => toast('Glace : ton tank glisse et garde son élan. Freine tôt, braque en avance… et profite des glissades pour esquiver !', 4400), 2200);
  else if (belts.some(Boolean)) setTimeout(() => toast('Tapis roulants : ils emportent les tanks, les mines et les caisses. Remonter le courant, ça ralentit !', 4200), 2200);
  else if (tiles.some(isTunnel)) setTimeout(() => toast('Tunnels : roule dedans pour disparaître aux yeux de l’ennemi. Les obus rebondissent dessus, mais on ne peut pas tirer de l’intérieur.', 4200), 2200);
  else if (tiles.some(isPortal)) setTimeout(() => toast('Portails : entre dans l’un, ressors par l’autre. Les obus aussi !', 3500), 2200);
}

/** One line on how to beat the boss of the table (the intro banner of a boss fight). */
function bossTip(thunder: boolean, sower: boolean, drill: boolean) {
  return thunder ? 'Il appelle la foudre sur toi. Quand son nuage gronde, bouge… ou file sous un tunnel !'
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
  onProgress(msg, prev);
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
  if (prev === 'playing' && (msg.phase === 'cleared' || msg.phase === 'failed' || msg.phase === 'roundEnd')) queueReel();
  else if (msg.phase !== 'cleared' && msg.phase !== 'failed' && msg.phase !== 'roundEnd') stopReel();
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
      if (treeOpen && treeAuto) break; // the skill tree card opened instead of the banner (iteration 19)
      if (msg.daily) {
        const last = msg.daily.stage >= msg.daily.stages;
        banner('Bravo !', last ? 'Défi relevé !' : `Étape ${msg.daily.stage} réussie`, `Chrono : ${formatTicks(msg.daily.ticks)}`, 'good');
      } else if (msg.rush && currentMode === 'rush') {
        const r = msg.rush;
        const split = r.splits[r.splits.length - 1];
        const last = r.stage >= r.stages;
        const who = r.bosses.map((b) => BOSS_NAMES[b as BossKind] ?? 'le boss');
        banner(last ? 'La ronde est bouclée !' : `Boss ${r.stage}/${r.stages} vaincu !`, last ? 'Les quatre boss sont tombés… et le duo aussi !' : `${cap(who.join(' et '))} ${who.length > 1 ? 'sont tombés' : 'est tombé'}`,
          `${split !== undefined ? `En ${formatTicks(split)} · ` : ''}chrono : ${formatTicks(r.ticks)}${!last && r.stage + 1 >= r.stages ? ' · Prochain : le bouquet final !' : ''}`, 'good');
      } else if (currentMode === 'atelier') banner('Bravo !', 'Mission réussie', currentLevelName, 'good');
      else banner('Bravo !', 'Mission réussie', msg.mission % 5 === 0 ? 'Vie bonus à la prochaine mission !' : '', 'good');
      break;
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
      } else banner('Fin de manche', msg.text ?? '', '', 'good');
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
  const s: Snap = { k: msg.k, a: msg.a, T: new Map(msg.T.map((t) => [t[0], t])), B: new Map(msg.B.map((b) => [b[0], b])), M: msg.M, P: msg.P ?? [], F: Array.isArray(msg.F) ? msg.F : [], at: performance.now() };
  snaps.push(s);
  if (snaps.length > 40) snaps.shift();
  latestK = msg.k;
  applyFrost(msg.I);
  for (const e of msg.E) {
    evq.push({ k: msg.k, e });
    if (e[0] === 'block') tiles[e[2] * W + e[1]] = Tile.Empty; // prediction sees the freshest map
    else if (e[0] === 'build') tiles[e[2] * W + e[1]] = Tile.Cork; // the Maçon's new block stops my tank right away
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

function predictStep(x: number, y: number, body: number, vx: number, vy: number, mx: number, my: number, s?: Snap): [number, number, number, number, number] {
  const snap = s ?? snaps[snaps.length - 1];
  const fl = snap?.T.get(myTankId)?.[5] ?? 0;
  const turbo = fl & BONUS_INFO.turbo.flag;
  const speed = mySpec.speed * (turbo ? TURBO_MULT : 1);
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
      if (own < mySpec.maxBullets) {
        localFireCd = mySpec.fireCd;
        if (meNet[5] & BONUS_INFO.heavy.flag) sfx.heavyShot(); else sfx.shot(mySpec.rocket);
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
  renderer.windTick = renderer.fogTick = renderTick; // the gust is a function of the tick: the same as the server's
  if (levelWind !== undefined && (windSoundT -= dt) <= 0) {
    windSoundT = 0.15;
    const k = gustAt(renderTick);
    windGust(k);
    $<HTMLElement>('#hud-wind i').style.transform = `rotate(${((windAngle(levelWind, renderTick) * 180) / Math.PI).toFixed(1)}deg)`;
    $<HTMLElement>('#hud-wind u').style.width = `${Math.round(k * 100)}%`;
  }

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
  renderer.syncTanks(tanks, myTankId, dt);
  lastTanks = tanks;
  updateBoss(tanks, (id) => a.T.get(id)?.[6] ?? 0, (id) => infos.get(id)?.hp ?? 0);
  if (currentMode === 'drapeau') {
    // the round clock: it runs while the round is being played
    const left = Math.max(0, Math.ceil(phase === 'playing' ? ctfLeft - (performance.now() - ctfLeftAt) / 1000 : ctfLeft));
    $('#hud-enemies').textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('#hud-enemies').classList.toggle('hurry', left <= 30 && phase === 'playing');
  } else {
    $('#hud-enemies').textContent = coopLike(currentMode) ? `${enemiesAlive} ennemi${enemiesAlive > 1 ? 's' : ''}` : '';
    $('#hud-enemies').classList.remove('hurry');
  }

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
    bullets.push({ id: bl[0], x: bl[1] + bl[3] * ahead, y: bl[2] + bl[4] * ahead, vx: bl[3], vy: bl[4], rocket: !!(bl[5] & 1), heavy: !!(bl[5] & SHELL_HEAVY), color: shellColor(bl[6]) });
  }
  for (const ba of a.B.values()) {
    if (ba[6] === myTankId) continue;
    const bb = b.B.get(ba[0]);
    if (!bb) { bullets.push({ id: ba[0], x: ba[1] + ba[3] * u * DT * (b.k - a.k), y: ba[2] + ba[4] * u * DT * (b.k - a.k), vx: ba[3], vy: ba[4], rocket: !!(ba[5] & 1), heavy: !!(ba[5] & SHELL_HEAVY), color: shellColor(ba[6]) }); continue; }
    const bw = jumped(ba[1], ba[2], bb[1], bb[2], u);
    bullets.push({ id: ba[0], x: lerp(ba[1], bb[1], bw), y: lerp(ba[2], bb[2], bw), vx: bb[3], vy: bb[4], rocket: !!(ba[5] & 1), heavy: !!(ba[5] & SHELL_HEAVY), color: shellColor(ba[6]) });
  }
  renderer.syncBullets(bullets, dt);
  lastBullets = bullets;
  const mines: RMine[] = a.M.map((m) => ({ id: m[0], x: m[1], y: m[2], blink: !!m[3], seed: m[4] ? (m[4] - 1) / 10 : undefined }));
  renderer.syncMines(mines);
  lastMines = mines;
  const bonuses: RBonus[] = a.P.map((c) => ({ id: c[0], x: c[1], y: c[2], kind: c[3], blink: !!c[4] }));
  renderer.syncBonuses(bonuses);
  const flags: RFlag[] | undefined = ctfBases ? a.F.map((f) => ({ team: f[0], x: f[1], y: f[2], carrier: f[3], state: f[4], left: f[5] })) : undefined;
  if (flags) renderer.syncFlags(flags);
  film.frame(dt, tanks, bullets, mines, bonuses, flags);
  updateNameTags(tanks);
  const myFlags = latest.T.get(myTankId)?.[5] ?? 0;
  renderBuffs(myFlags & 1 ? myFlags : 0);
}

function handleEvent(e: GameEvent, audible: boolean) {
  if (!reel) film.event(e); // « Le ralenti » (iteration 32): everything that happens goes on film
  if (online) { eventLog.push([Math.round(renderTick), ...e]); if (eventLog.length > 60) eventLog.shift(); }
  switch (e[0]) {
    case 'shot':
      if (e[5] === myTankId && online) break;
      renderer.muzzle(e[1], e[2], e[3], !!(e[4] & 1), e[5]);
      if (audible) { if (e[4] & SHELL_HEAVY) sfx.heavyShot(); else sfx.shot(!!(e[4] & 1)); }
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
      if (isBossKind(renderer.tankKind(e[3]) ?? '')) {
        // the boss goes down in a chain of blasts
        const kind = renderer.tankKind(e[3])!;
        renderer.explosion(e[1], e[2], true, renderer.tankColor(e[3]));
        for (let i = 1; i <= 3; i++) setTimeout(() => renderer.explosion(e[1] + (Math.random() - 0.5) * 1.4, e[2] + (Math.random() - 0.5) * 1.4, false, kind === 'drill' ? 0x8a5a33 : kind === 'thunder' ? 0x8fc0ff : kind === 'sower' ? 0x7fd05a : 0xf2c14e), i * 180);
        floater(e[1], e[2], `${specOf(kind).label} vaincu !`, 0xf2c14e);
        if (audible) { sfx.boom(true); setTimeout(() => sfx.boom(false), 250); }
        if (online && bossFight) setMusicIntensity(1);
      } else {
        renderer.explosion(e[1], e[2], false, renderer.tankColor(e[3]));
        if (audible) sfx.boom(false);
      }
      if (e[3] === myTankId && online) { toast('Détruit !', 1500); controls.rumble(1, 320); }
      break;
    case 'ko': // who did it (iteration 32): the film keeps it for the replay's caption
      if (e[1] === reelWanted && !online) { reelWanted = -1; queueReel(true); }
      break;
    case 'mineSet':
      if (audible) sfx.mineSet();
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
      renderer.removeBlock(e[1], e[2]);
      if (audible) sfx.block();
      break;
    case 'build':
      renderer.addBlock(e[1], e[2], e[3]);
      floater(e[1] + 0.5, e[2] + 0.5, 'Hop, un mur !', 0xc98f55); // the knock, written: readable without the sound
      if (audible) sfx.build();
      break;
    case 'crate':
      if (audible) sfx.crate();
      break;
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
      break;
    }
    case 'freeze': // « Gel » (iteration 29): a wave of frost from the one who grabbed it
      renderer.frostWave(e[1], e[2]);
      if (audible) sfx.freeze();
      if (e[4] > 0) floater(e[1], e[2] - 0.6, e[4] > 1 ? `${e[4]} tanks gelés !` : 'Un tank gelé !', BONUS_INFO.freeze.color);
      if (renderer.tankKind(e[3]) !== 'player' && online) toast('Brrr ! Un ennemi a pris le gel : te voilà pris dans la glace.', 3000);
      break;
    case 'thaw':
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
        // a destroyed tank is back at its base
        renderer.bonusBurst(x, y, color);
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
    if (on && !charging.has(t.id) && online && (renderer.tankKind(t.id) === 'boss' || renderer.tankKind(t.id) === 'sower')) sfx.bossCharge();
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
  inner.textContent = text;
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
emotePad.innerHTML = EMOTES.map((t, i) => `<button data-emote="${i}" class="e${i}"><kbd>${i + 1}</kbd>${t}</button>`).join('');
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
  el.textContent = myRole ? '🎭 Tu es la taupe' : '🛡 Loyal';
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

function onProgress(msg: Extract<ServerMsg, { t: 'phase' }>, prev: Phase) {
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
    treeEnd = performance.now() + TRAINING_SECONDS * 1000;
    openTree(true);
  } else if (msg.phase !== 'cleared' && treeAuto) closeTree();
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
  renderRole();
  $('#hud-rally').hidden = !hasMates();
  $('#hud-emote').hidden = !online;
  if (!online) closeEmotePad();
  const sb = $('#scoreboard');
  if (currentMode === 'drapeau') {
    sb.innerHTML = TEAM_NAMES.map((n, i) => `<div class="sb-row ctf${myTeam === i + 1 ? ' mine' : ''}"><i style="--c:${hex(TEAM_COLORS[i])}"></i><span>${n}</span><b>${teamScores[i]}</b></div>`).join('');
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

function renderLobby() {
  const me = lobbyPlayers.find((p) => p.id === pid);
  const isHost = !!me?.host;
  $('#room-code').textContent = roomCode;
  // « Drapeaux » (iteration 24): the tanks of the list take turns, one for the Bleus, one for the Rouges
  const order = lobbyPlayers.filter((p) => p.connected);
  const teamTag = (p: PlayerInfo) => {
    if (lobbyMode !== 'drapeau') return '';
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
  const need = lobbyMode === 'versus' || lobbyMode === 'drapeau' ? 2 : lobbyMode === 'taupe' ? TAUPE_MIN_PLAYERS : 1;
  const noMap = lobbyMode === 'atelier' && !lobbyAtelier;
  start.disabled = n < need || noMap;
  start.textContent = n < need ? (lobbyMode === 'versus' || lobbyMode === 'drapeau' ? 'Ajoute un rival ou invite un ami' : `Il faut ${need} joueurs`) : noMap ? 'Dessine d’abord ta mission' : phase === 'lobby' ? 'Lancer la partie' : 'Partie en cours…';
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

function showResults(r: Results) {
  const kinds = Object.keys(SPECS).filter((k) => k !== 'player') as (keyof typeof SPECS)[];
  const title = r.daily
    ? (r.daily.cleared >= r.daily.state.stages ? 'Défi du jour relevé !' : `Défi du jour · ${r.daily.cleared}/${r.daily.state.stages} étapes`)
    : r.rush ? (r.rush.cleared >= r.rush.state.stages ? 'La ronde des boss est bouclée !' : `Ronde des boss · ${r.rush.cleared}/${r.rush.state.stages} boss`)
    : r.taupe ? (r.taupe.winner === 'taupe' ? 'La taupe l’emporte !' : 'Les loyaux l’emportent !')
    : r.atelier ? (r.atelier.won ? `« ${r.atelier.name} » réussie !` : `« ${r.atelier.name} » : plus de vies…`)
    : r.drapeau ? (r.drapeau.winner ? `Les ${TEAM_NAMES[r.drapeau.winner - 1]} remportent les drapeaux ! (${r.drapeau.teams[0]} à ${r.drapeau.teams[1]})` : `Égalité aux drapeaux (${r.drapeau.teams[0]} à ${r.drapeau.teams[1]})`)
    : r.mode === 'coop' ? `Partie terminée · Mission ${r.mission}` : `${r.players[0]?.name ?? ''} remporte le versus !`;
  const ctf = !!r.drapeau;
  const coop = coopLike(r.mode);
  const ff = coop && r.players.some((p) => p.ff !== undefined);
  const gal = r.players.some((p) => p.g !== undefined);
  $('#results-title').textContent = title;
  $('#results-body').innerHTML = `
    <table>
      <thead><tr><th>Joueur</th>${coop ? kinds.map((k) => `<th title="${specOf(k).label}"><i class="dot" style="--c:${hex(enemyColor(k))}"></i></th>`).join('') : '<th>Kills</th>'}${ff ? '<th title="Coéquipiers détruits">Tirs amis</th>' : ''}${gal ? '<th title="Galons gagnés pendant la campagne">★</th>' : ''}${ctf ? '<th title="Drapeaux rapportés à la base">Drapeaux</th>' : ''}<th>Morts</th><th>${coop ? 'Total' : 'Manches'}</th></tr></thead>
      <tbody>${r.players
        .map((p) => {
          const kills = Object.values(p.kills).reduce((s, v) => s + (v ?? 0), 0);
          const team = ctf && (p.team === 1 || p.team === 2) ? ` <em class="ia" style="color:${hex(TEAM_COLORS[p.team - 1])}">${TEAM_NAMES[p.team - 1]}</em>` : '';
          return `<tr><td><i class="dot" style="--c:${hex(p.color)}"></i>${escapeHtml(p.name)}${team}${p.bot !== undefined ? ` <em class="ia">IA ${RIVAL_LEVELS[rivalLevel(p.bot)].label.toLowerCase()}</em>` : ''}</td>${
            coop ? kinds.map((k) => `<td>${p.kills[k] ?? '·'}</td>`).join('') : `<td>${kills}</td>`
          }${ff ? `<td>${p.ff || '·'}</td>` : ''}${gal ? `<td>${p.g ?? '·'}</td>` : ''}${ctf ? `<td>${p.caps || '·'}</td>` : ''}<td>${p.deaths}</td><td><b>${p.score}</b></td></tr>`;
        })
        .join('')}</tbody>
    </table>${r.daily ? dailyResultHtml(r.daily) : ''}${r.rush ? rushResultHtml(r.rush) : ''}${r.taupe ? taupeResultHtml(r.taupe, r.players) : ''}`;
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
let attractPrev = new Map<number, { x: number; y: number; body: number; turret: number }>();

/** A versus of AI rivals (iteration 17): the videos, and now and then the home-screen background. */
interface AttractVersus { round: number; levels?: number[]; scores?: number[]; chain?: boolean }
/** « Drapeaux » (iteration 24): two teams of AI rivals, for the videos and the home-screen background. */
interface AttractFlags { round: number; levels?: number[]; teams?: [number, number]; chain?: boolean; carry?: boolean } // carry: the round opens with a Bleu already holding the red flag, by the Rouges' base (videos)
interface AttractOpts { drapeau?: AttractFlags; versus?: AttractVersus; atelier?: AtelierMap; mission?: number; heroes?: boolean; rich?: boolean; bossHp?: number; night?: boolean; storm?: boolean; daily?: { day: number; stage: number }; rush?: { week: number; stage: number }; arms?: Weapon[]; taupe?: { seed: number; stage: number }; ranks?: Ranks }
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
  reelWanted = -1;
  film.clear();
  clearBubbles();
  attractOpts = opts;
  // now and then, the home-screen background is a versus of AI rivals (iteration 17)
  if (!opts.versus && !opts.drapeau && !opts.heroes && opts.mission === undefined && !opts.atelier && !opts.daily && !opts.taupe && !opts.rush) {
    const r = Math.random();
    if (r < 0.1) { startAttractVersus({ round: Math.floor(Math.random() * 12), levels: [1, 2, 1, 2] }); return; }
    if (r < 0.2) { startAttractFlags({ round: Math.floor(Math.random() * 12), levels: [1, 2, 2, 1] }); return; } // and, from iteration 24, a flag round
  }
  if (opts.versus) { startAttractVersus(opts.versus, opts.arms); return; }
  if (opts.drapeau) { startAttractFlags(opts.drapeau, opts.arms); return; }
  attractCtf = undefined;
  if (document.body.classList.contains('vs-demo')) { document.body.classList.remove('vs-demo'); $('#hud').hidden = true; }
  const lvl: ParsedLevel = opts.atelier ? atelierLevel(opts.atelier) : opts.taupe ? taupeLevel(opts.taupe.seed, opts.taupe.stage) : opts.daily ? dailyLevel(opts.daily.day, opts.daily.stage) : opts.rush ? rushLevel(opts.rush.week, opts.rush.stage) : getMission(opts.mission ?? attractMission()); // now and then, the Maçon's building site or the tunnels
  const g = new Game(lvl.tiles, lvl.belts);
  g.bonusOn = true;
  // the home-screen background sometimes plays in the dark, as a teaser
  g.night = opts.night ?? (!!lvl.night || (!opts.heroes && opts.mission === undefined && Math.random() < 0.25));
  // and sometimes under a storm
  g.storm = opts.storm ?? (!!lvl.storm || (!opts.heroes && opts.mission === undefined && Math.random() < 0.18));
  // the wind (iteration 23): its own setting, and sometimes on the home screen
  g.wind = lvl.wind ?? (!opts.heroes && opts.mission === undefined && !opts.atelier && Math.random() < 0.16 ? Math.floor(Math.random() * 8) * (Math.PI / 4) : undefined);
  // the fog (iteration 26): its own setting, and sometimes on the home screen (on calm, daylit tables)
  g.fog = lvl.fog ?? (!opts.heroes && opts.mission === undefined && !opts.atelier && !g.night && g.wind === undefined && Math.random() < 0.16 ? 1 + Math.floor(Math.random() * 999) : undefined);
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
  g.onKill = (v, k) => { if (v.kind === 'player' && k?.kind === 'player') g.events.push(['ff', v.x, v.y, v.id, k.id]); };
  g.frozen = false;
  attract = g;
  attractEnd = 0;
  attractPrev.clear();
  renderer.setLevel(g.tiles, g.tankInfos(), g.belts);
  renderer.setNight(g.night);
  renderer.setStorm(g.storm);
  renderer.setWind(g.wind);
  renderer.fogAlly = (id) => g.tankById(id)?.team === 1; // the camera sees through the mist around the heroes
  renderer.setFog(g.fog);
}
function stopAttract() {
  attract = undefined;
}

const VS_ARMS: Weapon[] = ['ricochet', 'canon', 'fusee', 'sapeur'];
let attractVs: (AttractVersus & { scores: number[]; names: string[] }) | undefined;

/** Four rivals, one team each, on a versus arena: the last one standing scores (and, in the videos, the next round follows). */
function startAttractVersus(vs: AttractVersus, arms?: Weapon[]) {
  const lvl = versusArena(vs.round);
  const g = new Game(lvl.tiles, lvl.belts);
  g.bonusOn = true;
  g.bonusNext = 3; g.bonusEvery = [6, 9];
  g.night = !!lvl.night;
  g.storm = !!lvl.storm;
  g.wind = lvl.wind;
  g.fog = lvl.fog;
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
  renderVsBoard();
}

let attractCtf: (AttractFlags & { teams: [number, number] }) | undefined;

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
    banner(`Versus · manche ${vs.round + 1}`, w >= 0 ? `${vs.names[w]} gagne la manche !` : 'Égalité !', w >= 0 ? `${vs.scores[w]} point${vs.scores[w] > 1 ? 's' : ''}` : '', 'intro');
    setTimeout(hideBanner, 2200);
  }
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
  renderer.windTick = renderer.fogTick = g.tick + u;
  const tanks: RTank[] = g.tanks.map((t) => {
    const p = attractPrev.get(t.id) ?? t;
    const w = jumped(p.x, p.y, t.x, t.y, u);
    return { id: t.id, x: lerp(p.x, t.x, w), y: lerp(p.y, t.y, w), body: lerpAng(p.body, t.body, u), turret: lerpAng(p.turret, t.turret, u), alive: t.alive, invisible: false, fx: g.buffFlags(t), hp: t.maxHp > 1 ? t.hp : undefined };
  });
  renderer.syncTanks(tanks, -1, dt);
  renderer.setFrost(g.frost.size || renderer.frostShown ? [...g.frost] : undefined); // the Givré's frost (iteration 31)
  lastTanks = tanks;
  updateBoss(tanks, (id) => g.tankById(id)?.hp ?? 0, (id) => g.tankById(id)?.maxHp ?? 0);
  const bullets: RBullet[] = g.bullets.map((b) => {
    const o = g.tankById(b.owner);
    return { id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, rocket: b.rocket, heavy: b.heavy, color: o?.kind === 'player' ? o.color : undefined };
  });
  renderer.syncBullets(bullets, dt);
  const mines: RMine[] = g.mines.map((m) => ({ id: m.id, x: m.x, y: m.y, blink: m.fuse >= 0 || (m.seed !== undefined && m.t > m.seed - SEED_BLINK), seed: m.seed !== undefined ? m.t : undefined }));
  renderer.syncMines(mines);
  const bonuses: RBonus[] = g.bonuses.map((c): RBonus => ({ id: c.id, x: c.x, y: c.y, kind: BONUS_KINDS.indexOf(c.kind), blink: c.t > 13 }));
  renderer.syncBonuses(bonuses);
  const flags: RFlag[] | undefined = g.flags ? g.netFlags()!.map((f): RFlag => ({ team: f[0], x: f[1], y: f[2], carrier: f[3], state: f[4], left: f[5] })) : undefined;
  if (flags) renderer.syncFlags(flags);
  film.frame(dt, tanks, bullets, mines, bonuses, flags);
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
  } else if (attractOpts.versus) {
    const alive = g.tanks.filter((t) => t.alive && t.kind === 'player').length;
    if (!attractEnd && (alive <= 1 || g.tick > TICK_RATE * 60)) { attractEnd = g.tick + TICK_RATE * 2.5; endAttractVersus(g); }
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
    }
    if (attractEnd && g.tick > attractEnd) { attract = undefined; startAttract(); }
  }
  if (!ended && attractEnd && attract === g) queueReel();
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
  if ((!replayOn && !force) || reel || screen !== 'game') return; // not behind the home screen or the lobby
  reelDue = performance.now() + (online ? 350 : 450);
  reelTries = 0;
}
let reelTries = 0;

function reelName(id: number) {
  const info = infos.get(id);
  if (online && info) return info.kind === 'player' ? info.name : specOf(info.kind).label;
  const t = attract?.tankById(id);
  if (t) return t.kind === 'player' ? t.name : specOf(t.kind).label;
  const kind = renderer.tankKind(id);
  return kind ? specOf(kind).label : undefined;
}

function startReel(force = false) {
  reelDue = 0;
  if (reel || (!force && !replayOn) || (treeOpen && treeAuto) || screen === 'results') return false;
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
  renderer.syncBonuses(f.bonuses);
  if (f.flags) renderer.syncFlags(f.flags);
  updateNameTags(f.tanks);
  renderer.replayCam = { x: r.x, y: r.y, k: r.zoom() };
  if (r.done) stopReel();
  return f.dt;
}

{
  const btn = $<HTMLButtonElement>('#menu-replay');
  const label = () => (btn.textContent = `Ralenti des fins de manche : ${replayOn ? 'oui' : 'non'}`);
  label();
  btn.addEventListener('click', () => {
    replayOn = !replayOn;
    try { localStorage.setItem('tanks.ralenti', replayOn ? '1' : '0'); } catch {}
    if (!replayOn) stopReel();
    label();
  });
}

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
  let rdt = dt;
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
  placeBubbles();
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

async function createRoom(btn: HTMLButtonElement, mode?: Mode) {
  sfx.click();
  btn.disabled = true;
  try {
    const r = await fetch('/api/new').then((r) => r.json() as Promise<{ room: string }>);
    wantMode = mode;
    connect(r.room);
    show('lobby');
  } catch {
    toast('Serveur injoignable');
  } finally {
    btn.disabled = false;
  }
}
$('#btn-create').addEventListener('click', () => createRoom($<HTMLButtonElement>('#btn-create')));
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
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { if (treeOpen) { treeReady(); return; } toggleMenu(); }
  if (e.code === 'KeyM' && (e.target as HTMLElement)?.tagName !== 'INPUT') updateMusicBtn(toggleMusic());
});
function updateMusicBtn(on = isMusicOn()) {
  $('#btn-music').textContent = on ? '♪' : '♪̸';
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
  ['white', 'invisible ! seules ses traces le trahissent'],
  ['black', 'le plus rapide de tous, fusées sans rebond'],
  ['steel', 'son blindage encaisse un coup, puis il s’énerve'],
  ['mason', 'bâtit des murs de liège entre toi et lui'],
  ['thief', 'file voler les caisses bonus avant toi'],
  ['rampart', 'son bouclier renvoie les obus : prends-le de côté'],
  ['magnet', 'son champ avale les obus et te les renvoie : tire quand il s’éteint'],
  ['frost', 'patine et givre le sol derrière lui : là, tout le monde dérape'],
  ['boss', 'boss : salves d’obus tout autour de lui'],
  ['drill', 'boss : creuse sous la table et jaillit sous toi'],
  ['thunder', 'boss : appelle la foudre sur ta tête'],
  ['sower', 'boss : sème des graines géantes qui explosent'],
];
// the crates (iteration 29): what each bonus does, in its colour
const CRATES: [BonusKind, string][] = [
  ['shield', 'une bulle encaisse un coup à ta place'],
  ['bounce', 'tes obus rebondissent une fois de plus'],
  ['turbo', 'tes chenilles vont bien plus vite'],
  ['fan', 'trois obus d’un coup, en éventail'],
  ['freeze', 'tous tes adversaires gèlent sur place, pris dans un cube de glace'],
  ['heavy', 'de gros obus qui traversent le liège et brisent les obus d’en face'],
];
$('#crates-list').innerHTML = CRATES.map(([k, line]) => `<li style="--c:${hex(BONUS_INFO[k].color)}"><span><b>${escapeHtml(BONUS_INFO[k].label)}</b> : ${escapeHtml(line)}</span></li>`).join('');
$('#bestiary-list').innerHTML = BESTIARY.map(([k, line]) => `<li class="${isBossKind(k) ? 'boss' : ''}" style="--c:${hex(enemyColor(k))}"><span><b>${escapeHtml(specOf(k).label)}</b> : ${escapeHtml(line)}</span></li>`).join('');
$('#iteration-stamp').textContent = `Itération ${META.iteration}`;
$('#iteration-stamp').title = META.title;
$('#btn-journal').addEventListener('click', () => { renderJournal(); $('#journal').hidden = false; sfx.click(); });
$('#btn-journal-close').addEventListener('click', () => ($('#journal').hidden = true));

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
        scores: online && (currentMode === 'versus' || currentMode === 'drapeau') ? scores : undefined,
        teams: online && currentMode === 'drapeau' ? teamScores : undefined,
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
    return { screen, phase, online, replays, replaying: !!reel, snaps: snaps.length, latestK, myTankId, room: roomCode, iteration: META.iteration, attract: attractState, mole: myRole, lives, mission: currentMission, council, belts: belts.filter(Boolean).length, ice: belts.filter((b) => b === ICE).length, slide: Math.hypot(pred.vx, pred.vy), pred: { x: pred.x + offset.x, y: pred.y + offset.y }, tanks: infos.size, moved: debugMoved(), galons: prog[pid], tree: treeOpen, rallies, bubbles: bubblesShown, emoteBtn: !$('#hud-emote').hidden, rallyBtn: !$('#hud-rally').hidden, ctf: currentMode === 'drapeau' ? { bases: !!ctfBases, team: myTeam, flags: snaps[snaps.length - 1]?.F.length ?? 0, teams: teamScores, board: $('#scoreboard').children.length } : undefined, rush: currentMode === 'rush' && rushState ? { stage: rushState.stage, bosses: rushState.bosses, clock: !$('#hud-clock').hidden, bar: !$('#boss-bar').hidden } : undefined };
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
    drapeau(round = 0, levels?: number[], arms?: Weapon[], chain = true, carry = false) {
      show('game');
      attract = undefined;
      startAttract({ drapeau: { round, levels, chain, carry }, arms: arms?.filter(isWeapon) });
      return ctfArena(round).name;
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
    /** Show a versus lobby (or, iteration 20, a coop one) with a player and AI tanks for a moment, the host adding them one by one (for the videos). */
    rivals(ms = 6000, mode: Mode = 'versus') {
      const keep = { players: lobbyPlayers, mode: lobbyMode, room: roomCode, phase };
      const me: PlayerInfo = { id: pid, name: myName, color: PLAYER_COLORS[0], host: true, connected: true, score: 0, weapon: myWeapon };
      const bots: PlayerInfo[] = [0, 1, 2].map((i) => ({ id: `ia:${i + 1}`, name: RIVAL_NAMES[i * 3], color: PLAYER_COLORS[i + 1], host: false, connected: true, score: 0, weapon: VS_ARMS[i], bot: i }));
      lobbyPlayers = [me];
      lobbyMode = mode === 'coop' || mode === 'drapeau' ? mode : 'versus';
      roomCode = 'SOLO7';
      phase = 'lobby';
      renderLobby();
      show('lobby');
      const step = Math.max(600, ms / 5);
      bots.forEach((b, i) => setTimeout(() => { lobbyPlayers = [...lobbyPlayers, b]; renderLobby(); sfx.click(); }, step * (i + 0.6)));
      setTimeout(() => {
        lobbyPlayers = keep.players; lobbyMode = keep.mode; roomCode = keep.room; phase = keep.phase;
        show('game');
        if (attractOpts.versus) renderVsBoard(); else if (attractOpts.drapeau) renderCtfBoard(); else $('#hud').hidden = true;
      }, ms);
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
      if (twist) for (let k = 0; k < 7 && dailyTwist(day) !== twist; k++) day++;
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
      attract = undefined; // the table behind stays still: all the machine's time goes to the painting
      openWorkshop();
      workshop.animate(a, ms);
      return a.name;
    },
    /** The showcase mission of the workshop. */
    atelierSample: () => ({ ...ATELIER_SAMPLE, map: ATELIER_SAMPLE.map.slice() }),
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
    /** Show the home screen with its bestiary open for a moment (iteration 25). */
    bestiary(ms = 5000) {
      const d = $('#bestiary') as HTMLDetailsElement;
      d.open = true;
      show('home');
      const list = $('#bestiary-list');
      list.scrollTop = 0;
      const home = $('#home');
      requestAnimationFrame(() => (home.scrollTop = home.scrollHeight)); // the bestiary sits at the bottom of the card
      const roll = setInterval(() => (list.scrollTop += 1), 30);
      setTimeout(() => { clearInterval(roll); d.open = false; home.scrollTop = 0; show('game'); $('#hud').hidden = true; }, ms);
    },
    /** Show the home screen with its list of crates open for a moment (iteration 29). */
    crates(ms = 5000) {
      const d = $('#crates-help') as HTMLDetailsElement;
      d.open = true;
      show('home');
      const home = $('#home');
      requestAnimationFrame(() => (home.scrollTop = home.scrollHeight));
      setTimeout(() => { d.open = false; home.scrollTop = 0; show('game'); $('#hud').hidden = true; }, ms);
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
    /** A hero fires straight into each Rempart's shield (to catch the shell bouncing back on camera). */
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
