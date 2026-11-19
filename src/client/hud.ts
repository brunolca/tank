// « Le réticule » (iteration 44): the tightened HUD. The mission and the enemies up top, the team down below,
// and a reticle under the mouse that carries what the tank has left: shells ready, mines, the reload.

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// ------------------------------------------------------------------ enemy tokens

export interface EnemyToken { color: number; boss: boolean }

let tokenKey = '';
/** The enemies still standing, as little coloured tokens next to their number (rebuilt only when they change). */
export function renderEnemyTokens(el: HTMLElement, list: EnemyToken[]) {
  const sorted = [...list].sort((a, b) => Number(b.boss) - Number(a.boss) || a.color - b.color);
  const key = sorted.map((t) => (t.boss ? 'B' : '') + t.color).join(',');
  if (key === tokenKey && el.dataset.tokens === '1' && el.firstElementChild?.tagName === 'B') return;
  tokenKey = key;
  el.dataset.tokens = '1';
  el.classList.remove('hurry');
  const MAX = 12;
  const shown = sorted.slice(0, MAX).map((t) => `<i class="tok${t.boss ? ' boss' : ''}" style="--c:${hex(t.color)}"></i>`).join('');
  const more = sorted.length > MAX ? `<em>+${sorted.length - MAX}</em>` : '';
  const n = sorted.length;
  el.innerHTML = `<b>${n}</b><span class="lbl">ennemi${n > 1 ? 's' : ''}</span>${n ? `<span class="toks">${shown}${more}</span>` : ''}`;
  el.title = n ? `Encore ${n} tank${n > 1 ? 's' : ''} ennemi${n > 1 ? 's' : ''} sur la table` : 'Plus aucun ennemi';
}
/** The enemy counter goes back to plain text (versus clocks, rounds…). */
export function plainEnemies(el: HTMLElement, text: string) {
  if (el.dataset.tokens === '1') { el.dataset.tokens = ''; tokenKey = ''; el.title = ''; }
  if (el.textContent !== text) el.textContent = text;
}

// ------------------------------------------------------------------ the team, at the bottom

export interface Mate { id: number; name: string; color: number; alive: boolean; me: boolean; bot: boolean }

let teamKey = '';
export function renderTeam(el: HTMLElement, mates: Mate[]) {
  const key = mates.map((m) => `${m.id}:${m.alive ? 1 : 0}:${m.color}:${m.name}`).join('|');
  if (key === teamKey) return;
  teamKey = key;
  el.innerHTML = mates
    .map((m) => `<span class="mate${m.alive ? '' : ' down'}${m.me ? ' me' : ''}" style="--c:${hex(m.color)}" title="${esc(m.name)}${m.bot ? ' (IA)' : ''}${m.alive ? '' : ' : hors de combat'}"><i class="tank-ico"></i><span>${esc(m.name)}</span></span>`)
    .join('');
}

// ------------------------------------------------------------------ the reticle

export interface ReticleState {
  x: number; // screen position
  y: number;
  max: number; // shells
  ready: number;
  mines: number; // mines the tank may lay
  minesLeft: number;
  reload: number; // 0 (ready) to 1 (just fired)
  off: boolean; // cannot fire (ceasefire, frozen…)
  color: number; // the player's colour
}

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 84, C = SIZE / 2;

export class Reticle {
  readonly el: SVGSVGElement;
  private ring: SVGCircleElement;
  private shells: SVGGElement;
  private mineG: SVGGElement;
  private shellKey = '';
  private mineKey = '';
  private shown = false;
  private lastReady = -1;

  constructor() {
    const svg = document.createElementNS(NS, 'svg');
    svg.id = 'reticle';
    svg.setAttribute('width', String(SIZE));
    svg.setAttribute('height', String(SIZE));
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `
      <g class="cross">
        <circle cx="${C}" cy="${C}" r="11" class="track"/>
        <circle cx="${C}" cy="${C}" r="11" class="load" pathLength="100" transform="rotate(-90 ${C} ${C})"/>
        <path d="M${C} ${C - 7}V${C - 3}M${C} ${C + 3}V${C + 7}M${C - 7} ${C}H${C - 3}M${C + 3} ${C}H${C + 7}" class="hair"/>
        <circle cx="${C}" cy="${C}" r="1.6" class="dot"/>
      </g>
      <g class="shells"></g>
      <g class="mines"></g>`;
    this.el = svg;
    this.ring = svg.querySelector('.load')!;
    this.shells = svg.querySelector('.shells')!;
    this.mineG = svg.querySelector('.mines')!;
    document.body.appendChild(svg);
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.remove('on');
    document.body.classList.remove('aiming');
  }

  /** A shot with nothing in the barrel: the shells shake. */
  dry() {
    this.el.classList.remove('dry');
    void this.el.getBoundingClientRect();
    this.el.classList.add('dry');
  }

  update(s: ReticleState) {
    if (!this.shown) { this.shown = true; this.el.classList.add('on'); document.body.classList.add('aiming'); }
    this.el.style.transform = `translate(${(s.x - C).toFixed(1)}px, ${(s.y - C).toFixed(1)}px)`;
    this.el.style.setProperty('--me', hex(s.color));
    // shells: an arc of pips over the cross, from left to right
    const sk = `${s.max}`;
    if (sk !== this.shellKey) {
      this.shellKey = sk;
      const step = s.max > 5 ? 14 : 17, r = 21;
      let html = '';
      for (let i = 0; i < s.max; i++) {
        const a = ((-90 + (i - (s.max - 1) / 2) * step) * Math.PI) / 180;
        const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
        const deg = (a * 180) / Math.PI + 90;
        html += `<g transform="rotate(${deg.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"><rect x="${(x - 2.6).toFixed(1)}" y="${(y - 4.6).toFixed(1)}" width="5.2" height="9.2" rx="2.6"/></g>`;
      }
      this.shells.innerHTML = html;
      this.lastReady = -1;
    }
    if (s.ready !== this.lastReady) {
      const pips = this.shells.querySelectorAll('rect');
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('full', i < s.ready);
      if (s.ready > this.lastReady && this.lastReady >= 0) { // a shell comes back: the new pip pops
        const p = pips[s.ready - 1];
        p?.classList.remove('pop'); void (p as SVGElement | undefined)?.getBoundingClientRect(); p?.classList.add('pop');
      }
      this.lastReady = s.ready;
    }
    // mines: little discs under the cross
    const mk = `${s.mines}:${s.minesLeft}`;
    if (mk !== this.mineKey) {
      this.mineKey = mk;
      let html = '';
      for (let i = 0; i < s.mines; i++) {
        const x = C + (i - (s.mines - 1) / 2) * 9, y = C + 22;
        html += `<circle cx="${x.toFixed(1)}" cy="${y}" r="3.3"${i < s.minesLeft ? ' class="full"' : ''}/>`;
      }
      this.mineG.innerHTML = html;
    }
    this.ring.style.strokeDasharray = `${(Math.max(0, Math.min(1, 1 - s.reload)) * 100).toFixed(1)} 100`;
    this.el.classList.toggle('loading', s.reload > 0.001);
    this.el.classList.toggle('empty', s.ready <= 0);
    this.el.classList.toggle('off', s.off);
  }
}
