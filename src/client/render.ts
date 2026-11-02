import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOLT_R, BONUS_INFO, DRILL_BLAST, FLAG_BURROW, BONUS_KINDS, ENEMY_COLORS, enemyColor, FLAG_ALERT, FLAG_CHARGING, FLAG_RAGE, H, MINE_BLAST, PORTAL_COLORS, TANK_R, Tile, W, isPortal, tankRadius, type BonusKind } from '../shared/constants';
import type { TankInfo } from '../shared/protocol';

export interface RTank { id: number; x: number; y: number; body: number; turret: number; alive: boolean; invisible: boolean; fx?: number; hp?: number } // hp: hit points left (tough tanks only)
export interface RBonus { id: number; x: number; y: number; kind: number; blink: boolean }
export interface RBullet { id: number; x: number; y: number; vx: number; vy: number; rocket: boolean; color?: number } // color: the shooter's, for player shells
export interface RMine { id: number; x: number; y: number; blink: boolean }

const PX = 64; // floor texture pixels per tile
const RAIN_DROPS = 700;
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
  bubble?: THREE.Mesh;
  scale: number; // hull radius / TANK_R (the boss is drawn bigger)
  hit: number; // white flash after a hit, fades out
  lamp: THREE.Mesh; // little headlamp on the turret, lit at night
  lampMat: THREE.MeshBasicMaterial;
  alert?: THREE.Sprite; // « ! » above an enemy that has spotted someone (night)
  alertT: number;
  armor?: THREE.Group; // steel tanks (iteration 10): plates that fly off at the first hit
  armorSeen?: boolean; // the plates' state has been synced once (no burst for a tank that starts the mission bare)
  bit?: THREE.Group; // the Foreur (iteration 11): its spinning drill bit
  mound?: THREE.Group; // the Foreur under the table: a moving bump of earth
  under?: boolean;
}

