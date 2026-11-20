// Keyboard + mouse, gamepad and touch (twin-stick) controls.

export interface InputSample {
  mx: number;
  my: number;
  aimX: number | null; // arena coords to aim at (mouse/touch)
  aimY: number | null;
  aimAng: number | null; // direct angle (gamepad)
  fire: boolean;
  mine: boolean;
  rally: boolean; // « Suis-moi ! » to the AI teammates (iteration 20): T, or Y on a gamepad
  emote: number; // « Les bulles » (iteration 30): the d-pad of a gamepad (up, right, down, left: lines 0 to 3 of EMOTES), -1 none
}

/** « La roue des bulles » (iteration 46): how long the right button must be held, or how far dragged, to open the wheel. */
export const WHEEL_HOLD = 220;
const WHEEL_DRAG = 18;

export class Controls {
  private keys = new Set<string>();
  private fireLatch = false;
  private mineLatch = false;
  private mouse: { x: number; y: number } | null = null;
  private padFireHeld = false;
  private padMineHeld = false;
  private padRallyHeld = false;
  private rallyLatch = false;
  private padDpad = -1;
  private lastPadAim: number | null = null;
  usingPad = false;
  private overTarget = false;
  suspended = false; // a modal (feedback) is open
  padMenu = false; // the pause menu is open: the gamepad picks its entries (iteration 39)
  // touch
  private moveTouch: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private aimTouch: { id: number; x: number; y: number } | null = null;
  touchMode = false;
  private stickEl: HTMLElement;
  private knobEl: HTMLElement;

