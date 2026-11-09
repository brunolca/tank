import { DurableObject } from 'cloudflare:workers';
import META from '../shared/meta.json';
import { BOSS_HP_PER_PLAYER, DT, PLAYER_COLORS, SETTLE_MAX, TankKind, Weapon, isCheckpoint, isWeapon } from '../shared/constants';
import { ATELIER_LIVES, atelierLevel, checkAtelier, cleanName } from '../shared/atelier';
import { applyTwist, DAILY_LIVES, DAILY_STAGES, dailyLevel, dailyTwist, dayNumber } from '../shared/daily';
import { getMission, nearestFree, versusArena, type ParsedLevel } from '../shared/levels';
import type { AtelierMap, BoardDay, ClientMsg, DailyState, Input, Mode, Phase, PlayerInfo, Results, ServerMsg } from '../shared/protocol';
import { Game } from '../shared/sim';
import { MAX_RIVALS, RIVAL_LEVELS, RIVAL_NAMES, RIVAL_PREFIX, isRivalId, makeRival, randomWeapon, rivalMode } from '../shared/rivals';
import { canBuy, canBuyAny, killXp, startGalons, TRAINING_SECONDS, XP_CLEAR, XP_PER_GALON, type Progress } from '../shared/skills';
import { CTF_ROUND, CTF_TARGET, TEAM_NAMES, TEAM_TANK_COLORS, ctfArena, ctfTeam, newFlags } from '../shared/drapeau';
import { COUNCIL_SECONDS, councilVerdict, TAUPE_LIVES, TAUPE_MIN_PLAYERS, TAUPE_STAGES, taupeLevel, VERDICT_SECONDS, type CouncilState, type TaupeResult } from '../shared/taupe';

interface Attachment {
  pid: string;
  name: string;
  color: number;
  joined: number;
  weapon?: Weapon;
  v?: number; // the client's iteration (sent in the socket URL from iteration 10; absent for older tabs)
}

interface Player extends Attachment {
  ws?: WebSocket;
  queue: Input[];
  last: Input;
  ack: number;
  score: number;
  kills: Partial<Record<TankKind, number>>;
  deaths: number;
  ff: number; // teammates destroyed (coop-like modes)
  inGame: boolean;
  prog?: Progress; // coop campaign (iteration 19): experience, galons and skills, for this run
  galonBase: number; // galons given at the start (checkpoint head start)
}

/** An AI rival of the versus mode (iteration 17): scored like a player, driven by the shared AI. */
interface Rival {
  pid: string;
  name: string;
  color: number;
  level: number;
  weapon: Weapon;
  score: number;
  kills: Partial<Record<TankKind, number>>;
  deaths: number;
}
type StoredRival = Pick<Rival, 'pid' | 'name' | 'color' | 'level' | 'weapon'>;

const MAX_PLAYERS = 4;
const VERSUS_TARGET = 5;
/** Modes played in rounds between players and rivals: free-for-all versus, and « Drapeaux » in two teams (iteration 24). */
const pvp = (m: Mode) => m === 'versus' || m === 'drapeau';
const EMPTY_INPUT: Input = { s: 0, mx: 0, my: 0, a: 0, f: 0, m: 0 };