/** Red « ! » bubble shown above enemies that have spotted a foe at night. */
function alertTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e2453c';
  g.beginPath(); g.arc(32, 30, 24, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(24, 48); g.lineTo(32, 62); g.lineTo(40, 48); g.fill();
  g.lineWidth = 4; g.strokeStyle = '#fff4e0';
  g.beginPath(); g.arc(32, 30, 24, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff4e0';
  g.font = '900 34px Rubik, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('!', 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const alertMat = new THREE.SpriteMaterial({ map: alertTexture(), depthWrite: false, depthTest: false, transparent: true });
const LAMP_PLAYER = 0xfff1c8, LAMP_ENEMY = 0xffb050, LAMP_ALERT = 0xff3020;

// ------------------------------------------------------------------ bonus crates

/** Wooden crate face with the bonus emblem, drawn once per kind. */
function crateTexture(kind: BonusKind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9965a';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(90,55,20,0.55)';
  g.lineWidth = 3;
  for (let y = 0; y < 128; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  g.fillStyle = '#7a4a1e';
  g.fillRect(0, 0, 128, 12); g.fillRect(0, 116, 128, 12); g.fillRect(0, 0, 12, 128); g.fillRect(116, 0, 12, 128);
  const col = '#' + BONUS_INFO[kind].color.toString(16).padStart(6, '0');
  g.fillStyle = col;
  g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.fill();
  g.lineWidth = 5; g.strokeStyle = '#fff8e8'; g.stroke();
  g.fillStyle = '#fff8e8'; g.strokeStyle = '#fff8e8';
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 8;
  g.beginPath();
  if (kind === 'shield') {
    g.moveTo(64, 40); g.lineTo(84, 48); g.lineTo(82, 68); g.quadraticCurveTo(78, 82, 64, 90); g.quadraticCurveTo(50, 82, 46, 68); g.lineTo(44, 48); g.closePath(); g.fill();
  } else if (kind === 'bounce') {
    g.moveTo(42, 46); g.lineTo(58, 80); g.lineTo(72, 50); g.lineTo(86, 82); g.stroke();
  } else if (kind === 'turbo') {
    for (const ox of [-10, 10]) { g.moveTo(52 + ox, 44); g.lineTo(70 + ox, 64); g.lineTo(52 + ox, 84); }
    g.stroke();
  } else {
    for (const a of [-0.55, 0, 0.55]) { g.moveTo(64, 86); g.lineTo(64 + Math.sin(a) * 40, 86 - Math.cos(a) * 40); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Spiral swirl painted once and shared by every portal (tinted by the material colour). */
function swirlTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    g.lineWidth = 6;
    g.beginPath();
    for (let k = 0; k <= 40; k++) {
      const u = k / 40, a = arm * ((Math.PI * 2) / 3) + u * Math.PI * 2.2, r = 6 + u * 54;
      if (k === 0) g.moveTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      else g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

interface PortalView { root: THREE.Group; swirl: THREE.Mesh; ring: THREE.Mesh; color: number; x: number; y: number; phase: number }

interface CrateView { root: THREE.Group; box: THREE.Mesh; halo: THREE.Mesh; beam: THREE.Mesh; born: number; x: number; y: number; kind: BonusKind }

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
  disc: new THREE.CircleGeometry(1, 40),
  crate: new RoundedBoxGeometry(0.58, 0.58, 0.58, 2, 0.06),
  beam: new THREE.CylinderGeometry(0.3, 0.36, 1.8, 24, 1, true),
  halo: new THREE.CircleGeometry(0.5, 36),
  bubble: new THREE.SphereGeometry(0.62, 28, 16),
  spike: new THREE.ConeGeometry(0.05, 0.13, 8),
  band: new THREE.TorusGeometry(0.205, 0.022, 8, 28),
  stud: new THREE.SphereGeometry(0.045, 10, 8),
  sideGun: new THREE.CylinderGeometry(0.03, 0.035, 0.26, 10),
  lamp: new THREE.SphereGeometry(0.055, 12, 8),
  // arsenal (iteration 7): each cannon has its own silhouette
  longBarrel: new THREE.CylinderGeometry(0.04, 0.046, 0.6, 12),
  collar: new THREE.TorusGeometry(0.058, 0.018, 8, 18),
  tube: new THREE.CylinderGeometry(0.085, 0.09, 0.44, 16),
  tubeTip: new THREE.ConeGeometry(0.085, 0.12, 16),
  fin: new THREE.BoxGeometry(0.12, 0.012, 0.09),
  shortBarrel: new THREE.CylinderGeometry(0.058, 0.064, 0.3, 14),
  rackMine: new THREE.CylinderGeometry(0.075, 0.085, 0.05, 16),
  // steel tank (iteration 10): bolted armour plates
  glacis: new RoundedBoxGeometry(0.14, 0.22, 0.66, 2, 0.03),
  skirt: new RoundedBoxGeometry(0.9, 0.17, 0.05, 2, 0.02),
  mantlet: new THREE.CylinderGeometry(0.27, 0.29, 0.1, 8),
  rivet: new THREE.SphereGeometry(0.025, 8, 6),
  // the Foreur (iteration 11): a drill bit in front, exhaust stacks behind, and a bump of earth when it is under
  bit: new THREE.ConeGeometry(0.21, 0.5, 18, 1),
  bitRidge: new THREE.TorusGeometry(1, 0.028, 6, 22),
  stack: new THREE.CylinderGeometry(0.045, 0.055, 0.26, 10),
  mound: new THREE.SphereGeometry(0.62, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  clod: new THREE.DodecahedronGeometry(0.09, 0),
};
const steelBitMat = new THREE.MeshStandardMaterial({ color: 0xc9d2da, roughness: 0.25, metalness: 0.9, emissive: 0x15181c, emissiveIntensity: 0.4 });
const dirtMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1, flatShading: true });
const dirtDarkMat = new THREE.MeshStandardMaterial({ color: 0x5e3b20, roughness: 1, flatShading: true });
const plateMat = new THREE.MeshStandardMaterial({ color: 0x9fb2c8, roughness: 0.28, metalness: 0.85, emissive: 0x101820, emissiveIntensity: 0.4 });
const rivetMat = new THREE.MeshStandardMaterial({ color: 0x3c4552, roughness: 0.4, metalness: 0.7 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xffb43d, roughness: 0.35, metalness: 0.6, emissive: 0x3a2000, emissiveIntensity: 0.3 });
const rocketTipMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.4, emissive: 0x7a2a00, emissiveIntensity: 0.5 });
const rackMineMat = new THREE.MeshStandardMaterial({ color: 0xf4c542, roughness: 0.5, metalness: 0.2 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.3, metalness: 0.75, emissive: 0x3a2400, emissiveIntensity: 0.4 });

const treadMat = new THREE.MeshStandardMaterial({ color: 0x24252b, roughness: 0.9 });

function buildTank(info: TankInfo): TankView {
  const color = info.kind === 'player' ? info.color : enemyColor(info.kind);
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
  const w = info.kind === 'player' ? info.w : undefined;
  if (w === 'ricochet') {
    // long thin barrel with two brass collars
    barrel.geometry = geo.longBarrel;
    barrel.position.x = 0.38;
    muzzle.position.x = 0.68;
    muzzle.scale.set(0.8, 1, 0.8);
    for (const x of [0.3, 0.48]) {
      const c = new THREE.Mesh(geo.collar, brassMat);
      c.rotation.y = Math.PI / 2;
      c.position.set(x, 0.09, 0);
      turret.add(c);
    }
  } else if (w === 'fusee') {
    // fat launch tube with an orange warhead peeking out and little fins
    barrel.geometry = geo.tube;
    barrel.position.x = 0.3;
    muzzle.geometry = geo.tubeTip;
    muzzle.material = rocketTipMat;
    muzzle.rotation.z = -Math.PI / 2;
    muzzle.position.x = 0.57;
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(geo.fin, barrelMat);
      f.position.set(0.14, 0.09, s * 0.1);
      turret.add(f);
    }
  } else if (w === 'sapeur') {
    // stubby barrel, and a rack of spare mines on the back deck
    barrel.geometry = geo.shortBarrel;
    barrel.position.x = 0.26;
    muzzle.position.x = 0.42;
    for (const z of [-0.17, 0, 0.17]) {
      const m = new THREE.Mesh(geo.rackMine, rackMineMat);
      m.position.set(-0.3, 0.39, z);
      hull.add(m);
    }
  }
  let armorGroup: THREE.Group | undefined;
  const lampMat = new THREE.MeshBasicMaterial({ color: info.kind === 'player' ? LAMP_PLAYER : LAMP_ENEMY });
  const lamp = new THREE.Mesh(geo.lamp, lampMat);
  lamp.position.set(0.2, 0.1, 0.12);
  lamp.visible = false;
  turret.add(dome, cap, barrel, muzzle, lamp);
  root.add(hull, turret);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  const scale = tankRadius(info.kind) / TANK_R;
  const view: TankView = { info, root, hull, turret, lastMarkX: NaN, lastMarkY: NaN, wasAlive: true, recoil: 0, materials: [bodyMat, topMat, barrelMat], scale, hit: 0, lamp, lampMat, alertT: 0 };
  if (info.kind !== 'player') {
    const alert = new THREE.Sprite(alertMat);
    alert.position.y = 0.95 * scale + 0.35;
    alert.visible = false;
    alert.renderOrder = 5;
    root.add(alert);
    view.alert = alert;
  }
  if (info.kind === 'steel') {
    // a toy ironclad: a sloped front plate, side skirts and an octagonal collar, all riveted
    const armor = new THREE.Group();
    const front = new THREE.Mesh(geo.glacis, plateMat);
    front.position.set(0.42, 0.26, 0);
    front.rotation.z = -0.35;
    armor.add(front);
    for (const z of [-0.41, 0.41]) {
      const sk = new THREE.Mesh(geo.skirt, plateMat);
      sk.position.set(0, 0.2, z);
      armor.add(sk);
      for (const x of [-0.32, -0.1, 0.12, 0.34]) {
        const rv = new THREE.Mesh(geo.rivet, rivetMat);
        rv.position.set(x, 0.24, z + Math.sign(z) * 0.03);
        armor.add(rv);
      }
    }
    for (const z of [-0.22, 0, 0.22]) {
      const rv = new THREE.Mesh(geo.rivet, rivetMat);
      rv.position.set(0.5, 0.31, z);
      armor.add(rv);
    }
    hull.add(armor);
    const collar = new THREE.Mesh(geo.mantlet, plateMat);
    collar.position.y = 0.03;
    collar.name = 'collar';
    turret.add(collar);
    armorGroup = armor;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'boss') {
    // a big toy general: golden crown on the turret, studs and two little side guns on the hull
    const band = new THREE.Mesh(geo.band, goldMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.13;
    turret.add(band);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const sp = new THREE.Mesh(geo.spike, goldMat);
      sp.position.set(Math.cos(a) * 0.2, 0.2, Math.sin(a) * 0.2);
      turret.add(sp);
    }
    for (const [sx, sz] of [[0.36, 0.26], [0.36, -0.26], [-0.36, 0.26], [-0.36, -0.26]]) {
      const st = new THREE.Mesh(geo.stud, goldMat);
      st.position.set(sx, 0.37, sz);
      hull.add(st);
    }
    for (const z of [-0.2, 0.2]) {
      const g = new THREE.Mesh(geo.sideGun, barrelMat);
      g.rotation.z = Math.PI / 2;
      g.position.set(0.48, 0.3, z);
      hull.add(g);
    }
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'drill') {
    // a toy mining machine: a big steel drill bit at the front, exhaust stacks at the back, a miner's lamp
    const bit = new THREE.Group();
    const cone = new THREE.Mesh(geo.bit, steelBitMat);
    cone.rotation.z = -Math.PI / 2;
    bit.add(cone);
    for (let i = 0; i < 4; i++) {
      // little ridges that make the spin readable
      const r = new THREE.Mesh(geo.bitRidge, barrelMat);
      const u = (i + 0.5) / 4;
      r.scale.setScalar(0.21 * (1 - u) + 0.01);
      r.position.x = -0.25 + u * 0.5;
      r.rotation.y = Math.PI / 2 + 0.35;
      bit.add(r);
    }
    bit.position.set(0.62, 0.22, 0);
    hull.add(bit);
    for (const z of [-0.18, 0.18]) {
      const st = new THREE.Mesh(geo.stack, barrelMat);
      st.position.set(-0.32, 0.45, z);
      hull.add(st);
    }
    lamp.visible = true;
    lampMat.color.setHex(0xfff1a0);
    lamp.position.set(0.2, 0.2, 0);
    const mound = new THREE.Group();
    const hump = new THREE.Mesh(geo.mound, dirtMat);
    hump.scale.set(1, 0.38, 1);
    mound.add(hump);
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(geo.clod, i % 2 ? dirtDarkMat : dirtMat);
      const a = (i / 7) * Math.PI * 2;
      c.position.set(Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55);
      c.rotation.set(a, a * 2, 0);
      mound.add(c);
    }
    mound.visible = false;
    root.add(mound);
    view.bit = bit;
    view.mound = mound;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (armorGroup) {
    view.armor = armorGroup;
    const collar = turret.getObjectByName('collar');
    if (collar) armorGroup.userData.collar = collar;
  }
  hull.scale.setScalar(scale);
  turret.scale.setScalar(scale);
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
  private portals: PortalView[] = [];
  private swirlTex = swirlTexture();
  private portalGeo = { ring: new THREE.TorusGeometry(0.4, 0.055, 10, 40), swirl: new THREE.CircleGeometry(0.38, 36), rim: new THREE.CylinderGeometry(0.46, 0.48, 0.05, 36) };
  private portalRimMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.7 });
  private tanks = new Map<number, TankView>();
  private bullets = new Map<number, THREE.Mesh>();
  private mines = new Map<number, THREE.Group>();
  private crates = new Map<number, CrateView>();
  private crateMats = new Map<BonusKind, THREE.MeshStandardMaterial>();
  private bubbleMat = new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x2a9fd0, emissiveIntensity: 0.6, transparent: true, opacity: 0.4, roughness: 0.15, depthWrite: false });
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
  // night: the daylight fades out, tanks drive with headlights and shells light up the walls
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private heads: THREE.SpotLight[] = [];
  private shellLights: THREE.PointLight[] = [];
  private night = 0;
  private nightTarget = 0;
  private nightApplied = -1;
  private nightStart = 0;
  private tmpColor = new THREE.Color();
  // storm (iteration 9): rain, a darker sky, announced strikes and lightning that lights up the whole table
  private storm = 0;
  private stormTarget = 0;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainSpeed: Float32Array;
  private zaps: { mesh: THREE.Mesh; core: THREE.Mesh; x: number; y: number; t: number; max: number }[] = [];
  private quakes: { mesh: THREE.Mesh; core: THREE.Mesh; x: number; y: number; t: number; max: number }[] = [];
  private bolts: { meshes: THREE.Mesh[]; t: number; max: number }[] = [];
  private boltMat = new THREE.MeshBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  private boltGlowMat = new THREE.MeshBasicMaterial({ color: 0x7fa8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  /** 1 right when the lightning falls, then fades: the sky lights up and invisible tanks show for an instant. */
  lightning = 0;
  private baseHemi = 1.1;
  private baseSun = 2.4;
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

    const hemi = (this.hemi = new THREE.HemisphereLight(0xfff3e0, 0x5a4a3c, 1.1));
    this.scene.add(hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4));
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
    const rim = (this.rim = new THREE.DirectionalLight(0x9ec5ff, 0.5));
    rim.position.set(W / 2 + 10, 8, H / 2 + 12);
    this.scene.add(rim);

    this.flash = new THREE.PointLight(0xffa040, 0, 7, 1.6);
    this.scene.add(this.flash);
    // a fixed pool of night lights (hidden by day) so the shaders compile once per level, not per shot
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.SpotLight(0xffe9c0, 0, 9, 0.48, 0.65, 1.3);
      sp.visible = false;
      this.scene.add(sp, sp.target);
      this.heads.push(sp);
    }
    for (let i = 0; i < 3; i++) {
      const pl = new THREE.PointLight(0xffd9a0, 0, 3, 1.5);
      pl.visible = false;
      this.scene.add(pl);
      this.shellLights.push(pl);
    }

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

    // rain: a pool of streaks falling over the table (hidden unless it storms)
    const N = RAIN_DROPS;
    this.rainPos = new Float32Array(N * 6);
    this.rainSpeed = new Float32Array(N);
    for (let i = 0; i < N; i++) this.resetDrop(i, Math.random() * 9);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb8cdf5, transparent: true, opacity: 0.42, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private resetDrop(i: number, h: number) {
    const x = -1 + Math.random() * (W + 2), z = -1 + Math.random() * (H + 2);
    const p = this.rainPos, o = i * 6;
    p[o] = x; p[o + 1] = h; p[o + 2] = z;
    p[o + 3] = x - 0.06; p[o + 4] = h - 0.45; p[o + 5] = z + 0.1;
    this.rainSpeed[i] = 11 + Math.random() * 5;
  }

  /** Storm: rain and a heavier sky come in, like the night does. */
  setStorm(on: boolean) {
    this.stormTarget = on ? 1 : 0;
    if (!on) { this.storm = 0; this.lightning = 0; }
    this.rain.visible = on;
    this.nightApplied = -1;
    for (const z of this.zaps) { this.scene.remove(z.mesh, z.core); (z.mesh.material as THREE.Material).dispose(); (z.core.material as THREE.Material).dispose(); }
    this.zaps = [];
  }
  get isStorm() { return this.stormTarget > 0; }

  /** A strike is announced: a crackling ring that tightens on the spot until the lightning falls. */
  zap(x: number, y: number, warn: number) {
    const mesh = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xbcd4ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.04, y);
    mesh.scale.setScalar(BOLT_R);
    const core = new THREE.Mesh(geo.disc, new THREE.MeshBasicMaterial({ color: 0x9fbfff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.rotation.x = -Math.PI / 2;
    core.position.set(x, 0.03, y);
    core.scale.setScalar(BOLT_R);
    this.scene.add(mesh, core);
    this.zaps.push({ mesh, core, x, y, t: 0, max: warn });
  }

  /** The lightning falls: a jagged bolt from the sky, a white flash over everything, a blast and a star-shaped scorch. */
  bolt(x: number, y: number) {
    for (let i = this.zaps.length - 1; i >= 0; i--) {
      const z = this.zaps[i];
      if (Math.hypot(z.x - x, z.y - y) > 0.3) continue;
      this.scene.remove(z.mesh, z.core);
      (z.mesh.material as THREE.Material).dispose(); (z.core.material as THREE.Material).dispose();
      this.zaps.splice(i, 1);
    }
    const meshes: THREE.Mesh[] = [];
    const branch = (x0: number, h0: number, z0: number, x1: number, z1: number, h1: number, n: number, rad: number) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= n; k++) {
        const u = k / n, j = k === 0 || k === n ? 0 : 0.45 * (1 - u * 0.5);
        pts.push(new THREE.Vector3(x0 + (x1 - x0) * u + (Math.random() - 0.5) * j, h0 + (h1 - h0) * u, z0 + (z1 - z0) * u + (Math.random() - 0.5) * j));
      }
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let k = 0; k < n; k++) path.add(new THREE.LineCurve3(pts[k], pts[k + 1]));
      meshes.push(new THREE.Mesh(new THREE.TubeGeometry(path, n * 2, rad, 4, false), this.boltMat));
      meshes.push(new THREE.Mesh(new THREE.TubeGeometry(path, n * 2, rad * 3.2, 5, false), this.boltGlowMat));
      return pts;
    };
    const top = branch(x + (Math.random() - 0.5) * 3, 16, y - 4 - Math.random() * 2, x, y, 0, 12, 0.05);
    for (let b = 0; b < 2; b++) {
      const p = top[3 + Math.floor(Math.random() * 6)];
      branch(p.x, p.y, p.z, p.x + (Math.random() - 0.5) * 3, p.z + (Math.random() - 0.5) * 3, p.y * (0.2 + Math.random() * 0.4), 5, 0.025);
    }
    for (const m of meshes) this.scene.add(m);
    this.bolts.push({ meshes, t: 0, max: 0.32 });
    this.lightning = 1;
    this.explosion(x, y, false);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 4;
      this.glow.emit({ x, y: 0.15, z: y, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 4, vz: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.3, s0: 0.08, s1: 0.01, c0: 0xffffff, c1: 0x6f9dff, grav: 8, drag: 1.5 });
    }
    this.flash.color.setHex(0xcfe0ff);
    this.flash.position.set(x, 2, y);
    this.flash.intensity = 70;
    this.flashT = 0.3;
    this.shake = Math.max(this.shake, 0.4);
    this.floorMark((g) => {
      g.save();
      g.translate(x * PX, y * PX);
      g.strokeStyle = 'rgba(20,24,40,0.5)';
      g.lineCap = 'round';
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + Math.random() * 0.4, l = PX * (0.5 + Math.random() * 0.6);
        g.lineWidth = 2 + Math.random() * 4;
        g.beginPath(); g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * l * 0.5 + (Math.random() - 0.5) * 8, Math.sin(a) * l * 0.5 + (Math.random() - 0.5) * 8);
        g.lineTo(Math.cos(a) * l, Math.sin(a) * l);
        g.stroke();
      }
      g.restore();
    });
  }

  private animateStorm(dt: number) {
    if (this.storm !== this.stormTarget) { this.storm = Math.min(this.stormTarget, this.storm + dt / 1.2); this.nightApplied = -1; }
    if (this.lightning > 0) this.lightning = Math.max(0, this.lightning - dt * 2.2);
    if (this.flashT <= 0 && this.flash.color.getHex() !== 0xffa040) this.flash.color.setHex(0xffa040);
    // the sky: a far-off flicker now and then (no strike), and the big flash of a real one
    if (this.storm > 0.5 && Math.random() < dt * 0.12) this.lightning = Math.max(this.lightning, 0.35);
    const fl = this.lightning > 0 ? this.lightning * (0.7 + 0.3 * Math.sin(this.time * 70)) : 0;
    this.hemi.intensity = this.baseHemi + fl * 3.2;
    this.sun.intensity = this.baseSun + fl * 2;
    if (this.rain.visible) {
      const p = this.rainPos, N = RAIN_DROPS;
      const k = this.storm;
      for (let i = 0; i < N; i++) {
        const o = i * 6, d = this.rainSpeed[i] * dt;
        p[o + 1] -= d; p[o + 4] -= d;
        p[o] -= d * 0.13; p[o + 3] -= d * 0.13;
        p[o + 2] += d * 0.22; p[o + 5] += d * 0.22;
        if (p[o + 4] <= 0) {
          if (Math.random() < 0.08 * k && p[o] > 0 && p[o] < W && p[o + 2] > 0 && p[o + 2] < H) {
            this.glow.emit({ x: p[o], y: 0.05, z: p[o + 2], vy: 0.6, life: 0.16, s0: 0.05, s1: 0.01, c0: 0xdbe7ff, c1: 0x8fb0ff, grav: 6 });
          }
          this.resetDrop(i, 7 + Math.random() * 2);
        }
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.42 * k;
    }
    for (let i = this.zaps.length - 1; i >= 0; i--) {
      const z = this.zaps[i];
      z.t += dt;
      const u = Math.min(1, z.t / z.max);
      if (z.t > z.max + 0.4) {
        this.scene.remove(z.mesh, z.core);
        (z.mesh.material as THREE.Material).dispose(); (z.core.material as THREE.Material).dispose();
        this.zaps.splice(i, 1);
        continue;
      }
      // flickers faster and faster, and the ring breathes in as the strike gets close
      const flick = 0.5 + 0.5 * Math.sin(this.time * (10 + u * 40));
      (z.mesh.material as THREE.MeshBasicMaterial).opacity = (0.35 + 0.55 * u) * (0.6 + 0.4 * flick);
      z.mesh.scale.setScalar(BOLT_R * (1.25 - 0.25 * u + 0.04 * flick));
      (z.core.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.22 * u * flick;
      if (Math.random() < dt * (6 + u * 30)) {
        const a = Math.random() * Math.PI * 2, r = BOLT_R * Math.random();
        this.glow.emit({ x: z.x + Math.cos(a) * r, y: 0.05, z: z.y + Math.sin(a) * r, vy: 1.5 + Math.random() * 2, life: 0.25, s0: 0.06, s1: 0.01, c0: 0xffffff, c1: 0x7fa8ff });
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      const vis = b.t < b.max && (b.t < 0.08 || Math.sin(b.t * 90) > -0.3);
      for (const m of b.meshes) m.visible = vis;
      if (b.t >= b.max) {
        for (const m of b.meshes) { this.scene.remove(m); m.geometry.dispose(); }
        this.bolts.splice(i, 1);
      }
    }
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

  /** Night falls in a little over a second; daylight comes back at once (on the next level). */
  setNight(on: boolean) {
    this.nightTarget = on ? 1 : 0;
    this.nightStart = performance.now() - this.night * 1200;
    if (!on) this.night = 0;
    for (const l of [...this.heads, ...this.shellLights]) l.visible = on;
  }
  get isNight() { return this.nightTarget > 0; }

  private applyNight() {
    const k = this.night, st = this.storm;
    if (Math.abs(k - this.nightApplied) < 0.002) return;
    this.nightApplied = k;
    const mix = (a: number, b: number) => new THREE.Color(a).lerp(new THREE.Color(b), k);
    // a storm greys the light (less so at night, which is already dark)
    const dim = 1 - st * (0.45 - 0.25 * k);
    this.baseHemi = (1.1 + (0.18 - 1.1) * k) * dim;
    this.hemi.color.copy(mix(0xfff3e0, 0x6f86c8)).lerp(this.tmpColor.setHex(0xa9b6cf), st * 0.6);
    this.hemi.groundColor.copy(mix(0x5a4a3c, 0x16142a));
    this.baseSun = (2.4 + (0.32 - 2.4) * k) * (1 - st * (0.6 - 0.3 * k));
    this.sun.color.copy(mix(0xfff0d8, 0x8aa4ff)).lerp(this.tmpColor.setHex(0x9fb0d0), st * 0.5);
    this.rim.intensity = 0.5 + (0.28 - 0.5) * k;
    for (const v of this.tanks.values()) v.lamp.visible = k > 0.05;
  }

  /** Night: headlights for the players' tanks (they follow the turret, so you light where you aim). */
  private headlights(list: RTank[]) {
    let n = 0;
    if (this.night > 0) {
      for (const t of list) {
        if (n >= this.heads.length) break;
        const v = this.tanks.get(t.id);
        if (!v || !t.alive || v.info.kind !== 'player') continue;
        const sp = this.heads[n++];
        const dx = Math.cos(t.turret), dy = Math.sin(t.turret);
        sp.position.set(t.x + dx * 0.3, 0.62, t.y + dy * 0.3);
        sp.target.position.set(t.x + dx * 4.5, 0, t.y + dy * 4.5);
        sp.color.setHex(0xffe9c0).lerp(this.tmpColor.setHex(v.info.color), 0.15);
        sp.intensity = 15 * this.night;
      }
    }
    for (let i = n; i < this.heads.length; i++) this.heads[i].intensity = 0;
  }

  setLevel(tiles: number[], infos: TankInfo[]) {
    this.nightApplied = -1; // the new tanks' lamps follow the current light
    for (const m of this.blocks.values()) this.levelGroup.remove(m);
    this.blocks.clear();
    for (const t of this.tanks.values()) this.scene.remove(t.root);
    this.tanks.clear();
    for (const b of this.bullets.values()) this.scene.remove(b);
    this.bullets.clear();
    for (const m of this.mines.values()) this.scene.remove(m);
    this.mines.clear();
    for (const c of this.crates.values()) this.removeCrate(c);
    this.crates.clear();
    for (const p of this.portals) {
      this.levelGroup.remove(p.root);
      (p.swirl.material as THREE.Material).dispose();
      (p.ring.material as THREE.Material).dispose();
    }
    this.portals = [];
    this.glow.clear(); this.smoke.clear(); this.debris.clear();
    for (let i = this.quakes.length - 1; i >= 0; i--) this.dropQuake(i);

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
        } else if (isPortal(t)) this.addPortal(x, y, PORTAL_COLORS[t - Tile.PortalA]);
      }
    }
    for (const info of infos) {
      const v = buildTank(info);
      this.tanks.set(info.id, v);
      this.scene.add(v.root);
    }
  }

  /** A wooden hoop on the floor with a glowing swirl inside. */
  private addPortal(x: number, y: number, color: number) {
    const root = new THREE.Group();
    root.position.set(x + 0.5, 0, y + 0.5);
    const rim = new THREE.Mesh(this.portalGeo.rim, this.portalRimMat);
    rim.position.y = 0.025;
    rim.receiveShadow = true;
    const ring = new THREE.Mesh(this.portalGeo.ring, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.4 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    ring.castShadow = true;
    const swirl = new THREE.Mesh(this.portalGeo.swirl, new THREE.MeshBasicMaterial({ map: this.swirlTex, color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    swirl.rotation.x = -Math.PI / 2;
    swirl.position.y = 0.06;
    root.add(rim, ring, swirl);
    this.levelGroup.add(root);
    this.portals.push({ root, swirl, ring, color, x: x + 0.5, y: y + 0.5, phase: Math.random() * 6 });
  }

  private animatePortals(dt: number) {
    for (const p of this.portals) {
      p.swirl.rotation.z += dt * 3.2;
      const k = 1 + Math.sin(this.time * 3 + p.phase) * 0.06;
      p.swirl.scale.set(k, k, k);
      (p.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + Math.sin(this.time * 4 + p.phase) * 0.3;
      if (Math.random() < 14 * dt) {
        const a = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * 0.25;
        this.glow.emit({ x: p.x + Math.cos(a) * r, y: 0.1, z: p.y + Math.sin(a) * r, vx: -Math.sin(a) * 0.6, vy: 0.6 + Math.random() * 0.6, vz: Math.cos(a) * 0.6, life: 0.7, s0: 0.05, s1: 0.01, c0: 0xffffff, c1: p.color, drag: 1 });
      }
    }
  }

  /** Something went through a portal: a puff of colour where it went in and a ring where it came out. */
  warp(x0: number, y0: number, x1: number, y1: number, tank: boolean) {
    const p = this.portals.find((o) => Math.abs(o.x - x1) < 0.6 && Math.abs(o.y - y1) < 0.6);
    const color = p?.color ?? PORTAL_COLORS[0];
    for (const [x, y, out] of [[x0, y0, 0], [x1, y1, 1]]) {
      for (let i = 0; i < (tank ? 26 : 10); i++) {
        const a = Math.random() * Math.PI * 2, s = (out ? 1.5 : -1.2) * (0.6 + Math.random());
        const r = out ? 0.05 : 0.6;
        this.glow.emit({ x: x + Math.cos(a) * r, y: 0.3 + Math.random() * 0.3, z: y + Math.sin(a) * r, vx: Math.cos(a) * s, vy: out ? 1 + Math.random() * 1.5 : 0.3, vz: Math.sin(a) * s, life: 0.35 + Math.random() * 0.2, s0: tank ? 0.1 : 0.06, s1: 0.01, c0: 0xffffff, c1: color, drag: 2 });
      }
    }
    if (tank) {
      const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x1, 0.08, y1);
      this.scene.add(ring);
      this.shocks.push({ mesh: ring, t: 0, max: 0.45, size: 1.2 });
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
        } else if (isPortal(t)) {
          // a coloured halo on the paper around the hoop
          const cx = x * PX + PX / 2, cy = y * PX + PX / 2;
          const col = '#' + PORTAL_COLORS[t - Tile.PortalA].toString(16).padStart(6, '0');
          const hg = g.createRadialGradient(cx, cy, PX * 0.3, cx, cy, PX * 0.9);
          hg.addColorStop(0, col + '66');
          hg.addColorStop(1, col + '00');
          g.fillStyle = hg;
          g.fillRect(cx - PX, cy - PX, PX * 2, PX * 2);
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
      // a lightning flash shows invisible tanks for an instant
      const visible = t.alive && !(t.invisible && t.id !== myId && this.lightning < 0.45);
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
      v.turret.position.y = 0.37 * v.scale;
      this.tankGlow(v, t, dt);
      if (v.ring) {
        (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(this.time * 4) * 0.25;
      }
      this.tankBuffs(v, t, visible, dt);
      this.tankAlert(v, t, dt);
      if (v.armor) this.tankArmor(v, t, visible, dt);
      if (v.mound && this.tankDrill(v, t, dt)) continue;
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
    this.headlights(list);
  }

  /** The Foreur: the bit spins (wildly while it digs in); under the table only a bump of earth shows, ploughing a furrow. */
  private tankDrill(v: TankView, t: RTank, dt: number): boolean {
    const fx = t.fx ?? 0;
    const under = !!(fx & FLAG_BURROW), spinning = !!(fx & FLAG_CHARGING);
    v.bit!.rotation.x += dt * (spinning ? 40 : 9);
    if (spinning && Math.random() < 50 * dt) {
      // earth thrown up around the hull as it digs in
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
      this.debris.emit({ x: t.x + Math.cos(a) * 0.5, y: 0.1, z: t.y + Math.sin(a) * 0.5, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 3, vz: Math.sin(a) * sp, life: 0.8, s0: 0.06 + Math.random() * 0.05, s1: 0.03, c0: 0x8a5a33, c1: 0x5e3b20, grav: 10, drag: 0.5 });
    }
    if (v.under !== under) {
      v.under = under;
      v.hull.visible = v.turret.visible = !under;
      v.mound!.visible = under;
      if (v.ring) v.ring.visible = !under;
    }
    if (!under) return false;
    if (v.alert) v.alert.visible = false;
    v.mound!.rotation.y += dt * 2;
    v.mound!.position.y = Math.sin(this.time * 18) * 0.03;
    v.mound!.scale.setScalar(1 + Math.sin(this.time * 9) * 0.06);
    this.shake = Math.max(this.shake, 0.05);
    if (Math.random() < 30 * dt) {
      const a = Math.random() * Math.PI * 2;
      this.debris.emit({ x: t.x + Math.cos(a) * 0.4, y: 0.15, z: t.y + Math.sin(a) * 0.4, vx: Math.cos(a) * 1.2, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * 1.2, life: 0.6, s0: 0.05 + Math.random() * 0.05, s1: 0.03, c0: 0x8a5a33, c1: 0x5e3b20, grav: 10, drag: 0.5 });
    }
    if (Number.isNaN(v.lastMarkX)) { v.lastMarkX = t.x; v.lastMarkY = t.y; }
    if (Math.hypot(t.x - v.lastMarkX, t.y - v.lastMarkY) > 0.18) {
      const bx = t.x, by = t.y;
      // a furrow of loose earth on the paper
      this.floorMark((g) => {
        g.fillStyle = 'rgba(100,62,30,0.38)';
        for (let k = 0; k < 4; k++) {
          g.beginPath();
          g.arc(bx * PX + (Math.random() - 0.5) * 34, by * PX + (Math.random() - 0.5) * 34, 4 + Math.random() * 9, 0, Math.PI * 2);
          g.fill();
        }
      });
      v.lastMarkX = t.x; v.lastMarkY = t.y;
    }
    return true;
  }

  /** The Foreur goes under: a spray of earth and a hole on the paper. */
  dig(x: number, y: number) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3;
      this.debris.emit({ x, y: 0.2, z: y, vx: Math.cos(a) * sp, vy: 2.5 + Math.random() * 3.5, vz: Math.sin(a) * sp, life: 1 + Math.random() * 0.5, s0: 0.07 + Math.random() * 0.07, s1: 0.03, c0: 0x8a5a33, c1: 0x4a2d16, grav: 11, drag: 0.4 });
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit({ x, y: 0.2, z: y, vx: Math.cos(a) * 1.2, vy: 0.6, vz: Math.sin(a) * 1.2, life: 1.2, s0: 0.2, s1: 0.5, c0: 0x9a7650, c1: 0xcdb08a, drag: 2 });
    }
    this.shake = Math.max(this.shake, 0.2);
    this.floorMark((g) => this.paintHole(g, x, y, 0.55));
  }

  private paintHole(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
    const hg = g.createRadialGradient(x * PX, y * PX, 2, x * PX, y * PX, r * PX);
    hg.addColorStop(0, 'rgba(40,24,10,0.7)');
    hg.addColorStop(0.6, 'rgba(90,58,30,0.45)');
    hg.addColorStop(1, 'rgba(110,70,35,0)');
    g.fillStyle = hg;
    g.beginPath(); g.arc(x * PX, y * PX, r * PX, 0, Math.PI * 2); g.fill();
  }

  /** The ground shakes where the Foreur is about to burst out: a ring of cracks that tightens, earth hopping about. */
  quake(x: number, y: number, warn: number) {
    const mesh = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.04, y);
    mesh.scale.setScalar(DRILL_BLAST);
    const core = new THREE.Mesh(geo.disc, new THREE.MeshBasicMaterial({ color: 0x6b3f1c, transparent: true, opacity: 0, depthWrite: false }));
    core.rotation.x = -Math.PI / 2;
    core.position.set(x, 0.03, y);
    core.scale.setScalar(DRILL_BLAST);
    this.scene.add(mesh, core);
    this.quakes.push({ mesh, core, x, y, t: 0, max: warn });
  }

  private animateQuakes(dt: number) {
    for (let i = this.quakes.length - 1; i >= 0; i--) {
      const q = this.quakes[i];
      q.t += dt;
      const u = Math.min(1, q.t / q.max);
      if (q.t > q.max + 0.3) { this.dropQuake(i); continue; }
      const flick = 0.5 + 0.5 * Math.sin(this.time * (8 + u * 30));
      (q.mesh.material as THREE.MeshBasicMaterial).opacity = (0.35 + 0.5 * u) * (0.6 + 0.4 * flick);
      q.mesh.scale.setScalar(DRILL_BLAST * (1.2 - 0.2 * u + 0.03 * flick));
      (q.core.material as THREE.MeshBasicMaterial).opacity = 0.15 + 0.35 * u;
      this.shake = Math.max(this.shake, 0.06 + 0.12 * u);
      if (Math.random() < dt * (10 + u * 40)) {
        const a = Math.random() * Math.PI * 2, r = DRILL_BLAST * Math.random();
        this.debris.emit({ x: q.x + Math.cos(a) * r, y: 0.05, z: q.y + Math.sin(a) * r, vy: 1.5 + Math.random() * 2.5, life: 0.5, s0: 0.05 + Math.random() * 0.04, s1: 0.03, c0: 0x8a5a33, c1: 0x5e3b20, grav: 12 });
      }
    }
  }
  private dropQuake(i: number) {
    const q = this.quakes[i];
    this.scene.remove(q.mesh, q.core);
    (q.mesh.material as THREE.Material).dispose(); (q.core.material as THREE.Material).dispose();
    this.quakes.splice(i, 1);
  }

  /** It bursts out: a fountain of earth and wood, a big shock wave, a crater on the paper. */
  erupt(x: number, y: number) {
    for (let i = this.quakes.length - 1; i >= 0; i--) if (Math.hypot(this.quakes[i].x - x, this.quakes[i].y - y) < 0.6) this.dropQuake(i);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4.5;
      this.debris.emit({ x: x + Math.cos(a) * 0.3, y: 0.2, z: y + Math.sin(a) * 0.3, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 6, vz: Math.sin(a) * sp, life: 1.3 + Math.random() * 0.8, s0: 0.07 + Math.random() * 0.1, s1: 0.04, c0: Math.random() < 0.2 ? 0xc98f55 : 0x8a5a33, c1: 0x4a2d16, grav: 12, drag: 0.35 });
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 2.5;
      this.smoke.emit({ x, y: 0.3, z: y, vx: Math.cos(a) * s, vy: 0.8 + Math.random() * 1.5, vz: Math.sin(a) * s, life: 1.4 + Math.random(), s0: 0.25, s1: 0.7, c0: 0x8a6a48, c1: 0xcdb08a, drag: 2.2 });
    }
    const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xffc080, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.08, y);
    this.scene.add(ring);
    this.shocks.push({ mesh: ring, t: 0, max: 0.5, size: DRILL_BLAST * 1.5 });
    this.flash.position.set(x, 1.2, y);
    this.flash.intensity = 35;
    this.flashT = 0.25;
    this.shake = Math.max(this.shake, 0.45);
    this.floorMark((g) => {
      this.paintHole(g, x, y, DRILL_BLAST);
      g.save();
      g.translate(x * PX, y * PX);
      g.strokeStyle = 'rgba(50,30,12,0.55)';
      g.lineCap = 'round';
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.random() * 0.5, l = PX * (DRILL_BLAST * 0.8 + Math.random() * 0.5);
        g.lineWidth = 2 + Math.random() * 3;
        g.beginPath(); g.moveTo(Math.cos(a) * PX * 0.4, Math.sin(a) * PX * 0.4);
        g.lineTo(Math.cos(a + 0.2) * l * 0.6, Math.sin(a + 0.2) * l * 0.6);
        g.lineTo(Math.cos(a - 0.1) * l, Math.sin(a - 0.1) * l);
        g.stroke();
      }
      g.restore();
    });
  }

  /** Night: the enemy's lamp turns red and a « ! » pops above it while it has someone in sight. */
  private tankAlert(v: TankView, t: RTank, dt: number) {
    if (!v.alert) return;
    const on = this.night > 0.3 && !!((t.fx ?? 0) & FLAG_ALERT);
    if (on && !v.alert.visible) v.alertT = 0;
    v.alert.visible = on;
    v.lampMat.color.setHex(on ? LAMP_ALERT : LAMP_ENEMY);
    if (!on) return;
    v.alertT += dt;
    const u = Math.min(1, v.alertT / 0.25);
    const s = 0.62 * (u < 1 ? Math.sin(u * Math.PI * 0.75) * 1.25 : 1) * (1 + Math.sin(this.time * 6) * 0.04);
    v.alert.scale.set(s, s, s);
  }

  /** Hit flash, the boss's charging glow and its angry smoke. */
  private tankGlow(v: TankView, t: RTank, dt: number) {
    const fx = t.fx ?? 0;
    v.hit = Math.max(0, v.hit - dt * 4);
    let glow = v.hit, col = 0xffffff;
    if (fx & FLAG_CHARGING) {
      glow = Math.max(glow, 0.45 + Math.sin(this.time * 30) * 0.35);
      col = 0xff5a20;
      if (Math.random() < 60 * dt) {
        // sparks sucked into the hull
        const a = Math.random() * Math.PI * 2, d = 1.4 + Math.random() * 0.6;
        this.glow.emit({ x: t.x + Math.cos(a) * d, y: 0.5, z: t.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 2.2, vz: -Math.sin(a) * d * 2.2, life: 0.4, s0: 0.03, s1: 0.1, c0: 0xffd060, c1: 0xff4010 });
      }
    } else if (fx & FLAG_RAGE) {
      glow = Math.max(glow, 0.12 + Math.sin(this.time * 8) * 0.1);
      col = v.hit > 0.2 ? 0xffffff : 0xff2010;
      if (Math.random() < 12 * dt) {
        this.smoke.emit({ x: t.x + (Math.random() - 0.5) * 0.6, y: 0.7, z: t.y + (Math.random() - 0.5) * 0.6, vy: 0.9, life: 0.9, s0: 0.1, s1: 0.35, c0: 0x2a2a2a, c1: 0x777777, drag: 1.5 });
      }
    }
    if (glow <= 0.001 && !v.materials[0].emissiveIntensity) return;
    for (const m of v.materials) {
      m.emissive.setHex(col);
      m.emissiveIntensity = glow;
    }
  }

  /** A tough tank (the boss) took a hit. */
  hurt(id: number, x: number, y: number) {
    const v = this.tanks.get(id);
    if (v) { v.hit = 1; v.recoil = 1; }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.debris.emit({
        x, y: 0.6, z: y, vx: Math.cos(a) * (1 + Math.random() * 2), vy: 2 + Math.random() * 3, vz: Math.sin(a) * (1 + Math.random() * 2),
        life: 1 + Math.random() * 0.5, s0: 0.05 + Math.random() * 0.04, s1: 0.02, c0: Math.random() < 0.3 ? 0xf2c14e : v ? enemyColor(v.info.kind) : ENEMY_COLORS.boss, c1: 0x2a2a2a, grav: 10, drag: 0.4,
      });
    }
    this.spark(x, y);
    this.shake = Math.max(this.shake, 0.15);
  }

  /** The boss's ring of shells: a flash and a shock wave. */
  volley(x: number, y: number) {
    const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.08, y);
    this.scene.add(ring);
    this.shocks.push({ mesh: ring, t: 0, max: 0.5, size: 2.2 });
    this.flash.position.set(x, 1.4, y);
    this.flash.intensity = 30;
    this.flashT = 0.2;
    this.shake = Math.max(this.shake, 0.2);
  }

  private tankBuffs(v: TankView, t: RTank, visible: boolean, dt: number) {
    const fx = t.fx ?? 0;
    const shield = !!(fx & BONUS_INFO.shield.flag);
    if (shield && !v.bubble) {
      v.bubble = new THREE.Mesh(geo.bubble, this.bubbleMat);
      v.bubble.position.y = 0.3;
      v.bubble.renderOrder = 2;
      v.root.add(v.bubble);
    }
    if (v.bubble) {
      v.bubble.visible = shield;
      const k = 1 + Math.sin(this.time * 5 + t.id) * 0.04;
      v.bubble.scale.set(k, k * 0.8, k);
    }
    if (!visible) return;
    if (fx & BONUS_INFO.turbo.flag && Math.random() < 40 * dt) {
      const bx = t.x - Math.cos(t.body) * 0.42, by = t.y - Math.sin(t.body) * 0.42;
      this.glow.emit({ x: bx + (Math.random() - 0.5) * 0.3, y: 0.15, z: by + (Math.random() - 0.5) * 0.3, vy: 0.4, life: 0.3, s0: 0.09, s1: 0.01, c0: 0xb8ff9a, c1: BONUS_INFO.turbo.color });
    }
    for (const kind of ['bounce', 'fan'] as const) {
      if (!(fx & BONUS_INFO[kind].flag) || Math.random() > 18 * dt) continue;
      const a = this.time * 3 + (kind === 'fan' ? Math.PI : 0);
      this.glow.emit({ x: t.x + Math.cos(a) * 0.5, y: 0.55, z: t.y + Math.sin(a) * 0.5, vy: 0.5, life: 0.45, s0: 0.07, s1: 0.01, c0: 0xffffff, c1: BONUS_INFO[kind].color });
    }
  }

  /** Steel tanks: the plates stay on while they have two hit points, fly off at the first hit, then the bare tank smokes. */
  private tankArmor(v: TankView, t: RTank, visible: boolean, dt: number) {
    const on = (t.hp ?? 2) > 1;
    const armor = v.armor!;
    const collar = armor.userData.collar as THREE.Object3D | undefined;
    if (armor.visible !== on) {
      armor.visible = on;
      if (collar) collar.visible = on;
      if (!on && v.armorSeen) this.shedArmor(t.x, t.y, t.body);
    }
    v.armorSeen = true;
    if (!on && visible && Math.random() < 9 * dt) {
      this.smoke.emit({ x: t.x + (Math.random() - 0.5) * 0.3, y: 0.5, z: t.y + (Math.random() - 0.5) * 0.3, vy: 0.7, life: 0.9, s0: 0.06, s1: 0.2, c0: 0x6b6f78, c1: 0xa9adb5, drag: 1.2 });
    }
  }

  /** The armour of a steel tank flies off: shiny plates, rivets and sparks. */
  shedArmor(x: number, y: number, body: number) {
    for (let i = 0; i < 22; i++) {
      const a = body + (Math.random() - 0.5) * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2.8;
      this.debris.emit({
        x, y: 0.35, z: y, vx: Math.cos(a) * sp, vy: 2.5 + Math.random() * 3.5, vz: Math.sin(a) * sp,
        life: 1.2 + Math.random() * 0.6, s0: 0.07 + Math.random() * 0.07, s1: 0.04, c0: Math.random() < 0.25 ? 0x3c4552 : 0xb9c8da, c1: 0x6d7a8a, grav: 11, drag: 0.3,
      });
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
      this.glow.emit({ x, y: 0.4, z: y, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 3, vz: Math.sin(a) * sp, life: 0.25 + Math.random() * 0.3, s0: 0.06, s1: 0.01, c0: 0xffffff, c1: 0xffc060, grav: 9, drag: 1.2 });
    }
    this.shake = Math.max(this.shake, 0.2);
  }

  syncBonuses(list: RBonus[]) {
    const seen = new Set<number>();
    for (const b of list) {
      const kind = BONUS_KINDS[b.kind];
      if (!kind) continue; // unknown kind from a newer server: just don't draw it
      seen.add(b.id);
      let c = this.crates.get(b.id);
      if (!c) {
        let mat = this.crateMats.get(kind);
        if (!mat) { mat = new THREE.MeshStandardMaterial({ map: crateTexture(kind), roughness: 0.7 }); this.crateMats.set(kind, mat); }
        const root = new THREE.Group();
        const box = new THREE.Mesh(geo.crate, mat);
        box.castShadow = true;
        const halo = new THREE.Mesh(geo.halo, new THREE.MeshBasicMaterial({ color: BONUS_INFO[kind].color, transparent: true, opacity: 0.7, depthWrite: false }));
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.02;
        const beam = new THREE.Mesh(geo.beam, new THREE.MeshBasicMaterial({ color: BONUS_INFO[kind].color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        beam.position.y = 0.9;
        root.add(box, halo, beam);
        root.position.set(b.x, 0, b.y);
        this.scene.add(root);
        c = { root, box, halo, beam, born: this.time, x: b.x, y: b.y, kind };
        this.crates.set(b.id, c);
      }
      const age = this.time - c.born;
      const fall = Math.max(0, 1 - age / 0.45);
      c.box.position.y = 0.36 + Math.sin(this.time * 2.6 + b.id) * 0.05 + fall * fall * 4;
      c.box.rotation.y = this.time * 1.4 + b.id;
      c.box.rotation.x = fall * 1.5;
      const pulse = 0.5 + Math.sin(this.time * 4 + b.id) * 0.2;
      (c.halo.material as THREE.MeshBasicMaterial).opacity = b.blink ? (Math.sin(this.time * 18) > 0 ? 0.7 : 0.1) : pulse;
      (c.beam.material as THREE.MeshBasicMaterial).opacity = (b.blink ? 0.08 : 0.16) * (1 - fall);
      c.box.visible = !b.blink || Math.sin(this.time * 18) > -0.6;
      if (Math.random() < 0.06) this.glow.emit({ x: b.x + (Math.random() - 0.5) * 0.5, y: 0.2, z: b.y + (Math.random() - 0.5) * 0.5, vy: 0.8, life: 0.6, s0: 0.05, s1: 0.01, c0: 0xffffff, c1: BONUS_INFO[kind].color });
    }
    for (const [id, c] of this.crates) {
      if (!seen.has(id)) { this.removeCrate(c); this.crates.delete(id); }
    }
  }

  private removeCrate(c: CrateView) {
    this.scene.remove(c.root);
    (c.halo.material as THREE.Material).dispose();
    (c.beam.material as THREE.Material).dispose();
  }

  /** Burst of colour when a crate is picked up (or a shield breaks). */
  bonusBurst(x: number, y: number, color: number, big = false) {
    for (let i = 0; i < (big ? 36 : 26); i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2.5;
      this.glow.emit({ x, y: 0.45, z: y, vx: Math.cos(a) * s, vy: 1 + Math.random() * 2.5, vz: Math.sin(a) * s, life: 0.4 + Math.random() * 0.3, s0: 0.1, s1: 0.01, c0: 0xffffff, c1: color, drag: 3, grav: 3 });
    }
    const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, y);
    this.scene.add(ring);
    this.shocks.push({ mesh: ring, t: 0, max: 0.4, size: big ? 1.4 : 0.9 });
    if (big) this.shake = Math.max(this.shake, 0.12);
  }

  private shellMats = new Map<string, THREE.MeshStandardMaterial>();
  /** Player shells wear their shooter's colour (rockets keep a hot orange core). */
  private shellMat(color: number, rocket: boolean) {
    const key = `${color}:${rocket ? 1 : 0}`;
    let m = this.shellMats.get(key);
    if (!m) {
      const base = new THREE.Color(0xffffff).lerp(new THREE.Color(color), 0.7);
      m = new THREE.MeshStandardMaterial({ color: base, emissive: rocket ? new THREE.Color(0xff7a1a).lerp(new THREE.Color(color), 0.4) : new THREE.Color(color), emissiveIntensity: rocket ? 1.1 : 0.75, roughness: 0.3 });
      this.shellMats.set(key, m);
    }
    return m;
  }

  syncBullets(list: RBullet[], dt: number) {
    const seen = new Set<number>();
    for (const b of list) {
      seen.add(b.id);
      let m = this.bullets.get(b.id);
      if (!m) {
        m = new THREE.Mesh(geo.bullet, b.color === undefined ? (b.rocket ? this.rocketMat : this.bulletMat) : this.shellMat(b.color, b.rocket));
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
        this.smoke.emit({ x: b.x, y: 0.45, z: b.y, life: 0.35, s0: 0.06, s1: 0.02, c0: b.color ?? 0xffffff, c1: 0xe8e2d8 });
        if (this.night > 0.3) this.glow.emit({ x: b.x, y: 0.45, z: b.y, life: 0.25, s0: 0.07, s1: 0.01, c0: 0xffe0a0, c1: 0xff7020 });
      }
    }
    // at night the first few shells carry a little light along the walls
    for (let i = 0; i < this.shellLights.length; i++) {
      const pl = this.shellLights[i], b = list[i];
      if (!b || this.night <= 0) { pl.intensity = 0; continue; }
      pl.position.set(b.x, 0.5, b.y);
      pl.color.setHex(b.rocket ? 0xff9a40 : 0xffd9a0);
      pl.intensity = 2.6 * this.night;
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
    if (this.night > 0.3 && this.flashT <= 0) {
      // the muzzle flash lights up the night (and gives the shooter away)
      this.flash.position.set(x, 0.8, y);
      this.flash.intensity = 9;
      this.flashT = 0.09;
    }
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
    const color = '#' + new THREE.Color(info.kind === 'player' ? info.color : enemyColor(info.kind)).getHexString();
    const big = tankRadius(info.kind) / TANK_R;
    this.floorMark((g) => {
      g.save();
      g.translate(x * PX, y * PX);
      g.rotate(0.2);
      g.strokeStyle = 'rgba(25,15,8,0.75)';
      g.lineCap = 'round';
      g.lineWidth = 9 * big;
      const s = PX * 0.3 * big;
      g.beginPath(); g.moveTo(-s, -s); g.lineTo(s, s); g.moveTo(s, -s); g.lineTo(-s, s); g.stroke();
      g.strokeStyle = color;
      g.globalAlpha = 0.5;
      g.lineWidth = 4 * big;
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
    this.animatePortals(dt);
    if (this.night !== this.nightTarget) this.night = Math.min(this.nightTarget, (performance.now() - this.nightStart) / 1200); // real time, even at a low frame rate
    this.applyNight();
    this.animateStorm(dt);
    this.animateQuakes(dt);
    if (this.night > 0.5 && Math.random() < 5 * dt) {
      // fireflies drifting over the table
      this.glow.emit({
        x: 1 + Math.random() * (W - 2), y: 0.3 + Math.random() * 0.7, z: 1 + Math.random() * (H - 2),
        vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.3) * 0.2, vz: (Math.random() - 0.5) * 0.5,
        life: 2.5 + Math.random() * 1.5, s0: 0.05, s1: 0.01, c0: 0xf0ff9a, c1: 0x5cff8a, drag: 0.1,
      });
    }
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

  tankKind(id: number) {
    return this.tanks.get(id)?.info.kind;
  }

  tankColor(id: number) {
    const v = this.tanks.get(id);
    if (!v) return 0xffffff;
    return v.info.kind === 'player' ? v.info.color : enemyColor(v.info.kind);
  }
}