  constructor(private target: HTMLElement, private toArena: (cx: number, cy: number) => { x: number; y: number } | null, mineBtn: HTMLElement) {
    addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || this.suspended) return;
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) { this.mineLatch = true; e.preventDefault(); }
      if (e.code === 'KeyT' && !e.repeat) this.rallyLatch = true;
      // several fire keys, for those who aim with the mouse but would rather not click (iteration 13)
      if ((e.code === 'Enter' || e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) this.fireLatch = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.cancelWheel(); });
    target.addEventListener('mousemove', (e) => {
      const r = this.right;
      if (r) {
        // « La roue des bulles » (iteration 46): a drag with the right button held opens the wheel at once
        if (!r.open && Math.hypot(e.clientX - r.x, e.clientY - r.y) > WHEEL_DRAG) this.openWheel();
        if (r.open) return; // the turret stays where it was while we pick a line (the window's listener below moves the wheel)
      }
      this.mouse = { x: e.clientX, y: e.clientY }; this.usingPad = false; this.overTarget = true;
    });
    target.addEventListener('mouseleave', () => { this.overTarget = false; });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse = { x: e.clientX, y: e.clientY }; this.fireLatch = true; }
      if (e.button === 2) {
        this.mouse = { x: e.clientX, y: e.clientY };
        // a quick right click still lays a mine (on release); held, it opens the wheel of the quick-chat bubbles
        if (!this.wheelOn || !this.wheel) { this.mineLatch = true; return; }
        this.right = { x: e.clientX, y: e.clientY, open: false };
        clearTimeout(this.rightTimer);
        this.rightTimer = setTimeout(() => this.openWheel(), WHEEL_HOLD);
      }
    });
    addEventListener('mousemove', (e) => { if (this.right?.open) this.wheel?.('move', e.clientX, e.clientY); });
    addEventListener('mouseup', (e) => {
      if (e.button !== 2 || !this.right) return;
      clearTimeout(this.rightTimer);
      const r = this.right;
      this.right = null;
      if (r.open) this.wheel?.('close', e.clientX, e.clientY);
      else if (!this.suspended) this.mineLatch = true;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());

    this.stickEl = document.createElement('div');
    this.stickEl.className = 'stick';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'knob';
    this.stickEl.appendChild(this.knobEl);
    document.body.appendChild(this.stickEl);

    target.addEventListener('touchstart', (e) => {
      this.touchMode = true;
      document.body.classList.add('touch');
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < innerWidth * 0.45 && !this.moveTouch) {
          this.moveTouch = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
          this.stickEl.style.display = 'block';
          this.stickEl.style.left = `${t.clientX}px`;
          this.stickEl.style.top = `${t.clientY}px`;
          this.knobEl.style.transform = 'translate(-50%,-50%)';
        } else if (!this.aimTouch) {
          this.aimTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
          this.fireLatch = true;
        }
      }
      e.preventDefault();
    }, { passive: false });
    target.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.moveTouch?.id === t.identifier) {
          this.moveTouch.x = t.clientX; this.moveTouch.y = t.clientY;
          const dx = t.clientX - this.moveTouch.ox, dy = t.clientY - this.moveTouch.oy;
          const l = Math.min(50, Math.hypot(dx, dy));
          const a = Math.atan2(dy, dx);
          this.knobEl.style.transform = `translate(calc(-50% + ${Math.cos(a) * l}px), calc(-50% + ${Math.sin(a) * l}px))`;
        }
        if (this.aimTouch?.id === t.identifier) { this.aimTouch.x = t.clientX; this.aimTouch.y = t.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.moveTouch?.id === t.identifier) { this.moveTouch = null; this.stickEl.style.display = 'none'; }
        if (this.aimTouch?.id === t.identifier) {
          this.mouse = { x: t.clientX, y: t.clientY };
          this.aimTouch = null;
        }
      }
    };
    target.addEventListener('touchend', end);
    target.addEventListener('touchcancel', end);
    mineBtn.addEventListener('touchstart', (e) => { this.mineLatch = true; e.preventDefault(); e.stopPropagation(); }, { passive: false });
    mineBtn.addEventListener('click', () => { this.mineLatch = true; });
  }

  /** « Le réticule » (iteration 44): where the mouse points on the screen, while it is over the table and is the way we aim. */
  pointer(): { x: number; y: number } | null {
    return this.mouse && this.overTarget && !this.usingPad && !this.aimTouch && !this.touchMode ? this.mouse : null;
  }

  release() {
    this.keys.clear();
    this.cancelWheel();
  }

  // « La roue des bulles » (iteration 46): right button held (or dragged) over the table
  /** Off in the options: the right click lays its mine at once, as before. */
  wheelOn = true;
  /** Set by the game: 'open' answers whether the wheel may open here (online, in a game), then 'move' and 'close'. */
  wheel?: (phase: 'open' | 'move' | 'close' | 'cancel', x: number, y: number) => boolean;
  private right: { x: number; y: number; open: boolean } | null = null;
  private rightTimer?: ReturnType<typeof setTimeout>;
  private openWheel() {
    const r = this.right;
    clearTimeout(this.rightTimer);
    if (!r || r.open) return;
    if (this.suspended || !this.wheel?.('open', r.x, r.y)) { this.right = null; this.mineLatch = !this.suspended; return; } // no wheel here: the mine, as usual
    r.open = true;
  }
  cancelWheel() {
    clearTimeout(this.rightTimer);
    if (this.right?.open) this.wheel?.('cancel', 0, 0);
    this.right = null;
  }

  /** A jolt in the hands (iteration 16): the gamepad rumbles if it can, a touch phone buzzes. */
  rumble(strength: number, ms: number) {
    try {
      if (this.usingPad) {
        for (const p of navigator.getGamepads?.() ?? []) {
          const act = (p as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null)?.vibrationActuator;
          if (p?.connected && act?.playEffect) { act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: Math.min(1, strength + 0.2) }).catch(() => {}); break; }
        }
      } else if (this.touchMode && navigator.vibrate) navigator.vibrate(ms);
    } catch { /* no rumble here: never mind */ }
  }

  sample(): InputSample {
    if (this.suspended) {
      this.fireLatch = this.mineLatch = this.rallyLatch = false;
      return { mx: 0, my: 0, aimX: null, aimY: null, aimAng: null, fire: false, mine: false, rally: false, emote: -1 };
    }
    let mx = 0, my = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) my -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    let aimAng: number | null = null;
    let fire = this.fireLatch, mine = this.mineLatch, rally = this.rallyLatch, emote = -1;
    this.fireLatch = this.mineLatch = this.rallyLatch = false;

    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
      const lx = dz(p.axes[0] ?? 0), ly = dz(p.axes[1] ?? 0);
      const rx = p.axes[2] ?? 0, ry = p.axes[3] ?? 0;
      // the pause menu has the gamepad (iteration 39): its buttons pick menu entries, they don't drive the tank
      if (this.padMenu) { this.padFireHeld = this.padMineHeld = this.padRallyHeld = true; this.padDpad = 0; break; }
      if (lx || ly) { mx = lx; my = ly; this.usingPad = true; }
      if (Math.hypot(rx, ry) > 0.35) { this.lastPadAim = Math.atan2(ry, rx); this.usingPad = true; }
      const fireBtn = !!(p.buttons[7]?.pressed || p.buttons[5]?.pressed || p.buttons[2]?.pressed);
      const mineBtn = !!(p.buttons[6]?.pressed || p.buttons[4]?.pressed || p.buttons[0]?.pressed);
      if (fireBtn && !this.padFireHeld) fire = true;
      if (mineBtn && !this.padMineHeld) mine = true;
      this.padFireHeld = fireBtn;
      this.padMineHeld = mineBtn;
      const rallyBtn = !!p.buttons[3]?.pressed;
      if (rallyBtn && !this.padRallyHeld) rally = true;
      this.padRallyHeld = rallyBtn;
      // the d-pad: up « Bravo ! », right « Merci ! », down « Oups ! », left « Par ici ! »
      const dpad = [12, 15, 13, 14].findIndex((b) => p.buttons[b]?.pressed);
      if (dpad >= 0 && dpad !== this.padDpad) emote = dpad;
      this.padDpad = dpad;
      if (this.usingPad) aimAng = this.lastPadAim;
      break;
    }

    if (this.moveTouch) {
      const dx = this.moveTouch.x - this.moveTouch.ox, dy = this.moveTouch.y - this.moveTouch.oy;
      const l = Math.hypot(dx, dy);
      if (l > 8) { const s = Math.min(1, l / 50); mx = (dx / l) * s; my = (dy / l) * s; }
    }

    let aimX: number | null = null, aimY: number | null = null;
    const pt = this.aimTouch ?? (this.usingPad ? null : this.mouse);
    if (pt) {
      const p = this.toArena(pt.x, pt.y);
      if (p) { aimX = p.x; aimY = p.y; }
    }
    return { mx, my, aimX, aimY, aimAng, fire, mine, rally, emote };
  }
}
