// Tiny synthesized sound kit + procedural march so the game ships with zero audio assets.

let ctx: AudioContext | undefined;
let master: GainNode;
let sfxBus: GainNode;
let musicBus: GainNode;
let noiseBuf: AudioBuffer;
let musicOn = localStorage.getItem('tanks.music') !== '0';

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = musicOn ? 0.22 : 0;
  musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function noise(t: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'lowpass', sweepTo?: number) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function tone(t: number, dur: number, f0: number, f1: number, gain: number, type: OscillatorType = 'sine', bus?: GainNode) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus ?? sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function pan(x: number) {
  return Math.max(-1, Math.min(1, (x - 11) / 11));
}
void pan;

export const sfx = {
  shot(rocket: boolean) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (rocket) {
      noise(t, 0.35, 3000, 0.8, 0.5, 'bandpass', 600);
      tone(t, 0.18, 220, 80, 0.35, 'sawtooth');
    } else {
      noise(t, 0.12, 2500, 0.7, 0.45, 'lowpass', 300);
      tone(t, 0.1, 180, 60, 0.5, 'triangle');
    }
  },
  /** Through a portal: a quick wobbling sweep, softer for shells. */
  warp(tank: boolean) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = tank ? 0.16 : 0.06;
    tone(t, 0.22, 300, 1400, g, 'sine');
    tone(t + 0.04, 0.2, 450, 1900, g * 0.6, 'triangle');
    if (tank) noise(t, 0.25, 4000, 2, 0.08, 'bandpass', 900);
  },
  bounce() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.07, 1500, 900, 0.12, 'square');
  },
  pop() {
    if (!ctx) return;
    noise(ctx.currentTime, 0.1, 1800, 1, 0.25, 'bandpass', 500);
  },
  boom(big: boolean) {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, big ? 1.2 : 0.8, 1200, 0.5, big ? 1 : 0.8, 'lowpass', 60);
    tone(t, big ? 0.7 : 0.5, 110, 30, 0.9, 'sine');
  },
  mineSet() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.08, 660, 660, 0.15, 'square');
    tone(t + 0.1, 0.1, 880, 880, 0.15, 'square');
  },
  /** The Maçon lays a block: two hollow knocks of wood and a little scrape of the trowel. */
  build() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.06, 420, 300, 0.22, 'triangle');
    tone(t + 0.11, 0.07, 520, 360, 0.2, 'triangle');
    noise(t + 0.2, 0.14, 2800, 1.4, 0.12, 'bandpass', 1800);
  },
  /** A Pilleur snatches a crate: a sly little « hé hé » on two descending notes and a rustle of burlap. */
  steal() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.12, 1600, 1.2, 0.14, 'bandpass', 900);
    tone(t + 0.05, 0.09, 740, 620, 0.16, 'square');
    tone(t + 0.17, 0.12, 620, 470, 0.16, 'square');
  },
  block() {
    if (!ctx) return;
    noise(ctx.currentTime, 0.4, 900, 0.6, 0.6, 'lowpass', 200);
  },
  jingle(kind: 'start' | 'clear' | 'fail' | 'over') {
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const seqs = {
      start: [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.42]],
      clear: [[784, 0], [988, 0.1], [1175, 0.2], [1568, 0.34], [1175, 0.5], [1568, 0.62]],
      fail: [[392, 0], [349, 0.18], [311, 0.36], [262, 0.6]],
      over: [[330, 0], [294, 0.25], [262, 0.5], [196, 0.8]],
    } as const;
    for (const [f, dt] of seqs[kind]) {
      tone(t + dt, 0.28, f, f, 0.18, 'triangle');
      tone(t + dt, 0.22, f * 2, f * 2, 0.05, 'square');
    }
  },
  crate() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.25, 900, 300, 0.06, 'sine');
    noise(t + 0.4, 0.18, 700, 0.8, 0.35, 'lowpass', 150);
  },
  bonus() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [659, 880, 1109, 1319].forEach((f, i) => tone(t + i * 0.055, 0.16, f, f, 0.12, 'triangle'));
    tone(t + 0.22, 0.25, 2637, 2637, 0.03, 'sine');
  },
  shieldBreak() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.35, 5000, 1.5, 0.35, 'highpass');
    tone(t, 0.3, 1400, 350, 0.12, 'square');
  },
  /** A steel tank's armour flies off: a bright, inharmonic ring with a rattle of plates. */
  clang() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, g] of [[523, 0.14], [1187, 0.09], [1913, 0.06], [2731, 0.04]] as const) tone(t, 0.7, f, f * 0.985, g, 'sine');
    tone(t, 0.12, 900, 200, 0.12, 'square');
    noise(t, 0.18, 6000, 1.2, 0.3, 'bandpass', 2500);
    [0.09, 0.17, 0.27].forEach((d) => noise(t + d, 0.06, 3500 + d * 4000, 3, 0.16, 'bandpass'));
  },
  /** A shell bounces off the Rempart's shield: a short bright gong, lighter than the steel tank's clang. */
  deflect() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, g] of [[784, 0.12], [1568, 0.06], [2350, 0.035]] as const) tone(t, 0.45, f, f * 1.01, g, 'sine');
    tone(t, 0.08, 1200, 2400, 0.06, 'triangle');
    noise(t, 0.08, 7000, 1.5, 0.18, 'highpass');
  },
  /** The boss takes a hit: a heavy metal clang. */
  bossHit() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.35, 320, 290, 0.22, 'square');
    tone(t, 0.5, 480, 470, 0.12, 'triangle');
    noise(t, 0.2, 4000, 2, 0.3, 'bandpass', 1500);
  },
  /** Rising whine while the boss charges its ring of shells. */
  bossCharge() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.9, 180, 900, 0.1, 'sawtooth');
    tone(t, 0.9, 182, 905, 0.06, 'square');
  },
  volley() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.4, 3000, 0.6, 0.7, 'lowpass', 200);
    tone(t, 0.3, 150, 50, 0.6, 'triangle');
  },
  /** Half health: the boss growls and speeds up. */
  rage() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 1.1, 70, 45, 0.5, 'sawtooth');
    tone(t + 0.05, 1.0, 105, 60, 0.3, 'square');
    noise(t, 1.0, 500, 0.7, 0.5, 'lowpass', 80);
  },
  /** The Foreur digs in: a grinding drill and a crunch of earth. */
  dig() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.7, 140, 90, 0.12, 'sawtooth');
    tone(t, 0.7, 147, 95, 0.08, 'square');
    noise(t, 0.8, 900, 0.8, 0.5, 'lowpass', 150);
  },
  /** The ground shakes where it will come out: a deep rumble that swells. */
  quake(secs: number) {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 5; i++) noise(t + (i * secs) / 5, secs / 4, 260 + i * 40, 1, 0.15 + i * 0.09, 'lowpass');
    tone(t, secs, 45, 65, 0.25, 'triangle');
  },
  /** It bursts out: a heavy thump and a shower of earth. */
  erupt() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.5, 120, 35, 0.7, 'sine');
    noise(t, 0.9, 1400, 0.6, 0.9, 'lowpass', 90);
    [0.15, 0.3, 0.45, 0.6].forEach((d) => noise(t + d, 0.08, 1200 + d * 1500, 2, 0.12, 'bandpass'));
  },
  /** Night: an enemy has spotted you (a little « hein ?! »). */
  alert() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.09, 520, 560, 0.12, 'square');
    tone(t + 0.09, 0.16, 780, 1050, 0.12, 'square');
  },
  click() {
    if (!ctx) return;
    tone(ctx.currentTime, 0.04, 1200, 1000, 0.08, 'triangle');
  },
  /** Storm: a strike is announced (a static crackle that builds up). */
  zap() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++) noise(t + i * 0.2, 0.06, 5000 + i * 600, 4, 0.05 + i * 0.03, 'bandpass');
    tone(t, 1.3, 90, 260, 0.05, 'sawtooth');
  },
  /** The Grondeur calls the lightning (iteration 18): a deep growl that climbs, an electric snap at the top. */
  call() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.5, 60, 140, 0.35, 'sawtooth');
    tone(t, 0.5, 90, 210, 0.15, 'square');
    noise(t + 0.38, 0.12, 7000, 0.8, 0.6, 'highpass');
    noise(t + 0.4, 0.6, 1800, 0.7, 0.4, 'lowpass', 200);
  },
  /** « Drapeaux » (iteration 24): 0 a flag is grabbed (a rising whistle), 1 dropped (a falling one), 2 sent home (a chime), 3 brought home (a fanfare). */
  flag(what: number, ours: boolean) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (what === 0) { tone(t, 0.18, 600, 1200, 0.12, 'square'); tone(t + 0.16, 0.14, ours ? 500 : 1200, ours ? 420 : 1500, 0.1, 'triangle'); }
    else if (what === 1) { tone(t, 0.32, 900, 300, 0.12, 'triangle'); noise(t + 0.05, 0.2, 600, 0.8, 0.25, 'lowpass', 120); }
    else if (what === 2) [988, 784, 659].forEach((f, i) => tone(t + i * 0.08, 0.2, f, f, 0.12, 'triangle'));
    else {
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => { tone(t + i * 0.09, 0.22, f, f, 0.16, 'square'); tone(t + i * 0.09, 0.22, f / 2, f / 2, 0.08, 'triangle'); });
      noise(t + 0.5, 0.6, 3000, 0.6, 0.2, 'highpass');
    }
  },
  /** The Semeur sows (iteration 25): a creak of the hopper, then one hollow « plop » per seed thrown. */
  sow(n: number) {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.18, 700, 1.5, 0.25, 'bandpass', 1500);
    for (let i = 0; i < Math.min(6, n); i++) tone(t + 0.12 + i * 0.07, 0.11, 300 + i * 45, 170 + i * 30, 0.2, 'sine');
  },
  /** A seed bursts: a deep thump, a rustle of leaves. */
  seedBurst() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.6, 95, 30, 0.75, 'sine');
    noise(t, 1, 1100, 0.6, 0.9, 'lowpass', 70);
    noise(t + 0.12, 0.5, 4200, 0.9, 0.18, 'bandpass', 2400);
  },
  /** « Suis-moi ! » (iteration 20): two cheerful toots of a toy horn. */
  rally() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.12, 520, 540, 0.18, 'square');
    tone(t + 0.15, 0.2, 700, 720, 0.18, 'square');
    tone(t + 0.15, 0.2, 350, 360, 0.08, 'triangle');
  },
  /** A foghorn far away (iteration 26): two long, low notes, the second one lower, and the breath of the mist. */
  foghorn() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 1.5, 116, 112, 0.09, 'sawtooth');
    tone(t, 1.5, 233, 226, 0.035, 'triangle');
    tone(t + 1.6, 2.1, 87, 82, 0.1, 'sawtooth');
    tone(t + 1.6, 2.1, 174, 166, 0.04, 'triangle');
    noise(t, 3.6, 380, 0.7, 0.05, 'lowpass', 200);
  },
  /** The lightning falls: a sharp crack, then the thunder rolls. */
  thunder() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.15, 6000, 0.5, 0.9, 'highpass');
    noise(t, 0.5, 2500, 0.7, 0.8, 'lowpass', 300);
    noise(t + 0.08, 2.2, 400, 0.8, 0.9, 'lowpass', 60);
    noise(t + 0.4, 1.6, 220, 1, 0.5, 'lowpass', 50);
    tone(t, 0.8, 70, 32, 0.5, 'sine');
  },
};

