import { DurableObject } from 'cloudflare:workers';
import { BOSS_HP_PER_PLAYER, DT, PLAYER_COLORS, SETTLE_MAX, TankKind, Weapon, isCheckpoint, isWeapon } from '../shared/constants';
import { applyTwist, DAILY_LIVES, DAILY_STAGES, dailyLevel, dailyTwist, dayNumber } from '../shared/daily';
import { getMission, nearestFree, versusArena, type ParsedLevel } from '../shared/levels';
import type { BoardDay, ClientMsg, DailyState, Input, Mode, Phase, PlayerInfo, Results, ServerMsg } from '../shared/protocol';
import { Game } from '../shared/sim';
import { COUNCIL_SECONDS, councilVerdict, TAUPE_LIVES, TAUPE_MIN_PLAYERS, TAUPE_STAGES, taupeLevel, VERDICT_SECONDS, type CouncilState, type TaupeResult } from '../shared/taupe';

interface Attachment {
  pid: string;
  name: string;
  color: number;
  joined: number;
  weapon?: Weapon;
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
}

const MAX_PLAYERS = 4;
const VERSUS_TARGET = 5;
const EMPTY_INPUT: Input = { s: 0, mx: 0, my: 0, a: 0, f: 0, m: 0 };

export class Room extends DurableObject<Env> {
  private players = new Map<string, Player>();
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
    });
  }

  private makePlayer(att: Attachment, ws?: WebSocket): Player {
    return { ...att, ws, queue: [], last: { ...EMPTY_INPUT }, ack: 0, score: 0, kills: {}, deaths: 0, ff: 0, inGame: false };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const pid = (url.searchParams.get('pid') ?? '').slice(0, 64) || crypto.randomUUID();
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
    const att: Attachment = existing
      ? { pid, name: existing.name, color: existing.color, joined: existing.joined, weapon: existing.weapon }
      : { pid, name: 'Joueur', color: this.freeColor(), joined: Date.now() };
    server.serializeAttachment(att);
    if (existing) {
      try { existing.ws?.close(4000, 'replaced'); } catch {}
      existing.ws = server;
    } else {
      this.players.set(pid, this.makePlayer(att, server));
    }
    this.send(server, { t: 'welcome', id: pid, room: this.roomCode });
    this.broadcastLobby();
    if (this.game && this.level) this.sendLevel(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private saveAttachment(p: Player, ws: WebSocket) {
    ws.serializeAttachment({ pid: p.pid, name: p.name, color: p.color, joined: p.joined, weapon: p.weapon } satisfies Attachment);
  }

  private connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.ws) n++;
    return n;
  }

  private freeColor() {
    const used = new Set([...this.players.values()].map((p) => p.color));
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
        if (PLAYER_COLORS.includes(wanted) && !taken) p.color = wanted;
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
        if (p.pid === this.hostId() && this.phase === 'lobby' && (msg.mode === 'coop' || msg.mode === 'versus' || msg.mode === 'daily' || msg.mode === 'taupe')) {
          this.mode = msg.mode;
          await this.ctx.storage.put('mode', this.mode);
          this.broadcastLobby();
        }
        break;
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

  // ---------------------------------------------------------------- game flow

  private startGame() {
    const active = [...this.players.values()].filter((p) => p.ws);
    if (this.mode === 'versus' && active.length < 2) {
      for (const p of active) this.send(p.ws!, { t: 'error', msg: 'Il faut au moins 2 joueurs pour le mode versus.' });
      return;
    }
    if (this.mode === 'taupe' && active.length < TAUPE_MIN_PLAYERS) {
      for (const p of active) this.send(p.ws!, { t: 'error', msg: `Il faut au moins ${TAUPE_MIN_PLAYERS} joueurs pour démasquer une taupe.` });
      return;
    }
    for (const p of this.players.values()) {
      p.score = 0; p.kills = {}; p.deaths = 0; p.ff = 0; p.inGame = !!p.ws;
    }
    this.mission = this.mode === 'coop' ? this.from : 1;
    this.lives = this.mode === 'daily' ? DAILY_LIVES : this.mode === 'taupe' ? TAUPE_LIVES : 3;
    this.mole = this.mode === 'taupe' ? active[Math.floor(Math.random() * active.length)].pid : undefined;
    this.taupeSeed = (Math.random() * 2 ** 31) >>> 0;
    this.council = undefined;
    this.taupeEnd = undefined;
    this.round = 0;
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
    for (const p of participants) p.inGame = true;
    this.level = this.mode === 'coop' ? getMission(this.mission)
      : this.mode === 'daily' ? dailyLevel(this.day, this.mission)
      : this.mode === 'taupe' ? taupeLevel(this.taupeSeed, this.mission)
      : versusArena(this.round);
    this.council = undefined;
    const game = new Game(this.level.tiles);
    const spawns = this.level.spawns.slice();
    const used: [number, number][] = [];
    participants.forEach((p, i) => {
      let pos: [number, number];
      if (spawns[i]) pos = spawns[i];
      else {
        const base = spawns[i % Math.max(1, spawns.length)] ?? [2.5, 8.5];
        pos = nearestFree(this.level!.tiles, Math.floor(base[0]), Math.floor(base[1]) + (i >= 2 ? 2 : -2), [...spawns, ...used]);
      }
      used.push(pos);
      const team = this.mode === 'versus' ? i + 1 : 0;
      const t = game.addTank('player', team, pos[0], pos[1], p.color, p.pid, p.name);
      game.arm(t, p.weapon ?? 'canon');
      if (this.mode === 'versus') {
        t.body = t.turret = Math.atan2(8.5 - pos[1], 11 - pos[0]);
      }
      p.queue = [];
      p.last = { ...EMPTY_INPUT, a: t.turret };
    });
    this.enemyIndexByTank.clear();
    this.level.enemies.forEach((e, idx) => {
      if (this.killedEnemies.has(idx)) return;
      const t = game.addTank(e.kind, 99, e.x, e.y, 0);
      if (t.maxHp > 1) {
        const max = t.maxHp + BOSS_HP_PER_PLAYER * Math.max(0, participants.length - 1);
        game.setHp(t, this.enemyHp.get(idx) ?? max, max);
      }
      this.enemyIndexByTank.set(t.id, idx);
    });
    game.bonusOn = true;
    game.night = !!this.level.night;
    if (this.mode === 'versus') { game.bonusNext = 5; game.bonusEvery = [8, 12]; }
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
    this.send(ws, {
      t: 'level',
      mode: this.mode,
      mission: this.mode === 'versus' ? this.round + 1 : this.mission,
      name: this.mode === 'versus' ? `Manche ${this.round + 1}` : this.level.name,
      tiles: this.game.tiles,
      tanks: this.game.tankInfos(),
      lives: this.lives,
      tick: this.game.tick,
      night: this.level.night ? 1 : undefined,
      daily: this.dailyState(),
    });
    if (this.mode === 'taupe') {
      const att = ws.deserializeAttachment() as Attachment | null;
      this.send(ws, { t: 'role', mole: !!att && att.pid === this.mole });
    }
    this.send(ws, this.phaseMsg());
  }

  private onKill(victim: { pid?: string; kind: TankKind; id: number; team: number; x: number; y: number }, killer?: { pid?: string; team: number; id: number }) {
    if (victim.pid) {
      const vp = this.players.get(victim.pid);
      if (vp) vp.deaths++;
      if (killer?.pid && this.mode !== 'versus') {
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
      const kp = this.players.get(killer.pid);
      const coop = this.mode !== 'versus';
      if (kp && kp.pid !== victim.pid && !(coop && victim.pid)) {
        const key: TankKind = victim.kind;
        kp.kills[key] = (kp.kills[key] ?? 0) + 1;
        if (coop) kp.score++;
      }
    }
  }

  private setPhase(phase: Phase, seconds: number) {
    this.phase = phase;
    this.phaseTimer = seconds;
    if (this.game) this.game.frozen = phase !== 'playing';
  }

  private phaseMsg(): ServerMsg {
    const scores: Record<string, number> = {};
    for (const p of this.players.values()) scores[p.pid] = p.score;
    return {
      t: 'phase',
      phase: this.phase,
      mission: this.mode === 'versus' ? this.round + 1 : this.mission,
      lives: this.lives,
      enemies: this.game ? this.game.aliveCount(99) : 0,
      scores,
      results: this.phase === 'gameover' ? this.results() : undefined,
      daily: this.dailyState(),
      council: this.council && this.phase === 'council' ? { ...this.council, left: Math.max(0, +this.phaseTimer.toFixed(1)) } : undefined,
      stages: this.mode === 'taupe' ? TAUPE_STAGES : undefined,
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
      .map((p) => ({ id: p.pid, name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, score: p.score, ff: this.mode === 'versus' ? undefined : p.ff }))
      .sort((a, b) => b.score - a.score);
    const daily = this.mode === 'daily' ? { state: this.dailyState()!, cleared: this.dailyCleared(), board: this.board } : undefined;
    const taupe = this.mode === 'taupe' && this.taupeEnd
      ? { ...this.taupeEnd, cleared: this.taupeEnd.why === 'missions' ? TAUPE_STAGES : this.mission - 1, stages: TAUPE_STAGES }
      : undefined;
    return { mode: this.mode, mission: this.mission, players, winner: this.mode === 'versus' ? players[0]?.id : undefined, daily, taupe };
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

    const T = game.netTanks(), B = game.netBullets(), M = game.netMines(), P = game.netBonuses(), E = game.events;
    game.events = [];
    for (const p of this.players.values()) {
      if (p.ws) this.send(p.ws, { t: 'snap', k: game.tick, a: p.ack, T, B, M, E, P });
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
          const best = Math.max(...[...this.players.values()].map((p) => p.score));
          if (best >= VERSUS_TARGET) { this.setPhase('gameover', 8); this.broadcastPhase(); }
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
    if (this.mode !== 'versus') {
      const playersAlive = game.aliveCount(0);
      const enemiesAlive = game.aliveCount(99);
      if (enemiesAlive === 0) {
        // wait for the last shells (nobody may fire any more), but never forever
        if (this.settle < 0) this.settle = 0;
        this.settle += DT;
        if (game.bullets.length === 0 || this.settle >= SETTLE_MAX) {
          this.setPhase('cleared', 3.5);
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
      }
      if (alive.length <= 1 && (game.bullets.length === 0 || this.settle >= SETTLE_MAX)) {
        const w = alive[0]?.pid ? this.players.get(alive[0].pid) : undefined;
        if (w) w.score++;
        this.setPhase('roundEnd', 3.5);
        this.broadcast({ ...(this.phaseMsg() as Extract<ServerMsg, { t: 'phase' }>), text: w ? `${w.name} gagne la manche !` : 'Égalité !' });
      }
    }
  }
  private lastEnemyCount = -1;

  private endToLobby() {
    this.stopLoop();
    this.game = undefined;
    this.level = undefined;
    this.phase = 'lobby';
    for (const [id, p] of this.players) {
      p.inGame = false;
      if (!p.ws) this.players.delete(id);
    }
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
      .map((p) => ({ id: p.pid, name: p.name, color: p.color, host: p.pid === host, connected: !!p.ws, score: p.score, weapon: p.weapon }));
  }

  private broadcastLobby() {
    this.broadcast({ t: 'lobby', players: this.lobbyPlayers(), mode: this.mode, phase: this.phase, from: this.from });
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
