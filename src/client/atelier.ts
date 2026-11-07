// The workshop (iteration 14): a mission editor drawn on a 2D canvas. Paint walls, cork, holes, tunnels and portals,
// drop the starting spots and the enemy tanks, then play the mission online or share it by link.
import { H, PLAYER_COLORS, PORTAL_COLORS, W, enemyColor, isBossKind } from '../shared/constants';
import { BRUSHES, blankMap, checkAtelier, cleanName, type Brush } from '../shared/atelier';
import { ENEMY_CHARS, EXTRA_LEVELS, LEVELS, parseLevel } from '../shared/levels';
import { tunnelAxis } from '../shared/physics';
import type { AtelierMap } from '../shared/protocol';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const GROUND = '.#Ho_=*+><^V~'; // then four conveyor belts (iteration 16) and the ice (iteration 21)

/** Draw a map onto a 2D canvas (the editor, the lobby preview). `hot`: a cell to highlight (the brush under the cursor). */
export function drawMap(cv: HTMLCanvasElement, map: string[], hot?: { x: number; y: number; ch: string }) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const cw = cv.clientWidth || cv.width / dpr;
  const s = cw / W;
  const w = Math.round(cw * dpr), h = Math.round(s * H * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // paper
  const grd = g.createLinearGradient(0, 0, 0, s * H);
  grd.addColorStop(0, '#efdcb8'); grd.addColorStop(1, '#e3cba0');
  g.fillStyle = grd;
  g.fillRect(0, 0, s * W, s * H);
  g.strokeStyle = 'rgba(120, 80, 40, 0.12)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 1; x < W; x++) { g.moveTo(x * s + 0.5, 0); g.lineTo(x * s + 0.5, s * H); }
  for (let y = 1; y < H; y++) { g.moveTo(0, y * s + 0.5); g.lineTo(s * W, y * s + 0.5); }
  g.stroke();
  const tiles = parseLevel({ name: '', map }).tiles;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = map[y]?.[x] ?? '.';
      if (c !== '.') drawCell(g, x * s, y * s, s, c, c === '=' ? tunnelAxis(tiles, y * W + x) : 0);
    }
  }
  if (hot && hot.x >= 0 && hot.y >= 0 && hot.x < W && hot.y < H) {
    g.strokeStyle = '#ffb43d'; g.lineWidth = 2;
    g.strokeRect(hot.x * s + 1, hot.y * s + 1, s - 2, s - 2);
    g.lineWidth = 1;
  }
}