// ------------------------------------------------------------------ rain (storm missions)

let rainSrc: AudioBufferSourceNode | undefined;
let rainGain: GainNode | undefined;

/** A soft bed of rain under the storm missions (fades in and out). */
export function setRain(on: boolean) {
  if (!ctx) return;
  if (on && !rainSrc) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 5200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 1.5);
    src.connect(hp).connect(lp).connect(g).connect(sfxBus);
    src.start();
    rainSrc = src; rainGain = g;
  } else if (!on && rainSrc) {
    const src = rainSrc, g = rainGain!;
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
    src.stop(ctx.currentTime + 1.5);
    rainSrc = rainGain = undefined;
  }
}

// wind (iteration 23): a low, breathy noise that swells with the gusts
let windSrc: AudioBufferSourceNode | undefined;
let windGain: GainNode | undefined;
let windBand: BiquadFilterNode | undefined;
export function setWind(on: boolean) {
  if (!ctx) return;
  if (on && !windSrc) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.6;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    src.connect(bp).connect(g).connect(sfxBus);
    src.start();
    windSrc = src; windGain = g; windBand = bp;
  } else if (!on && windSrc) {
    const src = windSrc, g = windGain!;
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
    src.stop(ctx.currentTime + 1.5);
    windSrc = windGain = windBand = undefined;
  }
}
/** Follow the gust of the moment (0.1 lull … 1 gust); called a few times per second. */
export function windGust(k: number) {
  if (!ctx || !windGain || !windBand) return;
  windGain.gain.setTargetAtTime(0.012 + 0.07 * k * k, ctx.currentTime, 0.25);
  windBand.frequency.setTargetAtTime(300 + 520 * k, ctx.currentTime, 0.3);
}