export class Room extends DurableObject<Env> {
  private players = new Map<string, Player>();
  private lastOrder = new Map<string, number>(); // « Suis-moi ! »: when each player last called (iteration 20)
  private rivals: Rival[] = []; // versus rivals (iteration 17) and coop teammates (iteration 20); cleared when the host picks another mode
  private mode: Mode = 'coop';
  private phase: Phase = 'lobby';
  private game?: Game;
  private level?: ParsedLevel;
  private mission = 1;
  private from = 1; // coop: checkpoint the campaign starts at
  private settle = -1; // seconds spent waiting for the last shells once a mission/round is decided (-1: not decided)
  private lives = 3;
  private round = 0;
  private killedEnemies = new Set<number>(); // enemy indices destroyed in current mission (persist across retries)
  private enemyIndexByTank = new Map<number, number>();
  private enemyHp = new Map<number, number>(); // damage dealt to tough enemies (the boss) sticks across retries
  private phaseTimer = 0;
  private day = 0; // daily challenge: the day the run started (it keeps it past midnight)
  private runTicks = 0; // daily challenge: ticks spent fighting
  private board?: BoardDay; // daily challenge: the board once the run is over
  private mole?: string; // mole mode: pid of the hidden saboteur
  private taupeSeed = 0; // mole mode: seed of the stages
  private council?: CouncilState; // mole mode: the vote in progress (or its verdict)
  private votes: Record<string, string> = {}; // mole mode: secret ballots of the council in progress
  private taupeEnd?: TaupeResult; // mole mode: outcome, once the game is over
  private atelier?: AtelierMap; // workshop mode (iteration 14): the mission the host drew, already checked
  private atelierWon = false;
  private teams: [number, number] = [0, 0]; // « Drapeaux »: rounds won by the Bleus and the Rouges
  private caps = new Map<string, number>(); // « Drapeaux »: flags each entrant brought home
  private bases?: [number, number][]; // « Drapeaux »: the bases of the round
  private roundWin = 0; // « Drapeaux »: the team that took the last round
  private training = new Set<string>(); // coop, end of a mission: players still picking skills (iteration 19)
  private loop?: ReturnType<typeof setInterval>;
  private roomCode = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // rehydrate after hibernation (lobby only: games keep the object awake through the interval)
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att) this.players.set(att.pid, this.makePlayer(att, ws));
    }
    ctx.blockConcurrencyWhile(async () => {
      this.mode = (await ctx.storage.get<Mode>('mode')) ?? 'coop';
      this.roomCode = (await ctx.storage.get<string>('code')) ?? '';
      this.atelier = await ctx.storage.get<AtelierMap>('atelier');
      const stored = (await ctx.storage.get<StoredRival[]>('rivals')) ?? [];
      this.rivals = rivalMode(this.mode) ? stored.slice(0, MAX_RIVALS).map((r) => ({ ...r, score: 0, kills: {}, deaths: 0 })) : [];
    });
  }

  private makePlayer(att: Attachment, ws?: WebSocket): Player {
    return { ...att, ws, queue: [], last: { ...EMPTY_INPUT }, ack: 0, score: 0, kills: {}, deaths: 0, ff: 0, inGame: false, galonBase: 0 };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const asked = (url.searchParams.get('pid') ?? '').slice(0, 64);
    const pid = asked && !isRivalId(asked) ? asked : crypto.randomUUID(); // rival ids are the room's own
    const code = url.searchParams.get('room') ?? '';
    if (code && !this.roomCode) {
      this.roomCode = code;
      await this.ctx.storage.put('code', code);
    }
    const existing = this.players.get(pid);
    if (!existing && this.connectedCount() >= MAX_PLAYERS) {
      return new Response('room full', { status: 403 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const v = Math.floor(Number(url.searchParams.get('v'))) || undefined;
    const att: Attachment = existing
      ? { pid, name: existing.name, color: existing.color, joined: existing.joined, weapon: existing.weapon, v }
      : { pid, name: 'Joueur', color: this.freeColor(), joined: Date.now(), v };
    server.serializeAttachment(att);
    if (existing) {
      try { existing.ws?.close(4000, 'replaced'); } catch {}
      existing.ws = server;
      existing.v = v;
      // a reloaded tab numbers its inputs from 1 again: forget the old count, or every input would be ignored
      // as already seen (players found their tank frozen after reloading mid-game)
      existing.ack = 0;
      existing.queue = [];
    } else {
      this.players.set(pid, this.makePlayer(att, server));
    }
    // a newcomer takes the seat of a rival (in the lobby; during a game, they watch and the rival leaves afterwards)
    if (this.phase === 'lobby') this.trimRivals();
    this.send(server, { t: 'welcome', id: pid, room: this.roomCode, v: META.iteration });
    // a tab opened before iteration 10 does not say its version: tell it to reload (it shows errors as a message)
    if (!v) this.send(server, { t: 'error', msg: 'Une nouvelle version de Tanks! est en ligne : recharge la page.' });
    this.broadcastLobby();
    if (this.game && this.level) this.sendLevel(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private saveAttachment(p: Player, ws: WebSocket) {
    ws.serializeAttachment({ pid: p.pid, name: p.name, color: p.color, joined: p.joined, weapon: p.weapon, v: p.v } satisfies Attachment);
  }

  private connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.ws) n++;
    return n;
  }

  private freeColor() {
    const used = new Set([...this.players.values(), ...this.rivals].map((p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  }

  private playerFor(ws: WebSocket): Player | undefined {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    let p = this.players.get(att.pid);
    if (!p) {
      p = this.makePlayer(att, ws);
      this.players.set(att.pid, p);
    }
    p.ws = ws;
    return p;
  }

  private hostId(): string | undefined {
    let best: Player | undefined;
    for (const p of this.players.values()) if (p.ws && (!best || p.joined < best.joined)) best = p;
    return best?.pid;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    const p = this.playerFor(ws);
    if (!p) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.t) {
      case 'hello': {
        p.name = String(msg.name ?? '').trim().slice(0, 16) || 'Joueur';
        const wanted = Number(msg.color);
        const taken = [...this.players.values()].some((o) => o !== p && o.ws && o.color === wanted);
        if (PLAYER_COLORS.includes(wanted) && !taken) {
          p.color = wanted;
          // a rival wearing that colour hands it over (it only wears it to tell the tanks apart)
          for (const r of this.rivals) if (r.color === wanted) r.color = this.freeColor();
          void this.saveRivals();
        }
        this.saveAttachment(p, ws);
        this.broadcastLobby();
        break;
      }
      case 'arm':
        if (isWeapon(msg.w)) {
          p.weapon = msg.w;
          this.saveAttachment(p, ws);
          this.broadcastLobby();
        }
        break;
      case 'from':
        if (p.pid === this.hostId() && this.phase === 'lobby' && isCheckpoint(Number(msg.n))) {
          this.from = Number(msg.n);
          this.broadcastLobby();
        }
        break;
      case 'mode':
        if (p.pid === this.hostId() && this.phase === 'lobby' && (msg.mode === 'coop' || msg.mode === 'versus' || msg.mode === 'daily' || msg.mode === 'taupe' || msg.mode === 'atelier' || msg.mode === 'drapeau')) {
          this.mode = msg.mode;
          if (!rivalMode(this.mode)) this.rivals = [];
          await this.ctx.storage.put('mode', this.mode);
          await this.saveRivals();
          this.broadcastLobby();
        }
        break;
      case 'atelier': {
        if (p.pid !== this.hostId() || this.phase !== 'lobby') break;
        const why = checkAtelier(msg.map);
        if (why) { this.send(ws, { t: 'error', msg: `Atelier : ${why}` }); break; }
        this.atelier = { name: cleanName(msg.name) || 'Mission maison', map: (msg.map as string[]).slice(), night: msg.night === true || undefined, storm: msg.storm === true || undefined, wind: msg.wind === true || undefined, fog: msg.fog === true || undefined };
        this.mode = 'atelier';
        this.rivals = [];
        void this.saveRivals();
        await this.ctx.storage.put('atelier', this.atelier);
        await this.ctx.storage.put('mode', this.mode);
        this.broadcastLobby();
        break;
      }
      case 'rival':
        if (p.pid === this.hostId() && this.phase === 'lobby' && rivalMode(this.mode)) this.onRival(msg.op, String(msg.id ?? ''));
        break;
      case 'skill':
        this.onSkill(p, Math.floor(Number(msg.b)));
        break;
      case 'order': {
        // « Suis-moi ! » (iteration 20): the AI teammates come to the caller's tank (once a second at most)
        if (this.mode !== 'coop' || this.phase !== 'playing' || !this.game) break;
        const now = Date.now();
        if (now - (this.lastOrder.get(p.pid) ?? 0) < 1000) break;
        this.lastOrder.set(p.pid, now);
        const me = this.game.tanks.find((t) => t.pid === p.pid && t.alive);
        if (me) this.game.rally(me);
        break;
      }
      case 'vote':
        this.onVote(p, String(msg.who ?? ''));
        break;
      case 'start':
        if (p.pid === this.hostId() && this.phase === 'lobby') this.startGame();
        break;
      case 'stop':
        if (p.pid === this.hostId() && this.phase !== 'lobby') this.endToLobby();
        break;
      case 'in':
        if (Array.isArray(msg.i)) {
          for (const i of msg.i.slice(0, 8)) {
            if (typeof i?.s !== 'number' || i.s <= p.ack || p.queue.some((q) => q.s === i.s)) continue;
            p.queue.push({
              s: i.s,
              mx: clamp(+i.mx || 0, -1, 1),
              my: clamp(+i.my || 0, -1, 1),
              a: Number.isFinite(+i.a) ? +i.a : 0,
              f: i.f ? 1 : 0,
              m: i.m ? 1 : 0,
            });
          }
          p.queue.sort((a, b) => a.s - b.s);
        }
        break;
      case 'ping':
        this.send(ws, { t: 'pong', c: msg.c });
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.dropSocket(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch {}
  }

  async webSocketError(ws: WebSocket) {
    this.dropSocket(ws);
  }

  private dropSocket(ws: WebSocket) {
    for (const p of this.players.values()) {
      if (p.ws === ws) {
        p.ws = undefined;
        // drop the player for good if they are not part of a running game
        if (!p.inGame || this.phase === 'lobby') this.players.delete(p.pid);
      }
    }
    if (this.connectedCount() === 0) {
      this.stopLoop();
      this.phase = 'lobby';
      this.game = undefined;
      this.players.clear();
      return;
    }
    this.broadcastLobby();
  }

  // ---------------------------------------------------------------- versus rivals (iteration 17)

  private onRival(op: string, id: string) {
    if (op === 'add') {
      if (this.rivals.length >= MAX_RIVALS || this.connectedCount() + this.rivals.length >= MAX_PLAYERS) return;
      const taken = new Set([...[...this.players.values()].map((p) => p.name), ...this.rivals.map((r) => r.name)]);
      const names = RIVAL_NAMES.filter((n) => !taken.has(n));
      const name = names[Math.floor(Math.random() * names.length)] ?? `Robot ${this.rivals.length + 1}`;
      let k = 1;
      while (this.rivals.some((r) => r.pid === RIVAL_PREFIX + k)) k++;
      // a new rival copies the level of the last one (the host usually wants them all alike)
      const level = this.rivals.length ? this.rivals[this.rivals.length - 1].level : 1;
      this.rivals.push({ pid: RIVAL_PREFIX + k, name, color: this.freeColor(), level, weapon: randomWeapon(), score: 0, kills: {}, deaths: 0 });
    } else if (op === 'del') {
      this.rivals = this.rivals.filter((r) => r.pid !== id);
    } else if (op === 'lvl') {
      const r = this.rivals.find((o) => o.pid === id);
      if (r) r.level = (r.level + 1) % RIVAL_LEVELS.length;
    } else return;
    void this.saveRivals();
    this.broadcastLobby();
  }

  /** Never more than 4 tanks: rivals give their seat to players. */
  private trimRivals() {
    const room = Math.max(0, MAX_PLAYERS - this.connectedCount());
    if (this.rivals.length > room) {
      this.rivals = this.rivals.slice(0, room);
      void this.saveRivals();
    }
  }

  private async saveRivals() {
    const list: StoredRival[] = this.rivals.map(({ pid, name, color, level, weapon }) => ({ pid, name, color, level, weapon }));
    try { await this.ctx.storage.put('rivals', list); } catch {}
  }

  /** A player or a rival, by id (scores, kills and round wins are counted the same way). */
  private entrant(pid: string | undefined): { score: number; kills: Partial<Record<TankKind, number>>; deaths: number; name: string } | undefined {
    if (!pid) return undefined;
    return this.players.get(pid) ?? this.rivals.find((r) => r.pid === pid);
  }

  /** The AI tanks that play this mode: rivals in versus, teammates in the coop campaign (iteration 20). */
  private versusRivals() {
    return rivalMode(this.mode) ? this.rivals : [];
  }

  // ---------------------------------------------------------------- game flow

  private startGame() {
    const active = [...this.players.values()].filter((p) => p.ws);
    if (pvp(this.mode) && active.length + this.versusRivals().length < 2) {
      for (const p of active) this.send(p.ws!, { t: 'error', msg: this.mode === 'drapeau' ? 'Il faut au moins 2 tanks pour jouer aux drapeaux : invite un ami ou ajoute un rival.' : 'Il faut au moins 2 tanks pour le mode versus : invite un ami ou ajoute un rival.' });
      return;
    }
    if (this.mode === 'atelier' && !this.atelier) {
      for (const p of active) this.send(p.ws!, { t: 'error', msg: 'L’hôte doit d’abord dessiner une mission dans l’atelier.' });
      return;
    }
    if (this.mode === 'taupe' && active.length < TAUPE_MIN_PLAYERS) {
      for (const p of active) this.send(p.ws!, { t: 'error', msg: `Il faut au moins ${TAUPE_MIN_PLAYERS} joueurs pour démasquer une taupe.` });
      return;
    }
    for (const p of this.players.values()) {
      p.score = 0; p.kills = {}; p.deaths = 0; p.ff = 0; p.inGame = !!p.ws;
      p.prog = undefined; // the skill tree starts over with every campaign
    }
    this.training.clear();
    for (const r of this.rivals) { r.score = 0; r.kills = {}; r.deaths = 0; }
    this.mission = this.mode === 'coop' ? this.from : 1;
    this.lives = this.mode === 'daily' ? DAILY_LIVES : this.mode === 'taupe' ? TAUPE_LIVES : this.mode === 'atelier' ? ATELIER_LIVES : 3;
    this.atelierWon = false;
    this.mole = this.mode === 'taupe' ? active[Math.floor(Math.random() * active.length)].pid : undefined;
    this.taupeSeed = (Math.random() * 2 ** 31) >>> 0;
    this.council = undefined;
    this.taupeEnd = undefined;
    this.round = 0;
    this.teams = [0, 0];
    this.caps.clear();
    this.day = dayNumber();
    this.runTicks = 0;
    this.board = undefined;
    this.killedEnemies.clear();
    this.enemyHp.clear();
    this.loadStage();
    this.startLoop();
  }

  private loadStage() {
    const participants = [...this.players.values()].filter((p) => p.ws).sort((a, b) => a.joined - b.joined);
    for (const p of participants) {
      p.inGame = true;
      if (this.mode === 'coop' && !p.prog) {
        // a newcomer to the campaign (at the start, or joining later): the head start of the mission they arrive at
        p.galonBase = startGalons(this.mission);
        p.prog = { xp: 0, g: p.galonBase, r: [0, 0, 0] };
      }
    }
    this.training.clear();
    this.level = this.mode === 'coop' ? getMission(this.mission)
      : this.mode === 'daily' ? dailyLevel(this.day, this.mission)
      : this.mode === 'taupe' ? taupeLevel(this.taupeSeed, this.mission)
      : this.mode === 'atelier' && this.atelier ? atelierLevel(this.atelier)
      : this.mode === 'drapeau' ? ctfArena(this.round)
      : versusArena(this.round);
    this.bases = this.mode === 'drapeau' ? (this.level as ReturnType<typeof ctfArena>).bases : undefined;
    this.council = undefined;
    const game = new Game(this.level.tiles, this.level.belts);
    const spawns = this.level.spawns.slice();
    const used: [number, number][] = [];
    const rivals = this.versusRivals().slice(0, Math.max(0, MAX_PLAYERS - participants.length));
    const entrants: { pid: string; name: string; color: number; weapon?: Weapon; rival?: number; player?: Player }[] = [
      ...participants.map((p) => ({ pid: p.pid, name: p.name, color: p.color, weapon: p.weapon, player: p })),
      ...rivals.map((r) => ({ pid: r.pid, name: r.name, color: r.color, weapon: r.weapon, rival: r.level })),
    ];
    entrants.forEach((p, i) => {
      let pos: [number, number];
      if (spawns[i]) pos = spawns[i];
      else {
        const base = spawns[i % Math.max(1, spawns.length)] ?? [2.5, 8.5];
        pos = nearestFree(this.level!.tiles, Math.floor(base[0]), Math.floor(base[1]) + (i >= 2 ? 2 : -2), [...spawns, ...used]);
      }
      used.push(pos);
      const team = this.mode === 'versus' ? i + 1 : this.mode === 'drapeau' ? ctfTeam(i) : 0;
      // « Drapeaux »: tanks wear their team's colours (blue and cyan, red and orange)
      const color = this.mode === 'drapeau' ? TEAM_TANK_COLORS[team - 1][Math.floor(i / 2) % 2] : p.color;
      const t = game.addTank('player', team, pos[0], pos[1], color, p.pid, p.name);
      game.arm(t, p.weapon ?? 'canon');
      if (this.mode === 'coop' && p.player?.prog) game.train(t, p.player.prog.r);
      if (pvp(this.mode)) {
        t.body = t.turret = Math.atan2(8.5 - pos[1], 11 - pos[0]);
      }
      if (p.rival !== undefined) {
        makeRival(game, t, p.rival);
      }
      if (p.player) {
        p.player.queue = [];
        p.player.last = { ...EMPTY_INPUT, a: t.turret };
      }
    });
    this.enemyIndexByTank.clear();
    this.level.enemies.forEach((e, idx) => {
      if (this.killedEnemies.has(idx)) return;
      const t = game.addTank(e.kind, 99, e.x, e.y, 0);
      if (t.maxHp > 1) {
        // only the boss grows tougher with a crowd; steel tanks always have their two hits
        const max = t.boss ? t.maxHp + BOSS_HP_PER_PLAYER * Math.max(0, participants.length + rivals.length - 1) : t.maxHp; // teammates count too
        game.setHp(t, this.enemyHp.get(idx) ?? max, max);
      }
      this.enemyIndexByTank.set(t.id, idx);
    });
    game.bonusOn = true;
    game.night = !!this.level.night;
    game.storm = !!this.level.storm;
    game.wind = this.level.wind;
    game.fog = this.level.fog;
    if (pvp(this.mode)) { game.bonusNext = 5; game.bonusEvery = [8, 12]; }
    if (this.bases) game.flags = newFlags(this.bases);
    if (this.mode === 'daily') applyTwist(game, dailyTwist(this.day));
    game.onKill = (victim, killer) => this.onKill(victim, killer);
    this.game = game;
    this.setPhase('intro', 3);
    this.lastEnemyCount = -1;
    this.settle = -1;
    for (const p of this.players.values()) if (p.ws) this.sendLevel(p.ws);
  }

  private sendLevel(ws: WebSocket) {
    if (!this.game || !this.level) return;
    const att = ws.deserializeAttachment() as Attachment | null;
    let tanks = this.game.tankInfos();
    // tabs older than iteration 10 don't know the steel tank: they draw a grey one instead of crashing
    if (!att?.v) tanks = tanks.map((t) => (t.kind === 'steel' || t.kind === 'mason' || t.kind === 'thief' || t.kind === 'rampart' ? { ...t, kind: 'ash' } : t.kind === 'drill' || t.kind === 'thunder' || t.kind === 'sower' ? { ...t, kind: 'boss' } : t));
    // and tabs older than iteration 22 draw the Rempart as a plain grey tank (without its shield)
    else if (att.v < 22) tanks = tanks.map((t) => (t.kind === 'rampart' ? { ...t, kind: 'ash' } : t.kind === 'sower' ? { ...t, kind: 'boss' } : t));
    // tabs older than iteration 25 draw the Semeur as a Colosse (its seeds look like plain mines to them)
    else if (att.v < 25) tanks = tanks.map((t) => (t.kind === 'sower' ? { ...t, kind: 'boss' } : t));
    this.send(ws, {
      t: 'level',
      mode: this.mode,
      mission: pvp(this.mode) ? this.round + 1 : this.mission,
      name: this.mode === 'versus' ? `Manche ${this.round + 1}` : this.level.name,
      tiles: this.game.tiles,
      tanks,
      lives: this.lives,
      tick: this.game.tick,
      night: this.level.night ? 1 : undefined,
      storm: this.level.storm ? 1 : undefined,
      wind: this.level.wind,
      fog: this.level.fog,
      belts: this.game.belts.length ? this.game.belts : undefined,
      daily: this.dailyState(),
      bases: this.bases?.flat(),
    });
    if (this.mode === 'taupe') {
      this.send(ws, { t: 'role', mole: !!att && att.pid === this.mole });
    }
    this.send(ws, this.phaseMsg());
  }

  private onKill(victim: { pid?: string; kind: TankKind; id: number; team: number; x: number; y: number }, killer?: { pid?: string; team: number; id: number }) {
    if (victim.pid) {
      const vp = this.entrant(victim.pid);
      if (vp) vp.deaths++;
      if (killer?.pid && !pvp(this.mode)) {
        // friendly fire is public: everyone sees who hit whom (the mole has to make it look like an accident)
        this.game?.events.push(['ff', +victim.x.toFixed(2), +victim.y.toFixed(2), victim.id, killer.id]);
        const kp = this.players.get(killer.pid);
        if (kp && killer.pid !== victim.pid) kp.ff++;
      }
    } else {
      const idx = this.enemyIndexByTank.get(victim.id);
      if (idx !== undefined) this.killedEnemies.add(idx);
    }
    if (killer?.pid) {
      const kp = this.entrant(killer.pid);
      const coop = !pvp(this.mode);
      const mate = this.mode === 'drapeau' && killer.team === victim.team; // a teammate's shell: no trophy
      if (kp && killer.pid !== victim.pid && !(coop && victim.pid) && !mate) {
        const key: TankKind = victim.kind;
        kp.kills[key] = (kp.kills[key] ?? 0) + 1;
        if (coop) kp.score++;
        if (this.mode === 'coop') this.addXp(this.players.get(killer.pid), killXp(victim.kind));
      }
    }
  }

  // ---------------------------------------------------------------- coop campaign: experience and skill tree (iteration 19)

  private addXp(p: Player | undefined, n: number) {
    if (!p?.prog) return;
    p.prog.xp += n;
    p.prog.g = p.galonBase + Math.floor(p.prog.xp / XP_PER_GALON);
  }

  /** Buy the next rank of a branch (b = 0 to 2), or say « ready » (b = -1) at the end of a mission. Effective from the next mission. */
  private onSkill(p: Player, b: number) {
    if (this.mode !== 'coop' || this.phase === 'lobby' || this.phase === 'gameover' || !p.inGame || !p.prog) return;
    if (b >= 0 && b <= 2) {
      if (!canBuy(p.prog, b)) return;
      p.prog.r[b]++;
      if (!canBuyAny(p.prog)) this.training.delete(p.pid);
    } else if (b === -1) this.training.delete(p.pid);
    else return;
    if (this.phase === 'cleared' && !this.training.size) this.phaseTimer = Math.min(this.phaseTimer, 0.8);
    this.broadcastPhase();
  }

  /** A mission cleared: everyone in it gets a little experience, then those with galons to spend get time to choose. */
  private clearedTraining(): number {
    if (this.mode !== 'coop') return 3.5;
    for (const p of this.players.values()) if (p.inGame) this.addXp(p, XP_CLEAR);
    this.training.clear();
    for (const p of this.players.values()) if (p.inGame && p.ws && p.prog && canBuyAny(p.prog)) this.training.add(p.pid);
    return this.training.size ? TRAINING_SECONDS : 3.5;
  }

  private progress(): Record<string, Progress> | undefined {
    if (this.mode !== 'coop' || this.phase === 'lobby') return undefined;
    const out: Record<string, Progress> = {};
    for (const p of this.players.values()) if (p.prog) out[p.pid] = p.prog;
    return out;
  }

  private setPhase(phase: Phase, seconds: number) {
    this.phase = phase;
    this.phaseTimer = seconds;
    if (this.game) this.game.frozen = phase !== 'playing';
  }

  private phaseMsg(): ServerMsg {
    const scores: Record<string, number> = {};
    for (const p of this.players.values()) scores[p.pid] = p.score;
    if (this.game) for (const r of this.versusRivals()) scores[r.pid] = r.score;
    return {
      t: 'phase',
      phase: this.phase,
      mission: pvp(this.mode) ? this.round + 1 : this.mission,
      lives: this.lives,
      enemies: this.game ? this.game.aliveCount(99) : 0,
      scores,
      results: this.phase === 'gameover' ? this.results() : undefined,
      daily: this.dailyState(),
      council: this.council && this.phase === 'council' ? { ...this.council, left: Math.max(0, +this.phaseTimer.toFixed(1)) } : undefined,
      stages: this.mode === 'taupe' ? TAUPE_STAGES : undefined,
      prog: this.progress(),
      training: this.phase === 'cleared' && this.training.size ? [...this.training] : undefined,
      teams: this.mode === 'drapeau' ? [this.teams[0], this.teams[1]] : undefined,
      win: this.mode === 'drapeau' && this.phase === 'roundEnd' ? this.roundWin : undefined,
      left: this.mode === 'drapeau' && this.game ? Math.max(0, +(CTF_ROUND - this.game.ctfTime).toFixed(1)) : undefined,
    };
  }

  private dailyState(): DailyState | undefined {
    if (this.mode !== 'daily') return undefined;
    return { day: this.day, twist: dailyTwist(this.day), stage: this.mission, stages: DAILY_STAGES, ticks: this.runTicks };
  }

  /** Stages cleared in the current daily run. */
  private dailyCleared() {
    return this.phase === 'gameover' && this.lives > 0 ? DAILY_STAGES : this.mission - 1;
  }

  /** End of a daily run (all stages cleared, or no lives left): post it to the board, then show everyone the results. */
  private async finishDaily() {
    this.setPhase('gameover', 14);
    const state = this.dailyState()!;
    const cleared = this.dailyCleared();
    try {
      const board = this.env.BOARD.get(this.env.BOARD.idFromName('daily'));
      const team = [...this.players.values()].filter((p) => p.inGame).sort((a, b) => a.joined - b.joined).map((p) => ({ name: p.name, color: p.color }));
      const res = cleared > 0
        ? await board.submit(state.day, { team, cleared, ticks: this.runTicks, lives: this.lives })
        : await board.get(state.day);
      this.board = res;
    } catch {
      this.board = undefined; // the board is down: results without a rank
    }
    if (this.phase === 'gameover' && this.mode === 'daily') this.broadcastPhase();
  }

  private broadcastPhase() {
    this.broadcast(this.phaseMsg());
  }

  private results(): Results {
    const players = [...this.players.values()]
      .filter((p) => p.inGame)
      .map((p) => ({ id: p.pid, name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, score: p.score, ff: pvp(this.mode) ? undefined : p.ff, g: this.mode === 'coop' ? p.prog?.g : undefined } as Results['players'][number]))
      .concat(this.versusRivals().map((r) => ({ id: r.pid, name: r.name, color: r.color, kills: r.kills, deaths: r.deaths, score: r.score, bot: r.level })))
      .sort((a, b) => b.score - a.score);
    let drapeau: Results['drapeau'];
    if (this.mode === 'drapeau') {
      // each entrant keeps the team and colours of the last round
      for (const pl of players) {
        const t = this.game?.tanks.find((o) => o.pid === pl.id);
        if (t) { pl.team = t.team; pl.color = t.color; }
        pl.caps = this.caps.get(pl.id) ?? 0;
      }
      const winner = this.teams[0] === this.teams[1] ? 0 : this.teams[0] > this.teams[1] ? 1 : 2;
      players.sort((a, b) => (a.team === winner ? 0 : 1) - (b.team === winner ? 0 : 1) || (b.caps ?? 0) - (a.caps ?? 0) || b.score - a.score);
      drapeau = { teams: [this.teams[0], this.teams[1]], winner };
    }
    const daily = this.mode === 'daily' ? { state: this.dailyState()!, cleared: this.dailyCleared(), board: this.board } : undefined;
    const taupe = this.mode === 'taupe' && this.taupeEnd
      ? { ...this.taupeEnd, cleared: this.taupeEnd.why === 'missions' ? TAUPE_STAGES : this.mission - 1, stages: TAUPE_STAGES }
      : undefined;
    const atelier = this.mode === 'atelier' && this.atelier ? { name: this.atelier.name, won: this.atelierWon } : undefined;
    return { mode: this.mode, mission: this.mode === 'drapeau' ? this.round + 1 : this.mission, players, winner: pvp(this.mode) ? players[0]?.id : undefined, daily, taupe, atelier, drapeau };
  }

  private tick() {
    const game = this.game;
    if (!game) return;
    const inputs = new Map<string, Input>();
    for (const p of this.players.values()) {
      let inp: Input;
      if (!p.ws) {
        p.queue = [];
        inputs.set(p.pid, { ...EMPTY_INPUT, a: p.last.a });
        continue;
      }
      if (p.queue.length > 6) {
        // too far behind: merge the backlog, keep one-shot actions
        const drop = p.queue.splice(0, p.queue.length - 2);
        const f = drop.some((d) => d.f), m = drop.some((d) => d.m);
        p.queue[0].f = (p.queue[0].f || f) ? 1 : 0;
        p.queue[0].m = (p.queue[0].m || m) ? 1 : 0;
        p.ack = drop[drop.length - 1].s;
      }
      if (p.queue.length) {
        inp = p.queue.shift()!;
        p.ack = inp.s;
        p.last = inp;
      } else {
        inp = { ...p.last, f: 0, m: 0 };
      }
      if (this.phase !== 'playing' || this.settle >= 0) inp = { ...inp, f: 0, m: 0 }; // cease-fire once the outcome is known
      inputs.set(p.pid, inp);
    }
    game.step(inputs);

    const T = game.netTanks(), B = game.netBullets(), M = game.netMines(), P = game.netBonuses(), F = game.netFlags(), E = game.events;
    game.events = [];
    for (const p of this.players.values()) {
      if (p.ws) this.send(p.ws, { t: 'snap', k: game.tick, a: p.ack, T, B, M, E, P, F });
    }

    this.phaseTimer -= DT;
    if (this.phase === 'playing' && this.mode === 'daily') this.runTicks++;
    switch (this.phase) {
      case 'intro':
        if (this.phaseTimer <= 0) { this.setPhase('playing', 0); this.broadcastPhase(); }
        break;
      case 'playing':
        this.checkEnd(game);
        break;
      case 'cleared':
        if (this.phaseTimer <= 0 && this.mode === 'taupe') {
          if (this.mission >= TAUPE_STAGES) this.finishTaupe('loyaux', 'missions');
          else this.startCouncil('cleared');
          break;
        }
        if (this.phaseTimer <= 0) {
          if (this.mode === 'daily' && this.mission >= DAILY_STAGES) { void this.finishDaily(); break; }
          if (this.mode === 'atelier') { this.atelierWon = true; this.setPhase('gameover', 10); this.broadcastPhase(); break; }
          this.mission++;
          this.killedEnemies.clear();
          this.enemyHp.clear();
          if (this.mode === 'coop' && this.mission % 5 === 1) this.lives++;
          this.loadStage();
        }
        break;
      case 'failed':
        if (this.phaseTimer <= 0) {
          if (this.mode === 'taupe') {
            if (this.lives <= 0) this.finishTaupe('taupe', 'vies');
            else this.startCouncil('failed');
          } else if (this.lives <= 0 && this.mode === 'daily') void this.finishDaily();
          else if (this.lives <= 0) { this.setPhase('gameover', 8); this.broadcastPhase(); }
          else this.loadStage();
        }
        break;
      case 'roundEnd':
        if (this.phaseTimer <= 0) {
          const best = Math.max(...[...this.players.values(), ...this.versusRivals()].map((p) => p.score));
          if (this.mode === 'drapeau' ? Math.max(...this.teams) >= CTF_TARGET : best >= VERSUS_TARGET) { this.setPhase('gameover', 8); this.broadcastPhase(); }
          else { this.round++; this.loadStage(); }
        }
        break;
      case 'council':
        this.councilTick();
        break;
      case 'gameover':
        if (this.phaseTimer <= 0) this.endToLobby();
        break;
    }
  }

  // ---------------------------------------------------------------- mole mode: councils

  private startCouncil(why: 'cleared' | 'failed') {
    const voters = [...this.players.values()].filter((p) => p.inGame && p.ws).sort((a, b) => a.joined - b.joined).map((p) => p.pid);
    this.votes = {};
    this.council = { why, left: COUNCIL_SECONDS, voters, voted: [] };
    this.setPhase('council', COUNCIL_SECONDS);
    this.broadcastPhase();
  }

  private onVote(p: Player, who: string) {
    const c = this.council;
    if (this.phase !== 'council' || !c || c.done || !c.voters.includes(p.pid)) return;
    if (who !== '' && (who === p.pid || !c.voters.includes(who))) return;
    this.votes[p.pid] = who;
    c.voted = c.voters.filter((v) => v in this.votes);
    if (c.voted.length >= c.voters.filter((v) => this.players.get(v)?.ws).length) this.phaseTimer = Math.min(this.phaseTimer, 0.6);
    this.broadcastPhase();
  }

  private councilTick() {
    const c = this.council;
    if (!c) { this.loadStage(); return; }
    if (this.phaseTimer > 0) return;
    if (!c.done) {
      // reveal the ballots and the verdict
      c.done = true;
      c.votes = { ...this.votes };
      c.accused = councilVerdict(c.voters, this.votes);
      c.wasMole = c.accused !== undefined && c.accused === this.mole;
      if (c.accused && !c.wasMole) this.lives--; // a loyal player wrongly accused: the team pays for its suspicion
      this.phaseTimer = VERDICT_SECONDS;
      this.broadcastPhase();
      return;
    }
    if (c.wasMole) { this.finishTaupe('loyaux', 'demasquee'); return; }
    if (this.lives <= 0) { this.finishTaupe('taupe', 'vies'); return; }
    if (c.why === 'cleared') {
      this.mission++;
      this.killedEnemies.clear();
      this.enemyHp.clear();
    }
    this.loadStage();
  }

  private finishTaupe(winner: TaupeResult['winner'], why: TaupeResult['why']) {
    this.taupeEnd = { mole: this.mole, winner, why };
    this.council = undefined;
    this.setPhase('gameover', 14);
    this.broadcastPhase();
  }

  private checkEnd(game: Game) {
    if (this.mode === 'drapeau') { this.checkFlags(game); return; }
    if (this.mode !== 'versus') {
      const playersAlive = game.aliveCount(0);
      const enemiesAlive = game.aliveCount(99);
      if (enemiesAlive === 0) {
        // wait for the last shells (nobody may fire any more), but never forever
        if (this.settle < 0) this.settle = 0;
        this.settle += DT;
        game.storm = false; // the sky calms down once the mission is won (strikes already announced still fall)
        if (game.bullets.length === 0 || this.settle >= SETTLE_MAX) {
          this.setPhase('cleared', this.clearedTraining());
          this.broadcastPhase();
        } else if (this.lastEnemyCount !== 0) this.broadcastPhase();
      } else if (playersAlive === 0) {
        for (const t of game.tanks) {
          const idx = this.enemyIndexByTank.get(t.id);
          if (idx !== undefined && t.alive && t.maxHp > 1) this.enemyHp.set(idx, t.hp);
        }
        this.lives--;
        this.setPhase('failed', 3.5);
        this.broadcastPhase();
      } else if (this.lastEnemyCount !== -1 && this.lastEnemyCount !== enemiesAlive) {
        this.broadcastPhase();
      }
      this.lastEnemyCount = enemiesAlive;
    } else {
      const alive = game.tanks.filter((t) => t.alive);
      if (alive.length <= 1) {
        if (this.settle < 0) this.settle = 0;
        this.settle += DT;
        game.storm = false;
        game.bolts = []; // the last tank standing won't be struck after the fact
      }
      if (alive.length <= 1 && (game.bullets.length === 0 || this.settle >= SETTLE_MAX)) {
        const w = this.entrant(alive[0]?.pid);
        if (w) w.score++;
        this.setPhase('roundEnd', 3.5);
        this.broadcast({ ...(this.phaseMsg() as Extract<ServerMsg, { t: 'phase' }>), text: w ? `${w.name} gagne la manche !` : 'Égalité !' });
      }
    }
  }
  private lastEnemyCount = -1;

  /** « Drapeaux »: a flag brought home takes the round at once (destroyed tanks come back, so only the clock can stop it otherwise). */
  private checkFlags(game: Game) {
    const win = game.ctfWinner;
    if (win) {
      const carrier = game.tanks.find((t) => t.id === game.flags?.find((f) => f.team !== win)?.carrier);
      if (carrier?.pid) this.caps.set(carrier.pid, (this.caps.get(carrier.pid) ?? 0) + 1);
      this.endFlagRound(game, win, carrier?.name ? `${carrier.name} rapporte le drapeau : les ${TEAM_NAMES[win - 1]} gagnent la manche !` : `Les ${TEAM_NAMES[win - 1]} gagnent la manche !`);
      return;
    }
    if (game.ctfTime >= CTF_ROUND) this.endFlagRound(game, 0, 'Temps écoulé : aucun drapeau rapporté, égalité !');
  }

  private endFlagRound(game: Game, win: number, text: string) {
    this.roundWin = win;
    if (win) {
      this.teams[win - 1]++;
      for (const t of game.tanks) if (t.team === win && t.pid) { const e = this.entrant(t.pid); if (e) e.score++; }
    }
    this.setPhase('roundEnd', 4);
    this.broadcast({ ...(this.phaseMsg() as Extract<ServerMsg, { t: 'phase' }>), text });
  }

  private endToLobby() {
    this.stopLoop();
    this.game = undefined;
    this.level = undefined;
    this.phase = 'lobby';
    for (const [id, p] of this.players) {
      p.inGame = false;
      if (!p.ws) this.players.delete(id);
    }
    this.trimRivals();
    this.broadcastPhase();
    this.broadcastLobby();
  }

  private startLoop() {
    this.stopLoop();
    let last = Date.now();
    let acc = 0;
    this.loop = setInterval(() => {
      const now = Date.now();
      acc += Math.min(250, now - last);
      last = now;
      const step = DT * 1000;
      while (acc >= step && this.game) {
        acc -= step;
        this.tick();
      }
    }, 1000 / 60);
  }

  private stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = undefined;
  }

  // ---------------------------------------------------------------- messaging

  private lobbyPlayers(): PlayerInfo[] {
    const host = this.hostId();
    return [...this.players.values()]
      .sort((a, b) => a.joined - b.joined)
      .map((p): PlayerInfo => ({ id: p.pid, name: p.name, color: p.color, host: p.pid === host, connected: !!p.ws, score: p.score, weapon: p.weapon }))
      .concat(this.versusRivals().map((r) => ({ id: r.pid, name: r.name, color: r.color, host: false, connected: true, score: r.score, weapon: r.weapon, bot: r.level })));
  }

  private broadcastLobby() {
    this.broadcast({ t: 'lobby', players: this.lobbyPlayers(), mode: this.mode, phase: this.phase, from: this.from, atelier: this.atelier });
  }

  private broadcast(msg: ServerMsg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (!p.ws) continue;
      try { p.ws.send(s); } catch {}
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
