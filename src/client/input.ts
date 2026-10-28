// Keyboard + mouse, gamepad and touch (twin-stick) controls.

export interface InputSample {
  mx: number;
  my: number;
  aimX: number | null; // arena coords to aim at (mouse/touch)
  aimY: number | null;
  aimAng: number | null; // direct angle (gamepad)
  fire: boolean;
  mine: boolean;
}

export class Controls {
  private keys = new Set<string>();
  private fireLatch = false;
  private mineLatch = false;
  private mouse: { x: number; y: number } | null = null;
  private padFireHeld = false;
  private padMineHeld = false;
  private lastPadAim: number | null = null;
  usingPad = false;
  suspended = false; // a modal (feedback) is open
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
      if (e.code === 'Enter' && !e.repeat) this.fireLatch = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    target.addEventListener('mousemove', (e) => { this.mouse = { x: e.clientX, y: e.clientY }; this.usingPad = false; });
    target.addEventListener('mousedown', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (e.button === 0) this.fireLatch = true;
      if (e.button === 2) this.mineLatch = true;
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

  release() {
    this.keys.clear();
  }

  sample(): InputSample {
    if (this.suspended) {
      this.fireLatch = this.mineLatch = false;
      return { mx: 0, my: 0, aimX: null, aimY: null, aimAng: null, fire: false, mine: false };
    }
    let mx = 0, my = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) my -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    let aimAng: number | null = null;
    let fire = this.fireLatch, mine = this.mineLatch;
    this.fireLatch = this.mineLatch = false;

    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
      const lx = dz(p.axes[0] ?? 0), ly = dz(p.axes[1] ?? 0);
      const rx = p.axes[2] ?? 0, ry = p.axes[3] ?? 0;
      if (lx || ly) { mx = lx; my = ly; this.usingPad = true; }
      if (Math.hypot(rx, ry) > 0.35) { this.lastPadAim = Math.atan2(ry, rx); this.usingPad = true; }
      const fireBtn = !!(p.buttons[7]?.pressed || p.buttons[5]?.pressed);
      const mineBtn = !!(p.buttons[6]?.pressed || p.buttons[4]?.pressed || p.buttons[0]?.pressed);
      if (fireBtn && !this.padFireHeld) fire = true;
      if (mineBtn && !this.padMineHeld) mine = true;
      this.padFireHeld = fireBtn;
      this.padMineHeld = mineBtn;
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
    return { mx, my, aimX, aimY, aimAng, fire, mine };
  }
}
