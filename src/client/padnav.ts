// « Les menus à la manette » (iteration 39): the cross or the left stick moves a wooden frame from button to button
// (the nearest one in that direction), A presses it, B goes back, LB / RB turn the pages of the manual, Start opens the pause menu.
// It only reads the gamepads: the game itself keeps its own controls (input.ts).

export interface PadNavHooks {
  /** The panel the gamepad drives right now (null: the table has the gamepad). */
  root(): HTMLElement | null;
  /** B: close or leave the current panel; false when there is nothing to go back to. */
  back(): boolean;
  /** LB / RB. */
  tab(dir: number): void;
  /** Start, when no panel has the gamepad. */
  start(): void;
}

const FOCUSABLE = 'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])';
const visible = (el: HTMLElement) => {
  if ((el as HTMLButtonElement).disabled) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};

export function padNav(hooks: PadNavHooks) {
  const held = new Set<string>();
  let dirHeld = '';
  let nextRepeat = 0;
  const pressed = (key: string, down: boolean) => {
    const edge = down && !held.has(key);
    if (down) held.add(key); else held.delete(key);
    return edge;
  };
  const using = () => document.body.classList.add('pad-nav');
  for (const ev of ['pointerdown', 'mousemove'] as const) addEventListener(ev, () => document.body.classList.remove('pad-nav'), { passive: true });

  function move(root: HTMLElement, dir: string) {
    const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
    if (!all.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !all.includes(cur)) {
      (all.find((b) => b.classList.contains('primary')) ?? all[0]).focus();
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | undefined, bestScore = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
      const across = dir === 'right' || dir === 'left' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 4) continue;
      // stay in the same row / column when possible: sideways distance costs more than distance ahead
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) {
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else if (dir === 'up' || dir === 'down') scroller(root)?.scrollBy({ top: dir === 'down' ? 140 : -140, behavior: 'smooth' }); // nothing further: read on
  }
  /** The page of text the right stick scrolls (the manual, the journal), else the panel itself. */
  const scroller = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-pad-scroll]') ?? root;

  /** Call once per frame. */
  return function step(now: number) {
    const pads = navigator.getGamepads?.() ?? [];
    let scroll = 0;
    let up = false, down = false, left = false, right = false, a = false, b = false, lb = false, rb = false, st = false;
    for (const p of pads) {
      if (!p) continue;
      const btn = (i: number) => !!p.buttons[i]?.pressed;
      const x = p.axes[0] ?? 0, y = p.axes[1] ?? 0;
      up ||= btn(12) || y < -0.6; down ||= btn(13) || y > 0.6; left ||= btn(14) || x < -0.6; right ||= btn(15) || x > 0.6;
      if (Math.abs(p.axes[3] ?? 0) > 0.3) scroll = p.axes[3];
      a ||= btn(0); b ||= btn(1); lb ||= btn(4); rb ||= btn(5); st ||= btn(9);
    }
    const root = hooks.root();
    const eA = pressed('a', a), eB = pressed('b', b), eL = pressed('lb', lb), eR = pressed('rb', rb), eS = pressed('start', st);
    const dir = up ? 'up' : down ? 'down' : left ? 'left' : right ? 'right' : '';
    let fire = false;
    if (dir !== dirHeld) { dirHeld = dir; fire = !!dir; nextRepeat = now + 380; }
    else if (dir && now >= nextRepeat) { fire = true; nextRepeat = now + 130; }
    if (!root) {
      if (eS) hooks.start();
      return;
    }
    if (fire) { using(); move(root, dir); }
    if (scroll) scroller(root).scrollTop += scroll * 14;
    if (eA) {
      using();
      const cur = document.activeElement as HTMLElement | null;
      if (cur && root.contains(cur) && cur !== document.body && visible(cur)) cur.click();
      else move(root, 'down');
    }
    if (eB) { using(); hooks.back(); }
    if (eL || eR) { using(); hooks.tab(eR ? 1 : -1); }
    if (eS) hooks.back();
  };
}