/** One cell of the map, `axis` for tunnels (0 across, 1 up and down, -1 not between two walls). */
function drawCell(g: CanvasRenderingContext2D, px: number, py: number, s: number, c: string, axis: number) {
  const rr = (x: number, y: number, ww: number, hh: number, r: number) => { g.beginPath(); g.roundRect(x, y, ww, hh, r); };
  if (c === '#') {
    g.fillStyle = '#c8955a'; g.fillRect(px, py, s, s);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(px, py, s, s * 0.18);
    g.strokeStyle = 'rgba(80,45,15,0.45)'; g.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  } else if (c === 'H') {
    g.fillStyle = '#8b5a2b'; g.fillRect(px, py, s, s);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(px, py, s, s * 0.3);
    g.strokeStyle = 'rgba(40,20,5,0.6)'; g.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  } else if (c === 'o') {
    g.fillStyle = '#d9b77e'; rr(px + 1, py + 1, s - 2, s - 2, s * 0.15); g.fill();
    g.fillStyle = 'rgba(110,70,30,0.45)';
    for (const [u, v] of [[0.3, 0.3], [0.7, 0.4], [0.45, 0.7], [0.75, 0.75], [0.2, 0.75]]) { g.beginPath(); g.arc(px + u * s, py + v * s, s * 0.06, 0, 7); g.fill(); }
  } else if (c === '_') {
    g.fillStyle = '#3a2a1e'; rr(px + 1.5, py + 1.5, s - 3, s - 3, s * 0.25); g.fill();
    g.fillStyle = '#1b130d'; rr(px + s * 0.2, py + s * 0.25, s * 0.6, s * 0.55, s * 0.2); g.fill();
  } else if (c === '=') {
    g.fillStyle = axis < 0 ? 'rgba(200,40,40,0.45)' : '#b8432f';
    rr(px + 1, py + 1, s - 2, s - 2, s * 0.2); g.fill();
    g.strokeStyle = '#f2e2c4'; g.lineWidth = Math.max(1, s * 0.08);
    g.beginPath();
    if (axis === 1) { g.moveTo(px + s * 0.5, py + 2); g.lineTo(px + s * 0.5, py + s - 2); } else { g.moveTo(px + 2, py + s * 0.5); g.lineTo(px + s - 2, py + s * 0.5); }
    g.stroke();
    if (axis < 0) { g.fillStyle = '#fff'; g.font = `800 ${s * 0.6}px Rubik, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', px + s / 2, py + s / 2); }
    g.lineWidth = 1;
  } else if (c === '*' || c === '+') {
    g.strokeStyle = hex(PORTAL_COLORS[c === '*' ? 0 : 1]); g.lineWidth = Math.max(2, s * 0.14);
    g.beginPath(); g.arc(px + s / 2, py + s / 2, s * 0.34, 0, 7); g.stroke();
    g.fillStyle = hex(PORTAL_COLORS[c === '*' ? 0 : 1]) + '55'; g.fill();
    g.lineWidth = 1;
  } else if (c === '>' || c === '<' || c === '^' || c === 'V') {
    // a conveyor belt: dark rubber, wooden rails, an orange chevron pointing where it carries
    g.fillStyle = '#3b3f4b'; g.fillRect(px, py, s, s);
    const across = c === '>' || c === '<';
    g.fillStyle = '#b98a55';
    if (across) { g.fillRect(px, py, s, s * 0.12); g.fillRect(px, py + s * 0.88, s, s * 0.12); }
    else { g.fillRect(px, py, s * 0.12, s); g.fillRect(px + s * 0.88, py, s * 0.12, s); }
    const [dx, dy] = c === '>' ? [1, 0] : c === '<' ? [-1, 0] : c === '^' ? [0, -1] : [0, 1];
    const cx = px + s / 2, cy = py + s / 2, k = s * 0.22;
    g.strokeStyle = '#ffb43d'; g.lineWidth = Math.max(1.5, s * 0.12); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(cx - dx * k - dy * k * 1.2, cy - dy * k - dx * k * 1.2);
    g.lineTo(cx + dx * k, cy + dy * k);
    g.lineTo(cx - dx * k + dy * k * 1.2, cy - dy * k + dx * k * 1.2);
    g.stroke();
    g.lineWidth = 1; g.lineCap = 'butt'; g.lineJoin = 'miter';
  } else if (c === '~') {
    // ice: pale blue, a frosty rim and two white scratches
    g.fillStyle = '#c6e8f7'; g.fillRect(px, py, s, s);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = Math.max(1, s * 0.07); g.lineCap = 'round';
    g.beginPath();
    g.moveTo(px + s * 0.2, py + s * 0.62); g.lineTo(px + s * 0.55, py + s * 0.3);
    g.moveTo(px + s * 0.45, py + s * 0.8); g.lineTo(px + s * 0.8, py + s * 0.48);
    g.stroke();
    g.lineWidth = 1; g.lineCap = 'butt';
  } else if (c === '1' || c === '2') {
    const col = hex(PLAYER_COLORS[c === '1' ? 0 : 1]);
    g.fillStyle = col + '44'; g.beginPath(); g.arc(px + s / 2, py + s / 2, s * 0.46, 0, 7); g.fill();
    tankIcon(g, px, py, s, col, false);
    g.fillStyle = '#fff'; g.font = `800 ${s * 0.42}px Rubik, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(c, px + s / 2, py + s * 0.53);
  } else if (ENEMY_CHARS[c]) {
    const kind = ENEMY_CHARS[c];
    tankIcon(g, px, py, s, hex(enemyColor(kind)), isBossKind(kind));
  }
}

function tankIcon(g: CanvasRenderingContext2D, px: number, py: number, s: number, col: string, big: boolean) {
  const k = big ? 1.25 : 1;
  const cx = px + s / 2, cy = py + s / 2;
  g.fillStyle = '#2a2b33';
  g.beginPath(); g.roundRect(cx - s * 0.36 * k, cy - s * 0.34 * k, s * 0.72 * k, s * 0.12 * k, 2); g.fill();
  g.beginPath(); g.roundRect(cx - s * 0.36 * k, cy + s * 0.22 * k, s * 0.72 * k, s * 0.12 * k, 2); g.fill();
  g.fillStyle = col;
  g.beginPath(); g.roundRect(cx - s * 0.32 * k, cy - s * 0.24 * k, s * 0.64 * k, s * 0.48 * k, s * 0.1); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
  g.fillStyle = '#2a2b33'; g.fillRect(cx, cy - s * 0.05, s * 0.42 * k, s * 0.1);
  g.fillStyle = col; g.beginPath(); g.arc(cx, cy, s * 0.17 * k, 0, 7); g.fill(); g.stroke();
  if (big) { g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(cx, cy, s * 0.07, 0, 7); g.fill(); }
}

function brushSwatch(b: Brush) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 56;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ead5ae';
  g.beginPath(); g.roundRect(0, 0, 56, 56, 10); g.fill();
  if (b.ch !== '.') drawCell(g, 4, 4, 48, b.ch, 0);
  return cv;
}