// ------------------------------------------------------------------ music

let musicTimer: ReturnType<typeof setInterval> | undefined;
let nextNote = 0;
let step = 0;
let intensity = 0;

const BASS = [55, 55, 82.4, 55, 73.4, 73.4, 65.4, 61.7];
const LEAD = [440, 0, 523, 0, 587, 523, 440, 0, 392, 0, 440, 0, 523, 494, 440, 0];
// boss fights (intensity 2): faster, lower, more menacing
const BOSS_BASS = [41.2, 41.2, 43.7, 41.2, 49, 46.2, 43.7, 36.7];
const BOSS_LEAD = [330, 0, 311, 330, 0, 392, 370, 0, 330, 0, 311, 330, 466, 0, 440, 0];

export function setMusicIntensity(v: number) {
  intensity = v;
}

export function startMusic() {
  if (!ctx || musicTimer) return;
  nextNote = ctx.currentTime + 0.1;
  musicTimer = setInterval(scheduleMusic, 50);
}

export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = undefined;
}

export function toggleMusic() {
  musicOn = !musicOn;
  localStorage.setItem('tanks.music', musicOn ? '1' : '0');
  if (ctx) musicBus.gain.setTargetAtTime(musicOn ? 0.22 : 0, ctx.currentTime, 0.1);
  return musicOn;
}
export const isMusicOn = () => musicOn;

