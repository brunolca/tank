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
  click() {
    if (!ctx) return;
    tone(ctx.currentTime, 0.04, 1200, 1000, 0.08, 'triangle');
  },
};

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
