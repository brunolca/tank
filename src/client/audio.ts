// Tiny synthesized sound kit + procedural march so the game ships with zero audio assets.

let ctx: AudioContext | undefined;
let master: GainNode;
let sfxBus: GainNode;
let musicBus: GainNode;
let noiseBuf: AudioBuffer;
let musicOn = localStorage.getItem('tanks.music') !== '0';
// « Les options » (iteration 43): a volume for the music and one for the sounds, 0 to 1
const readVol = (k: string, d: number) => { try { const v = Number(localStorage.getItem(k) ?? d); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d; } catch { return d; } };
let musicVol = readVol('tanks.vol.music', 1);
let sfxVol = readVol('tanks.vol.sfx', 1);
const musicGain = () => (musicOn ? 0.22 * musicVol : 0);

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = sfxVol;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = musicGain();
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
  /** « Détonateur » (iteration 52): the remote mine answers with a little radio chirp. */
  remoteSet() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.22;
    tone(t, 0.05, 1320, 1760, 0.07, 'sine');
    tone(t + 0.07, 0.05, 1760, 2200, 0.06, 'sine');
  },
  /** Its owner presses the plunger: a click, then a rising beep just before the blast. */
  detonate() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.03, 3500, 2, 0.22, 'highpass');
    tone(t + 0.02, 0.12, 900, 2400, 0.12, 'square');
  },
  /** « Passe-muraille » (iteration 52): a soft airy whistle on top of the shot. */
  ghostShot() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.28, 520, 880, 0.06, 'sine');
    noise(t, 0.22, 2400, 0.8, 0.05, 'bandpass', 1200);
  },
  /** The ghost shell slips into a wall: a wobbly « wouuh ». */
  ghostPass() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.32, 700, 300, 0.09, 'sine');
    tone(t + 0.04, 0.3, 740, 330, 0.05, 'triangle');
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
  /** « Les ponts » (iteration 33): the planks crack, a long creak, then the clatter of wood far down the pit. */
  bridge() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.09, 3200, 1.2, 0.35, 'bandpass', 2200);
    tone(t + 0.03, 0.45, 210, 120, 0.16, 'sawtooth');
    for (let i = 0; i < 4; i++) tone(t + 0.42 + i * 0.09 + Math.random() * 0.03, 0.06, 520 - i * 60, 300 - i * 30, 0.1 - i * 0.015, 'triangle');
    noise(t + 0.4, 0.4, 700, 0.6, 0.18, 'lowpass', 150);
  },
  /** « Les interrupteurs » (iteration 40): a shell hits a switch, a big wooden « clac » and a two-note chime (up for red, down for blue). */
  flip(phase: number) {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.05, 3600, 1.5, 0.4, 'bandpass', 2600);
    tone(t, 0.05, 900, 500, 0.2, 'square');
    const [a, b] = phase ? [880, 660] : [660, 880];
    tone(t + 0.07, 0.12, a, a, 0.14, 'triangle');
    tone(t + 0.18, 0.18, b, b, 0.14, 'triangle');
  },
  /** The gates slide: a low wooden rumble (rising) or a soft thud (sinking). */
  gate(up: boolean) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (up) { tone(t, 0.2, 140, 260, 0.14, 'sawtooth'); noise(t + 0.18, 0.08, 1800, 1.2, 0.16, 'bandpass', 1200); }
    else { tone(t, 0.18, 240, 110, 0.12, 'sawtooth'); noise(t + 0.12, 0.15, 600, 0.6, 0.12, 'lowpass', 150); }
  },
  /** « Les ponts-levis » (iteration 48): the chains rattle link by link, then the deck lands with a wooden boom (lowering) or locks up (raising). */
  drawbridge(up: boolean) {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 7; i++) noise(t + i * 0.055 + Math.random() * 0.015, 0.03, 4200 - i * 120, 2.5, 0.09, 'bandpass', 3400);
    if (up) { tone(t, 0.35, 120, 200, 0.1, 'sawtooth'); tone(t + 0.4, 0.06, 700, 700, 0.12, 'square'); }
    else { tone(t + 0.32, 0.22, 150, 60, 0.2, 'sine'); noise(t + 0.32, 0.25, 500, 0.6, 0.22, 'lowpass', 120); }
  },
  block() {
    if (!ctx) return;
    noise(ctx.currentTime, 0.4, 900, 0.6, 0.6, 'lowpass', 200);
  },
  /** « Les bonshommes de neige » (iteration 53): a soft « pouf » of snow, and a little « boing » as the head flies off. */
  snowHit() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.22, 2600, 0.4, 0.5, 'lowpass', 500);
    tone(t + 0.03, 0.2, 520, 880, 0.08, 'triangle');
  },
  /** …and a deeper, longer « flomp » as the whole snowman comes down. */
  snowFall() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.5, 1600, 0.6, 0.6, 'lowpass', 160);
    tone(t + 0.02, 0.3, 300, 140, 0.07, 'sine');
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
  /** « Gel » (iteration 29): a glassy glissando down, then frost crackling. */
  freeze() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [1760, 1318, 1046, 784].forEach((f, i) => tone(t + i * 0.06, 0.5, f, f * 1.01, 0.09, 'sine'));
    tone(t, 0.6, 2600, 900, 0.05, 'triangle');
    for (let i = 0; i < 6; i++) noise(t + 0.1 + i * 0.05, 0.06, 5000 + Math.random() * 3000, 4, 0.12, 'bandpass');
  },
  /** An ice cube cracks open. */
  thaw() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.09, 4200, 3, 0.18, 'bandpass', 1800);
    tone(t, 0.12, 1500, 700, 0.05, 'triangle');
  },
  /** « Gros calibre »: a deep thump. */
  heavyShot() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.2, 1400, 0.7, 0.5, 'lowpass', 150);
    tone(t, 0.22, 110, 38, 0.6, 'triangle');
  },
  /** « Le ralenti » (iteration 32): a tape rewinding, then the click of « play ». */
  rewind() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 5; i++) tone(t + i * 0.05, 0.07, 1500 - i * 160, 1900 - i * 160, 0.035, 'square');
    noise(t, 0.3, 3000, 0.9, 0.12, 'bandpass', 900);
    noise(t + 0.32, 0.03, 4000, 2, 0.25, 'highpass');
    tone(t + 0.32, 0.06, 240, 180, 0.12, 'triangle');
  },
  bonus() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [659, 880, 1109, 1319].forEach((f, i) => tone(t + i * 0.055, 0.16, f, f, 0.12, 'triangle'));
    tone(t + 0.22, 0.25, 2637, 2637, 0.03, 'sine');
  },
  /** « La chasse aux caisses » (iteration 37): a coin in the piggy bank (a fanfare for the golden crate), or one falling out. */
  hunt(points: number, mine: boolean) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (points < 0) { [988, 740, 523].forEach((f, i) => tone(t + i * 0.07, 0.14, f, f * 0.97, 0.08, 'triangle')); return; }
    const v = mine ? 0.13 : 0.06;
    tone(t, 0.08, 1976, 1976, v, 'square');
    tone(t + 0.07, 0.3, 2637, 2637, v, 'square');
    if (points > 1) [1047, 1319, 1568, 2093].forEach((f, i) => tone(t + 0.16 + i * 0.08, 0.3, f, f, 0.1, 'triangle'));
  },
  /** « Le bilan » (iteration 45): a pencil tick on the sheet, a little higher on every line. */
  tally(i: number) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = 520 * Math.pow(2, Math.min(i, 12) / 12);
    tone(t, 0.07, f, f * 0.98, 0.1, 'triangle');
    noise(t, 0.03, 3200, 2, 0.08, 'bandpass');
  },
  /** The red stamp comes down on the paper. */
  stamp() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.16, 900, 0.7, 0.5, 'lowpass', 160);
    tone(t, 0.14, 130, 55, 0.4, 'triangle');
    noise(t + 0.02, 0.08, 2600, 1, 0.12, 'bandpass');
  },
  /** A star of the sheet: a bright chime when won (higher for each star), a dull knock when missed. */
  star(i: number, on: boolean) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!on) { tone(t, 0.12, 196, 160, 0.08, 'triangle'); return; }
    const f = [1047, 1319, 1568][i] ?? 1568;
    tone(t, 0.4, f, f, 0.12, 'triangle');
    tone(t, 0.3, f * 2, f * 2, 0.04, 'sine');
    tone(t + 0.06, 0.35, f * 1.5, f * 1.5, 0.05, 'sine');
  },
  /** « Nouveau au bestiaire ! » (iteration 38): a little wooden xylophone run, then a bell. */
  newcomer() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [784, 988, 1175, 1568].forEach((f, i) => { tone(t + i * 0.07, 0.12, f, f, 0.09, 'triangle'); tone(t + i * 0.07, 0.04, f * 3, f * 3, 0.03, 'sine'); });
    tone(t + 0.3, 0.6, 2093, 2093, 0.05, 'sine');
  },
  /** The golden crate drops: a little bell rings three times. */
  gold() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) { tone(t + i * 0.16, 0.5, 1568, 1568, 0.09, 'sine'); tone(t + i * 0.16, 0.4, 3136, 3136, 0.03, 'sine'); }
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
  /** The Aimant catches a shell (iteration 27): a metallic snap, a little higher with each shell it holds. */
  magnetCatch(held = 1) {
    if (!ctx) return;
    const t = ctx.currentTime, f = 520 + held * 70;
    tone(t, 0.12, f * 1.6, f, 0.09, 'square');
    tone(t, 0.25, f * 2, f * 2.02, 0.04, 'sine');
    noise(t, 0.05, 5000, 1.2, 0.12, 'highpass');
  },
  /** And throws them all back: a rising electric whoosh. */
  magnetUnload(n = 1) {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.35, 180, 900, 0.1, 'sawtooth');
    tone(t + 0.05, 0.3, 360, 1500, 0.05, 'square');
    noise(t, 0.3, 2400, 0.8, 0.12 + Math.min(6, n) * 0.02, 'bandpass');
  },
  /** The boss takes a hit: a heavy metal clang. */
  bossHit() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.35, 320, 290, 0.22, 'square');
    tone(t, 0.5, 480, 470, 0.12, 'triangle');
    noise(t, 0.2, 4000, 2, 0.3, 'bandpass', 1500);
  },
  /**
   * « Le Tortillard » (iteration 49): a two-tone steam whistle (« tchou-tchou »), a hiss of steam behind it, and a
   * couple of chugs from the cylinders.
   */
  whistle() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [d, len] of [[0, 0.32], [0.4, 0.5]]) {
      tone(t + d, len, 740, 735, 0.09, 'triangle');
      tone(t + d, len, 932, 925, 0.07, 'triangle');
      tone(t + d, len, 1110, 1100, 0.035, 'sine');
      noise(t + d, len, 3400, 2.5, 0.08, 'bandpass');
    }
    noise(t + 0.95, 0.5, 5000, 0.8, 0.12, 'highpass');
    for (let i = 0; i < 3; i++) noise(t + 1.0 + i * 0.22, 0.09, 700, 1.2, 0.22, 'lowpass', 120);
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
  /** « Le réticule » (iteration 44): the trigger clicks on an empty barrel (all the shells are out). */
  dry() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.025, 5200, 4, 0.12, 'bandpass');
    tone(t + 0.012, 0.03, 2300, 1700, 0.05, 'square');
  },
  /** A shell is back in the barrel: a tiny tick (only when the barrel was empty). */
  reload() {
    if (!ctx) return;
    tone(ctx.currentTime, 0.05, 900, 1350, 0.05, 'triangle');
  },
  /** « Le nouvel accueil » (iteration 43): a soft knock of wood when the pointer lands on a plank. */
  toc() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.05, 420, 300, 0.05, 'triangle');
    noise(t, 0.03, 1800, 3, 0.03, 'bandpass');
  },
  // « Les finitions » (iteration 46): the sounds of the menus, all made of paper and wood like the menus themselves
  /** A sheet of paper slides out (a panel opens: the manual, the options, the journal, the menu). */
  paperIn() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.16, 2400, 0.9, 0.06, 'bandpass', 5200);
    tone(t + 0.03, 0.06, 520, 640, 0.03, 'triangle');
  },
  /** The sheet goes back in the box (a panel closes). */
  paperOut() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.13, 4800, 0.9, 0.05, 'bandpass', 1900);
    tone(t + 0.07, 0.05, 380, 300, 0.035, 'triangle');
  },
  /** A page of the manual turns. */
  page() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.09, 3000, 1.4, 0.05, 'bandpass', 6400);
    noise(t + 0.07, 0.05, 1500, 2, 0.03, 'bandpass');
  },
  /** A switch of the options flips (higher when on). */
  toggle(on: boolean) {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.035, on ? 900 : 620, on ? 1300 : 480, 0.06, 'square');
    noise(t, 0.02, 4000, 3, 0.04, 'bandpass');
  },
  /** A button is pressed: a little « clac » of wood. */
  clac() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.04, 700, 420, 0.07, 'triangle');
    noise(t, 0.025, 2600, 4, 0.05, 'bandpass');
  },
  /** The wheel of the bubbles opens: a soft pop of cardboard. */
  wheelOpen() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.08, 300, 620, 0.06, 'sine');
    noise(t, 0.05, 2000, 2, 0.03, 'bandpass');
  },
  /** The pointer moves to another line of the wheel (one note of a little scale per line). */
  wheelTick(n: number) {
    if (!ctx) return;
    const notes = [784, 880, 988, 1047, 1175, 1319];
    tone(ctx.currentTime, 0.04, notes[n % notes.length], notes[n % notes.length], 0.045, 'triangle');
  },
  /** The wheel closes without a word. */
  wheelClose() {
    if (!ctx) return;
    tone(ctx.currentTime, 0.07, 560, 300, 0.04, 'sine');
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
  /**
   * « La couronne » (iteration 50): 0 the crown is put on (a bright little trumpet call, prouder when it is yours), 1 it is
   * knocked off (a tumbling clatter), 2 it flies back to its cushion (a harp glissando), 3 a reign completed (a royal fanfare),
   * 4 five seconds from the throne (a drum roll).
   */
  crown(what: number, mine: boolean) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (what === 0) {
      const v = mine ? 0.15 : 0.08;
      [784, 988, 1175].forEach((f, i) => tone(t + i * 0.07, 0.14, f, f, v, 'square'));
      tone(t + 0.21, 0.32, 1568, 1568, v, 'square');
      tone(t + 0.21, 0.4, 3136, 3136, v * 0.2, 'sine');
    } else if (what === 1) {
      [1319, 1047, 880, 698, 523].forEach((f, i) => tone(t + i * 0.05, 0.1, f, f * 0.95, 0.07, 'triangle'));
      noise(t, 0.12, 5000, 1.5, 0.12, 'highpass');
      noise(t + 0.18, 0.1, 3000, 2, 0.1, 'bandpass');
    } else if (what === 2) {
      [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(t + i * 0.04, 0.3, f, f, 0.05, 'sine'));
    } else if (what === 3) {
      [[523, 0], [523, 0.12], [523, 0.24], [659, 0.36], [784, 0.6], [659, 0.84], [784, 0.96], [1047, 1.1]].forEach(([f, d]) => {
        tone(t + d, d >= 1.1 ? 0.7 : 0.2, f, f, 0.14, 'square');
        tone(t + d, d >= 1.1 ? 0.7 : 0.2, f / 2, f / 2, 0.08, 'triangle');
      });
      noise(t + 1.1, 0.8, 4000, 0.6, 0.18, 'highpass');
    } else {
      for (let i = 0; i < 12; i++) noise(t + i * 0.045, 0.05, 900, 1.2, 0.12 + i * 0.012, 'bandpass', 400);
      tone(t + 0.55, 0.25, 98, 60, 0.4, 'sine');
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
  /** « Le Mortier » (iteration 34): the hollow « ploc » of the barrel, then the cannonball whistling up and away. */
  lob() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.16, 160, 60, 0.6, 'sine');
    noise(t, 0.12, 500, 1.2, 0.35, 'bandpass', 220);
    tone(t + 0.08, 0.7, 900, 1500, 0.05, 'sine');
  },
  /** « Le Mécano » (iteration 51) gets to work: a ratchet spanner, a run of quick wooden clicks. */
  ratchet() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      noise(t + i * 0.085, 0.03, 2400 + (i % 2) * 600, 6, 0.09, 'bandpass');
      tone(t + i * 0.085, 0.025, 1800, 1500, 0.025, 'square');
    }
  },
  /** The wreck rolls again: a « ding » of a little bell over a happy rising chirp. */
  fixed() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.12, 520, 880, 0.08, 'triangle');
    tone(t + 0.1, 0.5, 1568, 1560, 0.09, 'sine');
    tone(t + 0.1, 0.4, 2350, 2340, 0.03, 'sine');
    noise(t, 0.08, 900, 1, 0.06, 'lowpass');
  },
  /** « Le Veilleur » (iteration 47) caught someone in its light: a little two-tone alarm bell (louder when it is you). */
  spot(me = false) {
    if (!ctx) return;
    const t = ctx.currentTime, v = me ? 0.16 : 0.08;
    for (let i = 0; i < 2; i++) {
      tone(t + i * 0.16, 0.14, 1320, 1300, v, 'triangle');
      tone(t + i * 0.16 + 0.08, 0.12, 990, 980, v * 0.85, 'triangle');
    }
    noise(t, 0.04, 3000, 1.5, 0.05, 'bandpass', 2600);
  },
  /** « La Sauterelle » (iteration 41) leaps: a toy spring going « boing », rising. */
  hop() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.28, 180, 620, 0.22, 'triangle');
    tone(t + 0.02, 0.24, 360, 1240, 0.06, 'square');
    noise(t, 0.05, 1200, 1, 0.12, 'bandpass', 900);
  },
  /** It lands: a soft wooden « toc » and a short spring wobble. */
  hopLand() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.1, 260, 120, 0.3, 'sine');
    noise(t, 0.08, 900, 0.8, 0.22, 'lowpass', 300);
    tone(t + 0.05, 0.18, 520, 440, 0.06, 'triangle');
  },
  /** It lands: a whistle falling, then a wooden thud and a burst. */
  lobLand() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.45, 120, 35, 0.7, 'sine');
    noise(t, 0.7, 1600, 0.7, 0.75, 'lowpass', 90);
    tone(t, 0.08, 420, 180, 0.25, 'triangle');
  },
  /** « Suis-moi ! » (iteration 20): two cheerful toots of a toy horn. */
  rally() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 0.12, 520, 540, 0.18, 'square');
    tone(t + 0.15, 0.2, 700, 720, 0.18, 'square');
    tone(t + 0.15, 0.2, 350, 360, 0.08, 'triangle');
  },
  /** « Les bulles » (iteration 30): a squeak of a rubber toy, its tune by line (cheerful up, « Oups » down, « Attention » twice). */
  emote(n: number) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const tunes: [number, number][][] = [[[660, 990]], [[700, 880]], [[620, 380]], [[560, 760]], [[880, 880], [880, 880]], [[520, 780], [780, 600]]];
    (tunes[n] ?? tunes[0]).forEach(([a, b], i) => {
      tone(t + i * 0.13, 0.12, a, b, 0.09, 'triangle');
      tone(t + i * 0.13, 0.12, a * 2, b * 2, 0.025, 'sine');
    });
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
  if (ctx) musicBus.gain.setTargetAtTime(musicGain(), ctx.currentTime, 0.1);
  return musicOn;
}
export const isMusicOn = () => musicOn;
export const volumes = () => ({ music: musicVol, sfx: sfxVol });
export function setVolume(which: 'music' | 'sfx', v: number) {
  v = Math.max(0, Math.min(1, v));
  if (which === 'music') musicVol = v; else sfxVol = v;
  try { localStorage.setItem(`tanks.vol.${which}`, String(v)); } catch {}
  if (!ctx) return;
  if (which === 'music') musicBus.gain.setTargetAtTime(musicGain(), ctx.currentTime, 0.05);
  else sfxBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
}

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