/** Templates to start from: an empty table, then the handmade missions. */
const TEMPLATES: { label: string; map: () => string[] }[] = [
  { label: 'Table vide', map: blankMap },
  ...LEVELS.map((l, i) => ({ label: `${i + 1}. ${l.name}`, map: () => l.map.slice() })),
  ...Object.entries(EXTRA_LEVELS).map(([n, l]) => ({ label: `${n}. ${l.name}`, map: () => l.map.slice() })),
];

export interface WorkshopHooks {
  play(a: AtelierMap): void;
  share(a: AtelierMap): void;
  close(): void;
  click(): void;
  place(ch: string): void;
}

export class Workshop {
  map: string[] = blankMap();
  name = 'Ma mission';
  night = false;
  storm = false;
  private brush = '#';
  private mirror = false;
  private undo: string[][] = [];
  private hot?: { x: number; y: number; ch: string };
  private painting = -1; // pointer id while painting
  private erase = false;
  private lastCell = -1;
  private anim?: ReturnType<typeof setInterval>;
  readonly root: HTMLElement;
  private cv: HTMLCanvasElement;

  constructor(root: HTMLElement, private hooks: WorkshopHooks) {
    this.root = root;
    root.innerHTML = `
      <div class="card atelier">
        <div class="at-head">
          <div><div class="kicker">L’atelier</div><h2>Dessine ta mission</h2></div>
          <label class="field at-name"><span>Nom</span><input maxlength="28" spellcheck="false" /></label>
        </div>
        <div class="at-main">
          <div class="at-board"><canvas class="at-canvas"></canvas></div>
          <div class="at-side">
            <div class="kicker">Terrain</div>
            <div class="at-brushes" data-g="sol"></div>
            <div class="kicker">Tanks</div>
            <div class="at-brushes" data-g="tank"></div>
            <div class="at-opts">
              <label class="check"><input type="checkbox" data-o="mirror" /> Miroir</label>
              <label class="check"><input type="checkbox" data-o="night" /> Nuit</label>
              <label class="check"><input type="checkbox" data-o="storm" /> Orage</label>
            </div>
            <div class="at-tools">
              <select class="at-tpl" aria-label="Partir d’une mission"></select>
              <button class="btn small" data-a="undo" title="Annuler (Ctrl+Z)">↶ Annuler</button>
            </div>
          </div>
        </div>
        <p class="at-status muted"></p>
        <div class="at-actions">
          <button class="btn ghost" data-a="close">Fermer</button>
          <button class="btn" data-a="share">Copier le lien</button>
          <button class="btn primary" data-a="play">Jouer en ligne</button>
        </div>
        <p class="muted at-help">Clic ou doigt : peindre · clic droit : gommer · un tank par clic. Les obus rebondissent sur les murs, le liège saute avec les mines, les trous arrêtent les tanks mais pas les obus.</p>
      </div>`;
    this.cv = root.querySelector('.at-canvas')!;
    for (const b of BRUSHES) {
      const el = document.createElement('button');
      el.dataset.ch = b.ch;
      el.title = b.label;
      el.append(brushSwatch(b));
      const sp = document.createElement('span');
      sp.textContent = b.label;
      el.append(sp);
      root.querySelector(`.at-brushes[data-g="${b.group}"]`)!.append(el);
    }
    root.querySelectorAll('.at-brushes').forEach((box) => box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-ch]');
      if (!b) return;
      this.brush = b.dataset.ch!;
      this.hooks.click();
      this.renderUi();
    }));
    const tpl = root.querySelector<HTMLSelectElement>('.at-tpl')!;
    tpl.innerHTML = `<option value="">Partir d’une mission…</option>` + TEMPLATES.map((t, i) => `<option value="${i}">${t.label}</option>`).join('');
    tpl.addEventListener('change', () => {
      const t = TEMPLATES[Number(tpl.value)];
      tpl.value = '';
      if (!t) return;
      this.push();
      this.map = t.map();
      if (t.label !== 'Table vide') this.name = `${t.label.replace(/^\d+\. /, '')} (remix)`.slice(0, 28);
      this.changed();
    });
    const nameIn = root.querySelector<HTMLInputElement>('.at-name input')!;
    nameIn.addEventListener('input', () => { this.name = nameIn.value; this.save(); });
    root.querySelectorAll<HTMLInputElement>('.at-opts input').forEach((i) => i.addEventListener('change', () => {
      const o = i.dataset.o as 'mirror' | 'night' | 'storm';
      this[o] = i.checked;
      this.hooks.click();
      this.changed();
    }));
    root.querySelector('.at-actions')!.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]')?.dataset.a;
      if (a === 'close') this.hooks.close();
      if (a === 'share') this.hooks.share(this.value());
      if (a === 'play') { if (!checkAtelier(this.map)) this.hooks.play(this.value()); }
    });
    root.querySelector('[data-a="undo"]')!.addEventListener('click', () => this.doUndo());
    addEventListener('keydown', (e) => {
      if (root.hidden || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); this.doUndo(); }
    });
    const cv = this.cv;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      if (this.anim) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      this.painting = e.pointerId;
      this.erase = e.button === 2;
      this.lastCell = -1;
      this.push();
      this.paintAt(e, true);
    });
    cv.addEventListener('pointermove', (e) => {
      const c = this.cellOf(e);
      this.hot = c ? { ...c, ch: this.brush } : undefined;
      if (this.painting === e.pointerId) this.paintAt(e, false);
      else this.draw();
    });
    const stop = (e: PointerEvent) => { if (this.painting === e.pointerId) { this.painting = -1; this.changed(); } };
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);
    cv.addEventListener('pointerleave', () => { this.hot = undefined; this.draw(); });
    addEventListener('resize', () => { if (!root.hidden) this.draw(); });
    this.load();
  }

  value(): AtelierMap {
    return { name: cleanName(this.name) || 'Ma mission', map: this.map.slice(), night: this.night || undefined, storm: this.storm || undefined };
  }

  set(a: AtelierMap) {
    this.stopAnim();
    this.push();
    this.map = a.map.slice();
    this.name = a.name;
    this.night = !!a.night;
    this.storm = !!a.storm;
    this.changed();
  }

  open() {
    this.root.hidden = false;
    this.renderUi();
    requestAnimationFrame(() => this.draw());
  }

  private cellOf(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * W), y = Math.floor(((e.clientY - r.top) / r.height) * H);
    return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : undefined;
  }

  private setCell(x: number, y: number, ch: string) {
    this.map[y] = this.map[y].slice(0, x) + ch + this.map[y].slice(x + 1);
  }

  private paintAt(e: PointerEvent, first: boolean) {
    const c = this.cellOf(e);
    if (!c) return;
    const idx = c.y * W + c.x;
    if (idx === this.lastCell) return;
    this.lastCell = idx;
    const ch = this.erase ? '.' : this.brush;
    const ground = GROUND.includes(ch);
    if (!ground && !first) return; // tanks: one per click
    if (ch === '1' || ch === '2') this.map = this.map.map((r) => r.replaceAll(ch, '.'));
    if (this.map[c.y][c.x] === ch) return;
    this.setCell(c.x, c.y, ch);
    if (this.mirror && ground) {
      const mx = W - 1 - c.x;
      const there = this.map[c.y][mx];
      const flip = ch === '>' ? '<' : ch === '<' ? '>' : ch; // a mirrored belt runs the other way
      if (GROUND.includes(there) || ch === '.') this.setCell(mx, c.y, flip);
    }
    this.hooks.place(ch);
    this.draw();
  }

  private push() {
    this.undo.push(this.map.slice());
    if (this.undo.length > 60) this.undo.shift();
  }

  private doUndo() {
    const m = this.undo.pop();
    if (!m) return;
    this.map = m;
    this.hooks.click();
    this.changed();
  }

  private changed() {
    this.save();
    this.renderUi();
    this.draw();
  }

  draw() {
    if (this.root.hidden) return;
    drawMap(this.cv, this.map, this.hot);
  }

  private renderUi() {
    this.root.querySelectorAll<HTMLButtonElement>('.at-brushes button').forEach((b) => b.classList.toggle('on', b.dataset.ch === this.brush));
    const nameIn = this.root.querySelector<HTMLInputElement>('.at-name input')!;
    if (document.activeElement !== nameIn) nameIn.value = this.name;
    this.root.querySelectorAll<HTMLInputElement>('.at-opts input').forEach((i) => (i.checked = this[i.dataset.o as 'mirror' | 'night' | 'storm']));
    const why = checkAtelier(this.map);
    const lvl = parseLevel({ name: '', map: this.map });
    const st = this.root.querySelector('.at-status')!;
    st.classList.toggle('bad', !!why);
    st.textContent = why ?? `Prête à jouer : ${lvl.enemies.length} tank${lvl.enemies.length > 1 ? 's' : ''} ennemi${lvl.enemies.length > 1 ? 's' : ''}${this.night ? ', de nuit' : ''}${this.storm ? ', sous l’orage' : ''}.`;
    this.root.querySelector<HTMLButtonElement>('[data-a="play"]')!.disabled = !!why;
    this.root.querySelector<HTMLButtonElement>('[data-a="undo"]')!.disabled = !this.undo.length;
  }

  private save() {
    try { localStorage.setItem('tanks.atelier', JSON.stringify(this.value())); } catch {}
  }

  private load() {
    try {
      const a = JSON.parse(localStorage.getItem('tanks.atelier') ?? 'null') as AtelierMap | null;
      if (a && Array.isArray(a.map) && a.map.length === H && a.map.every((r) => typeof r === 'string' && r.length === W)) {
        this.map = a.map.slice(); this.name = String(a.name ?? 'Ma mission'); this.night = !!a.night; this.storm = !!a.storm;
      }
    } catch {}
  }

  private stopAnim() {
    if (this.anim) clearInterval(this.anim);
    this.anim = undefined;
  }

  /** For the videos: draw a whole mission cell by cell, brush by brush, as if someone was painting it. */
  animate(a: AtelierMap, ms: number) {
    this.stopAnim();
    const order: { x: number; y: number; ch: string }[] = [];
    const rank = (ch: string) => { const i = '#Ho_=*+12'.indexOf(ch); return i < 0 ? 20 : i; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a.map[y][x] !== '.') order.push({ x, y, ch: a.map[y][x] });
    order.sort((p, q) => rank(p.ch) - rank(q.ch) || (rank(p.ch) < 5 ? p.y - q.y || p.x - q.x : p.x - q.x));
    this.map = blankMap().map((r) => r.replace(/[12]/g, '.'));
    this.name = '';
    this.night = !!a.night; this.storm = !!a.storm;
    this.renderUi();
    this.draw();
    let k = 0;
    const t0 = performance.now();
    const fullName = a.name;
    this.anim = setInterval(() => {
      // paced by the clock, not by the timer: a busy machine skips frames but still ends on time
      const goal = Math.min(order.length, Math.ceil(((performance.now() - t0) / (ms * 0.8)) * order.length));
      for (let n = 0; k < goal; n++, k++) {
        const c = order[k];
        this.brush = c.ch;
        this.setCell(c.x, c.y, c.ch);
        this.hot = c;
        if (n === 0) this.hooks.place(c.ch);
      }
      this.name = fullName.slice(0, Math.ceil((k / order.length) * fullName.length));
      this.renderUi();
      this.draw();
      if (k >= order.length) { this.hot = undefined; this.name = fullName; this.renderUi(); this.draw(); this.stopAnim(); }
    }, 50);
  }
}
