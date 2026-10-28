import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ENEMY_COLORS, H, MINE_BLAST, Tile, W } from '../shared/constants';
import type { TankInfo } from '../shared/protocol';

export interface RTank { id: number; x: number; y: number; body: number; turret: number; alive: boolean; invisible: boolean }
export interface RBullet { id: number; x: number; y: number; vx: number; vy: number; rocket: boolean }
export interface RMine { id: number; x: number; y: number; blink: boolean }

const PX = 64; // floor texture pixels per tile
const WALL_H = 0.8;
const TALL_H = 1.5;

// ------------------------------------------------------------------ particles

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  s0: number; s1: number;
  c0: THREE.Color; c1: THREE.Color;
  grav: number; drag: number;
}

class ParticleSystem {
  mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private free: number[] = [];
  private active = new Set<number>();
  private m = new THREE.Matrix4();
  private col = new THREE.Color();
  constructor(scene: THREE.Scene, max: number, material: THREE.Material, castShadow = false) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
      this.free.push(i);
      this.parts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0, s1: 0, c0: new THREE.Color(), c1: new THREE.Color(), grav: 0, drag: 0 });
    }
    scene.add(this.mesh);
  }
  emit(o: { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number; life: number; s0: number; s1: number; c0: THREE.ColorRepresentation; c1?: THREE.ColorRepresentation; grav?: number; drag?: number }) {
    const i = this.free.pop();
    if (i === undefined) return;
    const p = this.parts[i];
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
    p.life = 0; p.max = o.life; p.s0 = o.s0; p.s1 = o.s1;
    p.c0.set(o.c0); p.c1.set(o.c1 ?? o.c0);
    p.grav = o.grav ?? 0; p.drag = o.drag ?? 0;
    this.active.add(i);
  }
  update(dt: number) {
    for (const i of this.active) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.active.delete(i);
        this.free.push(i);
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3; }
      const u = p.life / p.max;
      const s = p.s0 + (p.s1 - p.s0) * u;
      this.m.makeScale(s, s, s);
      this.m.setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, this.m);
      this.col.copy(p.c0).lerp(p.c1, u);
      this.mesh.setColorAt(i, this.col);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() {
    for (const i of this.active) {
      this.free.push(i);
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.active.clear();
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ textures

function noiseCanvas(w: number, h: number, base: string, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function woodTexture(base: string, grain: string) {
  return noiseCanvas(128, 128, base, (g) => {
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = grain;
      g.globalAlpha = 0.08 + Math.random() * 0.12;
      g.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * 128;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + Math.sin(x / 20 + i) * 3);
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

function corkTexture() {
  return noiseCanvas(128, 128, '#c98f55', (g) => {
    for (let i = 0; i < 900; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(90,50,20,0.35)' : 'rgba(255,220,170,0.25)';
      const s = 1 + Math.random() * 3;
      g.fillRect(Math.random() * 128, Math.random() * 128, s, s);
    }
  });
}

function shade(hex: number, k: number) {
  const c = new THREE.Color(hex);
  if (k > 0) c.lerp(new THREE.Color(0xffffff), k); else c.lerp(new THREE.Color(0x000000), -k);
  return c;
}

// ------------------------------------------------------------------ tank model

interface TankView {
  info: TankInfo;
  root: THREE.Group;
  hull: THREE.Group;
  turret: THREE.Group;
  ring?: THREE.Mesh;
  lastMarkX: number;
  lastMarkY: number;
  wasAlive: boolean;
  recoil: number;
  materials: THREE.MeshStandardMaterial[];
}

const geo = {
  body: new RoundedBoxGeometry(0.8, 0.24, 0.6, 3, 0.07),
  tread: new RoundedBoxGeometry(0.86, 0.2, 0.17, 3, 0.07),
  dome: new THREE.CylinderGeometry(0.19, 0.23, 0.15, 24),
  cap: new THREE.SphereGeometry(0.19, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  barrel: new THREE.CylinderGeometry(0.052, 0.058, 0.48, 14),
  muzzle: new THREE.CylinderGeometry(0.072, 0.072, 0.08, 14),
  ring: new THREE.RingGeometry(0.46, 0.54, 40),
  bullet: new THREE.CapsuleGeometry(0.075, 0.14, 4, 10),
  mineBase: new THREE.CylinderGeometry(0.2, 0.24, 0.08, 24),
  mineTop: new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  mineLed: new THREE.SphereGeometry(0.045, 10, 8),
  shock: new THREE.RingGeometry(0.85, 1, 48),
};

const treadMat = new THREE.MeshStandardMaterial({ color: 0x24252b, roughness: 0.9 });

function buildTank(info: TankInfo): TankView {
  const color = info.kind === 'player' ? info.color : ENEMY_COLORS[info.kind];
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.08 });
  const topMat = new THREE.MeshStandardMaterial({ color: shade(color, 0.18), roughness: 0.4, metalness: 0.08 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: shade(color, -0.35), roughness: 0.5, metalness: 0.3 });
  const root = new THREE.Group();
  const hull = new THREE.Group();
  const body = new THREE.Mesh(geo.body, bodyMat);
  body.position.y = 0.25;
  hull.add(body);
  for (const z of [-0.3, 0.3]) {
    const tr = new THREE.Mesh(geo.tread, treadMat);
    tr.position.set(0, 0.12, z);
    hull.add(tr);
  }
  const turret = new THREE.Group();
  turret.position.y = 0.37;
  const dome = new THREE.Mesh(geo.dome, topMat);
  dome.position.y = 0.06;
  const cap = new THREE.Mesh(geo.cap, topMat);
  cap.position.y = 0.13;
  cap.scale.y = 0.55;
  const barrel = new THREE.Mesh(geo.barrel, barrelMat);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.32, 0.09, 0);
  const muzzle = new THREE.Mesh(geo.muzzle, barrelMat);
  muzzle.rotation.z = Math.PI / 2;
  muzzle.position.set(0.56, 0.09, 0);
  turret.add(dome, cap, barrel, muzzle);
  root.add(hull, turret);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  const view: TankView = { info, root, hull, turret, lastMarkX: NaN, lastMarkY: NaN, wasAlive: true, recoil: 0, materials: [bodyMat, topMat, barrelMat] };
  if (info.kind === 'player') {
    const ring = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.015;
    root.add(ring);
    view.ring = ring;
  }
  return view;
}

// ------------------------------------------------------------------ renderer

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private camTarget = new THREE.Vector3(W / 2, 0, H / 2 + 0.4);
  private shake = 0;
  private floorCanvas!: HTMLCanvasElement;
  private floorCtx!: CanvasRenderingContext2D;
  private floorTex!: THREE.CanvasTexture;
  private floorDirty = false;
  private floorTimer = 0;
  private levelGroup = new THREE.Group();
  private blocks = new Map<number, THREE.Mesh>();
  private tanks = new Map<number, TankView>();
  private bullets = new Map<number, THREE.Mesh>();
  private mines = new Map<number, THREE.Group>();
  private glow: ParticleSystem;
  private smoke: ParticleSystem;
  private debris: ParticleSystem;
  private shocks: { mesh: THREE.Mesh; t: number; max: number; size: number }[] = [];
  private flash: THREE.PointLight;
  private flashT = 0;
  private bulletMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.6, roughness: 0.3 });
  private rocketMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xff7a1a, emissiveIntensity: 1.2, roughness: 0.3 });
  private mineMat = new THREE.MeshStandardMaterial({ color: 0xf4c542, roughness: 0.5, metalness: 0.2 });
  private mineTopMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6 });
  private ledOn = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  private ledOff = new THREE.MeshBasicMaterial({ color: 0x551515 });
  private wallGeo = new RoundedBoxGeometry(0.98, WALL_H, 0.98, 3, 0.06);
  private tallGeo = new RoundedBoxGeometry(0.98, TALL_H, 0.98, 3, 0.06);
  private wallMat = new THREE.MeshStandardMaterial({ map: woodTexture('#d9b98a', '#8a5a2b'), roughness: 0.75 });
  private tallMat = new THREE.MeshStandardMaterial({ map: woodTexture('#c9a46f', '#6e4520'), roughness: 0.75 });
  private corkMat = new THREE.MeshStandardMaterial({ map: corkTexture(), roughness: 0.95 });
  private raycaster = new THREE.Raycaster();
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.45);
  time = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);

    const hemi = new THREE.HemisphereLight(0xfff3e0, 0x5a4a3c, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(W / 2 - 7, 20, H / 2 - 9);
    sun.target.position.set(W / 2, 0, H / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -17; sc.right = 17; sc.top = 15; sc.bottom = -15; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    this.scene.add(sun, sun.target);
    const rim = new THREE.DirectionalLight(0x9ec5ff, 0.5);
    rim.position.set(W / 2 + 10, 8, H / 2 + 12);
    this.scene.add(rim);

    this.flash = new THREE.PointLight(0xffa040, 0, 7, 1.6);
    this.scene.add(this.flash);

    // table under the arena
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.95 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.set(W / 2, -0.02, H / 2);
    table.receiveShadow = true;
    this.scene.add(table);

    // border frame
    const frameMat = new THREE.MeshStandardMaterial({ map: woodTexture('#8a5a36', '#4a2a12'), roughness: 0.7 });
    const add = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, WALL_H + 0.1, d, 3, 0.08), frameMat);
      m.position.set(x, (WALL_H + 0.1) / 2 - 0.02, z);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    };
    add(W + 1.2, 0.6, W / 2, -0.3);
    add(W + 1.2, 0.6, W / 2, H + 0.3);
    add(0.6, H, -0.3, H / 2);
    add(0.6, H, W + 0.3, H / 2);

    // floor
    this.floorCanvas = document.createElement('canvas');
    this.floorCanvas.width = W * PX;
    this.floorCanvas.height = H * PX;
    this.floorCtx = this.floorCanvas.getContext('2d')!;
    this.floorTex = new THREE.CanvasTexture(this.floorCanvas);
    this.floorTex.colorSpace = THREE.SRGBColorSpace;
    this.floorTex.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.scene.add(this.levelGroup);

    this.glow = new ParticleSystem(this.scene, 900, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.smoke = new ParticleSystem(this.scene, 1400, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.32, depthWrite: false }));
    this.debris = new ParticleSystem(this.scene, 300, new THREE.MeshStandardMaterial({ roughness: 0.6 }), true);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const elev = THREE.MathUtils.degToRad(64);
    const needH = (H + 2.2) * Math.sin(elev) + 1.2;
    const needW = (W + 2.2) / aspect;
    const dist = Math.max(needH, needW) / (2 * Math.tan(fov / 2)) * 1.04;
    this.camera.position.set(this.camTarget.x, Math.sin(elev) * dist, this.camTarget.z + Math.cos(elev) * dist);
    this.camera.lookAt(this.camTarget);
    this.camera.updateProjectionMatrix();
    this.basePos.copy(this.camera.position);
  }
  private basePos = new THREE.Vector3();

  // ---------------------------------------------------------------- level

  setLevel(tiles: number[], infos: TankInfo[]) {
    for (const m of this.blocks.values()) this.levelGroup.remove(m);
    this.blocks.clear();
    for (const t of this.tanks.values()) this.scene.remove(t.root);
    this.tanks.clear();
    for (const b of this.bullets.values()) this.scene.remove(b);
    this.bullets.clear();
    for (const m of this.mines.values()) this.scene.remove(m);
    this.mines.clear();
    this.glow.clear(); this.smoke.clear(); this.debris.clear();

    this.paintFloor(tiles);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = tiles[y * W + x];
        if (t === Tile.Wall || t === Tile.Tall || t === Tile.Cork) {
          const h = t === Tile.Tall ? TALL_H : WALL_H;
          const m = new THREE.Mesh(t === Tile.Tall ? this.tallGeo : this.wallGeo, t === Tile.Tall ? this.tallMat : t === Tile.Cork ? this.corkMat : this.wallMat);
          m.position.set(x + 0.5, h / 2, y + 0.5);
          if (t === Tile.Cork) m.scale.set(0.96, 0.92, 0.96), (m.position.y = (h * 0.92) / 2);
          m.castShadow = m.receiveShadow = true;
          this.levelGroup.add(m);
          this.blocks.set(y * W + x, m);
        }
      }
    }
    for (const info of infos) {
      const v = buildTank(info);
      this.tanks.set(info.id, v);
      this.scene.add(v.root);
    }
  }

  private paintFloor(tiles: number[]) {
    const g = this.floorCtx;
    const cw = this.floorCanvas.width, ch = this.floorCanvas.height;
    const grad = g.createLinearGradient(0, 0, cw, ch);
    grad.addColorStop(0, '#efdcb8');
    grad.addColorStop(1, '#e3cba0');
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
    // paper fibres
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(120,80,40,0.05)' : 'rgba(255,255,255,0.08)';
      g.fillRect(Math.random() * cw, Math.random() * ch, 1 + Math.random() * 3, 1);
    }
    // grid
    g.strokeStyle = 'rgba(140,100,60,0.12)';
    g.lineWidth = 1;
    for (let x = 1; x < W; x++) { g.beginPath(); g.moveTo(x * PX, 0); g.lineTo(x * PX, ch); g.stroke(); }
    for (let y = 1; y < H; y++) { g.beginPath(); g.moveTo(0, y * PX); g.lineTo(cw, y * PX); g.stroke(); }
    // vignette near the border
    const vg = g.createRadialGradient(cw / 2, ch / 2, ch * 0.3, cw / 2, ch / 2, cw * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(80,50,20,0.18)');
    g.fillStyle = vg;
    g.fillRect(0, 0, cw, ch);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = tiles[y * W + x];
        if (t === Tile.Wall || t === Tile.Tall) {
          // soft contact shadow (walls are permanent)
          g.save();
          g.shadowColor = 'rgba(40,20,0,0.45)';
          g.shadowBlur = 18;
          g.fillStyle = 'rgba(60,30,10,0.35)';
          g.fillRect(x * PX + 4, y * PX + 4, PX - 8, PX - 8);
          g.restore();
        } else if (t === Tile.Hole) {
          const cx = x * PX + PX / 2, cy = y * PX + PX / 2;
          const hg = g.createRadialGradient(cx, cy, 2, cx, cy, PX * 0.55);
          hg.addColorStop(0, '#0b0806');
          hg.addColorStop(0.7, '#1c130c');
          hg.addColorStop(1, 'rgba(60,35,15,0.0)');
          g.fillStyle = hg;
          g.beginPath();
          g.roundRect(x * PX + 3, y * PX + 3, PX - 6, PX - 6, 14);
          g.fill();
          g.strokeStyle = 'rgba(255,240,210,0.25)';
          g.lineWidth = 2;
          g.stroke();
        }
      }
    }
    this.floorTex.needsUpdate = true;
  }

  removeBlock(cx: number, cy: number) {
    const key = cy * W + cx;
    const m = this.blocks.get(key);
    if (!m) return;
    this.levelGroup.remove(m);
    this.blocks.delete(key);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      this.debris.emit({
        x: cx + 0.5 + (Math.random() - 0.5) * 0.6, y: 0.4 + Math.random() * 0.4, z: cy + 0.5 + (Math.random() - 0.5) * 0.6,
        vx: Math.cos(a) * (1 + Math.random() * 2.5), vy: 2 + Math.random() * 3, vz: Math.sin(a) * (1 + Math.random() * 2.5),
        life: 1.2 + Math.random() * 0.6, s0: 0.07 + Math.random() * 0.06, s1: 0.03, c0: 0xc98f55, c1: 0x8a5a2b, grav: 9, drag: 0.5,
      });
    }
  }

  private floorMark(fn: (g: CanvasRenderingContext2D) => void) {
    fn(this.floorCtx);
    this.floorDirty = true;
  }

  // ---------------------------------------------------------------- per-frame state

  syncTanks(list: RTank[], myId: number, dt: number) {
    for (const t of list) {
      const v = this.tanks.get(t.id);
      if (!v) continue;
      const visible = t.alive && !(t.invisible && t.id !== myId);
      v.root.visible = visible;
      if (!t.alive) {
        if (v.wasAlive) this.deathMark(t.x, t.y, v.info);
        v.wasAlive = false;
        continue;
      }
      v.wasAlive = true;
      v.root.position.set(t.x, 0, t.y);
      v.hull.rotation.y = -t.body;
      v.turret.rotation.y = -t.turret;
      v.recoil = Math.max(0, v.recoil - dt * 4);
      v.turret.position.x = -Math.cos(t.turret) * v.recoil * 0.12;
      v.turret.position.z = -Math.sin(t.turret) * v.recoil * 0.12;
      if (v.ring) {
        (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(this.time * 4) * 0.25;
      }
      // tread marks
      if (Number.isNaN(v.lastMarkX)) { v.lastMarkX = t.x; v.lastMarkY = t.y; }
      const d = Math.hypot(t.x - v.lastMarkX, t.y - v.lastMarkY);
      if (d > 0.22) {
        const bx = t.x, by = t.y, ang = t.body;
        this.floorMark((g) => {
          g.save();
          g.translate(bx * PX, by * PX);
          g.rotate(ang);
          g.fillStyle = 'rgba(90,60,30,0.16)';
          for (const off of [-0.3, 0.3]) for (let k = -1; k <= 1; k++) g.fillRect(k * 5 - 2, off * PX - 5, 4, 10);
          g.restore();
        });
        v.lastMarkX = t.x; v.lastMarkY = t.y;
        if (Math.random() < 0.5 && !(t.invisible && t.id !== myId)) {
          this.smoke.emit({ x: t.x - Math.cos(t.body) * 0.4, y: 0.08, z: t.y - Math.sin(t.body) * 0.4, vy: 0.3, life: 0.6, s0: 0.06, s1: 0.16, c0: 0xd9c4a0, c1: 0xe8dcc8, drag: 2 });
        }
      }
    }
  }

  syncBullets(list: RBullet[], dt: number) {
    const seen = new Set<number>();
    for (const b of list) {
      seen.add(b.id);
      let m = this.bullets.get(b.id);
      if (!m) {
        m = new THREE.Mesh(geo.bullet, b.rocket ? this.rocketMat : this.bulletMat);
        m.castShadow = true;
        m.rotation.order = 'YXZ';
        this.scene.add(m);
        this.bullets.set(b.id, m);
      }
      m.position.set(b.x, 0.45, b.y);
      m.rotation.y = -Math.atan2(b.vy, b.vx);
      m.rotation.z = Math.PI / 2;
      // trails
      if (b.rocket) {
        const back = 0.18 / Math.hypot(b.vx, b.vy);
        this.glow.emit({ x: b.x - b.vx * back, y: 0.45, z: b.y - b.vy * back, life: 0.18, s0: 0.1, s1: 0.02, c0: 0xffb040, c1: 0xff4010 });
        if (Math.random() < 0.8) this.smoke.emit({ x: b.x - b.vx * back, y: 0.45, z: b.y - b.vy * back, vy: 0.2, life: 0.9, s0: 0.08, s1: 0.26, c0: 0xcfcfcf, c1: 0xf2f2f2, drag: 1.5 });
      } else if (Math.random() < 60 * dt) {
        this.smoke.emit({ x: b.x, y: 0.45, z: b.y, life: 0.35, s0: 0.06, s1: 0.02, c0: 0xffffff, c1: 0xe8e2d8 });
      }
    }
    for (const [id, m] of this.bullets) {
      if (!seen.has(id)) { this.scene.remove(m); this.bullets.delete(id); }
    }
  }

  syncMines(list: RMine[]) {
    const seen = new Set<number>();
    for (const mn of list) {
      seen.add(mn.id);
      let g = this.mines.get(mn.id);
      if (!g) {
        g = new THREE.Group();
        const base = new THREE.Mesh(geo.mineBase, this.mineMat);
        base.position.y = 0.04;
        const top = new THREE.Mesh(geo.mineTop, this.mineTopMat);
        top.position.y = 0.08;
        top.scale.y = 0.6;
        const led = new THREE.Mesh(geo.mineLed, this.ledOff);
        led.position.y = 0.17;
        led.name = 'led';
        g.add(base, top, led);
        g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
        g.position.set(mn.x, 0, mn.y);
        this.scene.add(g);
        this.mines.set(mn.id, g);
      }
      const led = g.getObjectByName('led') as THREE.Mesh;
      const on = mn.blink ? Math.sin(this.time * 22) > 0 : Math.sin(this.time * 3) > 0.6;
      led.material = on ? this.ledOn : this.ledOff;
      if (on && mn.blink && Math.random() < 0.3) this.glow.emit({ x: mn.x, y: 0.2, z: mn.y, life: 0.12, s0: 0.12, s1: 0.02, c0: 0xff3030 });
    }
    for (const [id, g] of this.mines) {
      if (!seen.has(id)) { this.scene.remove(g); this.mines.delete(id); }
    }
  }

  // ---------------------------------------------------------------- effects

  muzzle(x: number, y: number, ang: number, rocket: boolean, shooterId: number) {
    const v = this.tanks.get(shooterId);
    if (v) v.recoil = 1;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let i = 0; i < 8; i++) {
      const s = 1 + Math.random() * 2.5;
      this.glow.emit({ x, y: 0.45, z: y, vx: dx * s + (Math.random() - 0.5), vy: Math.random() * 0.6, vz: dy * s + (Math.random() - 0.5), life: 0.12 + Math.random() * 0.08, s0: 0.12, s1: 0.02, c0: rocket ? 0xffc060 : 0xfff0c0, c1: 0xff6020, drag: 6 });
    }
    for (let i = 0; i < 5; i++) {
      this.smoke.emit({ x, y: 0.45, z: y, vx: dx * (0.5 + Math.random()), vy: 0.3 + Math.random() * 0.4, vz: dy * (0.5 + Math.random()), life: 0.5 + Math.random() * 0.3, s0: 0.06, s1: 0.2, c0: 0xf0ece4, c1: 0xffffff, drag: 3 });
    }
  }

  spark(x: number, y: number) {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      this.glow.emit({ x, y: 0.45, z: y, vx: Math.cos(a) * 2.5, vy: Math.random() * 2, vz: Math.sin(a) * 2.5, life: 0.18, s0: 0.05, s1: 0.01, c0: 0xffe6a0, c1: 0xff8020, grav: 6 });
    }
  }

  pop(x: number, y: number) {
    this.spark(x, y);
    for (let i = 0; i < 6; i++) {
      this.smoke.emit({ x: x + (Math.random() - 0.5) * 0.2, y: 0.45, z: y + (Math.random() - 0.5) * 0.2, vy: 0.4, life: 0.6, s0: 0.08, s1: 0.22, c0: 0xdedad2, c1: 0xf4f2ee, drag: 2 });
    }
  }

  explosion(x: number, y: number, big: boolean, tint?: number) {
    const n = big ? 60 : 40;
    const radius = big ? MINE_BLAST : 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.5 + Math.random() * 3.5) * (big ? 1.4 : 1);
      this.glow.emit({
        x, y: 0.35, z: y, vx: Math.cos(a) * s, vy: 0.5 + Math.random() * 3, vz: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.4, s0: 0.22 + Math.random() * 0.2, s1: 0.02, c0: Math.random() < 0.5 ? 0xfff0a0 : 0xffa040, c1: 0xc02000, drag: 3, grav: -1,
      });
    }
    for (let i = 0; i < n * 0.7; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * 1.8 * radius;
      this.smoke.emit({
        x: x + Math.cos(a) * 0.2, y: 0.3, z: y + Math.sin(a) * 0.2, vx: Math.cos(a) * s, vy: 0.6 + Math.random() * 1.5, vz: Math.sin(a) * s,
        life: 1.2 + Math.random() * 1.2, s0: 0.2, s1: 0.55 + Math.random() * 0.3, c0: 0x3a3a3a, c1: 0xb8b4ae, drag: 2.2,
      });
    }
    if (tint !== undefined) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        this.debris.emit({
          x, y: 0.4, z: y, vx: Math.cos(a) * (1 + Math.random() * 3), vy: 2 + Math.random() * 4, vz: Math.sin(a) * (1 + Math.random() * 3),
          life: 1.4 + Math.random(), s0: 0.06 + Math.random() * 0.06, s1: 0.03, c0: tint, c1: 0x2a2a2a, grav: 10, drag: 0.4,
        });
      }
    }
    const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, y);
    this.scene.add(ring);
    this.shocks.push({ mesh: ring, t: 0, max: 0.45, size: radius * 1.2 });
    this.flash.position.set(x, 1.2, y);
    this.flash.intensity = big ? 40 : 25;
    this.flashT = 0.25;
    this.shake = Math.max(this.shake, big ? 0.35 : 0.22);
    this.floorMark((g) => {
      const r = (big ? 1.3 : 0.85) * PX;
      const sg = g.createRadialGradient(x * PX, y * PX, 2, x * PX, y * PX, r);
      sg.addColorStop(0, 'rgba(30,20,10,0.55)');
      sg.addColorStop(1, 'rgba(30,20,10,0)');
      g.fillStyle = sg;
      g.beginPath();
      g.arc(x * PX, y * PX, r, 0, Math.PI * 2);
      g.fill();
    });
  }

  private deathMark(x: number, y: number, info: TankInfo) {
    const color = '#' + new THREE.Color(info.kind === 'player' ? info.color : ENEMY_COLORS[info.kind]).getHexString();
    this.floorMark((g) => {
      g.save();
      g.translate(x * PX, y * PX);
      g.rotate(0.2);
      g.strokeStyle = 'rgba(25,15,8,0.75)';
      g.lineCap = 'round';
      g.lineWidth = 9;
      const s = PX * 0.3;
      g.beginPath(); g.moveTo(-s, -s); g.lineTo(s, s); g.moveTo(s, -s); g.lineTo(-s, s); g.stroke();
      g.strokeStyle = color;
      g.globalAlpha = 0.5;
      g.lineWidth = 4;
      g.stroke();
      g.restore();
    });
  }

  // ---------------------------------------------------------------- frame

  render(dt: number) {
    this.time += dt;
    this.glow.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.t += dt;
      const u = s.t / s.max;
      if (u >= 1) {
        this.scene.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        this.shocks.splice(i, 1);
        continue;
      }
      const k = 0.2 + (1 - Math.pow(1 - u, 3)) * s.size;
      s.mesh.scale.set(k, k, k);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - u);
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity *= Math.exp(-dt * 14);
      if (this.flashT <= 0) this.flash.intensity = 0;
    }
    this.floorTimer -= dt;
    if (this.floorDirty && this.floorTimer <= 0) {
      this.floorTex.needsUpdate = true;
      this.floorDirty = false;
      this.floorTimer = 0.1;
    }
    this.shake *= Math.exp(-dt * 8);
    this.camera.position.copy(this.basePos);
    if (this.shake > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** JPEG of the current frame (the drawing buffer is only valid right after a render). */
  capture(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/jpeg', 0.9);
  }

  glInfo() {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      webgl2: this.renderer.capabilities.isWebGL2,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  /** Ground point (arena coords) under a screen position, on the turret-height plane. */
  screenToArena(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.aimPlane, p)) return null;
    return { x: p.x, y: p.z };
  }

  arenaToScreen(x: number, y: number, h = 1): { x: number; y: number } {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  tankColor(id: number) {
    const v = this.tanks.get(id);
    if (!v) return 0xffffff;
    return v.info.kind === 'player' ? v.info.color : ENEMY_COLORS[v.info.kind];
  }
}
