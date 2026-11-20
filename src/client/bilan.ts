// « Le bilan » (iteration 45, step 3 of the new interface): the full-screen briefing before a mission (as in the
// original: « Mission 7 · Tanks ennemis : 4 »), and the end-of-mission sheet torn from a notebook: the tanks destroyed,
// colour by colour, line after line, the red « RÉUSSIE » stamp, then three stars.
import { STAR_LABELS, starCount, type Tally } from '../shared/bilan';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const clock = (sec: number) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const STAR = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3.5l4.9 10.6 11.6 1.3-8.6 7.9 2.4 11.4L20 28.9 9.7 34.7l2.4-11.4-8.6-7.9 11.6-1.3z"/></svg>';

export type TankArt = (kind: string) => string;
export type KindLabel = (kind: string) => string;

// ------------------------------------------------------------------ the record of each mission (stars, kept on this device)

const STARS_KEY = 'tanks.etoiles';
function loadStars(): Record<string, number> {
  try { const o = JSON.parse(localStorage.getItem(STARS_KEY) ?? '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
/** Best stars won on that campaign mission (undefined: never cleared here). */
export function starRecord(mission: number): number | undefined {
  const v = loadStars()[String(mission)];
  return typeof v === 'number' ? v : undefined;
}
/** Keep the stars of a campaign mission; true when they beat the record (a first clear counts if it has a star). */
export function saveStars(mission: number, n: number): boolean {
  const all = loadStars();
  const old = all[String(mission)];
  if (typeof old === 'number' && old >= n) return false;
  all[String(mission)] = n;
  try { localStorage.setItem(STARS_KEY, JSON.stringify(all)); } catch { /* private mode: no record */ }
  return n > 0;
}
/** All the stars won in the campaign, on this device. */
export function starTotal(): { stars: number; missions: number } {
  const v = Object.values(loadStars()).filter((n) => typeof n === 'number');
  return { stars: v.reduce((a, b) => a + b, 0), missions: v.length };
}
export const starsText = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));

// ------------------------------------------------------------------ the briefing

export interface BriefView {
  kicker: string; // « Mission », « Défi du jour · étape »…
  big: string; // the number, very big (« 7 », « 2/5 »)
  name: string;
  sub: string; // a line under the count (the boss's tip, the twist of the day)
  wx: string[]; // the weather of the table
  kinds: [string, number][]; // enemy kinds and how many, bosses first
  total: number;
  record?: number; // stars already won here
  cls: string;
}

let briefOut: ReturnType<typeof setTimeout> | undefined;
export function showBrief(v: BriefView, art: TankArt, label: KindLabel) {
  const el = $('#brief');
  clearTimeout(briefOut);
  const tanks = v.kinds.map(([k, n], i) => `<li style="--i:${i}"><span class="art">${art(k)}</span><b>${n > 1 ? `× ${n}` : ''}</b><small>${esc(label(k))}</small></li>`).join('');
  el.className = v.cls;
  el.innerHTML = `<div class="br-card">
    <div class="br-kicker">${esc(v.kicker)}</div>
    ${v.big ? `<div class="br-num">${esc(v.big)}</div>` : ''}
    <div class="br-name">${esc(v.name)}</div>
    ${v.wx.length ? `<div class="br-wx">${v.wx.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : ''}
    <div class="br-count">Tanks ennemis : <b>${v.total}</b></div>
    <ul class="br-tanks">${tanks}</ul>
    ${v.sub ? `<div class="br-sub">${esc(v.sub)}</div>` : ''}
    ${v.record !== undefined ? `<div class="br-record">Ton record ici : <span class="stars">${starsText(v.record)}</span></div>` : ''}
  </div>`;
  el.hidden = false;
  el.classList.remove('out');
}
/** The briefing fades away (the mission starts), or vanishes at once. */
export function hideBrief(fade = true) {
  const el = $('#brief');
  if (el.hidden) return;
  clearTimeout(briefOut);
  if (!fade) { el.hidden = true; return; }
  el.classList.add('out');
  briefOut = setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 520);
}
export const briefShown = () => !$('#brief').hidden && !$('#brief').classList.contains('out');

// ------------------------------------------------------------------ the sheet

export interface SheetView { kicker: string; title: string; sub: string; tally: Tally; best?: boolean }
export interface SheetSounds { tick(i: number): void; stamp(): void; star(i: number, on: boolean): void }

let waiting = false;
let timers: ReturnType<typeof setTimeout>[] = [];
let sounds: SheetSounds | undefined;
let lines = 0;

const LINE = 300; // ms between two lines of the count
const lead = 350;

export function showSheet(v: SheetView, art: TankArt, label: KindLabel, sfx: SheetSounds) {
  const el = $('#sheet');
  const t = v.tally;
  const total = t.k.reduce((n, [, c]) => n + c, 0);
  lines = t.k.length;
  sounds = sfx;
  const rows = t.k.map(([k, n], i) => `<li style="--i:${i}"><span class="art">${art(k)}</span><span class="nm">${esc(label(k))}</span><i class="dots"></i><b>× ${n}</b></li>`).join('');
  const details = [
    t.falls ? `${t.falls} chute${t.falls > 1 ? 's' : ''}` : 'Aucune chute',
    `${clock(t.s)} · objectif ${clock(t.par)}`,
    `${t.shots} obus tiré${t.shots > 1 ? 's' : ''} · ${t.budget} au plus`,
  ];
  const stars = t.stars.map((on, i) => `<li class="${on ? 'on' : ''}" style="--i:${i}">${STAR}<b>${STAR_LABELS[i]}</b><small>${details[i]}</small></li>`).join('');
  el.innerHTML = `<div class="sh-holes"></div>
    <div class="sh-kicker">${esc(v.kicker)}</div>
    <div class="sh-title">${esc(v.title)}</div>
    ${v.sub ? `<div class="sh-sub">${esc(v.sub)}</div>` : ''}
    <ol class="sh-lines">${rows || '<li class="none" style="--i:0">Aucun tank détruit</li>'}</ol>
    <div class="sh-total" style="--i:${Math.max(1, lines)}"><span>Total</span><i class="dots"></i><b>${total}</b></div>
    <div class="sh-stamp">Réussie</div>
    <ul class="sh-stars">${stars}</ul>
    ${v.best ? '<div class="sh-best">Nouveau record !</div>' : ''}`;
  el.style.setProperty('--n', String(Math.max(1, lines)));
  el.dataset.stars = String(starCount(t));
  el.hidden = false;
  el.classList.remove('play');
  waiting = true;
}

/** The sheet waits behind the replay; play its count now (lines, stamp, stars) with their sounds. */
export function playSheet() {
  const el = $('#sheet');
  if (el.hidden) { waiting = false; return; }
  waiting = false;
  for (const t of timers) clearTimeout(t);
  timers = [];
  el.classList.remove('play');
  void el.offsetWidth;
  el.classList.add('play');
  const n = Math.max(1, lines);
  for (let i = 0; i < n + 1; i++) timers.push(setTimeout(() => sounds?.tick(i), lead + i * LINE));
  const stampAt = lead + (n + 1) * LINE + 150;
  timers.push(setTimeout(() => sounds?.stamp(), stampAt));
  const on = [...el.querySelectorAll('.sh-stars li')].map((li) => li.classList.contains('on'));
  on.forEach((s, i) => timers.push(setTimeout(() => sounds?.star(i, s), stampAt + 450 + i * 280)));
}
export const sheetWaiting = () => waiting && !$('#sheet').hidden;
export const sheetShown = () => !$('#sheet').hidden;
/** How long the count takes to play, in ms (the skill tree waits for it). */
export const sheetLength = () => lead + (Math.max(1, lines) + 1) * LINE + 150 + 450 + 3 * 280 + 400;

export function hideSheet() {
  const el = $('#sheet');
  waiting = false;
  for (const t of timers) clearTimeout(t);
  timers = [];
  if (!el.hidden) { el.hidden = true; el.classList.remove('play'); }
}