function scheduleMusic() {
  if (!ctx) return;
  const boss = intensity >= 2;
  const spb = 60 / (boss ? 150 : 132) / 2; // eighth notes at 132 bpm (150 for the boss)
  const bass = boss ? BOSS_BASS : BASS, lead = boss ? BOSS_LEAD : LEAD;
  while (nextNote < ctx.currentTime + 0.2) {
    const t = nextNote;
    const s = step % 16;
    // snare march pattern
    if (s % 4 === 2 || (intensity > 0 && s % 2 === 1 && Math.random() < (boss ? 0.5 : 0.3))) {
      musicNoise(t, 0.09, 2500, 0.35);
    }
    if (s % 4 === 0 || (boss && s % 4 === 3)) musicTone(t, 0.12, 120, 45, 0.6, 'sine');
    const b = bass[(step >> 1) % bass.length];
    musicTone(t, spb * 0.9, b, b, 0.22, 'triangle');
    if (boss) musicTone(t, spb * 0.5, b * 2, b * 2, 0.08, 'sawtooth');
    if (intensity > 0) {
      const f = lead[s];
      if (f) musicTone(t, spb * 0.8, f, f, 0.06, 'square');
    }
    nextNote += spb;
    step++;
  }
}

function musicTone(t: number, dur: number, f0: number, f1: number, gain: number, type: OscillatorType) {
  tone(t, dur, f0, f1, gain, type, musicBus);
}

function musicNoise(t: number, dur: number, freq: number, gain: number) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(musicBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}
