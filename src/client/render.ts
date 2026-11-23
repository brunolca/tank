import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SEED_BLAST, SEED_FLIGHT, SEED_RIPEN, BELT_SPEED, ICE, SAND, SNOW, PACKED, RAMPART_ARC, BOLT_R, BONUS_INFO, DRILL_BLAST, FLAG_BURROW, BONUS_KINDS, ENEMY_COLORS, enemyColor, FLAG_ALERT, FLAG_CHARGING, FLAG_RAGE, FLAG_MAGNET, FLAG_FROZEN, FLAG_AIR, FLAG_SPOT, FLAG_REPAIR, FLAG_PATCHED, WATCH_HALF, WATCH_RANGE, HOP_HEIGHT, HOP_MAX, MAGNET_HELD_SHIFT, MAGNET_R, H, MINE_BLAST, MORTAR_BLAST, PORTAL_COLORS, TANK_R, Tile, W, isPit, isPortal, isTunnel, tankRadius, type BonusKind } from '../shared/constants';
import { bridgeAxis, castRicochet, tunnelAxis } from '../shared/physics';
import { GATE_COLORS, gateColor, gateUp, isDrawbridge, isGate, reverseBelts } from '../shared/constants';
import { gustAt, windAngle } from '../shared/wind';
import { FOG_BANKS, FOG_HIDE, FOG_SIGHT, fogBanks, fogDensity, type FogBank } from '../shared/fog';
import { isRivalId } from '../shared/rivals';
import { CTF_RETURN, TEAM_COLORS } from '../shared/drapeau';
import { GOLD_COLOR as GOLD } from '../shared/caisses';
import { CROWN_RETURN } from '../shared/couronne';
import type { TankInfo } from '../shared/protocol';

export interface RTank { id: number; x: number; y: number; body: number; turret: number; alive: boolean; invisible: boolean; fx?: number; hp?: number } // hp: hit points left (tough tanks only)
export interface RBonus { id: number; x: number; y: number; kind: number; blink: boolean; gold?: boolean } // gold: « La chasse aux caisses » (iteration 37), the golden crate
export interface RBullet { id: number; x: number; y: number; vx: number; vy: number; rocket: boolean; heavy?: boolean; ghost?: boolean; color?: number } // ghost: a shell of the « Passe-muraille » not yet through its wall (iteration 52) // color: the shooter's, for player shells
export interface RMine { id: number; x: number; y: number; blink: boolean; seed?: number; remote?: boolean } // remote: a mine of the « Détonateur » (iteration 52) // seed: a seed of the Semeur (iteration 25), its age in seconds
/** « Drapeaux » (iteration 24): a flag, state 0 at home, 1 carried by `carrier`, 2 dropped (`left` seconds before it flies home). */
/** « Le Mortier » (iteration 34): a cannonball in the air, from (x0, y0) to (x1, y1), t seconds into its dur-second flight. */
export interface RLob { id: number; x0: number; y0: number; x1: number; y1: number; t: number; dur: number }
export interface RFlag { team: number; x: number; y: number; carrier: number; state: number; left: number }
/** « La couronne » (iteration 50): where the crown is, who wears it (0: nobody), 0 on its cushion / 1 worn / 2 dropped, seconds before it flies home. */
export interface RCrown { x: number; y: number; holder: number; state: number; left: number }

const PX = 64; // floor texture pixels per tile
const SPX = 32; // skate scratch texture pixels per tile (iteration 38)
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

/** « Drapeaux » (iteration 24): one flag and its base. */
interface FlagView {
  root: THREE.Group;
  cloth: THREE.Mesh;
  base: Float32Array; // the cloth's vertices at rest
  halo: THREE.Mesh;
  rim: THREE.Mesh;
  foot: THREE.Mesh;
  ang: number; // where the cloth points
  px: number; // last position, to see it move
  py: number;
  carried: boolean;
  phase: number;
}

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
  seenT?: number; // fog (iteration 26): seconds during which its last muzzle flash shows it through the mist
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
  crane?: THREE.Group; // the Maçon (iteration 12): its crane swings when it lays a block
  sack?: THREE.Group; // the Pilleur (iteration 15): its loot sack swells with each crate it steals
  key?: THREE.Group; // a versus rival (iteration 17): its wind-up key
  cloud?: THREE.Group; // the Grondeur (iteration 18): its own little storm cloud, floating above
  rodBall?: THREE.MeshStandardMaterial; // and the ball of its lightning rod, which glows as it calls
  hopper?: THREE.Group; // the Semeur (iteration 25): its seed hopper, which shakes as it sows
  shieldMat?: THREE.MeshStandardMaterial; // the Rempart (iteration 22): its brass shield, which flares when a shell bounces off
  shieldGlow?: number;
  magnet?: MagnetView; // the Aimant (iteration 27)
  flake?: THREE.Group; // the Givré (iteration 31): the snowflake of ice crystals spinning on its turret
  tube?: THREE.Group; // the Mortier (iteration 34): its stubby barrel raised toward the sky
  under?: boolean;
  legs?: HopperLeg[]; // « La Sauterelle » (iteration 41): its two big folded hind legs
  leap?: { x0: number; y0: number; x1: number; y1: number }; // the leap it is in (from its « hop » event)
  leapRing?: THREE.Mesh; // and the ring on the floor where it will land
  squash?: number; // the bounce of its landing, fading out
  spanner?: THREE.Group; // « Le Mécano » (iteration 51): the big spanner on its turret (it turns while it works)
  patch?: THREE.Group; // a tank put back together by a Mécano: two crossed strips of plaster on its hull
  fixing?: boolean; // its wreck is being repaired right now (drawn half sunk and tilted, rising as the work goes on)
  lantern?: LanternView; // « Le Veilleur » (iteration 47): its lighthouse lamp and the beam it throws on the table
  wheels?: THREE.Mesh[]; // « Le Tortillard » (iteration 49): the wheels of the locomotive and its wagons (they turn as it runs)
  chimney?: THREE.Object3D; // and the locomotive's chimney, where the smoke puffs out
  trainX?: number; // where it was last frame (how far the wheels turned)
  trainY?: number;
  ice?: THREE.Group; // « Gel » (iteration 29): the ice cube it is frozen in (in the scene, not the tank: it gives away invisible tanks)
  iceT?: number; // seconds since it froze
}

/**
 * « Le Veilleur » (iteration 47): the glass of its lamp and its lens (they glow yellow, red once it has caught someone),
 * and the beam: a fan on the floor, cut short by the walls, fading out with distance (in the scene, not the tank).
 */
interface LanternView {
  glass: THREE.MeshStandardMaterial;
  lens: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  pos: Float32Array;
  col: Float32Array;
  red: number; // 0 sweeping … 1 alarm, eased
  reach: number; // length of the middle ray (the night spotlight stops there, not through the wall)
}
/** Rays of the Veilleur's beam (the fan has BEAM_RAYS + 1 edge points). */
const BEAM_RAYS = 28;

/** « La Sauterelle » (iteration 41): a hind leg, a thigh rising behind the hull and a shin folded back down to the floor. */
interface HopperLeg { thigh: THREE.Group; knee: THREE.Group }

/** The Aimant (iteration 27): its field on the floor, a ripple running inward, and the shells it holds above its turret. */
interface MagnetView {
  field: THREE.Mesh;
  ripple: THREE.Mesh;
  orbit: THREE.Group;
  held: THREE.Mesh[];
  horseshoe: THREE.MeshStandardMaterial;
  on: number; // eased 0..1
  flash: number;
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
  } else if (kind === 'freeze') {
    // a snowflake (iteration 29)
    g.lineWidth = 6;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3, ca = Math.cos(a), sa = Math.sin(a);
      g.moveTo(64, 64); g.lineTo(64 + ca * 32, 64 + sa * 32);
      for (const sgn of [-1, 1]) {
        const b = a + sgn * 0.7;
        g.moveTo(64 + ca * 20, 64 + sa * 20); g.lineTo(64 + ca * 20 + Math.cos(b) * 10, 64 + sa * 20 + Math.sin(b) * 10);
      }
    }
    g.stroke();
  } else if (kind === 'ghost') {
    // « Passe-muraille » (iteration 52): a shell flying through a brick wall, three speed lines behind it
    g.fillStyle = 'rgba(255,248,232,0.45)';
    g.fillRect(56, 34, 16, 60);
    g.fillStyle = '#fff8e8';
    g.moveTo(74, 56); g.lineTo(92, 56); g.quadraticCurveTo(104, 64, 92, 72); g.lineTo(74, 72); g.closePath(); g.fill();
    g.lineWidth = 6;
    g.beginPath();
    for (const yy of [52, 64, 76]) { g.moveTo(32, yy); g.lineTo(48, yy); }
    g.stroke();
  } else if (kind === 'remote') {
    // « Détonateur » (iteration 52): a plunger box with its handle, two radio waves above
    g.fillRect(42, 62, 44, 28);
    g.fillRect(61, 42, 6, 20);
    g.fillRect(50, 38, 28, 7);
    g.lineWidth = 5;
    g.beginPath(); g.arc(64, 40, 18, -2.4, -0.74); g.stroke();
    g.beginPath(); g.arc(64, 40, 28, -2.3, -0.84); g.stroke();
  } else if (kind === 'heavy') {
    // a big fat shell, nose up (iteration 29)
    g.moveTo(48, 92); g.lineTo(48, 58); g.quadraticCurveTo(48, 34, 64, 30); g.quadraticCurveTo(80, 34, 80, 58); g.lineTo(80, 92); g.closePath(); g.fill();
    g.fillStyle = col; g.fillRect(48, 70, 32, 7);
  } else {
    for (const a of [-0.55, 0, 0.55]) { g.moveTo(64, 86); g.lineTo(64 + Math.sin(a) * 40, 86 - Math.cos(a) * 40); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Spiral swirl painted once and shared by every portal (tinted by the material colour). */
/** Rubber of a conveyor belt (iteration 16): orange chevrons pointing along +u, wooden rails on both edges. */
function beltTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3b3f4b';
  g.fillRect(0, 0, 128, 128);
  // ribs of the rubber
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (let x = 0; x < 128; x += 16) g.fillRect(x, 14, 6, 100);
  // two chevrons per tile
  g.strokeStyle = '#ffb43d';
  g.lineWidth = 11;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const x0 of [14, 78]) {
    g.beginPath();
    g.moveTo(x0, 34);
    g.lineTo(x0 + 26, 64);
    g.lineTo(x0, 94);
    g.stroke();
  }
  // rails along both edges
  for (const y0 of [0, 116]) {
    g.fillStyle = '#b98a55';
    g.fillRect(0, y0, 128, 12);
    g.fillStyle = 'rgba(70,40,15,0.45)';
    g.fillRect(0, y0 === 0 ? 10 : 116, 128, 2);
    g.fillStyle = '#6b4a2c';
    for (let x = 8; x < 128; x += 32) { g.beginPath(); g.arc(x, y0 + 6, 2.2, 0, Math.PI * 2); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Ice (iteration 21): pale blue, a few white scratches from skates and a frosty rim. */
const SNOW_FLAKES = 320;
/** Wind (iteration 23): leaves blown across the table, and quick white streaks when it gusts. */
const LEAVES = 80;
const GUSTS = 40;
const LEAF_COLORS = [0xe8892c, 0xd9542b, 0xf2c14e, 0x9bbf4a, 0xc76a2a, 0xf0a33a];

/** Red and white stripes of the windsock (iteration 23). */
function sockTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#f6efe2' : '#e2453c'; g.fillRect((i * 64) / 5, 0, 64 / 5 + 1, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function iceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#bfe6fa'); grad.addColorStop(0.5, '#93d0f0'); grad.addColorStop(1, '#b3e0f7');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.lineCap = 'round';
  for (let k = 0; k < 12; k++) {
    g.strokeStyle = `rgba(255,255,255,${0.5 + rnd() * 0.45})`;
    g.lineWidth = 1 + rnd() * 1.6;
    const x = rnd() * 128, y = rnd() * 128, a = rnd() * Math.PI, l = 18 + rnd() * 40;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 6, y + Math.sin(a) * l * 0.5 - 6, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // a couple of hairline cracks
  g.strokeStyle = 'rgba(70,130,175,0.45)';
  g.lineWidth = 1;
  for (let k = 0; k < 2; k++) {
    let x = rnd() * 128, y = rnd() * 128;
    g.beginPath(); g.moveTo(x, y);
    for (let j = 0; j < 4; j++) { x += (rnd() - 0.5) * 34; y += (rnd() - 0.5) * 34; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

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
  antenna: new THREE.CylinderGeometry(0.012, 0.016, 0.34, 6), // « Détonateur » (iteration 52)
  shock: new THREE.RingGeometry(0.85, 1, 48),
  disc: new THREE.CircleGeometry(1, 40),
  crate: new RoundedBoxGeometry(0.58, 0.58, 0.58, 2, 0.06),
  beam: new THREE.CylinderGeometry(0.3, 0.36, 1.8, 24, 1, true),
  halo: new THREE.CircleGeometry(0.5, 36),
  bubble: new THREE.SphereGeometry(0.62, 28, 16),
  ice: new RoundedBoxGeometry(1.02, 0.78, 0.9, 2, 0.1),
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
  // the Maçon (iteration 12): a little crane on the back deck, a hod of cork bricks, a trowel
  post: new THREE.CylinderGeometry(0.03, 0.035, 0.42, 8),
  boom: new THREE.BoxGeometry(0.5, 0.035, 0.035),
  brick: new RoundedBoxGeometry(0.15, 0.09, 0.11, 2, 0.015),
  hookBlock: new RoundedBoxGeometry(0.13, 0.13, 0.13, 2, 0.02),
  cable: new THREE.CylinderGeometry(0.006, 0.006, 0.16, 4),
  trowel: new THREE.BoxGeometry(0.2, 0.012, 0.11),
};
const masonCorkMat = new THREE.MeshStandardMaterial({ color: 0xc98f55, roughness: 0.95 });
const craneMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, metalness: 0.2 });
// the Pilleur (iteration 15): a burlap sack on the back deck, a rope knot, a black mask round the turret, a gold coin peeking out
const sackGeo = new THREE.SphereGeometry(0.2, 18, 12);
const knotGeo = new THREE.TorusGeometry(0.05, 0.02, 6, 14);
const maskGeo = new THREE.CylinderGeometry(0.236, 0.236, 0.05, 24, 1, true);
const coinGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.015, 16);
const sackMat = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 1 });
const ropeMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
const maskMat = new THREE.MeshStandardMaterial({ color: 0x17171c, roughness: 0.6, side: THREE.DoubleSide });
// the Rempart (iteration 22): a curved brass shield on its turret, as wide as the arc that sends shells back
// the Semeur (iteration 25): a wooden seed hopper on its back deck, a sprout on its turret, and its giant seeds
const sowerGeo = {
  hopper: new THREE.CylinderGeometry(0.24, 0.13, 0.28, 14, 1, true),
  hopperBottom: new THREE.CircleGeometry(0.13, 14),
  grain: new THREE.SphereGeometry(0.06, 10, 8),
  leaf: new THREE.SphereGeometry(0.1, 12, 8),
  stem: new THREE.CylinderGeometry(0.015, 0.02, 0.2, 6),
  seed: new THREE.SphereGeometry(0.3, 22, 14),
  seam: new THREE.TorusGeometry(0.27, 0.025, 6, 28),
};
const hopperMat = new THREE.MeshStandardMaterial({ color: 0xb77a3e, roughness: 0.7, side: THREE.DoubleSide });
const grainMat = new THREE.MeshStandardMaterial({ color: 0xe8b04a, roughness: 0.5, emissive: 0x5a3200, emissiveIntensity: 0.3 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x5fc24a, roughness: 0.5 });
const seedMat = new THREE.MeshStandardMaterial({ color: 0xc98a3a, roughness: 0.55, metalness: 0.05, emissive: 0xff5a10, emissiveIntensity: 0 });
const seamMat = new THREE.MeshStandardMaterial({ color: 0x7a4a1c, roughness: 0.7 });

const rampartGeo = {
  plate: new THREE.CylinderGeometry(0.5, 0.5, 0.4, 22, 1, true, Math.PI / 2 - RAMPART_ARC, RAMPART_ARC * 2),
  // a flat brass lip on top, so the shield reads from the camera high above the table
  lip: new THREE.RingGeometry(0.38, 0.53, 22, 1, -RAMPART_ARC, RAMPART_ARC * 2),
  rim: new THREE.TorusGeometry(0.5, 0.028, 6, 22, RAMPART_ARC * 2),
  boss: new THREE.SphereGeometry(0.065, 12, 8),
  stud: new THREE.SphereGeometry(0.026, 8, 6),
  crest: new THREE.ConeGeometry(0.05, 0.16, 4),
};
const rampartRimMat = new THREE.MeshStandardMaterial({ color: 0x8a5a26, roughness: 0.4, metalness: 0.7 });
// the Aimant (iteration 27): a red horseshoe magnet with silver poles on its turret
const magnetGeo = {
  shoe: new THREE.TorusGeometry(0.15, 0.055, 10, 18, Math.PI),
  pole: new THREE.BoxGeometry(0.11, 0.11, 0.11),
  field: new THREE.RingGeometry(MAGNET_R - 0.06, MAGNET_R, 64),
  ripple: new THREE.RingGeometry(0.92, 1, 48),
  shell: new THREE.SphereGeometry(0.065, 10, 8),
};
const magnetPoleMat = new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.2, metalness: 0.9, emissive: 0x1a2028, emissiveIntensity: 0.4 });
const magnetShellMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.3, metalness: 0.6, emissive: 0x7fc8ff, emissiveIntensity: 0.5 });
// the Givré (iteration 31): a snowflake of ice crystals on its turret, skate blades along its treads
const frostGeo = {
  arm: new THREE.BoxGeometry(0.58, 0.035, 0.05),
  twig: new THREE.BoxGeometry(0.12, 0.03, 0.035),
  gem: new THREE.OctahedronGeometry(0.085),
  blade: new THREE.BoxGeometry(0.86, 0.03, 0.035),
  icicle: new THREE.ConeGeometry(0.035, 0.16, 6),
};
const frostCrystalMat = new THREE.MeshStandardMaterial({ color: 0xeaf8ff, roughness: 0.08, metalness: 0.2, emissive: 0x7fd0ff, emissiveIntensity: 0.55, transparent: true, opacity: 0.92 });
// the Mortier (iteration 34): a stubby wide barrel raised toward the sky, a little pyramid of cannonballs on its back deck
const MORTAR_TILT = 0.9; // elevation of the barrel (radians)
const mortarGeo = {
  tube: new THREE.CylinderGeometry(0.105, 0.125, 0.4, 16),
  lip: new THREE.TorusGeometry(0.105, 0.03, 8, 18),
  hoop: new THREE.TorusGeometry(0.125, 0.018, 6, 18),
  ball: new THREE.SphereGeometry(0.085, 14, 10),
  flight: new THREE.SphereGeometry(0.17, 18, 12),
};
const cannonballMat = new THREE.MeshStandardMaterial({ color: 0x3b2f27, roughness: 0.55, metalness: 0.25 });
// « La Sauterelle » (iteration 41): two big spring legs folded along its hull, feelers and bulging eyes on its turret
const HOP_THIGH = 0.44, HOP_SHIN = 0.54;
const HOP_POSE = { rest: [2.48, 1.85], crouch: [2.78, 1.35], air: [2.05, 2.75] };
const hopperGeo = {
  thigh: new THREE.BoxGeometry(HOP_THIGH, 0.1, 0.075),
  shin: new THREE.BoxGeometry(HOP_SHIN, 0.055, 0.05),
  joint: new THREE.SphereGeometry(0.055, 10, 8),
  foot: new THREE.BoxGeometry(0.12, 0.035, 0.08),
  feeler: new THREE.CylinderGeometry(0.012, 0.016, 0.42, 6),
  tip: new THREE.SphereGeometry(0.03, 8, 6),
  eye: new THREE.SphereGeometry(0.065, 12, 10),
  pupil: new THREE.SphereGeometry(0.032, 8, 6),
};
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.2 });
const hopRingMat = new THREE.MeshBasicMaterial({ color: 0x4a8a0e, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
const hopRingGeo = new THREE.RingGeometry(0.66, 1, 48);
// « Le Veilleur » (iteration 47): a little lighthouse on its turret, striped tower, glass lantern room, brass roof
const watchGeo = {
  tower: new THREE.CylinderGeometry(0.15, 0.2, 0.36, 20),
  band: new THREE.CylinderGeometry(0.172, 0.185, 0.08, 20),
  deck: new THREE.CylinderGeometry(0.22, 0.22, 0.035, 20),
  glass: new THREE.CylinderGeometry(0.14, 0.14, 0.17, 16),
  roof: new THREE.ConeGeometry(0.2, 0.17, 16),
  knob: new THREE.SphereGeometry(0.045, 10, 8),
  lens: new THREE.BoxGeometry(0.05, 0.12, 0.15),
};
const watchBandMat = new THREE.MeshStandardMaterial({ color: 0xf1e6cf, roughness: 0.5 });
// « Le Mécano » (iteration 51): a big chrome spanner on its turret, a red toolbox on its back deck; the plaster strips of
// a patched tank; the ring of little ticks that fills up around a wreck under repair
const mechGeo = {
  handle: new THREE.BoxGeometry(0.4, 0.05, 0.075),
  jaw: new THREE.TorusGeometry(0.075, 0.03, 8, 16, Math.PI * 1.45),
  ring: new THREE.TorusGeometry(0.05, 0.022, 8, 14),
  post: new THREE.CylinderGeometry(0.025, 0.03, 0.14, 8),
  box: new THREE.BoxGeometry(0.2, 0.12, 0.3),
  lid: new THREE.BoxGeometry(0.215, 0.03, 0.315),
  grip: new THREE.TorusGeometry(0.055, 0.013, 6, 12, Math.PI),
  strip: new THREE.BoxGeometry(0.36, 0.014, 0.075),
  tick: new THREE.BoxGeometry(0.14, 0.03, 0.07),
};
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.22, metalness: 0.85 });
const toolboxMat = new THREE.MeshStandardMaterial({ color: 0xd8392f, roughness: 0.45, metalness: 0.15 });
const plasterMat = new THREE.MeshStandardMaterial({ color: 0xf6e7c8, roughness: 0.85 });
const tickOnMat = new THREE.MeshBasicMaterial({ color: 0xffd648 });
const tickOffMat = new THREE.MeshBasicMaterial({ color: 0x6b5236, transparent: true, opacity: 0.7 });
/** Ticks of the repair ring (one lights up every 1/REPAIR_TICKS of the work). */
const REPAIR_TICKS = 16;

/** The Mécano's spanner: a handle, an open jaw at one end and a ring at the other, raised on a little post. */
function buildSpanner(): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.Mesh(mechGeo.post, chromeMat);
  post.position.y = 0.07;
  const arm = new THREE.Group();
  arm.position.y = 0.16;
  const handle = new THREE.Mesh(mechGeo.handle, chromeMat);
  const jaw = new THREE.Mesh(mechGeo.jaw, chromeMat);
  jaw.rotation.x = -Math.PI / 2;
  jaw.rotation.z = Math.PI * 0.275;
  jaw.position.x = 0.25;
  const ring = new THREE.Mesh(mechGeo.ring, chromeMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.x = -0.22;
  arm.add(handle, jaw, ring);
  g.add(post, arm);
  g.userData.arm = arm;
  return g;
}
// « Le Tortillard » (iteration 49): a toy steam locomotive (boiler, cab, chimney, cowcatcher, red wheels) and its flat
// wagons, each with a little cannon; its rails on the floor (sleepers and two steel rails)
const trainGeo = {
  chassis: new THREE.BoxGeometry(0.98, 0.08, 0.46),
  wheel: new THREE.CylinderGeometry(0.11, 0.11, 0.05, 16),
  hub: new THREE.CylinderGeometry(0.035, 0.035, 0.06, 8),
  boiler: new THREE.CylinderGeometry(0.17, 0.17, 0.56, 18),
  band: new THREE.CylinderGeometry(0.178, 0.178, 0.035, 18),
  front: new THREE.CylinderGeometry(0.15, 0.15, 0.03, 18),
  chimney: new THREE.CylinderGeometry(0.075, 0.05, 0.2, 12),
  lip: new THREE.CylinderGeometry(0.095, 0.095, 0.04, 12),
  dome: new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  cab: new THREE.BoxGeometry(0.3, 0.3, 0.44),
  roof: new THREE.BoxGeometry(0.38, 0.04, 0.5),
  window: new THREE.BoxGeometry(0.12, 0.1, 0.45),
  catcher: new THREE.BoxGeometry(0.16, 0.025, 0.44),
  lampBox: new THREE.CylinderGeometry(0.045, 0.045, 0.07, 10),
  bed: new THREE.BoxGeometry(0.78, 0.07, 0.46),
  side: new THREE.BoxGeometry(0.78, 0.08, 0.03),
  hook: new THREE.BoxGeometry(0.12, 0.03, 0.05),
  sleeper: new THREE.BoxGeometry(0.11, 0.025, 0.62),
  rail: new THREE.BoxGeometry(1, 0.03, 0.045),
};
const wheelMat = new THREE.MeshStandardMaterial({ color: 0xc8402e, roughness: 0.45, metalness: 0.1 });
const sootMat = new THREE.MeshStandardMaterial({ color: 0x24252b, roughness: 0.6, metalness: 0.3 });
const cabWindowMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, roughness: 0.3, emissive: 0xffc860, emissiveIntensity: 0.5 });
const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.9 });
const railMat = new THREE.MeshStandardMaterial({ color: 0xaeb6be, roughness: 0.3, metalness: 0.85 });
const lobShadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
const skateMat = new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.15, metalness: 0.95, emissive: 0x16222c, emissiveIntensity: 0.4 });
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc94a, roughness: 0.25, metalness: 0.85, emissive: 0x4a3000, emissiveIntensity: 0.5 });
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
// the Grondeur (iteration 18): a copper lightning rod on the turret, yellow lightning stripes, a cotton cloud above
const thunderGeo = {
  rod: new THREE.CylinderGeometry(0.022, 0.03, 0.56, 8),
  ball: new THREE.SphereGeometry(0.075, 14, 10),
  coil: new THREE.TorusGeometry(0.05, 0.014, 6, 14),
  stripe: new THREE.BoxGeometry(0.16, 0.05, 0.02),
  puff: new THREE.SphereGeometry(1, 16, 10),
};
const copperMat = new THREE.MeshStandardMaterial({ color: 0xd9824a, roughness: 0.3, metalness: 0.8, emissive: 0x2a1000, emissiveIntensity: 0.4 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.4, emissive: 0x5a4000, emissiveIntensity: 0.6 });
// versus rivals (iteration 17): antenna, bead and wind-up key
const rivalGeo = {
  post: new THREE.CylinderGeometry(0.012, 0.016, 0.3, 6),
  bead: new THREE.SphereGeometry(0.05, 12, 8),
  shaft: new THREE.CylinderGeometry(0.022, 0.022, 0.14, 8),
  loop: new THREE.TorusGeometry(0.06, 0.018, 6, 14),
};
const rivalMetalMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.3, metalness: 0.8 });
const rivalBeadMat = new THREE.MeshStandardMaterial({ color: 0xff4d3d, roughness: 0.3, emissive: 0xff2a1a, emissiveIntensity: 0.9 });

// the stripes of the coop campaign (iteration 19): gold chevrons on the front deck, one per three skills bought
const chevronGeo = new THREE.BoxGeometry(0.15, 0.03, 0.045);
const chevronMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.3, metalness: 0.4, emissive: 0xc08a00, emissiveIntensity: 0.9 });

/** Fold the Sauterelle's legs: [thigh angle, knee angle] (radians, around the hull's side axis). */
function poseLegs(v: TankView, pose: number[]) {
  for (const l of v.legs ?? []) { l.thigh.rotation.z = pose[0]; l.knee.rotation.z = pose[1]; }
}

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
  const ranks = info.kind === 'player' && Array.isArray(info.sk) ? info.sk.reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  for (let i = 0; i < Math.min(3, Math.ceil(ranks / 3)); i++) {
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(chevronGeo, chevronMat);
      arm.rotation.y = s * 0.7;
      arm.position.set(0.25 + i * 0.065, 0.385, s * 0.05);
      hull.add(arm);
    }
  }
  let armorGroup: THREE.Group | undefined;
  const lampMat = new THREE.MeshBasicMaterial({ color: info.kind === 'player' ? LAMP_PLAYER : LAMP_ENEMY });
  const lamp = new THREE.Mesh(geo.lamp, lampMat);
  lamp.position.set(0.2, 0.1, 0.12);
  lamp.visible = false;
  turret.add(dome, cap, barrel, muzzle, lamp);
  let rivalKey: THREE.Group | undefined;
  if (info.kind === 'player' && isRivalId(info.pid)) {
    // a versus rival driven by the computer (iteration 17): a wind-up robot's antenna with a glowing bead, and a key in its back
    const post = new THREE.Mesh(rivalGeo.post, rivalMetalMat);
    post.position.set(-0.08, 0.32, 0);
    const bead = new THREE.Mesh(rivalGeo.bead, rivalBeadMat);
    bead.position.set(-0.08, 0.5, 0);
    turret.add(post, bead);
    const key = new THREE.Group();
    const shaft = new THREE.Mesh(rivalGeo.shaft, rivalMetalMat);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = -0.06;
    key.add(shaft);
    for (const s of [-1, 1]) {
      const loop = new THREE.Mesh(rivalGeo.loop, rivalMetalMat);
      loop.position.set(-0.14, 0, s * 0.08);
      key.add(loop);
    }
    key.position.set(-0.46, 0.3, 0);
    hull.add(key);
    rivalKey = key;
  }
  root.add(hull, turret);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  const scale = tankRadius(info.kind) / TANK_R;
  const view: TankView = { info, root, hull, turret, lastMarkX: NaN, lastMarkY: NaN, wasAlive: true, recoil: 0, materials: [bodyMat, topMat, barrelMat], scale, hit: 0, lamp, lampMat, alertT: 0, key: rivalKey };
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
  if (info.kind === 'thunder') {
    const rod = new THREE.Mesh(thunderGeo.rod, copperMat);
    rod.position.set(-0.08, 0.36, 0);
    turret.add(rod);
    for (const h of [0.22, 0.32, 0.42]) {
      const c = new THREE.Mesh(thunderGeo.coil, copperMat);
      c.rotation.x = Math.PI / 2;
      c.position.set(-0.08, h, 0);
      turret.add(c);
    }
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.2, metalness: 0.3, emissive: 0x4f8dff, emissiveIntensity: 0.5 });
    const ball = new THREE.Mesh(thunderGeo.ball, ballMat);
    ball.position.set(-0.08, 0.68, 0);
    turret.add(ball);
    // zigzag stripes on both flanks: a lightning bolt painted on the toy
    for (const z of [-0.305, 0.305]) {
      [[-0.2, 0.26, 0.5], [-0.06, 0.22, -0.5], [0.08, 0.26, 0.5], [0.22, 0.22, -0.5]].forEach(([x, y, r]) => {
        const st = new THREE.Mesh(thunderGeo.stripe, stripeMat);
        st.position.set(x, y + 0.02, z);
        st.rotation.z = r;
        hull.add(st);
      });
    }
    const cloud = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xdde4f0, roughness: 1, transparent: true, opacity: 0.94 });
    for (const [x, y, z, r] of [[0, 0, 0, 0.34], [0.3, -0.06, 0.08, 0.25], [-0.3, -0.05, -0.05, 0.27], [0.08, 0.1, -0.22, 0.22], [-0.1, -0.02, 0.25, 0.23]]) {
      const p = new THREE.Mesh(thunderGeo.puff, cloudMat);
      p.position.set(x, y, z);
      p.scale.set(r, r * 0.8, r);
      p.castShadow = true;
      cloud.add(p);
    }
    cloud.position.y = 2.2;
    cloud.userData.mat = cloudMat;
    root.add(cloud);
    view.cloud = cloud;
    view.rodBall = ballMat;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'sower') {
    // a toy seed drill: a wooden hopper full of golden grains on the back deck, a green sprout on the turret
    const hopper = new THREE.Group();
    const bin = new THREE.Mesh(sowerGeo.hopper, hopperMat);
    const bottom = new THREE.Mesh(sowerGeo.hopperBottom, hopperMat);
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -0.14;
    hopper.add(bin, bottom);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, r = i ? 0.1 + (i % 3) * 0.035 : 0;
      const g = new THREE.Mesh(sowerGeo.grain, grainMat);
      g.position.set(Math.cos(a) * r, 0.1 + (i % 2) * 0.03, Math.sin(a) * r);
      hopper.add(g);
    }
    hopper.position.set(-0.28, 0.6, 0);
    hull.add(hopper);
    const stem = new THREE.Mesh(sowerGeo.stem, leafMat);
    stem.position.set(-0.05, 0.25, 0);
    turret.add(stem);
    for (const z of [-1, 1]) {
      const leaf = new THREE.Mesh(sowerGeo.leaf, leafMat);
      leaf.scale.set(0.5, 0.25, 1);
      leaf.position.set(-0.05, 0.35, z * 0.08);
      leaf.rotation.x = z * 0.5;
      turret.add(leaf);
    }
    view.hopper = hopper;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'mason') {
    // a toy builder: bricks of cork stacked on the back deck, a yellow crane with a block on its hook, a trowel up front
    for (const [x, y, z] of [[-0.3, 0.42, -0.13], [-0.3, 0.42, 0.03], [-0.3, 0.51, -0.05]]) {
      const b = new THREE.Mesh(geo.brick, masonCorkMat);
      b.position.set(x, y, z);
      hull.add(b);
    }
    const crane = new THREE.Group();
    crane.position.set(-0.2, 0.37, 0.2);
    const post = new THREE.Mesh(geo.post, craneMat);
    post.position.y = 0.21;
    const boom = new THREE.Mesh(geo.boom, craneMat);
    boom.position.set(0.18, 0.41, 0);
    const cable = new THREE.Mesh(geo.cable, barrelMat);
    cable.position.set(0.4, 0.33, 0);
    const hook = new THREE.Mesh(geo.hookBlock, masonCorkMat);
    hook.position.set(0.4, 0.2, 0);
    hook.name = 'hook';
    crane.add(post, boom, cable, hook);
    hull.add(crane);
    const trowel = new THREE.Mesh(geo.trowel, steelBitMat);
    trowel.position.set(0.5, 0.2, 0);
    trowel.rotation.z = -0.3;
    hull.add(trowel);
    view.crane = crane;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'thief') {
    const sack = new THREE.Group();
    sack.position.set(-0.32, 0.44, 0);
    const bag = new THREE.Mesh(sackGeo, sackMat);
    bag.scale.set(1, 0.85, 1.1);
    const knot = new THREE.Mesh(knotGeo, ropeMat);
    knot.position.y = 0.17;
    knot.rotation.x = Math.PI / 2;
    const coin = new THREE.Mesh(coinGeo, coinMat);
    coin.position.set(0.03, 0.2, 0.04);
    coin.rotation.set(0.9, 0, 0.4);
    sack.add(bag, knot, coin);
    hull.add(sack);
    const mask = new THREE.Mesh(maskGeo, maskMat);
    mask.position.y = 0.07;
    turret.add(mask);
    view.sack = sack;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'rampart') {
    const shieldMat = new THREE.MeshStandardMaterial({ color: 0xf0b445, roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide, emissive: 0xffc850, emissiveIntensity: 0.2 });
    const plate = new THREE.Mesh(rampartGeo.plate, shieldMat);
    plate.position.y = 0.04;
    const lip = new THREE.Mesh(rampartGeo.lip, shieldMat);
    lip.rotation.x = -Math.PI / 2;
    lip.position.y = 0.24;
    turret.add(plate, lip);
    for (const y of [-0.16, 0.245]) {
      // a bronze rim along the top and the bottom edge
      const holder = new THREE.Group();
      holder.rotation.y = RAMPART_ARC;
      holder.position.y = y;
      const rim = new THREE.Mesh(rampartGeo.rim, rampartRimMat);
      rim.rotation.x = Math.PI / 2;
      holder.add(rim);
      turret.add(holder);
    }
    const boss = new THREE.Mesh(rampartGeo.boss, rampartRimMat);
    boss.position.set(0.51, 0.04, 0);
    turret.add(boss);
    for (const a of [-0.8, -0.4, 0.4, 0.8]) {
      const stud = new THREE.Mesh(rampartGeo.stud, rampartRimMat);
      stud.position.set(Math.cos(a) * 0.51, 0.04 + (Math.abs(a) > 0.5 ? 0.1 : -0.1), Math.sin(a) * 0.51);
      turret.add(stud);
    }
    const crest = new THREE.Mesh(rampartGeo.crest, shieldMat);
    crest.position.set(-0.05, 0.27, 0);
    turret.add(crest);
    view.shieldMat = shieldMat;
    view.shieldGlow = 0;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'magnet') {
    const horseshoe = new THREE.MeshStandardMaterial({ color: 0xe03a32, roughness: 0.35, metalness: 0.3, emissive: 0x7fc8ff, emissiveIntensity: 0 });
    const g = new THREE.Group();
    g.position.set(-0.04, 0.29, 0);
    g.scale.setScalar(1.45);
    const inner = new THREE.Group();
    inner.rotation.y = Math.PI / 2;
    const shoe = new THREE.Mesh(magnetGeo.shoe, horseshoe);
    shoe.rotation.x = -Math.PI / 2;
    inner.add(shoe);
    g.add(inner);
    for (const z of [-0.15, 0.15]) {
      const pole = new THREE.Mesh(magnetGeo.pole, magnetPoleMat);
      pole.position.set(0.05, 0, z);
      g.add(pole);
    }
    turret.add(g);
    const fieldMat = new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0, depthWrite: false });
    const field = new THREE.Mesh(magnetGeo.field, fieldMat);
    field.rotation.x = -Math.PI / 2;
    field.position.y = 0.03;
    const ripple = new THREE.Mesh(magnetGeo.ripple, fieldMat.clone());
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = 0.035;
    const orbit = new THREE.Group();
    orbit.position.y = 0.95;
    const held: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(magnetGeo.shell, magnetShellMat);
      m.position.set(Math.cos((i / 6) * Math.PI * 2) * 0.3, 0, Math.sin((i / 6) * Math.PI * 2) * 0.3);
      m.visible = false;
      orbit.add(m);
      held.push(m);
    }
    root.add(field, ripple, orbit);
    view.magnet = { field, ripple, orbit, held, horseshoe, on: 0, flash: 0 };
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== field && o !== ripple) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'frost') {
    const flake = new THREE.Group();
    flake.position.set(-0.03, 0.27, 0);
    for (let k = 0; k < 3; k++) {
      const arm = new THREE.Group();
      arm.rotation.y = (k * Math.PI) / 3;
      arm.add(new THREE.Mesh(frostGeo.arm, frostCrystalMat));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        // little twigs near each tip, as on a real snowflake
        const tw = new THREE.Mesh(frostGeo.twig, frostCrystalMat);
        tw.position.set(sx * 0.19, 0, sz * 0.035);
        tw.rotation.y = sx * sz * 0.8;
        arm.add(tw);
      }
      flake.add(arm);
    }
    const gem = new THREE.Mesh(frostGeo.gem, frostCrystalMat);
    gem.position.y = 0.05;
    flake.add(gem);
    turret.add(flake);
    for (const z of [-0.38, 0.38]) {
      const blade = new THREE.Mesh(frostGeo.blade, skateMat);
      blade.position.set(0, 0.03, z);
      hull.add(blade);
    }
    for (const x of [-0.3, -0.1, 0.1, 0.3]) {
      // icicles hanging along the front and back of the hull
      for (const z of [-0.29, 0.29]) {
        const ic = new THREE.Mesh(frostGeo.icicle, frostCrystalMat);
        ic.rotation.z = Math.PI;
        ic.position.set(x, 0.3, z * 1.12);
        ic.scale.y = 0.7 + ((x * 7 + z * 3) % 0.3);
        hull.add(ic);
      }
    }
    view.flake = flake;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'mortar') {
    // no straight gun: a stubby tube raised toward the sky, bound with brass hoops, and spare cannonballs on the back
    barrel.visible = false;
    muzzle.visible = false;
    const tube = new THREE.Group();
    tube.position.set(0.04, 0.1, 0);
    const pivot = new THREE.Group();
    pivot.rotation.z = MORTAR_TILT;
    const pipe = new THREE.Mesh(mortarGeo.tube, barrelMat);
    pipe.rotation.z = -Math.PI / 2;
    pipe.position.x = 0.2;
    const lip = new THREE.Mesh(mortarGeo.lip, barrelMat);
    lip.rotation.y = Math.PI / 2;
    lip.position.x = 0.4;
    pivot.add(pipe, lip);
    for (const x of [0.08, 0.28]) {
      const hoop = new THREE.Mesh(mortarGeo.hoop, brassMat);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.x = x;
      pivot.add(hoop);
    }
    tube.add(pivot);
    turret.add(tube);
    for (const [x, y, z] of [[-0.33, 0.43, -0.09], [-0.33, 0.43, 0.09], [-0.2, 0.43, 0], [-0.28, 0.57, 0]]) {
      const b = new THREE.Mesh(mortarGeo.ball, cannonballMat);
      b.position.set(x, y, z);
      hull.add(b);
    }
    view.tube = tube;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'watcher') {
    // a short rocket tube under a lighthouse: the tower, a cream band, the deck, the lantern room and its lens, a brass roof
    barrel.geometry = geo.tube;
    barrel.position.x = 0.28;
    muzzle.visible = false;
    dome.visible = false;
    cap.visible = false;
    const tower = new THREE.Group();
    const tw = new THREE.Mesh(watchGeo.tower, bodyMat);
    tw.position.y = 0.2;
    const band = new THREE.Mesh(watchGeo.band, watchBandMat);
    band.position.y = 0.2;
    const deck = new THREE.Mesh(watchGeo.deck, barrelMat);
    deck.position.y = 0.395;
    const glass = new THREE.MeshStandardMaterial({ color: 0xfff2b8, emissive: 0xffd860, emissiveIntensity: 1.2, roughness: 0.15, transparent: true, opacity: 0.92 });
    const room = new THREE.Mesh(watchGeo.glass, glass);
    room.position.y = 0.495;
    const roof = new THREE.Mesh(watchGeo.roof, brassMat);
    roof.position.y = 0.665;
    const knob = new THREE.Mesh(watchGeo.knob, brassMat);
    knob.position.y = 0.77;
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
    const lens = new THREE.Mesh(watchGeo.lens, lensMat);
    lens.position.set(0.14, 0.495, 0);
    tower.add(tw, band, deck, room, roof, knob, lens);
    tower.scale.setScalar(1.2);
    turret.add(tower);
    // the beam on the floor: a fan of triangles around the tank, rebuilt each frame (see tankWatcher)
    const pos = new Float32Array((BEAM_RAYS + 2) * 3), col = new Float32Array((BEAM_RAYS + 2) * 4);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 1; i <= BEAM_RAYS; i++) idx.push(0, i + 1, i);
    bg.setIndex(idx);
    const beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    beam.renderOrder = 3;
    beam.frustumCulled = false;
    view.lantern = { glass, lens: lensMat, beam, pos, col, red: 0, reach: WATCH_RANGE };
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== room) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'mechanic') {
    // a short barrel, the spanner on the turret, the toolbox on the back deck
    barrel.geometry = geo.shortBarrel;
    barrel.position.x = 0.26;
    muzzle.position.x = 0.42;
    const sp = buildSpanner();
    sp.position.set(-0.02, 0.13, 0);
    turret.add(sp);
    view.spanner = sp;
    const box = new THREE.Group();
    const b = new THREE.Mesh(mechGeo.box, toolboxMat);
    const lid = new THREE.Mesh(mechGeo.lid, toolboxMat);
    lid.position.y = 0.075;
    const grip = new THREE.Mesh(mechGeo.grip, chromeMat);
    grip.position.y = 0.09;
    box.add(b, lid, grip);
    box.position.set(-0.29, 0.43, 0);
    hull.add(box);
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'hopper') {
    const legMat = new THREE.MeshStandardMaterial({ color: shade(enemyColor('hopper'), -0.28), roughness: 0.5, metalness: 0.1 });
    view.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.08, 0.3, s * 0.43);
      const thigh = new THREE.Group();
      const tm = new THREE.Mesh(hopperGeo.thigh, legMat);
      tm.position.x = HOP_THIGH / 2;
      const knee = new THREE.Group();
      knee.position.x = HOP_THIGH;
      const kj = new THREE.Mesh(hopperGeo.joint, brassMat);
      const sm = new THREE.Mesh(hopperGeo.shin, legMat);
      sm.position.x = HOP_SHIN / 2;
      const foot = new THREE.Mesh(hopperGeo.foot, barrelMat);
      foot.position.x = HOP_SHIN;
      knee.add(kj, sm, foot);
      thigh.add(tm, knee);
      hip.add(new THREE.Mesh(hopperGeo.joint, brassMat), thigh);
      hull.add(hip);
      view.legs.push({ thigh, knee });
    }
    for (const s of [-1, 1]) {
      const fl = new THREE.Group();
      fl.position.set(0.1, 0.14, s * 0.06);
      fl.rotation.set(s * 0.35, 0, -0.75);
      const stalk = new THREE.Mesh(hopperGeo.feeler, barrelMat);
      stalk.position.y = 0.21;
      const tip = new THREE.Mesh(hopperGeo.tip, brassMat);
      tip.position.y = 0.43;
      fl.add(stalk, tip);
      const eye = new THREE.Mesh(hopperGeo.eye, eyeMat);
      eye.position.set(0.12, 0.1, s * 0.1);
      const pupil = new THREE.Mesh(hopperGeo.pupil, pupilMat);
      pupil.position.set(0.17, 0.11, s * 0.1);
      turret.add(fl, eye, pupil);
    }
    poseLegs(view, HOP_POSE.rest);
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'bombard') {
    // the Bombardier (iteration 35): a giant toy mortar on a gun carriage, bound with gold hoops, a short straight gun in
    // front for close quarters, a pyramid of cannonballs and two ammunition crates on the back deck
    barrel.geometry = geo.shortBarrel;
    barrel.position.x = 0.3;
    muzzle.position.x = 0.46;
    const mount = new THREE.Group();
    mount.position.set(-0.06, 0.05, 0);
    mount.scale.setScalar(1.35);
    const tube = new THREE.Group();
    tube.position.set(0.04, 0.1, 0);
    const pivot = new THREE.Group();
    pivot.rotation.z = MORTAR_TILT + 0.12;
    const pipe = new THREE.Mesh(mortarGeo.tube, barrelMat);
    pipe.rotation.z = -Math.PI / 2;
    pipe.position.x = 0.2;
    const lip = new THREE.Mesh(mortarGeo.lip, goldMat);
    lip.rotation.y = Math.PI / 2;
    lip.position.x = 0.4;
    pivot.add(pipe, lip);
    for (const x of [0.04, 0.16, 0.28]) {
      const hoop = new THREE.Mesh(mortarGeo.hoop, goldMat);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.x = x;
      pivot.add(hoop);
    }
    tube.add(pivot);
    mount.add(tube);
    turret.add(mount);
    for (const [x, y, z] of [[-0.36, 0.43, -0.1], [-0.36, 0.43, 0.1], [-0.2, 0.43, -0.1], [-0.2, 0.43, 0.1], [-0.28, 0.56, 0]]) {
      const b = new THREE.Mesh(mortarGeo.ball, cannonballMat);
      b.position.set(x, y, z);
      hull.add(b);
    }
    for (const z of [-0.27, 0.27]) {
      const crate = new THREE.Mesh(geo.stud, goldMat);
      crate.scale.set(1.6, 1.2, 1.6);
      crate.position.set(0.36, 0.37, z);
      hull.add(crate);
    }
    view.tube = tube;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  }
  if (info.kind === 'train' || info.kind === 'wagon') {
    // « Le Tortillard » (iteration 49): no treads, a chassis on red wheels
    body.visible = false;
    hull.children.forEach((c) => { if (c !== body) c.visible = false; });
    view.wheels = [];
    const loco = info.kind === 'train';
    for (const x of loco ? [-0.3, 0, 0.3] : [-0.24, 0.24]) {
      for (const z of [-0.25, 0.25]) {
        const wh = new THREE.Mesh(trainGeo.wheel, wheelMat);
        wh.rotation.x = Math.PI / 2;
        wh.position.set(x, 0.11, z);
        const hub = new THREE.Mesh(trainGeo.hub, goldMat);
        hub.position.y = Math.sign(z) * 0.01;
        wh.add(hub);
        hull.add(wh);
        view.wheels.push(wh);
      }
    }
    for (const x of loco ? [-0.52] : [-0.44, 0.44]) {
      const hk = new THREE.Mesh(trainGeo.hook, sootMat);
      hk.position.set(x, 0.14, 0);
      hull.add(hk);
    }
    if (loco) {
      dome.visible = cap.visible = barrel.visible = muzzle.visible = false;
      const ch = new THREE.Mesh(trainGeo.chassis, sootMat);
      ch.position.y = 0.17;
      const boiler = new THREE.Mesh(trainGeo.boiler, bodyMat);
      boiler.rotation.z = Math.PI / 2;
      boiler.position.set(0.12, 0.38, 0);
      const face = new THREE.Mesh(trainGeo.front, sootMat);
      face.rotation.z = Math.PI / 2;
      face.position.set(0.41, 0.38, 0);
      hull.add(ch, boiler, face);
      for (const x of [-0.04, 0.16, 0.34]) {
        const b = new THREE.Mesh(trainGeo.band, goldMat);
        b.rotation.z = Math.PI / 2;
        b.position.set(x, 0.38, 0);
        hull.add(b);
      }
      const chim = new THREE.Mesh(trainGeo.chimney, sootMat);
      chim.position.set(0.3, 0.63, 0);
      const lip = new THREE.Mesh(trainGeo.lip, sootMat);
      lip.position.set(0.3, 0.74, 0);
      const steam = new THREE.Mesh(trainGeo.dome, goldMat);
      steam.position.set(0.08, 0.54, 0);
      const cab = new THREE.Mesh(trainGeo.cab, bodyMat);
      cab.position.set(-0.3, 0.42, 0);
      const win = new THREE.Mesh(trainGeo.window, cabWindowMat);
      win.position.set(-0.27, 0.48, 0);
      const roof = new THREE.Mesh(trainGeo.roof, sootMat);
      roof.position.set(-0.3, 0.59, 0);
      const catcher = new THREE.Mesh(trainGeo.catcher, goldMat);
      catcher.rotation.z = -0.75;
      catcher.position.set(0.5, 0.13, 0);
      const lampBox = new THREE.Mesh(trainGeo.lampBox, goldMat);
      lampBox.rotation.z = Math.PI / 2;
      lampBox.position.set(0.44, 0.54, 0);
      hull.add(chim, lip, steam, cab, win, roof, catcher, lampBox);
      view.chimney = lip;
      // the headlamp sits on the front of the boiler (the turret follows the hull for the locomotive)
      lamp.position.set(0.49, 0.54 - 0.37, 0);
    } else {
      const bed = new THREE.Mesh(trainGeo.bed, bodyMat);
      bed.position.y = 0.19;
      hull.add(bed);
      for (const z of [-0.22, 0.22]) {
        const sd = new THREE.Mesh(trainGeo.side, barrelMat);
        sd.position.set(0, 0.26, z);
        hull.add(sd);
      }
      const post = new THREE.Mesh(trainGeo.lip, barrelMat);
      post.scale.set(1.3, 2.4, 1.3);
      post.position.y = 0.27;
      hull.add(post);
    }
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
  /** « Les options » (iteration 43): 0 turns the screen shake off, for players who feel sick with it. */
  shakeScale = 1;
  private floorCanvas!: HTMLCanvasElement;
  private floorCtx!: CanvasRenderingContext2D;
  private floorTex!: THREE.CanvasTexture;
  private floorDirty = false;
  private floorTimer = 0;
  private levelGroup = new THREE.Group();
  private blocks = new Map<number, THREE.Mesh>();
  private portals: PortalView[] = [];
  // tunnels (iteration 13): an arched toy-train tunnel per cell, its roof fades while a tank is inside
  /** Conveyor belts (iteration 16): one instanced slab per belt cell, a single texture scrolls them all along. */
  private beltTex = beltTexture();
  private beltMat = new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.85 });
  private beltGeo = new THREE.PlaneGeometry(1, 0.94).rotateX(-Math.PI / 2);
  private beltMesh?: THREE.InstancedMesh;
  /** Ice (iteration 21): one glossy slab per ice cell, snow falls over the table while the level has some. */
  private iceMat = new THREE.MeshStandardMaterial({ map: iceTexture(), roughness: 0.1, metalness: 0.25 });
  private iceGeo = new THREE.BoxGeometry(1, 0.03, 1);
  private iceMesh?: THREE.InstancedMesh;
  private iceCells = new Set<number>();
  /** Skate scratches (iteration 38): the ice slabs hide the floor's tread marks, so the tanks scratch a layer of their own above
   * the ice. That is how a white (invisible) tank gives itself away on the ice, as it does on the bare floor. */
  private scratchCanvas?: HTMLCanvasElement;
  private scratchCtx?: CanvasRenderingContext2D;
  private scratchTex?: THREE.CanvasTexture;
  private scratchMesh?: THREE.Mesh;
  private scratchDirty = false;
  private scratchFade = 0;
  private scratchTimer = 0;
  /**
   * « La neige » (iteration 42): a layer of snow over the floor, on a canvas of its own. The tanks plough trails into it
   * (packed snow, a little grey-blue), the blasts blow it away, and the snowfall slowly covers it all again.
   */
  private snowCells = new Set<number>();
  private snowCanvas?: HTMLCanvasElement;
  private snowCtx?: CanvasRenderingContext2D;
  private snowBase?: HTMLCanvasElement;
  private snowTex?: THREE.CanvasTexture;
  private snowMesh?: THREE.Mesh;
  private snowDirty = false;
  private snowTimer = 0;
  private snowFall = 0;
  private snowPacked = new Set<number>();
  /** « Les dunes » (iteration 36): the sand cells of the table, painted into the floor texture. */
  private sandCells = new Set<number>();
  /** « Le Givré » (iteration 31): its frost, slabs of ice laid and melted as the snapshots say. */
  private frostMat = new THREE.MeshStandardMaterial({ map: iceTexture(), color: 0xe6f6ff, roughness: 0.18, metalness: 0.15, emissive: 0x5fa8d8, emissiveIntensity: 0.18, transparent: true, opacity: 0.88 });
  private frostMesh?: THREE.InstancedMesh;
  private frostCells = new Map<number, { life: number; born: number }>();
  private snow?: THREE.Points;
  private snowPos = new Float32Array(SNOW_FLAKES * 3);
  private snowSeed = new Float32Array(SNOW_FLAKES);
  /** Wind (iteration 23): where it mainly blows (undefined on a calm table), and the tick the gust is read at (set every frame). */
  private windBase?: number;
  windTick = 0;
  private leaves?: THREE.InstancedMesh;
  private leafSt = new Float32Array(LEAVES * 5); // x, height, z, spin phase, own speed
  private gustLines?: THREE.LineSegments;
  private gustPos = new Float32Array(GUSTS * 6);
  private gustLife = new Float32Array(GUSTS);
  private sock?: THREE.Group;
  private sockPivot?: THREE.Group;
  private windDummy = new THREE.Object3D();
  /** Fog (iteration 26): the seed of the banks of mist (undefined on a clear table), the tick they are read at (set every frame). */
  private fogSeed?: number;
  fogTick = 0;
  /** Who sees through the mist around them: set by the game (teammates in coop, only oneself in versus). */
  fogAlly?: (id: number) => boolean;
  private fogMesh?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private fogNow: FogBank[] = [];
  private fogSeers: { x: number; y: number }[] = [];
  private fogAmt = 0;
  private fogStart = 0;
  private fogHorn = 0;
  /** Called now and then on a foggy table (for the foghorn). */
  onFogHorn?: () => void;
  private tunnels: { cell: number; root: THREE.Group; mats: THREE.Material[]; geos: THREE.BufferGeometry[]; op: number }[] = [];
  private tunnelBusy = new Set<number>();
  private tunnelGeo = {
    shell: new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1, true, 0, Math.PI),
    inner: new THREE.CylinderGeometry(0.44, 0.44, 1, 20, 1, true, 0, Math.PI),
    rim: new THREE.TorusGeometry(0.47, 0.055, 8, 22, Math.PI),
    key: new THREE.BoxGeometry(0.12, 0.13, 0.1),
  };
  private swirlTex = swirlTexture();
  private portalGeo = { ring: new THREE.TorusGeometry(0.4, 0.055, 10, 40), swirl: new THREE.CircleGeometry(0.38, 36), rim: new THREE.CylinderGeometry(0.46, 0.48, 0.05, 36) };
  private portalRimMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.7 });
  private tanks = new Map<number, TankView>();
  private bullets = new Map<number, THREE.Mesh>();
  private mines = new Map<number, THREE.Group>();
  private crates = new Map<number, CrateView>();
  private crateMats = new Map<BonusKind | 'gold', THREE.MeshStandardMaterial>();
  private cubeMat = new THREE.MeshStandardMaterial({ color: 0xd6f2ff, emissive: 0x6fb8e0, emissiveIntensity: 0.35, transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.1, depthWrite: false });
  private iceEdgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  private bubbleMat = new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x2a9fd0, emissiveIntensity: 0.6, transparent: true, opacity: 0.4, roughness: 0.15, depthWrite: false });
  private glow: ParticleSystem;
  private smoke: ParticleSystem;
  private debris: ParticleSystem;
  private shocks: { mesh: THREE.Mesh; t: number; max: number; size: number }[] = [];
  /** « Le Mécano » (iteration 51): the repairs going on, by Mécano id (the wreck, where it lies, when the work began). */
  private repairs = new Map<number, { wreck: number; x: number; y: number; t0: number; dur: number; ring: THREE.Group }>();
  private flash: THREE.PointLight;
  private flashT = 0;
  private bulletMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.6, roughness: 0.3 });
  private rocketMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xff7a1a, emissiveIntensity: 1.2, roughness: 0.3 });
  private mineMat = new THREE.MeshStandardMaterial({ color: 0xf4c542, roughness: 0.5, metalness: 0.2 });
  private mineTopMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6 });
  private ledOn = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  private ledOff = new THREE.MeshBasicMaterial({ color: 0x551515 });
  // « Détonateur » (iteration 52): the remote mine's antenna and its green light (red once it is set off)
  private antennaMat = new THREE.MeshStandardMaterial({ color: 0x2c2c32, roughness: 0.4, metalness: 0.6 });
  private remoteOn = new THREE.MeshBasicMaterial({ color: 0x5dff7a });
  private remoteOff = new THREE.MeshBasicMaterial({ color: 0x1c4a24 });
  // « Passe-muraille » (iteration 52): a pale see-through shell, drawn over the walls it flies through
  private ghostMat = new THREE.MeshStandardMaterial({ color: 0xe6fff8, emissive: 0x9fe8d8, emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false });
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
  private beamLights: THREE.SpotLight[] = [];
  /** The live map (main.ts and the demo keep it up to date in place): the Veilleur's beam stops at its walls. */
  private beamTiles: ArrayLike<number> = [];
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
  private rising: { mesh: THREE.Mesh; t: number }[] = [];
  // « Les ponts » (iteration 33): the deck of each bridge cell, and the planks of fallen ones tumbling into the pit
  private bridges = new Map<number, THREE.Group>();
  private falling: { obj: THREE.Object3D; vy: number; spin: THREE.Vector3; t: number }[] = [];
  private plankGeo = new RoundedBoxGeometry(0.9, 0.05, 0.155, 2, 0.015);
  private railGeo = new THREE.BoxGeometry(0.06, 0.05, 1);
  private postGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.26, 8);
  private ropeGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5);
  private plankMats = [
    new THREE.MeshStandardMaterial({ map: woodTexture('#c79a62', '#6e4520'), roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ map: woodTexture('#b3854f', '#5e3b20'), roughness: 0.8 }),
  ];
  private ropeMat = new THREE.MeshStandardMaterial({ color: 0xe6d3a3, roughness: 0.9 });
  private quakes: { mesh: THREE.Mesh; core: THREE.Mesh; x: number; y: number; t: number; max: number }[] = [];
  private bolts: { meshes: THREE.Mesh[]; t: number; max: number }[] = [];
  private boltMat = new THREE.MeshBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  private boltGlowMat = new THREE.MeshBasicMaterial({ color: 0x7fa8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  /** 1 right when the lightning falls, then fades: the sky lights up and invisible tanks show for an instant. */
  lightning = 0;
  private baseHemi = 1.1;
  private baseSun = 2.4;
  time = 0;

  /** « Les options » (iteration 43): « eco » draws fewer pixels and no soft shadows, for small laptops and old phones. */
  setQuality(q: 'auto' | 'eco') {
    const eco = q === 'eco';
    this.renderer.setPixelRatio(eco ? 1 : Math.min(devicePixelRatio, 2));
    const type = eco ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    if (this.renderer.shadowMap.type !== type) { this.renderer.shadowMap.type = type; this.renderer.shadowMap.needsUpdate = true; }
  }

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
    // « Le Veilleur » (iteration 47): two more spotlights for its beam at night
    for (let i = 0; i < 2; i++) {
      const sp = new THREE.SpotLight(0xfff0c0, 0, WATCH_RANGE + 1, WATCH_HALF * 1.1, 0.35, 1.1);
      sp.visible = false;
      this.scene.add(sp, sp.target);
      this.beamLights.push(sp);
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
    // iPhone (player feedback #24): after a rotation, the resize event can come before the page has its new size,
    // and the table stayed stretched; the frame loop also checks the canvas size (see render)
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    visualViewport?.addEventListener('resize', () => this.resize());
  }
  private sizeW = 0;
  private sizeH = 0;

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

  /** One jagged stroke of lightning (a thin core and its glow), from (x0, h0, z0) to (x1, h1, z1). */
  private boltBranch(meshes: THREE.Mesh[], x0: number, h0: number, z0: number, x1: number, z1: number, h1: number, n: number, rad: number) {
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
  }

  /** The Grondeur calls the lightning (iteration 18): a stroke shoots up from its rod into its cloud, a blue shock wave. */
  call(id: number, x: number, y: number) {
    const v = this.tanks.get(id);
    const meshes: THREE.Mesh[] = [];
    this.boltBranch(meshes, x, 0.95, y, x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, 2.15, 6, 0.035);
    this.boltBranch(meshes, x, 2.3, y, x + (Math.random() - 0.5) * 4, y - 3 - Math.random() * 2, 14, 9, 0.03);
    for (const m of meshes) this.scene.add(m);
    this.bolts.push({ meshes, t: 0, max: 0.28 });
    const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0x8fc0ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.08, y);
    this.scene.add(ring);
    this.shocks.push({ mesh: ring, t: 0, max: 0.45, size: 2 });
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.6;
      this.glow.emit({ x, y: 2.1, z: y, vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 2, vz: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.3, s0: 0.07, s1: 0.01, c0: 0xffffff, c1: 0x6f9dff, grav: 4, drag: 1.5 });
    }
    if (v?.cloud) v.cloud.userData.boom = 1;
    this.lightning = Math.max(this.lightning, 0.5);
    this.flash.color.setHex(0xa9c8ff);
    this.flash.position.set(x, 2, y);
    this.flash.intensity = 40;
    this.flashT = 0.2;
    this.shake = Math.max(this.shake, 0.15);
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
    const branch = (x0: number, h0: number, z0: number, x1: number, z1: number, h1: number, n: number, rad: number) => this.boltBranch(meshes, x0, h0, z0, x1, z1, h1, n, rad);
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
    this.sizeW = w; this.sizeH = h;
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
  // « Les finitions » (iteration 46): the camera flies between the screens. In a game it sits where it always has
  // (the play pose); behind the menus (home, lobby, results) it backs off, dips and sways slowly, like a toy in a shop
  // window (the shelf pose). The blend between the two eases out, so entering a game is a dive onto the table.
  /** Off in the options: the camera never moves between the screens. */
  camFx = true;
  private camMode: 'play' | 'shelf' = 'play';
  private camBlend = 0; // 0: play pose, 1: shelf pose
  private camClock = 0;
  private posePos = new THREE.Vector3();
  private poseLook = new THREE.Vector3();
  camScreen(kind: 'play' | 'shelf') {
    this.camMode = kind;
  }
  /** Where the camera stands this frame, and where it looks, before the replay lean and the shake. */
  private cameraPose(dt: number) {
    const goal = this.camFx && this.camMode === 'shelf' ? 1 : 0;
    if (!this.camFx) this.camBlend = 0;
    this.camBlend += (goal - this.camBlend) * (1 - Math.exp(-dt * (goal ? 1.6 : 2.6)));
    if (Math.abs(goal - this.camBlend) < 0.0005) this.camBlend = goal;
    this.camClock += dt;
    const k = this.camBlend;
    this.poseLook.copy(this.camTarget);
    if (k <= 0) { this.posePos.copy(this.basePos); return; }
    const s = k * k * (3 - 2 * k);
    const ox = this.basePos.x - this.camTarget.x, oy = this.basePos.y - this.camTarget.y, oz = this.basePos.z - this.camTarget.z;
    const r = Math.hypot(ox, oy, oz);
    const elev = Math.asin(oy / r) - s * 0.2;
    const yaw = s * (0.16 * Math.sin(this.camClock * 0.11) + 0.05 * Math.sin(this.camClock * 0.37));
    const rr = r * (1 + 0.1 * s);
    this.poseLook.z += s * -0.6;
    this.posePos.set(
      this.poseLook.x + Math.sin(yaw) * Math.cos(elev) * rr,
      this.poseLook.y + Math.sin(elev) * rr,
      this.poseLook.z + Math.cos(yaw) * Math.cos(elev) * rr,
    );
  }
  /** « Le ralenti » (iteration 32): where the replay camera leans (arena x, y) and how far (0: not at all, 1: close up). */
  replayCam?: { x: number; y: number; k: number };
  private camLook = new THREE.Vector3();
  private camLeaned = false;
  private camWasMoving = false;

  // ---------------------------------------------------------------- level

  /** Night falls in a little over a second; daylight comes back at once (on the next level). */
  setNight(on: boolean) {
    this.nightTarget = on ? 1 : 0;
    this.nightStart = performance.now() - this.night * 1200;
    if (!on) this.night = 0;
    for (const l of [...this.heads, ...this.shellLights, ...this.beamLights]) l.visible = on;
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

  setLevel(tiles: number[], infos: TankInfo[], belts: number[] = [], rail?: number[]) {
    this.beamTiles = tiles;
    this.setRail(rail);
    this.nightApplied = -1; // the new tanks' lamps follow the current light
    for (const m of this.blocks.values()) this.levelGroup.remove(m);
    this.blocks.clear();
    this.rising = [];
    for (const b of this.bridges.values()) this.levelGroup.remove(b);
    this.bridges.clear();
    for (const gt of this.gates.values()) this.levelGroup.remove(gt.mesh);
    this.gates.clear();
    for (const lf of this.lifts.values()) this.levelGroup.remove(lf.root);
    this.lifts.clear();
    for (const sw of this.switches) this.levelGroup.remove(sw.root);
    this.switches = [];
    for (const f of this.falling) this.levelGroup.remove(f.obj);
    this.falling = [];
    for (const r of this.repairs.values()) this.scene.remove(r.ring);
    this.repairs.clear();
    for (const t of this.tanks.values()) { this.scene.remove(t.root); if (t.ice) this.scene.remove(t.ice); if (t.leapRing) this.scene.remove(t.leapRing); if (t.lantern) this.scene.remove(t.lantern.beam); }
    this.tanks.clear();
    for (const b of this.bullets.values()) this.scene.remove(b);
    this.bullets.clear();
    for (const m of this.mines.values()) { this.scene.remove(m); if (m.userData.ring) this.scene.remove(m.userData.ring); }
    this.mines.clear();
    this.syncLobs([]);
    for (const c of this.crates.values()) this.removeCrate(c);
    this.crates.clear();
    for (const p of this.portals) {
      this.levelGroup.remove(p.root);
      (p.swirl.material as THREE.Material).dispose();
      (p.ring.material as THREE.Material).dispose();
    }
    this.portals = [];
    for (const tn of this.tunnels) {
      this.levelGroup.remove(tn.root);
      for (const m of tn.mats) m.dispose();
      for (const g of tn.geos) g.dispose();
    }
    this.tunnels = [];
    this.glow.clear(); this.smoke.clear(); this.debris.clear();
    for (let i = this.quakes.length - 1; i >= 0; i--) this.dropQuake(i);
    this.setCtf(undefined);
    this.setCrown(undefined);

    this.sandCells = new Set(belts.flatMap((b, i) => (b === SAND && tiles[i] === Tile.Empty ? [i] : [])));
    this.paintFloor(tiles);
    this.addBelts(belts);
    this.addIce(tiles, belts);
    this.addSnow(tiles, belts);
    this.setFrost(undefined);
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
        else if (isTunnel(t)) this.addTunnel(tiles, x, y);
        else if (t === Tile.Bridge) this.addBridge(tiles, x, y);
        else if (isGate(t)) this.addGate(x, y, t);
        else if (isDrawbridge(t)) this.addDrawbridge(tiles, x, y, t);
        else if (t === Tile.Switch) this.addSwitch(x, y);
      }
    }
    // the switches show which gates stand (red at the start); a late arrival reads it off the map
    this.gatePhase = (tiles.includes(Tile.BlueUp) || tiles.includes(Tile.BlueLift)) && !tiles.includes(Tile.RedUp) && !tiles.includes(Tile.RedLift) ? 1 : 0;
    for (const sw of this.switches) this.paintSwitch(sw);
    for (const info of infos) {
      const v = buildTank(info);
      this.tanks.set(info.id, v);
      this.scene.add(v.root);
      if (v.lantern) this.scene.add(v.lantern.beam);
    }
  }

  /** The belt codes the slabs were laid from (iteration 48: a flip of the switches turns them round). */
  private beltCodes: number[] = [];
  /** « Les ponts-levis » (iteration 48): every belt turns round, its chevrons point the other way, with a puff of sawdust. */
  /** « Le Tortillard » (iteration 49): lay its loop of rails on the floor (sleepers, two steel rails), or take it up. */
  private railGroup?: THREE.Group;
  setRail(pts?: number[]) {
    if (this.railGroup) {
      this.levelGroup.remove(this.railGroup);
      this.railGroup.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
      this.railGroup = undefined;
    }
    if (!pts || pts.length < 6) return;
    const n = pts.length / 2;
    const segs: { x0: number; y0: number; x1: number; y1: number; len: number }[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[j * 2], y1 = pts[j * 2 + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-3) continue;
      segs.push({ x0, y0, x1, y1, len });
      total += len;
    }
    const g = new THREE.Group();
    const gap = 0.42, count = Math.floor(total / gap);
    const sleepers = new THREE.InstancedMesh(trainGeo.sleeper, sleeperMat, count);
    const rails = new THREE.InstancedMesh(trainGeo.rail, railMat, segs.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let k = 0, acc = 0, si = 0;
    for (const sg of segs) {
      const ang = Math.atan2(sg.y1 - sg.y0, sg.x1 - sg.x0);
      q.setFromAxisAngle(up, -ang);
      // sleepers every `gap` along the loop
      while (k < count && k * gap < acc + sg.len) {
        const u = (k * gap - acc) / sg.len;
        pos.set(sg.x0 + (sg.x1 - sg.x0) * u, 0.013, sg.y0 + (sg.y1 - sg.y0) * u);
        sleepers.setMatrixAt(k++, m.compose(pos, q, sc));
      }
      acc += sg.len;
      // the two rails, a little longer than the segment so the corners join up
      for (const side of [-1, 1]) {
        const ox = -Math.sin(ang) * 0.19 * side, oy = Math.cos(ang) * 0.19 * side;
        pos.set((sg.x0 + sg.x1) / 2 + ox, 0.04, (sg.y0 + sg.y1) / 2 + oy);
        rails.setMatrixAt(si++, m.compose(pos, q, new THREE.Vector3(sg.len + 0.05, 1, 1)));
      }
    }
    sleepers.count = k;
    sleepers.receiveShadow = rails.receiveShadow = true;
    rails.castShadow = true;
    g.add(sleepers, rails);
    this.levelGroup.add(g);
    this.railGroup = g;
  }

  reverseBelts() {
    if (!this.beltMesh) return;
    const b = this.beltCodes.slice();
    reverseBelts(b);
    this.addBelts(b);
    b.forEach((c, i) => {
      if (c < 1 || c > 4 || Math.random() > 0.35) return;
      this.smoke.emit({ x: (i % W) + 0.5, y: 0.06, z: Math.floor(i / W) + 0.5, vx: (Math.random() - 0.5) * 0.8, vy: 0.4, vz: (Math.random() - 0.5) * 0.8, life: 0.45, s0: 0.08, s1: 0.2, c0: 0xffb15a, c1: 0xefdcb8, drag: 3 });
    });
  }

  private addBelts(belts: number[]) {
    if (this.beltMesh) { this.levelGroup.remove(this.beltMesh); this.beltMesh.dispose(); this.beltMesh = undefined; }
    this.beltCodes = belts.slice();
    const cells: number[] = [];
    belts.forEach((b, i) => { if (b >= 1 && b <= 4) cells.push(i); });
    if (!cells.length) return;
    const mesh = new THREE.InstancedMesh(this.beltGeo, this.beltMat, cells.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    // the texture runs along local x: turn each slab so that x points down its belt (right, left, up the grid = -z, down = +z)
    const ANG = [0, 0, Math.PI, Math.PI / 2, -Math.PI / 2];
    cells.forEach((i, k) => {
      q.setFromAxisAngle(up, ANG[belts[i]]);
      m.compose(new THREE.Vector3((i % W) + 0.5, 0.014, Math.floor(i / W) + 0.5), q, one);
      mesh.setMatrixAt(k, m);
    });
    mesh.receiveShadow = true;
    this.levelGroup.add(mesh);
    this.beltMesh = mesh;
  }

  private addIce(tiles: number[], belts: number[]) {
    if (this.iceMesh) { this.levelGroup.remove(this.iceMesh); this.iceMesh.dispose(); this.iceMesh = undefined; }
    this.iceCells.clear();
    belts.forEach((b, i) => { if (b === ICE && tiles[i] === Tile.Empty) this.iceCells.add(i); });
    this.flakes(this.iceCells.size > 0 || this.snowCells.size > 0);
    if (!this.iceCells.size) return;
    const cells = [...this.iceCells];
    const mesh = new THREE.InstancedMesh(this.iceGeo, this.iceMat, cells.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    cells.forEach((i, k) => {
      q.setFromAxisAngle(up, ((i * 7) % 4) * Math.PI / 2); // the scratches turn from slab to slab
      m.compose(new THREE.Vector3((i % W) + 0.5, 0.012, Math.floor(i / W) + 0.5), q, one);
      mesh.setMatrixAt(k, m);
    });
    mesh.receiveShadow = true;
    this.levelGroup.add(mesh);
    this.iceMesh = mesh;
  }

  /** Snowflakes fall over the table while it has ice (iteration 21) or snow (iteration 42). */
  private flakes(on: boolean) {
    if (!on) { if (this.snow) this.snow.visible = false; return; }
    if (!this.snow) {
      for (let k = 0; k < SNOW_FLAKES; k++) {
        this.snowPos[k * 3] = -2 + Math.random() * (W + 4);
        this.snowPos[k * 3 + 1] = Math.random() * 7;
        this.snowPos[k * 3 + 2] = -2 + Math.random() * (H + 4);
        this.snowSeed[k] = Math.random() * 100;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
      this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.11, transparent: true, opacity: 0.9, depthWrite: false }));
      this.snow.frustumCulled = false;
      this.scene.add(this.snow);
    }
    this.snow.visible = true;
  }

  /** Wind (iteration 23): leaves fly across the table, streaks show the gusts and a windsock on the frame shows where it blows. */
  setWind(base?: number) {
    this.windBase = base;
    const on = base !== undefined;
    if (on && !this.leaves) {
      const geo = new THREE.PlaneGeometry(0.26, 0.15);
      const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
      this.leaves = new THREE.InstancedMesh(geo, mat, LEAVES);
      this.leaves.frustumCulled = false;
      const c = new THREE.Color();
      for (let i = 0; i < LEAVES; i++) {
        this.leaves.setColorAt(i, c.setHex(LEAF_COLORS[i % LEAF_COLORS.length]));
        const o = i * 5;
        this.leafSt[o] = -2 + Math.random() * (W + 4);
        this.leafSt[o + 1] = 0.2 + Math.random() * 1.4;
        this.leafSt[o + 2] = -2 + Math.random() * (H + 4);
        this.leafSt[o + 3] = Math.random() * 10;
        this.leafSt[o + 4] = 0.7 + Math.random() * 0.6;
      }
      this.scene.add(this.leaves);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(this.gustPos, 3).setUsage(THREE.DynamicDrawUsage));
      this.gustLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      this.gustLines.frustumCulled = false;
      this.scene.add(this.gustLines);
      // the windsock: a wooden pole on the far right corner of the frame, a striped sock that swings with the wind
      const sock = new THREE.Group();
      sock.position.set(W + 0.3, WALL_H + 0.08, -0.3);
      const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.7 });
      sock.scale.setScalar(1.35);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.95, 10), wood);
      pole.position.y = 0.475;
      pole.castShadow = true;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffb43d, roughness: 0.4, metalness: 0.3 }));
      knob.position.y = 0.98;
      const pivot = new THREE.Group();
      pivot.position.y = 0.88;
      pivot.rotation.order = 'YZX';
      const cloth = new THREE.CylinderGeometry(0.17, 0.08, 0.95, 16, 1, true).rotateZ(Math.PI / 2).translate(0.5, 0, 0); // along +x, wide at the pole
      const sm = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ map: sockTexture(), roughness: 0.8, side: THREE.DoubleSide }));
      sm.castShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 6, 18).rotateY(Math.PI / 2), wood);
      ring.position.x = 0.03;
      pivot.add(sm, ring);
      sock.add(pole, knob, pivot);
      this.scene.add(sock);
      this.sock = sock; this.sockPivot = pivot;
    }
    if (this.leaves) this.leaves.visible = on;
    if (this.gustLines) this.gustLines.visible = on;
    if (this.sock) this.sock.visible = on;
  }
  get windOn() { return this.windBase !== undefined; }

  /** Fog (iteration 26): banks of mist drift over the table, a clearing opens around you and your teammates. */
  setFog(seed?: number) {
    this.fogSeed = seed;
    if (seed !== undefined && !this.fogMesh) {
      const banks = Array.from({ length: FOG_BANKS }, () => new THREE.Vector3(-99, -99, 1));
      const seers = Array.from({ length: 4 }, () => new THREE.Vector3(0, 0, 0));
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uBank: { value: banks }, uSeer: { value: seers }, uTime: { value: 0 }, uAmt: { value: 0 }, uSight: { value: FOG_SIGHT } },
        vertexShader: `
          varying vec2 vP;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vP = w.xz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: `
          uniform vec3 uBank[${FOG_BANKS}];
          uniform vec3 uSeer[4];
          uniform float uTime, uAmt, uSight;
          varying vec2 vP;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
            return v;
          }
          void main() {
            float d = 0.0;
            for (int i = 0; i < ${FOG_BANKS}; i++) {
              vec3 b = uBank[i];
              d = max(d, (b.z - length(vP - b.xy)) / (b.z * 0.55));
            }
            d = clamp(d, 0.0, 1.0);
            float n = fbm(vP * 0.42 + vec2(uTime * 0.06, uTime * 0.035));
            float m = fbm(vP * 0.9 - vec2(uTime * 0.04, -uTime * 0.05));
            float dd = clamp(d * 1.2 + (n - 0.5) * 0.8, 0.0, 1.0);
            float a = smoothstep(0.0, 1.0, dd) * (0.78 + 0.18 * m) + 0.05 + 0.05 * n;
            for (int i = 0; i < 4; i++) {
              vec3 s = uSeer[i];
              float c = smoothstep(uSight * 0.45, uSight * 1.05, length(vP - s.xy));
              a *= mix(1.0, 0.25 + 0.75 * c, s.z);
            }
            vec3 col = mix(vec3(0.74, 0.76, 0.78), vec3(0.98, 0.97, 0.94), n * 0.6 + m * 0.4);
            gl_FragColor = vec4(col, clamp(a, 0.0, 0.94) * uAmt);
          }`,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W + 2, H + 2).rotateX(-Math.PI / 2), mat);
      mesh.position.set(W / 2, 1.25, H / 2);
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.fogMesh = mesh;
    }
    if (seed === undefined) this.fogAmt = 0;
    else if (this.fogAmt <= 0) this.fogStart = performance.now();
    if (this.fogMesh) this.fogMesh.visible = seed !== undefined;
    this.fogHorn = 1.2;
  }
  get fogOn() { return this.fogSeed !== undefined; }

  /** Is that tank lost in the mist for us? Never ourselves, our teammates, a tank close to one of us, or one that just fired. */
  private lostInFog(t: RTank, v: TankView) {
    if (this.fogSeed === undefined || !t.alive || (v.seenT ?? 0) > 0 || this.lightning > 0.45) return false;
    const r = FOG_SIGHT + v.scale * TANK_R;
    for (const s of this.fogSeers) if ((s.x - t.x) ** 2 + (s.y - t.y) ** 2 < r * r) return false;
    return fogDensity(this.fogNow, t.x, t.y) >= FOG_HIDE;
  }

  private animateFog(dt: number) {
    const m = this.fogMesh;
    if (!m || this.fogSeed === undefined) return;
    this.fogAmt = Math.min(1, (performance.now() - this.fogStart) / 900); // real time, even at a low frame rate
    const u = m.material.uniforms;
    u.uAmt.value = this.fogAmt;
    u.uTime.value = this.time;
    fogBanks(this.fogSeed, this.fogTick, this.fogNow);
    const banks = u.uBank.value as THREE.Vector3[];
    for (let i = 0; i < banks.length; i++) {
      const b = this.fogNow[i];
      if (b) banks[i].set(b.x, b.y, b.r); else banks[i].set(-99, -99, 1);
    }
    const seers = u.uSeer.value as THREE.Vector3[];
    for (let i = 0; i < seers.length; i++) {
      const s = this.fogSeers[i];
      if (s) seers[i].set(s.x, s.y, 1); else seers[i].set(0, 0, 0);
    }
    // a foghorn now and then, far away
    if ((this.fogHorn -= dt) <= 0) { this.fogHorn = 16 + Math.random() * 10; this.onFogHorn?.(); }
  }

  private animateWind(dt: number) {
    if (this.windBase === undefined || !this.leaves) return;
    const ang = windAngle(this.windBase, this.windTick), k = gustAt(this.windTick);
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const px = -dz, pz = dx; // across the wind
    const d = this.windDummy;
    const st = this.leafSt;
    // a point that left the table comes back in from the side the wind blows from
    const respawn = (o: number, stride: number, arr: Float32Array) => {
      const u = Math.random();
      let x: number, z: number;
      if (Math.abs(dx) > Math.abs(dz)) { x = dx > 0 ? -1.5 : W + 1.5; z = -1.5 + u * (H + 3); } else { z = dz > 0 ? -1.5 : H + 1.5; x = -1.5 + u * (W + 3); }
      arr[o] = x; arr[o + stride] = z;
    };
    for (let i = 0; i < LEAVES; i++) {
      const o = i * 5;
      const sp = (0.6 + 4.4 * k) * st[o + 4];
      const fl = Math.sin(this.time * 3 + st[o + 3]) * 0.6;
      st[o] += (dx * sp + px * fl) * dt;
      st[o + 2] += (dz * sp + pz * fl) * dt;
      st[o + 1] = Math.max(0.06, st[o + 1] + (Math.sin(this.time * 1.7 + st[o + 3] * 2) * 0.5 + (k - 0.45) * 0.6) * dt);
      if (st[o + 1] > 1.8) st[o + 1] = 1.8;
      if (st[o] < -2 || st[o] > W + 2 || st[o + 2] < -2 || st[o + 2] > H + 2) { respawn(o, 2, st); st[o + 1] = 0.3 + Math.random() * 1.2; }
      d.position.set(st[o], st[o + 1], st[o + 2]);
      const spin = this.time * (2 + 4 * k) * st[o + 4] + st[o + 3];
      d.rotation.set(-Math.PI / 2 + Math.sin(spin) * 0.9, -ang + spin * 0.3, Math.cos(spin * 1.3) * 0.6);
      d.updateMatrix();
      this.leaves.setMatrixAt(i, d.matrix);
    }
    this.leaves.instanceMatrix.needsUpdate = true;
    // gust streaks: only when it really blows
    const g = this.gustPos;
    const len = 0.5 + 1.3 * k, sp = 3 + 8 * k;
    for (let i = 0; i < GUSTS; i++) {
      const o = i * 6;
      this.gustLife[i] -= dt;
      if (this.gustLife[i] <= 0) {
        this.gustLife[i] = 0.5 + Math.random() * 0.9;
        g[o] = -1 + Math.random() * (W + 2); g[o + 1] = 0.35 + Math.random() * 1.2; g[o + 2] = -1 + Math.random() * (H + 2);
      }
      g[o] += dx * sp * dt; g[o + 2] += dz * sp * dt;
      g[o + 3] = g[o] - dx * len; g[o + 4] = g[o + 1]; g[o + 5] = g[o + 2] - dz * len;
    }
    (this.gustLines!.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.gustLines!.material as THREE.LineBasicMaterial).opacity = Math.max(0, (k - 0.35) * 0.75) * (1 - this.night * 0.5);
    // the windsock swings round and stands out in a gust, droops in a lull
    if (this.sockPivot) {
      this.sockPivot.rotation.y = -ang + Math.sin(this.time * 7) * 0.08 * k;
      this.sockPivot.rotation.z = -(1 - k) * 1.05 + Math.sin(this.time * 11) * 0.05 * k;
    }
  }

  /** Is this point of the table on sand? (iteration 36: deep tread marks, dust, buried mines) */
  onSand(x: number, y: number) {
    if (!this.sandCells.size || x < 0 || y < 0 || x >= W || y >= H) return false;
    return this.sandCells.has(Math.floor(y) * W + Math.floor(x));
  }

  /**
   * « Les dunes » (iteration 36): the sand is painted right into the floor texture, so the tread marks dig into it.
   * Rounded patches that run into each other, grains, and wind ripples across them.
   */
  private paintSand(g: CanvasRenderingContext2D) {
    if (!this.sandCells.size) return;
    const cells = [...this.sandCells];
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // cell by cell, with simple shapes only (one big clipped or blurred path brings accelerated canvases to their knees)
    const disc = (cx: number, cy: number, r: number) => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); };
    // a darker rim, then the sand: overlapping discs and squares give the patch soft, rounded edges
    g.fillStyle = 'rgba(170,110,40,0.35)';
    for (const i of cells) disc((i % W) * PX + PX / 2, Math.floor(i / W) * PX + PX / 2, PX * 0.74);
    g.fillStyle = '#e6b866';
    for (const i of cells) {
      const x = (i % W) * PX, y = Math.floor(i / W) * PX;
      disc(x + PX / 2, y + PX / 2, PX * 0.68);
      g.fillRect(x, y, PX, PX);
    }
    for (const i of cells) {
      const x0 = (i % W) * PX, y0 = Math.floor(i / W) * PX;
      g.save();
      g.beginPath();
      g.rect(x0, y0, PX, PX);
      g.clip();
      // a warmer heart, grains, and wind ripples (a dark crest line and its sunlit edge just above), continuous from cell to cell
      const hg = g.createRadialGradient(x0 + PX / 2, y0 + PX / 2, 4, x0 + PX / 2, y0 + PX / 2, PX * 0.7);
      hg.addColorStop(0, 'rgba(240,196,110,0.7)');
      hg.addColorStop(1, 'rgba(240,196,110,0)');
      g.fillStyle = hg;
      g.fillRect(x0, y0, PX, PX);
      for (let k = 0; k < 60; k++) {
        g.fillStyle = rnd() < 0.55 ? 'rgba(140,90,30,0.28)' : 'rgba(255,240,200,0.45)';
        g.fillRect(x0 + rnd() * PX, y0 + rnd() * PX, 1.5, 1.5);
      }
      g.lineCap = 'round';
      for (let yy = Math.floor(y0 / 11) * 11 - 11; yy < y0 + PX + 11; yy += 11) {
        for (const [dy, col, lw] of [[0, 'rgba(150,95,30,0.3)', 2], [-2, 'rgba(255,236,190,0.5)', 1.2]] as const) {
          g.strokeStyle = col; g.lineWidth = lw;
          g.beginPath();
          for (let xx = x0 - 8; xx <= x0 + PX + 8; xx += 8) {
            const y = yy + dy + Math.sin(xx * 0.045 + yy * 0.7) * 3.5 + Math.sin(xx * 0.013 + yy) * 2;
            if (xx === x0 - 8) g.moveTo(xx, y); else g.lineTo(xx, y);
          }
          g.stroke();
        }
      }
      g.restore();
    }
  }

  /** Is this point of the table on ice? (tread marks turn to frost, sliding throws ice shavings) */
  onIce(x: number, y: number) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = Math.floor(y) * W + Math.floor(x);
    return (this.iceCells.size > 0 && this.iceCells.has(i)) || this.frostCells.has(i);
  }

  /** Some frost is on the table (the demo keeps sending it until it is all gone). */
  get frostShown() { return this.frostCells.size > 0; }

  /**
   * « Le Givré » (iteration 31): the frost cells and the seconds before each melts. New slabs grow in with a puff of
   * frost, slabs shrink away in their last second, gone ones vanish.
   */
  setFrost(cells: Iterable<[number, number]> | undefined) {
    const seen = new Set<number>();
    for (const [i, life] of cells ?? []) {
      if (i < 0 || i >= W * H) continue;
      seen.add(i);
      const f = this.frostCells.get(i);
      if (f) f.life = life;
      else {
        this.frostCells.set(i, { life, born: this.time });
        if (Math.random() < 0.5) this.glow.emit({ x: (i % W) + 0.5 + (Math.random() - 0.5) * 0.6, y: 0.08, z: Math.floor(i / W) + 0.5 + (Math.random() - 0.5) * 0.6, vy: 0.5 + Math.random() * 0.4, life: 0.5, s0: 0.06, s1: 0.01, c0: 0xffffff, c1: 0xa8e0ff, drag: 2 });
      }
    }
    let puffs = 0;
    for (const i of [...this.frostCells.keys()]) {
      if (seen.has(i)) continue;
      this.frostCells.delete(i);
      // a slab melts away (or a blast melts it): a little cloud of glittering mist
      if (puffs++ < 24) for (let k = 0; k < 2; k++) this.smoke.emit({ x: (i % W) + 0.2 + Math.random() * 0.6, y: 0.05, z: Math.floor(i / W) + 0.2 + Math.random() * 0.6, vx: (Math.random() - 0.5) * 0.4, vy: 0.3 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4, life: 0.6, s0: 0.08, s1: 0.2, c0: 0xf4fbff, c1: 0xcfe9ff, drag: 2 });
    }
    if (!this.frostCells.size) { if (this.frostMesh) this.frostMesh.count = 0; return; }
    if (!this.frostMesh) {
      this.frostMesh = new THREE.InstancedMesh(this.iceGeo, this.frostMat, W * H);
      this.frostMesh.receiveShadow = true;
      this.frostMesh.frustumCulled = false;
      this.scene.add(this.frostMesh);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    let k = 0;
    for (const [i, f] of this.frostCells) {
      const grow = Math.min(1, (this.time - f.born) / 0.25);
      const s = Math.max(0.05, Math.min(grow, f.life / 1.2)) * 0.96;
      q.setFromAxisAngle(up, ((i * 5) % 4) * Math.PI / 2);
      m.compose(pos.set((i % W) + 0.5, 0.016, Math.floor(i / W) + 0.5), q, sc.set(s, 1, s));
      this.frostMesh.setMatrixAt(k++, m);
    }
    this.frostMesh.count = k;
    this.frostMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- « La neige » (iteration 42)

  /** Is this point of the table on snow (deep or packed)? (deep tread marks, puffs of snow, buried mines) */
  onSnowR(x: number, y: number) {
    if (!this.snowCells.size || x < 0 || y < 0 || x >= W || y >= H) return false;
    return this.snowCells.has(Math.floor(y) * W + Math.floor(x));
  }

  /** The layer of snow of a new level: soft white drifts with rounded edges over every snow cell (none: hidden). */
  private addSnow(tiles: number[], belts: number[]) {
    this.snowCells = new Set(belts.flatMap((b, i) => ((b === SNOW || b === PACKED) && tiles[i] === Tile.Empty ? [i] : [])));
    this.snowPacked.clear();
    this.flakes(this.iceCells.size > 0 || this.snowCells.size > 0);
    if (!this.snowCells.size) { if (this.snowMesh) this.snowMesh.visible = false; return; }
    if (!this.snowCtx) {
      const c = (this.snowCanvas = document.createElement('canvas'));
      c.width = W * SPX; c.height = H * SPX;
      this.snowCtx = c.getContext('2d')!;
      this.snowBase = document.createElement('canvas');
      this.snowBase.width = W * SPX; this.snowBase.height = H * SPX;
      this.snowTex = new THREE.CanvasTexture(c);
      this.snowTex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: this.snowTex, transparent: true, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(W / 2, 0.006, H / 2);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.snowMesh = mesh;
    }
    this.snowMesh!.visible = true;
    const b = this.snowBase!.getContext('2d')!;
    b.clearRect(0, 0, W * SPX, H * SPX);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cells = [...this.snowCells];
    const disc = (cx: number, cy: number, r: number) => { b.beginPath(); b.arc(cx, cy, r, 0, Math.PI * 2); b.fill(); };
    // a blue shade along the edges, then the snow itself: discs and squares that run into soft rounded drifts
    b.fillStyle = 'rgba(150,180,220,0.5)';
    for (const i of cells) disc((i % W) * SPX + SPX / 2, Math.floor(i / W) * SPX + SPX / 2 + 2, SPX * 0.64);
    b.fillStyle = '#eef4fa';
    for (const i of cells) {
      const x = (i % W) * SPX, y = Math.floor(i / W) * SPX;
      disc(x + SPX / 2, y + SPX / 2, SPX * 0.6);
      b.fillRect(x, y, SPX, SPX);
    }
    // soft lumps (a lighter top, a bluish underside) and a sparkle here and there
    for (const i of cells) {
      const x0 = (i % W) * SPX, y0 = Math.floor(i / W) * SPX;
      for (let k = 0; k < 3; k++) {
        const cx = x0 + rnd() * SPX, cy = y0 + rnd() * SPX, r = 4 + rnd() * 7;
        b.fillStyle = 'rgba(170,195,225,0.1)'; disc(cx, cy + 1.5, r);
        b.fillStyle = 'rgba(255,255,255,0.4)'; disc(cx, cy - 0.5, r * 0.8);
      }
      for (let k = 0; k < 5; k++) {
        b.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,1)' : 'rgba(160,200,240,0.7)';
        b.fillRect(x0 + rnd() * SPX, y0 + rnd() * SPX, 1.2, 1.2);
      }
    }
    const g = this.snowCtx!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W * SPX, H * SPX);
    g.drawImage(this.snowBase!, 0, 0);
    this.snowDirty = true;
  }

  /** A tank ploughs through the snow: a trail of packed snow, its two treads pressed a little deeper. */
  private snowTrack(x: number, y: number, ang: number, len: number, r: number) {
    const g = this.snowCtx;
    if (!g) return;
    g.save();
    g.translate(x * SPX, y * SPX);
    g.rotate(ang);
    const l = Math.min(0.5, len + 0.08) * SPX, w = r * 2.1 * SPX;
    g.fillStyle = 'rgba(196,212,230,0.9)';
    g.fillRect(-l, -w / 2, l + 2, w);
    g.fillStyle = 'rgba(150,172,200,0.9)';
    for (const off of [-0.3, 0.3]) for (let k = 0; k < 2; k++) g.fillRect(-l + k * l / 2, off * SPX * (r / TANK_R) - 3, l / 2 - 2, 6);
    // the ridges of snow pushed aside along the trail
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillRect(-l, -w / 2 - 2, l + 2, 2.5);
    g.fillRect(-l, w / 2 - 0.5, l + 2, 2.5);
    g.restore();
    this.snowDirty = true;
  }

  /** A blast blows the snow away (the scorched floor shows), until the snowfall covers it again. */
  private snowBlast(x: number, y: number, R: number) {
    const g = this.snowCtx;
    if (!g || !this.snowCells.size) return;
    let near = false;
    for (const i of this.snowCells) if (Math.hypot((i % W) + 0.5 - x, Math.floor(i / W) + 0.5 - y) < R + 1) { near = true; break; }
    if (!near) return;
    const gr = g.createRadialGradient(x * SPX, y * SPX, 0, x * SPX, y * SPX, R * SPX);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(0.75, 'rgba(0,0,0,0.85)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = gr;
    g.beginPath(); g.arc(x * SPX, y * SPX, R * SPX, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 26; k++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3;
      this.smoke.emit({ x, y: 0.2, z: y, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 2.2, vz: Math.sin(a) * sp, life: 0.9 + Math.random() * 0.5, s0: 0.12, s1: 0.4, c0: 0xffffff, c1: 0xe4eef8, drag: 2.2, grav: 2 });
    }
    this.snowDirty = true;
  }

  /**
   * The trails the server says are packed (online: the snapshots; the demo: the simulation). A trail that is no longer
   * packed was covered by the snowfall: its cell turns fresh white again.
   */
  setPacked(cells: Iterable<number>) {
    if (!this.snowCtx || !this.snowCells.size) return;
    const now = new Set(cells);
    const g = this.snowCtx;
    for (const i of this.snowPacked) {
      if (now.has(i)) continue;
      const x = (i % W) * SPX, y = Math.floor(i / W) * SPX;
      g.clearRect(x, y, SPX, SPX);
      g.drawImage(this.snowBase!, x, y, SPX, SPX, x, y, SPX, SPX);
      this.snowDirty = true;
    }
    this.snowPacked = now;
  }

  private stepSnowLayer(dt: number) {
    if (!this.snowCtx || !this.snowCells.size) return;
    // the snowfall slowly blurs the trails before covering them for good
    this.snowFall += dt;
    if (this.snowFall > 0.6) {
      this.snowFall = 0;
      const g = this.snowCtx;
      g.globalAlpha = 0.035;
      g.drawImage(this.snowBase!, 0, 0);
      g.globalAlpha = 1;
      this.snowDirty = true;
    }
    this.snowTimer -= dt;
    if (this.snowDirty && this.snowTimer <= 0) { this.snowTex!.needsUpdate = true; this.snowDirty = false; this.snowTimer = 0.1; }
  }

  private animateSnow(dt: number) {
    if (!this.snow?.visible) return;
    const p = this.snowPos;
    for (let k = 0; k < SNOW_FLAKES; k++) {
      const o = k * 3, sd = this.snowSeed[k];
      p[o] += Math.sin(this.time * 0.9 + sd) * 0.35 * dt + 0.12 * dt;
      p[o + 1] -= (0.55 + (sd % 1) * 0.4) * dt;
      p[o + 2] += Math.cos(this.time * 0.7 + sd) * 0.25 * dt;
      if (p[o + 1] < 0.02) { p[o] = -2 + Math.random() * (W + 4); p[o + 1] = 6 + Math.random(); p[o + 2] = -2 + Math.random() * (H + 4); }
    }
    (this.snow.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * A bridge cell (iteration 33): five planks laid across the way over the pit, two stringers under them, and a
   * rope handrail on the open sides, held by posts where the bridge meets the board.
   */
  private addBridge(tiles: number[], x: number, y: number) {
    const cell = y * W + x;
    const axis = bridgeAxis(tiles, cell);
    const root = new THREE.Group();
    root.position.set(x + 0.5, 0, y + 0.5);
    if (axis === 0) root.rotation.y = Math.PI / 2; // built running up-down (along z), turned for left-right bridges
    const deck = new THREE.Group();
    deck.name = 'deck';
    for (let k = 0; k < 5; k++) {
      const p = new THREE.Mesh(this.plankGeo, this.plankMats[(x + y + k) % 2]);
      p.position.set((Math.random() - 0.5) * 0.04, 0.045, -0.4 + k * 0.2);
      p.rotation.y = (Math.random() - 0.5) * 0.06;
      p.castShadow = p.receiveShadow = true;
      deck.add(p);
    }
    for (const sx of [-0.3, 0.3]) {
      const r = new THREE.Mesh(this.railGeo, this.plankMats[1]);
      r.position.set(sx, 0.012, 0);
      r.receiveShadow = true;
      deck.add(r);
    }
    root.add(deck);
    // the way runs along local z: the cells before and after are where the bridge meets the board (or more bridge)
    const along = (d: number) => {
      const nx = axis === 1 ? x : x + d, ny = axis === 1 ? y + d : y;
      return nx >= 0 && ny >= 0 && nx < W && ny < H ? tiles[ny * W + nx] : Tile.Wall;
    };
    for (const sx of [-0.46, 0.46]) {
      const rope = new THREE.Mesh(this.ropeGeo, this.ropeMat);
      rope.rotation.x = Math.PI / 2;
      rope.position.set(sx, 0.2, 0);
      root.add(rope);
      for (const d of [-1, 1]) {
        if (along(d) === Tile.Bridge) continue;
        const post = new THREE.Mesh(this.postGeo, this.plankMats[1]);
        post.position.set(sx, 0.13, d * 0.47);
        post.castShadow = true;
        root.add(post);
      }
    }
    this.levelGroup.add(root);
    this.bridges.set(cell, root);
  }

  /** A bridge cell gives way (iteration 33): its planks tumble into the pit in a shower of splinters. False if it was already gone. */
  collapseBridge(cx: number, cy: number): boolean {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      this.debris.emit({
        x: cx + 0.5 + (Math.random() - 0.5) * 0.8, y: 0.15 + Math.random() * 0.2, z: cy + 0.5 + (Math.random() - 0.5) * 0.8,
        vx: Math.cos(a) * (0.6 + Math.random() * 1.6), vy: 1.5 + Math.random() * 2.5, vz: Math.sin(a) * (0.6 + Math.random() * 1.6),
        life: 1 + Math.random() * 0.6, s0: 0.05 + Math.random() * 0.06, s1: 0.02, c0: 0xc79a62, c1: 0x5e3b20, grav: 10, drag: 0.5,
      });
    }
    const key = cy * W + cx;
    const root = this.bridges.get(key);
    if (!root) return false;
    this.bridges.delete(key);
    // each piece falls on its own: taken out of the bridge, kept where it was in the world
    root.updateMatrixWorld(true);
    const parts: THREE.Object3D[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) parts.push(o); });
    for (const o of parts) {
      this.levelGroup.attach(o);
      this.falling.push({ obj: o, vy: 0.6 + Math.random() * 1.4, spin: new THREE.Vector3((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 7), t: Math.random() * -0.12 });
    }
    this.levelGroup.remove(root);
    return true;
  }

  private animateFalling(dt: number) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      if (f.t < 0) continue; // a short ripple along the bridge: not every plank lets go at once
      f.vy -= 11 * dt;
      f.obj.position.y += f.vy * dt;
      f.obj.rotation.x += f.spin.x * dt;
      f.obj.rotation.y += f.spin.y * dt;
      f.obj.rotation.z += f.spin.z * dt;
      // down in the dark of the pit, it shrinks away (the board is a painted floor: no real depth to fall into)
      const k = Math.max(0, 1 - f.t / 0.9);
      f.obj.scale.setScalar(Math.max(0.01, k));
      if (k <= 0) { this.levelGroup.remove(f.obj); this.falling.splice(i, 1); }
    }
  }

  /** A piece of toy-train tunnel (iteration 13): a painted arch, dark inside, with a cream rim at each mouth. */
  private addTunnel(tiles: number[], x: number, y: number) {
    const cell = y * W + x;
    const axis = tunnelAxis(tiles, cell);
    const root = new THREE.Group();
    root.position.set(x + 0.5, 0, y + 0.5);
    if (axis === 1) root.rotation.y = Math.PI / 2; // built along x, turned for up-down tunnels
    const paint = new THREE.MeshStandardMaterial({ color: 0xc4573f, roughness: 0.65, transparent: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.9, side: THREE.BackSide, transparent: true });
    const cream = new THREE.MeshStandardMaterial({ color: 0xf3e2bf, roughness: 0.55, transparent: true });
    const shell = new THREE.Mesh(this.tunnelGeo.shell, paint);
    const inner = new THREE.Mesh(this.tunnelGeo.inner, dark);
    for (const m of [shell, inner]) { m.rotation.z = Math.PI / 2; m.castShadow = true; m.receiveShadow = true; root.add(m); }
    // stripes of paint every cell, like a wooden toy
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.505, 0.02, 4, 18, Math.PI), cream);
    band.rotation.y = Math.PI / 2;
    root.add(band);
    // a rim and a keystone at each open end
    const run = (d: number) => {
      const nx = axis === 1 ? x : x + d, ny = axis === 1 ? y + d : y;
      return nx >= 0 && ny >= 0 && nx < W && ny < H && isTunnel(tiles[ny * W + nx]);
    };
    for (const d of [-1, 1]) {
      if (run(d)) continue;
      const rim = new THREE.Mesh(this.tunnelGeo.rim, cream);
      rim.rotation.y = Math.PI / 2;
      rim.position.x = d * 0.48;
      rim.castShadow = true;
      const key = new THREE.Mesh(this.tunnelGeo.key, cream);
      key.position.set(d * 0.48, 0.5, 0);
      key.rotation.y = Math.PI / 2;
      root.add(rim, key);
    }
    this.levelGroup.add(root);
    this.tunnels.push({ cell, root, mats: [paint, dark, cream], geos: [band.geometry], op: 1 });
  }

  /** A tunnel's roof turns see-through while a tank drives inside it. */
  private animateTunnels(dt: number) {
    for (const tn of this.tunnels) {
      const target = this.tunnelBusy.has(tn.cell) ? 0.3 : 1;
      if (tn.op === target) continue;
      tn.op = target < tn.op ? Math.max(target, tn.op - dt * 5) : Math.min(target, tn.op + dt * 3);
      for (const m of tn.mats) { m.opacity = tn.op; m.depthWrite = tn.op > 0.99; }
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
    this.paintSand(g);
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
        } else if (isTunnel(t)) {
          // the dusky floor under the arch
          g.fillStyle = 'rgba(60,35,20,0.4)';
          g.fillRect(x * PX + 2, y * PX + 2, PX - 4, PX - 4);
        } else if (isGate(t)) {
          // « Les interrupteurs » (iteration 40): the slot of a gate, painted in its colour with hazard stripes (what a lowered gate looks like)
          const col = '#' + GATE_COLORS[t <= Tile.RedDown ? 0 : 1].toString(16).padStart(6, '0');
          const X = x * PX, Y = y * PX;
          g.save();
          g.beginPath(); g.rect(X + 3, Y + 3, PX - 6, PX - 6); g.clip();
          g.fillStyle = col + '40'; g.fillRect(X, Y, PX, PX);
          g.strokeStyle = col + 'a0'; g.lineWidth = 7;
          for (let k = -PX; k < PX * 2; k += 18) { g.beginPath(); g.moveTo(X + k, Y); g.lineTo(X + k - PX, Y + PX); g.stroke(); }
          g.restore();
          g.strokeStyle = 'rgba(60,35,15,0.55)'; g.lineWidth = 2.5;
          g.strokeRect(X + 3, Y + 3, PX - 6, PX - 6);
        } else if (t === Tile.Switch) {
          g.save();
          g.shadowColor = 'rgba(40,20,0,0.45)'; g.shadowBlur = 14;
          g.fillStyle = 'rgba(60,30,10,0.35)';
          g.fillRect(x * PX + 6, y * PX + 6, PX - 12, PX - 12);
          g.restore();
        }
      }
    }
    this.paintHoles(g, tiles);
    this.floorTex.needsUpdate = true;
    if (this.scratchCtx) { this.scratchCtx.clearRect(0, 0, W * SPX, H * SPX); this.scratchDirty = true; }
  }

  /** Two thin skate scratches under the tracks of a tank sliding on the ice (iteration 38). */
  private iceScratch(x: number, y: number, ang: number, len: number) {
    if (!this.scratchCtx) {
      const c = (this.scratchCanvas = document.createElement('canvas'));
      c.width = W * SPX;
      c.height = H * SPX;
      this.scratchCtx = c.getContext('2d')!;
      this.scratchTex = new THREE.CanvasTexture(c);
      this.scratchTex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: this.scratchTex, transparent: true, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(W / 2, 0.031, H / 2); // just above the slabs of ice (0.027) and of frost
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      this.scratchMesh = mesh;
    }
    const g = this.scratchCtx;
    g.save();
    g.translate(x * SPX, y * SPX);
    g.rotate(ang);
    g.lineCap = 'round';
    const l = Math.min(0.5, len + 0.06) * SPX;
    for (const off of [-0.3, 0.3]) {
      // a pale groove with a darker blue edge: readable on the white-blue ice
      g.strokeStyle = 'rgba(70,120,160,0.42)';
      g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(-l, off * SPX + 1); g.lineTo(0, off * SPX + 1); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-l, off * SPX); g.lineTo(0, off * SPX); g.stroke();
    }
    g.restore();
    this.scratchDirty = true;
  }

  /**
   * Holes (redrawn in iteration 13): neighbouring hole cells merge into one pit cut in the board, with rounded
   * outer corners, a sawn rim and the far wall of the pit lit, so they read as depth instead of black dots.
   */
  private paintHoles(g: CanvasRenderingContext2D, tiles: number[]) {
    const hole = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && isPit(tiles[y * W + x]); // a bridge spans a pit (iteration 33)
    const I = 4, R = 12; // inset on open sides, radius of the outer corners
    const path = new Path2D();
    let any = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!hole(x, y)) continue;
      any = true;
      const l = !hole(x - 1, y), r = !hole(x + 1, y), u = !hole(x, y - 1), d = !hole(x, y + 1);
      const x0 = x * PX + (l ? I : 0), x1 = (x + 1) * PX - (r ? I : 0);
      const y0 = y * PX + (u ? I : 0), y1 = (y + 1) * PX - (d ? I : 0);
      path.roundRect(x0, y0, x1 - x0, y1 - y0, [u && l ? R : 0, u && r ? R : 0, d && r ? R : 0, d && l ? R : 0]);
    }
    if (!any) return;
    // a soft shadow of the cut on the paper around it
    g.save();
    g.shadowColor = 'rgba(50,25,5,0.55)';
    g.shadowBlur = 10;
    g.fillStyle = '#120b07';
    g.fill(path);
    g.restore();
    g.save();
    g.clip(path);
    // the depths: darker towards the middle of each cell
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!hole(x, y)) continue;
      const cx = x * PX + PX / 2, cy = y * PX + PX / 2;
      const hg = g.createRadialGradient(cx, cy + PX * 0.1, 2, cx, cy, PX * 0.8);
      hg.addColorStop(0, '#050302');
      hg.addColorStop(1, '#22150c');
      g.fillStyle = hg;
      g.fillRect(x * PX - 1, y * PX - 1, PX + 2, PX + 2);
    }
    // the walls of the pit: the far (top) one catches the light, the sides a little, the near one is hidden
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!hole(x, y)) continue;
      const X = x * PX, Y = y * PX;
      if (!hole(x, y - 1)) {
        const wg = g.createLinearGradient(0, Y + I, 0, Y + PX * 0.42);
        wg.addColorStop(0, '#a8784a');
        wg.addColorStop(0.35, '#6e4526');
        wg.addColorStop(1, 'rgba(30,18,10,0)');
        g.fillStyle = wg;
        g.fillRect(X - 1, Y, PX + 2, PX * 0.42);
        // wood grain on the sawn face
        g.strokeStyle = 'rgba(60,30,10,0.35)';
        g.lineWidth = 1;
        for (let k = 0; k < 3; k++) { const yy = Y + I + 3 + k * 5; g.beginPath(); g.moveTo(X, yy); g.lineTo(X + PX, yy + (k % 2 ? 1 : -1)); g.stroke(); }
      }
      for (const [side, dx] of [[!hole(x - 1, y), 1], [!hole(x + 1, y), -1]] as const) {
        if (!side) continue;
        const ex = dx > 0 ? X + I : X + PX - I;
        const sg = g.createLinearGradient(ex, 0, ex + dx * PX * 0.2, 0);
        sg.addColorStop(0, 'rgba(120,80,45,0.75)');
        sg.addColorStop(1, 'rgba(40,25,12,0)');
        g.fillStyle = sg;
        g.fillRect(Math.min(ex, ex + dx * PX * 0.2), Y - 1, PX * 0.2, PX + 2);
      }
    }
    g.restore();
    // the sawn rim of the board, drawn outside the pit only (the cells' shared edges stay invisible)
    g.save();
    const outside = new Path2D();
    outside.rect(0, 0, g.canvas.width, g.canvas.height);
    outside.addPath(path);
    g.clip(outside, 'evenodd');
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(255,244,220,0.6)';
    g.stroke(path);
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(90,55,25,0.85)';
    g.stroke(path);
    g.restore();
  }

  // -------------------------------------------------------------- « Les interrupteurs » (iteration 40)
  private gateGeo = new RoundedBoxGeometry(0.9, WALL_H * 0.92, 0.9, 2, 0.05).translate(0, (WALL_H * 0.92) / 2, 0);
  private gateMats = GATE_COLORS.map((c) => new THREE.MeshStandardMaterial({ map: woodTexture('#' + c.toString(16).padStart(6, '0'), '#' + new THREE.Color(c).multiplyScalar(0.55).getHexString()), roughness: 0.55, emissive: c, emissiveIntensity: 0.12 }));
  private gates = new Map<number, { mesh: THREE.Mesh; color: number; up: number; target: number; wait: boolean }>();
  private switches: { root: THREE.Group; cap: THREE.Mesh; capMat: THREE.MeshStandardMaterial; lever: THREE.Group; x: number; y: number; press: number }[] = [];
  /** Which gates stand: 0 the red ones, 1 the blue ones. */
  gatePhase = 0;

  private addGate(x: number, y: number, t: number) {
    const color = t <= Tile.RedDown ? 0 : 1;
    const m = new THREE.Mesh(this.gateGeo, this.gateMats[color]);
    m.position.set(x + 0.5, 0, y + 0.5);
    m.castShadow = m.receiveShadow = true;
    const up = gateUp(t) ? 1 : 0;
    m.scale.y = Math.max(0.02, up);
    m.visible = up > 0;
    this.levelGroup.add(m);
    this.gates.set(y * W + x, { mesh: m, color, up, target: up, wait: false });
  }

  private addSwitch(x: number, y: number) {
    const root = new THREE.Group();
    root.position.set(x + 0.5, 0, y + 0.5);
    const base = new THREE.Mesh(this.wallGeo, this.wallMat);
    base.position.y = WALL_H / 2;
    base.castShadow = base.receiveShadow = true;
    root.add(base);
    // a big round push button on top, in the colour of the gates that stand, and a little lever pointing at it
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.08, 24), new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.6 }));
    ring.position.y = WALL_H + 0.04;
    root.add(ring);
    const capMat = new THREE.MeshStandardMaterial({ color: GATE_COLORS[0], roughness: 0.35, emissive: GATE_COLORS[0], emissiveIntensity: 0.35 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.14, 24), capMat);
    cap.position.y = WALL_H + 0.12;
    cap.castShadow = true;
    root.add(cap);
    const lever = new THREE.Group();
    lever.position.set(0, WALL_H + 0.05, 0);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), new THREE.MeshStandardMaterial({ color: 0xf2e2c4, roughness: 0.5 }));
    stick.position.set(0.36, 0.14, 0);
    stick.rotation.z = -0.5;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), capMat);
    knob.position.set(0.44, 0.29, 0);
    lever.add(stick, knob);
    root.add(lever);
    this.levelGroup.add(root);
    this.switches.push({ root, cap, capMat, lever, x, y, press: 0 });
  }

  private paintSwitch(sw: { capMat: THREE.MeshStandardMaterial; lever: THREE.Group }) {
    const c = GATE_COLORS[this.gatePhase];
    sw.capMat.color.setHex(c);
    sw.capMat.emissive.setHex(c);
    sw.lever.rotation.y = this.gatePhase ? Math.PI : 0;
  }

  /** A shell hit a switch: every button flips colour and clicks down, the gates that should rise get ready. */
  flipSwitches(cx: number, cy: number, phase: number) {
    this.gatePhase = phase ? 1 : 0;
    for (const sw of this.switches) {
      this.paintSwitch(sw);
      sw.press = 1;
      if (sw.x === cx && sw.y === cy) {
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          this.glow.emit({ x: cx + 0.5, y: WALL_H + 0.2, z: cy + 0.5, vx: Math.cos(a) * 2.2, vy: 1 + Math.random() * 1.5, vz: Math.sin(a) * 2.2, life: 0.45, s0: 0.12, s1: 0.02, c0: GATE_COLORS[this.gatePhase], c1: 0xffffff, grav: 4, drag: 1.5 });
        }
      }
    }
    for (const gt of this.gates.values()) gt.wait = gt.color === this.gatePhase && gt.target === 0;
    for (const lf of this.lifts.values()) lf.wait = lf.color === this.gatePhase && lf.target === 0;
  }

  /** A gate rises or sinks (its new tile from the room). */
  setGate(cx: number, cy: number, tile: number) {
    const lf = this.lifts.get(cy * W + cx);
    if (lf) { lf.target = gateUp(tile) ? 1 : 0; lf.wait = false; return; }
    const gt = this.gates.get(cy * W + cx);
    if (!gt) return;
    gt.target = gateUp(tile) ? 1 : 0;
    gt.wait = false;
    gt.mesh.visible = true;
    if (gt.target) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        this.smoke.emit({ x: cx + 0.5 + Math.cos(a) * 0.45, y: 0.08, z: cy + 0.5 + Math.sin(a) * 0.45, vx: Math.cos(a) * 1.1, vy: 0.3 + Math.random() * 0.3, vz: Math.sin(a) * 1.1, life: 0.5, s0: 0.1, s1: 0.26, c0: 0xd9b48a, c1: 0xefdcb8, drag: 3 });
      }
    }
  }

  /** Is there a standing gate in this cell? (for the demo's camera work) */
  gateStanding(cx: number, cy: number) { return (this.gates.get(cy * W + cx)?.target ?? 0) > 0; }

  // -------------------------------------------------------------- « Les ponts-levis » (iteration 48)
  private chainGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 5).translate(0, 0.5, 0);
  private chainMat = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.4, metalness: 0.7 });
  private liftPostGeo = new THREE.BoxGeometry(0.11, 0.62, 0.11).translate(0, 0.31, 0);
  private lifts = new Map<number, { root: THREE.Group; pivot: THREE.Group; chains: THREE.Mesh[]; d: number; color: number; up: number; target: number; wait: boolean }>();

  /**
   * A drawbridge over a pit: planks in the colour of its switches, hinged on the side of the board, two posts and two
   * chains that haul its far end up (raised: the pit stops the tanks, shells fly over) or let it down (a bridge).
   */
  private addDrawbridge(tiles: number[], x: number, y: number, t: number) {
    const cell = y * W + x;
    const axis = bridgeAxis(tiles, cell);
    const color = gateColor(t);
    const root = new THREE.Group();
    root.position.set(x + 0.5, 0, y + 0.5);
    if (axis === 0) root.rotation.y = Math.PI / 2; // as addBridge: built running along local z
    const along = (k: number) => {
      // local +z is grid +y when the way runs up-down; turned by +90° about y, local +z becomes grid +x
      const nx = axis === 1 ? x : x + k, ny = axis === 1 ? y + k : y;
      return nx >= 0 && ny >= 0 && nx < W && ny < H ? tiles[ny * W + nx] : Tile.Wall;
    };
    // the hinge sits where the bridge meets the board (or on the -z end when both ends do)
    const d = isPit(along(-1)) && !isPit(along(1)) ? 1 : -1;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.03, d * 0.5);
    for (let k = 0; k < 5; k++) {
      const p = new THREE.Mesh(this.plankGeo, k % 2 ? this.gateMats[color] : this.plankMats[(x + y) % 2]);
      p.position.set(0, 0.015, -d * (0.1 + k * 0.2));
      p.castShadow = p.receiveShadow = true;
      pivot.add(p);
    }
    for (const sx of [-0.3, 0.3]) {
      const r = new THREE.Mesh(this.railGeo, this.gateMats[color]);
      r.position.set(sx, -0.015, -d * 0.5);
      pivot.add(r);
    }
    root.add(pivot);
    const chains: THREE.Mesh[] = [];
    for (const sx of [-0.44, 0.44]) {
      const post = new THREE.Mesh(this.liftPostGeo, this.plankMats[1]);
      post.position.set(sx, 0, d * 0.47);
      post.castShadow = true;
      root.add(post);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), this.gateMats[color]);
      cap.position.set(sx, 0.66, d * 0.47);
      root.add(cap);
      const ch = new THREE.Mesh(this.chainGeo, this.chainMat);
      root.add(ch);
      chains.push(ch);
    }
    this.levelGroup.add(root);
    const up = gateUp(t) ? 1 : 0;
    const lf = { root, pivot, chains, d, color, up, target: up, wait: false };
    this.lifts.set(cell, lf);
    this.poseDrawbridge(lf, up);
  }

  private poseDrawbridge(lf: { pivot: THREE.Group; chains: THREE.Mesh[]; d: number }, k: number) {
    const a = k * 1.2; // raised: about 70°
    lf.pivot.rotation.x = lf.d * a;
    // the far end of the deck, in the bridge's own space: the pivot turned about x
    const L = 0.95, ty = 0.03 + L * Math.sin(a), tz = lf.d * 0.5 - lf.d * L * Math.cos(a);
    const v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    lf.chains.forEach((ch, i) => {
      const sx = i ? 0.44 : -0.44;
      const from = new THREE.Vector3(sx, 0.64, lf.d * 0.47), to = new THREE.Vector3(sx * 0.75, ty, tz);
      v.subVectors(to, from);
      ch.position.copy(from);
      ch.scale.set(1, v.length(), 1);
      ch.quaternion.setFromUnitVectors(up, v.normalize());
    });
  }

  private animateGates(dt: number) {
    for (const lf of this.lifts.values()) {
      if (lf.up === lf.target && !lf.wait) continue;
      const sp = lf.target ? 2.2 : 3;
      lf.up = lf.target ? Math.min(1, lf.up + dt * sp) : Math.max(0, lf.up - dt * sp);
      // lowering: it drops faster at the end and bounces once on the far bank; waiting for a tank to move off: it tugs at its chains
      const k = !lf.target && lf.up < 0.25 ? lf.up * lf.up * 4 * 0.25 + Math.abs(Math.sin(lf.up * 25)) * 0.03 : lf.up;
      this.poseDrawbridge(lf, lf.wait ? 0.05 + Math.abs(Math.sin(this.time * 20)) * 0.05 : k);
    }
    for (const gt of this.gates.values()) {
      if (gt.up !== gt.target) {
        const sp = gt.target ? 4.2 : 6;
        gt.up = gt.target ? Math.min(1, gt.up + dt * sp) : Math.max(0, gt.up - dt * sp);
      }
      // rising: a little overshoot like a toy block snapping up; waiting for a tank to move off: it trembles in its slot
      const k = gt.target && gt.up < 1 ? 1 - (1 - gt.up) ** 3 + Math.sin(gt.up * Math.PI) * 0.1 : gt.up;
      const shiver = gt.wait ? 0.06 + Math.sin(this.time * 38 + gt.mesh.position.x * 3) * 0.04 : 0;
      gt.mesh.scale.y = Math.max(0.02, k + shiver);
      gt.mesh.visible = gt.up > 0.01 || gt.wait;
    }
    for (const sw of this.switches) {
      if (sw.press <= 0) continue;
      sw.press = Math.max(0, sw.press - dt * 3.5);
      const d = Math.sin(sw.press * Math.PI);
      sw.cap.position.y = WALL_H + 0.12 - d * 0.09;
      sw.capMat.emissiveIntensity = 0.35 + d * 0.9;
    }
  }

  /** The Maçon lays a cork block (iteration 12): it pops out of the floor with a puff of sawdust. */
  addBlock(cx: number, cy: number, by?: number) {
    const key = cy * W + cx;
    if (this.blocks.has(key)) return;
    const m = new THREE.Mesh(this.wallGeo, this.corkMat);
    m.position.set(cx + 0.5, 0, cy + 0.5);
    m.scale.set(0.96, 0.01, 0.96);
    m.castShadow = m.receiveShadow = true;
    this.levelGroup.add(m);
    this.blocks.set(key, m);
    this.rising.push({ mesh: m, t: 0 });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit({ x: cx + 0.5 + Math.cos(a) * 0.45, y: 0.1, z: cy + 0.5 + Math.sin(a) * 0.45, vx: Math.cos(a) * 1.4, vy: 0.4 + Math.random() * 0.4, vz: Math.sin(a) * 1.4, life: 0.7, s0: 0.12, s1: 0.32, c0: 0xd9b48a, c1: 0xefdcb8, drag: 3 });
      this.debris.emit({ x: cx + 0.5, y: 0.3, z: cy + 0.5, vx: Math.cos(a) * (0.8 + Math.random()), vy: 2 + Math.random() * 2, vz: Math.sin(a) * (0.8 + Math.random()), life: 0.8, s0: 0.05, s1: 0.02, c0: 0xc98f55, c1: 0x8a5a2b, grav: 9, drag: 0.5 });
    }
    const v = by !== undefined ? this.tanks.get(by) : undefined;
    if (v?.crane) v.crane.userData.swing = 1;
  }

  private animateRising(dt: number) {
    for (let i = this.rising.length - 1; i >= 0; i--) {
      const r = this.rising[i];
      r.t += dt;
      const u = Math.min(1, r.t / 0.32);
      // a little overshoot, like a toy block snapping in place
      const k = u < 1 ? 1 - (1 - u) ** 3 + Math.sin(u * Math.PI) * 0.12 : 1;
      r.mesh.scale.y = Math.max(0.01, 0.92 * k);
      r.mesh.position.y = (WALL_H * r.mesh.scale.y) / 2;
      if (u >= 1) this.rising.splice(i, 1);
    }
    for (const v of this.tanks.values()) {
      if (v.key) v.key.rotation.x += dt * 3.2; // the rival's wind-up key turns
      const sk = v.sack;
      if (sk) {
        // it wobbles as it drives, and gulps (a quick swell) each time it steals a crate
        const g = (sk.userData.gulp as number | undefined) ?? 0;
        const full = 1 + Math.min(3, (sk.userData.loot as number | undefined) ?? 0) * 0.12;
        const s0 = full + Math.sin(g * Math.PI) * 0.45;
        sk.scale.set(s0, s0 * (1 + Math.sin(this.time * 9 + v.info.id) * 0.04), s0);
        if (g > 0) sk.userData.gulp = Math.max(0, g - dt * 2.2);
      }
      const c = v.crane;
      if (!c) continue;
      const sw = (c.userData.swing as number | undefined) ?? 0;
      c.rotation.y = Math.sin(this.time * 1.3 + v.info.id) * 0.25 + Math.sin(sw * Math.PI * 3) * sw * 0.9;
      const hook = c.getObjectByName('hook');
      if (hook) hook.visible = sw < 0.4; // the block leaves the hook, a new one comes back
      if (sw > 0) c.userData.swing = Math.max(0, sw - dt * 1.4);
    }
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
    this.fogSeers.length = 0;
    if (this.fogSeed !== undefined) {
      fogBanks(this.fogSeed, this.fogTick, this.fogNow);
      for (const t of list) if (t.alive && (t.id === myId || this.fogAlly?.(t.id)) && this.fogSeers.length < 4) this.fogSeers.push({ x: t.x, y: t.y });
    }
    this.tunnelBusy.clear();
    if (this.tunnels.length) {
      for (const t of list) {
        if (!t.alive) continue;
        // every cell the hull overlaps: the roof clears as soon as a tank noses in
        for (const [ox, oy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) this.tunnelBusy.add(Math.floor(t.y + oy) * W + Math.floor(t.x + ox));
      }
    }
    for (const t of list) {
      const v = this.tanks.get(t.id);
      if (!v) continue;
      // a lightning flash shows invisible tanks for an instant
      // and, in the fog (iteration 26), the tanks lost in a bank of mist far from you and your teammates
      if (v.seenT) v.seenT = Math.max(0, v.seenT - dt);
      // « Le Veilleur » (iteration 47): its beam lights up the invisible tanks too
      const visible = t.alive && !(t.invisible && t.id !== myId && this.lightning < 0.45 && !this.inLight(list, t)) && !this.lostInFog(t, v);
      v.root.visible = visible;
      this.tankIce(v, t, dt);
      if (v.lantern) this.tankWatcher(v, t, dt);
      if (!t.alive) {
        if (v.wasAlive) this.deathMark(t.x, t.y, v.info);
        v.wasAlive = false;
        this.wreckUnderRepair(v, t);
        continue;
      }
      v.wasAlive = true;
      if (v.fixing) { v.fixing = false; v.root.rotation.set(0, 0, 0); }
      if (!v.patch && (t.fx ?? 0) & FLAG_PATCHED) this.addPatch(v);
      if (v.spanner) this.tankMechanic(v, t, dt, visible);
      v.root.position.set(t.x, 0, t.y);
      v.hull.rotation.y = -t.body;
      v.turret.rotation.y = -t.turret;
      v.recoil = Math.max(0, v.recoil - dt * 4);
      v.turret.position.x = -Math.cos(t.turret) * v.recoil * 0.12;
      v.turret.position.z = -Math.sin(t.turret) * v.recoil * 0.12;
      v.turret.position.y = 0.37 * v.scale;
      this.tankGlow(v, t, dt);
      if (v.cloud) this.tankThunder(v, t, dt);
      if (v.magnet) this.tankMagnet(v.magnet, t, dt);
      if (v.flake && t.alive) {
        // the Givré's snowflake spins, and a few frost sparkles drift off it (iteration 31)
        v.flake.rotation.y += dt * (t.fx && t.fx & FLAG_FROZEN ? 0 : 1.4);
        if (visible && Math.random() < 6 * dt) this.glow.emit({ x: t.x + (Math.random() - 0.5) * 0.6, y: 0.7, z: t.y + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.3, vy: 0.35, vz: (Math.random() - 0.5) * 0.3, life: 0.7, s0: 0.05, s1: 0.01, c0: 0xffffff, c1: 0x9fdcff, drag: 1 });
      }
      if (v.tube) {
        // the Mortier (iteration 34): aiming, its barrel trembles and swells; it kicks back when it fires
        const charging = !!((t.fx ?? 0) & FLAG_CHARGING);
        const k = 1 + (charging ? 0.06 + Math.sin(this.time * 34) * 0.04 : 0) + v.recoil * 0.12;
        v.tube.scale.set(1, k, k);
        v.tube.position.x = 0.04 - v.recoil * 0.08;
      }
      if (v.hopper) {
        const sh = (v.hopper.userData.shake = Math.max(0, (v.hopper.userData.shake ?? 0) - dt * 2.5));
        const charging = !!((t.fx ?? 0) & FLAG_CHARGING);
        v.hopper.rotation.z = Math.sin(this.time * 38) * (sh * 0.25 + (charging ? 0.08 : 0));
        v.hopper.position.y = 0.6 + sh * 0.12;
        if (charging && Math.random() < 30 * dt) this.glow.emit({ x: t.x, y: 1.1, z: t.y, vx: (Math.random() - 0.5) * 0.8, vy: 1.2, vz: (Math.random() - 0.5) * 0.8, life: 0.4, s0: 0.06, s1: 0.02, c0: 0xffe080, c1: 0xffa020 });
      }
      if (v.ring) {
        (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(this.time * 4) * 0.25;
      }
      this.tankBuffs(v, t, visible, dt);
      this.tankAlert(v, t, dt);
      if (v.armor) this.tankArmor(v, t, visible, dt);
      if (v.wheels) { this.tankTrain(v, t, visible, dt); continue; } // « Le Tortillard »: on rails, no tread marks
      if (v.mound && this.tankDrill(v, t, dt)) continue;
      if (v.legs && this.tankHopper(v, t, dt)) continue;
      // tread marks
      if (Number.isNaN(v.lastMarkX)) { v.lastMarkX = t.x; v.lastMarkY = t.y; }
      const d = Math.hypot(t.x - v.lastMarkX, t.y - v.lastMarkY);
      if (d > 0.22 && this.onIce(t.x, t.y)) {
        // on the ice (iteration 21): no tread marks, a spray of ice shavings, more when the tank drifts sideways
        const mvx = t.x - v.lastMarkX, mvy = t.y - v.lastMarkY;
        const side = Math.abs(Math.sin(Math.atan2(mvy, mvx) - t.body));
        v.lastMarkX = t.x; v.lastMarkY = t.y;
        this.iceScratch(t.x, t.y, Math.atan2(mvy, mvx), Math.hypot(mvx, mvy));
        if (!(t.invisible && t.id !== myId)) {
          for (let k = 0, n = side > 0.35 ? 3 : 1; k < n; k++) {
            this.smoke.emit({ x: t.x - mvx * 1.5 + (Math.random() - 0.5) * 0.5, y: 0.06, z: t.y - mvy * 1.5 + (Math.random() - 0.5) * 0.5, vx: -mvx * 3 + (Math.random() - 0.5) * 0.6, vy: 0.5 + Math.random() * 0.4, vz: -mvy * 3 + (Math.random() - 0.5) * 0.6, life: 0.5, s0: 0.05, s1: 0.12, c0: 0xffffff, c1: 0xdff3ff, drag: 2.5 });
          }
        }
      } else if (d > 0.18 && this.onSnowR(t.x, t.y)) {
        // in the snow (iteration 42): a trail of packed snow, even behind a white (invisible) tank, and puffs of powder
        const mvx = t.x - v.lastMarkX, mvy = t.y - v.lastMarkY;
        v.lastMarkX = t.x; v.lastMarkY = t.y;
        this.snowTrack(t.x, t.y, Math.atan2(mvy, mvx), Math.hypot(mvx, mvy), tankRadius(v.info.kind));
        if (!(t.invisible && t.id !== myId) && Math.random() < 0.7) {
          this.smoke.emit({ x: t.x - Math.cos(t.body) * 0.4 + (Math.random() - 0.5) * 0.5, y: 0.08, z: t.y - Math.sin(t.body) * 0.4 + (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 0.8, vy: 0.5 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.8, life: 0.7, s0: 0.08, s1: 0.26, c0: 0xffffff, c1: 0xeaf2fa, drag: 2 });
        }
      } else if (d > 0.22) {
        const bx = t.x, by = t.y, ang = t.body;
        const sand = this.onSand(t.x, t.y); // in the dunes (iteration 36): deeper tracks and a cloud of dust
        this.floorMark((g) => {
          g.save();
          g.translate(bx * PX, by * PX);
          g.rotate(ang);
          g.fillStyle = sand ? 'rgba(120,70,20,0.3)' : 'rgba(90,60,30,0.16)';
          for (const off of [-0.3, 0.3]) for (let k = -1; k <= 1; k++) g.fillRect(k * 5 - 2, off * PX - 5, 4, 10);
          if (sand) {
            g.fillStyle = 'rgba(255,236,190,0.35)';
            for (const off of [-0.3, 0.3]) g.fillRect(-8, off * PX + 5, 16, 2);
          }
          g.restore();
        });
        v.lastMarkX = t.x; v.lastMarkY = t.y;
        if ((sand || Math.random() < 0.5) && !(t.invisible && t.id !== myId)) {
          for (let k = 0, n = sand ? 2 : 1; k < n; k++) {
            this.smoke.emit(sand
              ? { x: t.x - Math.cos(t.body) * 0.4 + (Math.random() - 0.5) * 0.5, y: 0.1, z: t.y - Math.sin(t.body) * 0.4 + (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 0.7, vy: 0.45 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.7, life: 0.9, s0: 0.1, s1: 0.32, c0: 0xe2b56a, c1: 0xf1dcae, drag: 1.6 }
              : { x: t.x - Math.cos(t.body) * 0.4, y: 0.08, z: t.y - Math.sin(t.body) * 0.4, vy: 0.3, life: 0.6, s0: 0.06, s1: 0.16, c0: 0xd9c4a0, c1: 0xe8dcc8, drag: 2 });
          }
        }
      }
    }
    this.headlights(list);
    this.watchLights(list);
  }

  /**
   * « La Sauterelle » (iteration 41): it crouches on its springs (FLAG_CHARGING), then flies along an arc to the ring
   * that marks its landing (the height comes from how far along its leap it is), legs stretched out, nose up then down.
   * Returns true in the air (no tread marks).
   */
  /**
   * « Le Veilleur » (iteration 47): its beam fans out on the floor from the lens, each ray stopped by the first wall,
   * warm yellow while it sweeps, red once it has caught someone (FLAG_SPOT); the lantern glows the same colour.
   */
  private tankWatcher(v: TankView, t: RTank, dt: number) {
    const L = v.lantern!;
    const on = t.alive && !(t.fx && t.fx & FLAG_FROZEN);
    L.beam.visible = on;
    const spot = !!((t.fx ?? 0) & FLAG_SPOT);
    L.red += ((spot ? 1 : 0) - L.red) * Math.min(1, dt * (spot ? 14 : 4));
    const r = L.red, pulse = spot ? 0.75 + Math.sin(this.time * 22) * 0.25 : 1;
    const c = this.tmpColor.setHex(0xffd648).lerp(new THREE.Color(0xff3a26), r);
    L.glass.emissive.copy(c);
    L.glass.emissiveIntensity = (1 + this.night * 1.2) * pulse;
    L.lens.color.copy(c).lerp(new THREE.Color(0xffffff), 0.35 * (1 - r));
    if (!on) return;
    const pos = L.pos, col = L.col, tiles = this.beamTiles;
    const ox = t.x + Math.cos(t.turret) * 0.18, oy = t.y + Math.sin(t.turret) * 0.18;
    const yb = 0.035;
    pos[0] = ox; pos[1] = yb; pos[2] = oy;
    // brighter by night, and much stronger once it has caught someone
    const a0 = (0.5 + 0.2 * r) * (1 + this.night * 0.3), a1 = 0.06 + 0.08 * r;
    col[0] = c.r; col[1] = c.g; col[2] = c.b; col[3] = Math.min(0.85, a0);
    for (let i = 0; i <= BEAM_RAYS; i++) {
      const ang = t.turret - WATCH_HALF + (i / BEAM_RAYS) * WATCH_HALF * 2;
      let len = WATCH_RANGE;
      if (tiles.length) {
        const seg = castRicochet(tiles, ox, oy, ang, 0, WATCH_RANGE)[0];
        if (seg) len = Math.min(WATCH_RANGE, Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0) + 0.08);
      }
      if (i === BEAM_RAYS >> 1) L.reach = len;
      const k = (i + 1) * 3, kc = (i + 1) * 4;
      pos[k] = ox + Math.cos(ang) * len; pos[k + 1] = yb; pos[k + 2] = oy + Math.sin(ang) * len;
      // the light fades with distance: a ray cut short by a wall ends brighter
      const f = len / WATCH_RANGE;
      col[kc] = c.r; col[kc + 1] = c.g; col[kc + 2] = c.b; col[kc + 3] = a0 + (a1 - a0) * f;
    }
    const g = L.beam.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  /**
   * « Le Tortillard » (iteration 49): the wheels turn with the distance run, the chimney puffs smoke (more at speed),
   * and while it stands whistling (FLAG_CHARGING) clouds of white steam burst out at its feet.
   */
  private tankTrain(v: TankView, t: RTank, visible: boolean, dt: number) {
    if (v.trainX === undefined) { v.trainX = t.x; v.trainY = t.y; }
    const mx = t.x - v.trainX, my = t.y - (v.trainY ?? t.y);
    v.trainX = t.x; v.trainY = t.y;
    const run = (mx * Math.cos(t.body) + my * Math.sin(t.body)) / v.scale;
    for (const w of v.wheels!) w.rotation.y -= run / 0.11;
    if (!visible || !v.chimney || dt <= 0) return;
    const speed = Math.hypot(mx, my) / dt;
    const fx = t.fx ?? 0;
    const cx = t.x + Math.cos(t.body) * 0.3 * v.scale, cy = t.y + Math.sin(t.body) * 0.3 * v.scale;
    if (Math.random() < (2 + speed * 5) * dt) {
      this.smoke.emit({ x: cx, y: 0.78 * v.scale, z: cy, vx: -Math.cos(t.body) * speed * 0.3 + (Math.random() - 0.5) * 0.2, vy: 0.9 + Math.random() * 0.3, vz: -Math.sin(t.body) * speed * 0.3 + (Math.random() - 0.5) * 0.2, life: 1.1, s0: 0.12, s1: 0.42, c0: 0x9a9a9a, c1: 0xe6e6e6, drag: 1.2 });
    }
    if (fx & FLAG_CHARGING && Math.random() < 40 * dt) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const px = -Math.sin(t.body) * s, py = Math.cos(t.body) * s;
      this.smoke.emit({ x: t.x + px * 0.45 + (Math.random() - 0.5) * 0.6, y: 0.12, z: t.y + py * 0.45 + (Math.random() - 0.5) * 0.6, vx: px * 1.6, vy: 0.4 + Math.random() * 0.4, vz: py * 1.6, life: 0.7, s0: 0.1, s1: 0.38, c0: 0xffffff, c1: 0xf2f2f2, drag: 2.4 });
    }
  }

  /** Is this tank in the beam of a Veilleur (any of them, whatever its side)? */
  private inLight(list: RTank[], o: RTank): boolean {
    for (const t of list) {
      if (t === o || !t.alive || !this.tanks.get(t.id)?.lantern) continue;
      const dx = o.x - t.x, dy = o.y - t.y, d = Math.hypot(dx, dy);
      if (d > WATCH_RANGE + 0.3 || d < 0.3) continue;
      let a = Math.atan2(dy, dx) - t.turret;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > WATCH_HALF + Math.asin(Math.min(1, 0.4 / d))) continue;
      const seg = this.beamTiles.length ? castRicochet(this.beamTiles, t.x, t.y, Math.atan2(dy, dx), 0, d)[0] : undefined;
      if (!seg || Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0) >= d - 0.4) return true;
    }
    return false;
  }

  /** At night the Veilleurs' beams light the table for real (two spotlights, for the first two of them). */
  private watchLights(list: RTank[]) {
    let n = 0;
    if (this.night > 0) {
      for (const t of list) {
        if (n >= this.beamLights.length) break;
        const v = this.tanks.get(t.id);
        if (!v?.lantern || !t.alive || !v.lantern.beam.visible) continue;
        const sp = this.beamLights[n++];
        const dx = Math.cos(t.turret), dy = Math.sin(t.turret);
        sp.position.set(t.x + dx * 0.2, 0.9, t.y + dy * 0.2);
        const reach = v.lantern.reach;
        sp.target.position.set(t.x + dx * reach, 0, t.y + dy * reach);
        sp.distance = reach + 1.2; // the light stops at the wall it hits
        sp.color.setHex(0xfff0c0).lerp(this.tmpColor.setHex(0xff4a30), v.lantern.red);
        sp.intensity = 26 * this.night;
      }
      // « Le Tortillard » (iteration 49): the locomotive's headlamp lights the track ahead of it
      for (const t of list) {
        if (n >= this.beamLights.length) break;
        const v = this.tanks.get(t.id);
        if (!v?.chimney || !t.alive || !v.root.visible) continue;
        const sp = this.beamLights[n++];
        const dx = Math.cos(t.body), dy = Math.sin(t.body);
        sp.position.set(t.x + dx * 0.8, 0.85, t.y + dy * 0.8);
        sp.target.position.set(t.x + dx * 5, 0, t.y + dy * 5);
        sp.distance = 7;
        sp.color.setHex(0xffe2a0);
        sp.intensity = 24 * this.night;
      }
    }
    for (let i = n; i < this.beamLights.length; i++) this.beamLights[i].intensity = 0;
  }

  // ---------------------------------------------------------------- « Le Mécano » (iteration 51)

  /** A Mécano starts work on a wreck: a ring of ticks around it fills up as the work goes on. */
  startRepair(mech: number, wreck: number, x: number, y: number, dur: number) {
    this.stopRepair(mech);
    const ring = new THREE.Group();
    for (let i = 0; i < REPAIR_TICKS; i++) {
      const a = (i / REPAIR_TICKS) * Math.PI * 2 - Math.PI / 2;
      const m = new THREE.Mesh(mechGeo.tick, tickOffMat);
      m.position.set(Math.cos(a) * 0.62, 0.04, Math.sin(a) * 0.62);
      m.rotation.y = -a;
      ring.add(m);
    }
    ring.position.set(x, 0, y);
    this.scene.add(ring);
    this.repairs.set(mech, { wreck, x, y, t0: this.time, dur: Math.max(0.5, dur), ring });
  }

  stopRepair(mech: number) {
    const r = this.repairs.get(mech);
    if (!r) return;
    this.scene.remove(r.ring);
    this.repairs.delete(mech);
  }

  /** The wreck rolls again: a puff of dust, a little star of sparks, the ring goes. */
  repaired(wreck: number, x: number, y: number) {
    for (const [id, r] of this.repairs) if (r.wreck === wreck) this.stopRepair(id);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.smoke.emit({ x: x + Math.cos(a) * 0.3, y: 0.08, z: y + Math.sin(a) * 0.3, vx: Math.cos(a) * 1.3, vy: 0.3 + Math.random() * 0.3, vz: Math.sin(a) * 1.3, life: 0.5, s0: 0.08, s1: 0.22, c0: 0xd9c4a0, c1: 0xefe4cf, drag: 3 });
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
      this.glow.emit({ x, y: 0.5, z: y, vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * sp, life: 0.45 + Math.random() * 0.3, s0: 0.07, s1: 0.01, c0: 0xfff2a0, c1: 0xff9a30, drag: 1.5, grav: 6 });
    }
  }

  /** A dead tank: drawn half sunk and tilted while a Mécano works on it, straightening up as the ring fills. */
  private wreckUnderRepair(v: TankView, t: RTank) {
    let rep: { x: number; y: number; t0: number; dur: number; ring: THREE.Group } | undefined;
    for (const r of this.repairs.values()) if (r.wreck === t.id) { rep = r; break; }
    if (!rep) {
      if (v.fixing) { v.fixing = false; v.root.rotation.set(0, 0, 0); }
      return;
    }
    const k = Math.max(0, Math.min(1, (this.time - rep.t0) / rep.dur));
    v.fixing = true;
    v.root.visible = true;
    v.root.position.set(rep.x, -0.16 * (1 - k), rep.y);
    v.root.rotation.set(0.45 * (1 - k) + Math.sin(this.time * 30) * 0.03 * (1 - k), 0, 0.25 * (1 - k));
    const lit = Math.floor(k * REPAIR_TICKS);
    rep.ring.children.forEach((m, i) => { (m as THREE.Mesh).material = i < lit ? tickOnMat : tickOffMat; });
    if (Math.random() < 0.45) {
      const a = Math.random() * Math.PI * 2;
      this.glow.emit({ x: rep.x + Math.cos(a) * 0.25, y: 0.35, z: rep.y + Math.sin(a) * 0.25, vx: Math.cos(a) * 1.8, vy: 1.2 + Math.random() * 1.5, vz: Math.sin(a) * 1.8, life: 0.3 + Math.random() * 0.2, s0: 0.05, s1: 0.01, c0: 0xfff6c0, c1: 0xffa030, drag: 1, grav: 7 });
    }
  }

  /** The Mécano's spanner: it bobs as it drives, and spins round while it works (a repair lost: its ring goes). */
  private tankMechanic(v: TankView, t: RTank, dt: number, visible: boolean) {
    const working = !!((t.fx ?? 0) & FLAG_REPAIR);
    const arm = v.spanner!.userData.arm as THREE.Group;
    if (working) arm.rotation.y += dt * 9;
    else {
      arm.rotation.y = arm.rotation.y % (Math.PI * 2);
      arm.rotation.y += -arm.rotation.y * Math.min(1, dt * 6);
      const r = this.repairs.get(t.id);
      if (r && this.time - r.t0 > 0.5) this.stopRepair(t.id); // driven off, or the wreck came back some other way
    }
    arm.position.y = 0.16 + (working ? Math.abs(Math.sin(this.time * 18)) * 0.05 : Math.sin(this.time * 4) * 0.012);
    if (working && visible && Math.random() < 0.5) {
      const a = t.turret;
      this.glow.emit({ x: t.x + Math.cos(a) * 0.35, y: 0.75, z: t.y + Math.sin(a) * 0.35, vx: (Math.random() - 0.5) * 1.5, vy: 1 + Math.random(), vz: (Math.random() - 0.5) * 1.5, life: 0.3, s0: 0.05, s1: 0.01, c0: 0xffffff, c1: 0xffc040, drag: 1, grav: 6 });
    }
  }

  /** A patched tank (put back together by a Mécano): two crossed strips of plaster on its hull. */
  private addPatch(v: TankView) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(mechGeo.strip, plasterMat);
      m.rotation.y = s * 0.7;
      g.add(m);
    }
    g.position.set(0.24, 0.38, 0.16);
    g.scale.setScalar(0.62);
    v.hull.add(g);
    v.patch = g;
  }

  private tankHopper(v: TankView, t: RTank, dt: number): boolean {
    const fx = t.fx ?? 0, air = !!(fx & FLAG_AIR), crouch = !!(fx & FLAG_CHARGING);
    let z = 0, p = 0;
    const L = v.leap;
    if (air && L) {
      const dx = L.x1 - L.x0, dy = L.y1 - L.y0, l2 = dx * dx + dy * dy;
      p = l2 > 0.01 ? Math.max(0, Math.min(1, ((t.x - L.x0) * dx + (t.y - L.y0) * dy) / l2)) : 0.5;
      z = Math.sin(Math.PI * p) * HOP_HEIGHT * (0.6 + 0.4 * Math.min(1, Math.sqrt(l2) / HOP_MAX));
    } else if (air) z = 0.5;
    v.root.position.y = z;
    v.squash = Math.max(0, (v.squash ?? 0) - dt * 4);
    const sy = crouch ? 0.8 + Math.sin(this.time * 34) * 0.025 : air ? 1.1 : 1 - Math.sin(v.squash * Math.PI) * 0.22;
    const sx = 1 + (1 - sy) * 0.6;
    v.root.scale.set(sx, sy, sx);
    poseLegs(v, air ? HOP_POSE.air : crouch ? HOP_POSE.crouch : HOP_POSE.rest);
    const pitch = air ? (0.5 - p) * 0.6 : 0;
    v.hull.rotation.z = pitch;
    v.turret.rotation.z = pitch;
    if (v.leapRing) {
      v.leapRing.visible = air;
      if (air) {
        const k = 0.85 - p * 0.35;
        v.leapRing.scale.set(k, k, k);
        (v.leapRing.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(this.time * 18) * 0.2;
      }
    }
    if (crouch && Math.random() < 14 * dt) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit({ x: t.x + Math.cos(a) * 0.4, y: 0.06, z: t.y + Math.sin(a) * 0.4, vx: Math.cos(a) * 0.5, vy: 0.3, vz: Math.sin(a) * 0.5, life: 0.4, s0: 0.05, s1: 0.13, c0: 0xd9c4a0, c1: 0xe8dcc8, drag: 2 });
    }
    if (!air) return false;
    v.lastMarkX = t.x; v.lastMarkY = t.y;
    if (v.alert) v.alert.visible = false;
    return true;
  }

  /** « La Sauterelle » (iteration 41) leaps: a puff of dust where it took off, and a ring where it will land. */
  hopShot(id: number, x0: number, y0: number, x1: number, y1: number) {
    const v = this.tanks.get(id);
    if (v) {
      v.leap = { x0, y0, x1, y1 };
      if (!v.leapRing) {
        v.leapRing = new THREE.Mesh(hopRingGeo, hopRingMat.clone());
        v.leapRing.rotation.x = -Math.PI / 2;
        v.leapRing.renderOrder = 2;
        this.scene.add(v.leapRing);
      }
      v.leapRing.position.set(x1, 0.05, y1);
      v.leapRing.visible = true;
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.2;
      this.smoke.emit({ x: x0 + Math.cos(a) * 0.3, y: 0.08, z: y0 + Math.sin(a) * 0.3, vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 0.4, vz: Math.sin(a) * sp, life: 0.6, s0: 0.08, s1: 0.24, c0: 0xd9c4a0, c1: 0xefe4cf, drag: 2.5 });
    }
  }

  /** It lands: a bounce, a ring of dust and a little shake. */
  hopLand(id: number, x: number, y: number) {
    const v = this.tanks.get(id);
    if (v) { v.squash = 1; v.leap = undefined; if (v.leapRing) v.leapRing.visible = false; }
    const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xe8d6b0, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, y);
    this.scene.add(ring);
    this.shocks.push({ mesh: ring, t: 0, max: 0.35, size: 0.9 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.smoke.emit({ x: x + Math.cos(a) * 0.35, y: 0.06, z: y + Math.sin(a) * 0.35, vx: Math.cos(a) * 1.6, vy: 0.25 + Math.random() * 0.3, vz: Math.sin(a) * 1.6, life: 0.55, s0: 0.08, s1: 0.22, c0: 0xd9c4a0, c1: 0xefe4cf, drag: 3 });
    }
    this.shake = Math.max(this.shake, 0.12);
  }

  /** The Grondeur: its cloud bobs and drifts; antenna up (charging), the cloud darkens, the rod ball blazes and sparks fly. */
  private tankThunder(v: TankView, t: RTank, dt: number) {
    const c = v.cloud!, charging = !!((t.fx ?? 0) & FLAG_CHARGING), rage = !!((t.fx ?? 0) & FLAG_RAGE);
    const boom = (c.userData.boom as number | undefined) ?? 0;
    c.position.y = 2.2 + Math.sin(this.time * 1.7 + t.id) * 0.08 + (charging ? 0.15 : 0);
    c.rotation.y = this.time * 0.25; // the cloud does not turn with the hull
    const k = 1 + boom * 0.25 + (charging ? Math.sin(this.time * 24) * 0.04 : 0);
    c.scale.set(k, k, k);
    if (boom > 0) c.userData.boom = Math.max(0, boom - dt * 3);
    const dark = charging ? 1 : rage ? 0.45 : 0;
    const cur = (c.userData.dark as number | undefined) ?? 0;
    const nd = cur + (dark - cur) * Math.min(1, dt * 6);
    c.userData.dark = nd;
    (c.userData.mat as THREE.MeshStandardMaterial).color.setRGB(0.87 - nd * 0.55, 0.89 - nd * 0.53, 0.94 - nd * 0.46);
    v.rodBall!.emissiveIntensity = charging ? 1.6 + Math.sin(this.time * 40) * 0.8 : 0.5 + Math.sin(this.time * 3) * 0.2;
    if ((charging || rage) && Math.random() < (charging ? 40 : 6) * dt) {
      const a = Math.random() * Math.PI * 2;
      this.glow.emit({ x: t.x + Math.cos(a) * 0.35, y: c.position.y - 0.2, z: t.y + Math.sin(a) * 0.35, vx: Math.cos(a) * 0.3, vy: -2.5 - Math.random() * 2, vz: Math.sin(a) * 0.3, life: 0.25, s0: 0.05, s1: 0.01, c0: 0xffffff, c1: 0x7fb2ff, drag: 1 });
    }
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
    if (v.shieldMat) {
      v.shieldGlow = Math.max(0, (v.shieldGlow ?? 0) - dt * 3);
      v.shieldMat.emissiveIntensity = 0.2 + v.shieldGlow * 1.4;
    }
    v.hit = Math.max(0, v.hit - dt * 4);
    let glow = v.hit, col = 0xffffff;
    if (fx & FLAG_CHARGING) {
      glow = Math.max(glow, 0.45 + Math.sin(this.time * 30) * 0.35);
      col = v.wheels ? 0xfff0d0 : v.legs ? 0xb8e840 : v.cloud ? 0x4f8dff : v.hopper ? 0xffc040 : v.magnet ? 0x5fb0ff : v.tube ? 0xffa040 : 0xff5a20;
      if (v.wheels) glow *= 0.4; // the Tortillard whistles (its steam is drawn in tankTrain)
      else if (!v.legs && Math.random() < 60 * dt) {
        // sparks sucked into the hull
        const a = Math.random() * Math.PI * 2, d = 1.4 + Math.random() * 0.6;
        this.glow.emit({ x: t.x + Math.cos(a) * d, y: 0.5, z: t.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 2.2, vz: -Math.sin(a) * d * 2.2, life: 0.4, s0: 0.03, s1: 0.1, c0: v.cloud ? 0xdcebff : 0xffd060, c1: v.cloud ? 0x3f7dff : 0xff4010 });
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

  /** The Aimant (iteration 27): its field glows on the floor while it is on, a ripple runs inward, caught shells circle above. */
  private tankMagnet(m: MagnetView, t: RTank, dt: number) {
    const fx = t.fx ?? 0;
    const on = fx & FLAG_MAGNET ? 1 : 0;
    const held = (fx >> MAGNET_HELD_SHIFT) & 7;
    m.on += (on - m.on) * Math.min(1, dt * 8);
    m.flash = Math.max(0, m.flash - dt * 3);
    const fm = m.field.material as THREE.MeshBasicMaterial, rm = m.ripple.material as THREE.MeshBasicMaterial;
    fm.opacity = m.on * (0.6 + Math.sin(this.time * 5) * 0.15) + m.flash * 0.3;
    const u = (this.time * 0.9 + t.id * 0.37) % 1;
    const rs = MAGNET_R * (1 - u * 0.85);
    m.ripple.scale.set(rs, rs, rs);
    rm.opacity = m.on * 0.55 * Math.sin(u * Math.PI);
    m.field.visible = m.ripple.visible = m.on > 0.02 || m.flash > 0.02;
    m.horseshoe.emissiveIntensity = m.on * (0.25 + Math.sin(this.time * 9) * 0.12) + m.flash;
    m.orbit.rotation.y += dt * (2 + held);
    for (let i = 0; i < m.held.length; i++) m.held[i].visible = i < held;
    m.orbit.position.y = 0.95 + Math.sin(this.time * 3) * 0.05;
    if (on && Math.random() < 22 * dt) {
      // blue sparks drawn in from the edge of the field
      const a = Math.random() * Math.PI * 2, d = MAGNET_R * (0.8 + Math.random() * 0.2);
      this.glow.emit({ x: t.x + Math.cos(a) * d, y: 0.12, z: t.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 1.6, vz: -Math.sin(a) * d * 1.6, life: 0.5, s0: 0.05, s1: 0.015, c0: 0xffffff, c1: 0x5fb0ff, drag: 0.6 });
    }
  }

  /** The Aimant caught a shell: a blue snap where it struck. */
  magnetCatch(id: number, x: number, y: number) {
    const v = this.tanks.get(id);
    if (v?.magnet) v.magnet.flash = 1;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 2.5;
      this.glow.emit({ x, y: 0.45, z: y, vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 2, vz: Math.sin(a) * sp, life: 0.25 + Math.random() * 0.2, s0: 0.07, s1: 0.01, c0: 0xffffff, c1: 0x6fbaff, grav: 4, drag: 1.2 });
    }
  }

  /** The Aimant throws its shells back: a ring of blue light bursts from it. */
  magnetUnload(id: number, x: number, y: number) {
    const v = this.tanks.get(id);
    if (v) { v.recoil = 1; if (v.magnet) v.magnet.flash = 1; }
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2, sp = 4 + Math.random() * 1.5;
      this.glow.emit({ x, y: 0.3, z: y, vx: Math.cos(a) * sp, vy: 0.3, vz: Math.sin(a) * sp, life: 0.35, s0: 0.08, s1: 0.02, c0: 0xffffff, c1: 0x4f9dff, drag: 2 });
    }
    this.shake = Math.max(this.shake, 0.12);
  }

  /** A shell bounced off the Rempart's shield (iteration 22): the brass flares, a fan of sparks flies off. */
  deflect(id: number, x: number, y: number) {
    const v = this.tanks.get(id);
    if (v) { v.shieldGlow = 1; v.recoil = Math.max(v.recoil, 0.5); }
    const t = v ? v.root.position : undefined;
    const out = t ? Math.atan2(y - t.z, x - t.x) : Math.random() * Math.PI * 2;
    for (let i = 0; i < 16; i++) {
      const a = out + (Math.random() - 0.5) * 1.8, sp = 2.5 + Math.random() * 3;
      this.glow.emit({ x, y: 0.45, z: y, vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 2.5, vz: Math.sin(a) * sp, life: 0.22 + Math.random() * 0.2, s0: 0.06, s1: 0.01, c0: 0xffffff, c1: 0xffc040, grav: 8, drag: 1 });
    }
    this.shake = Math.max(this.shake, 0.08);
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
    for (const kind of ['bounce', 'fan', 'heavy', 'ghost', 'remote'] as const) {
      if (!(fx & BONUS_INFO[kind].flag) || Math.random() > 18 * dt) continue;
      const a = this.time * 3 + (kind === 'fan' ? Math.PI : kind === 'heavy' ? Math.PI / 2 : kind === 'ghost' ? -Math.PI / 2 : kind === 'remote' ? Math.PI / 4 : 0);
      this.glow.emit({ x: t.x + Math.cos(a) * 0.5, y: 0.55, z: t.y + Math.sin(a) * 0.5, vy: 0.5, life: 0.45, s0: 0.07, s1: 0.01, c0: 0xffffff, c1: BONUS_INFO[kind].color });
    }
  }

  /**
   * « Gel » (iteration 29): a frozen tank sits in an ice cube that pops up around it, glints, and shatters when the tank is
   * destroyed. The cube lives in the scene, not in the tank, so it shows even an invisible tank (or one hidden in a tunnel).
   */
  private tankIce(v: TankView, t: RTank, dt: number) {
    const frozen = t.alive && !!((t.fx ?? 0) & FLAG_FROZEN) && !v.under && !this.lostInFog(t, v);
    if (frozen && !v.ice) {
      const g = new THREE.Group();
      const cube = new THREE.Mesh(geo.ice, this.cubeMat);
      cube.renderOrder = 3;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo.ice, 30), this.iceEdgeMat);
      g.add(cube, edges);
      g.position.y = 0.36;
      this.scene.add(g);
      v.ice = g;
    }
    if (!v.ice) return;
    if (frozen) {
      if (!v.ice.visible || v.iceT === undefined) {
        v.iceT = 0;
        v.ice.visible = true;
        v.ice.rotation.y = Math.random() * 0.6 - 0.3;
      }
      v.iceT += dt;
      const k = v.scale * Math.min(1, 0.3 + v.iceT * 5) * (1 + Math.sin(this.time * 3 + t.id) * 0.015);
      v.ice.scale.set(k, k, k);
      v.ice.position.x = t.x; v.ice.position.z = t.y;
      if (Math.random() < 5 * dt) this.glow.emit({ x: t.x + (Math.random() - 0.5) * 0.8 * v.scale, y: 0.3 + Math.random() * 0.5, z: t.y + (Math.random() - 0.5) * 0.7 * v.scale, life: 0.35, s0: 0.08, s1: 0.01, c0: 0xffffff, c1: 0x9fdcff });
    } else if (v.ice.visible) {
      v.ice.visible = false;
      v.iceT = undefined;
      if (!t.alive) this.thaw(v.ice.position.x, v.ice.position.z, true); // shattered with its tank
    }
  }

  /** Frost spreading from the one who grabbed the « Gel » crate. */
  frostWave(x: number, y: number) {
    const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.07, y);
    this.scene.add(ring);
    this.shocks.push({ mesh: ring, t: 0, max: 0.7, size: 7 });
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 7;
      this.glow.emit({ x, y: 0.3 + Math.random() * 0.4, z: y, vx: Math.cos(a) * sp, vy: Math.random() * 1.2, vz: Math.sin(a) * sp, life: 0.6 + Math.random() * 0.5, s0: 0.1, s1: 0.02, c0: 0xffffff, c1: 0x8fd0ff, drag: 2.5 });
    }
    this.flashT = Math.max(this.flashT, 0.12);
  }

  /** An ice cube cracks: shards and glitter (more of them when it shatters with its tank). */
  thaw(x: number, y: number, big = false) {
    for (let i = 0; i < (big ? 30 : 16); i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * (big ? 3.5 : 2);
      this.debris.emit({
        x: x + Math.cos(a) * 0.3, y: 0.4, z: y + Math.sin(a) * 0.3, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 3, vz: Math.sin(a) * sp,
        life: 0.7 + Math.random() * 0.5, s0: 0.06 + Math.random() * 0.06, s1: 0.03, c0: 0xeaf8ff, c1: 0x9fd6f5, grav: 10, drag: 0.4,
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.5 + Math.random() * 2;
      this.glow.emit({ x, y: 0.5, z: y, vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 1.5, vz: Math.sin(a) * sp, life: 0.4, s0: 0.07, s1: 0.01, c0: 0xffffff, c1: 0xbfeaff, drag: 2 });
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
      const tint = b.gold ? GOLD : BONUS_INFO[kind].color;
      if (!c) {
        let mat = this.crateMats.get(b.gold ? 'gold' : kind);
        if (!mat) {
          // the golden crate (iteration 37): gilded wood that shines
          mat = b.gold ? new THREE.MeshStandardMaterial({ color: 0xffd45a, emissive: 0x8a5a00, emissiveIntensity: 0.55, metalness: 0.6, roughness: 0.3, map: crateTexture(kind) })
            : new THREE.MeshStandardMaterial({ map: crateTexture(kind), roughness: 0.7 });
          this.crateMats.set(b.gold ? 'gold' : kind, mat);
        }
        const root = new THREE.Group();
        const box = new THREE.Mesh(geo.crate, mat);
        box.castShadow = true;
        if (b.gold) box.scale.setScalar(1.35);
        const halo = new THREE.Mesh(geo.halo, new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.7, depthWrite: false }));
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.02;
        if (b.gold) halo.scale.setScalar(1.6);
        const beam = new THREE.Mesh(geo.beam, new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        beam.position.y = 0.9;
        if (b.gold) beam.scale.set(1.6, 2.2, 1.6);
        root.add(box, halo, beam);
        root.position.set(b.x, 0, b.y);
        this.scene.add(root);
        c = { root, box, halo, beam, born: this.time, x: b.x, y: b.y, kind };
        this.crates.set(b.id, c);
      }
      const far = Math.abs(b.x - c.root.position.x) + Math.abs(b.y - c.root.position.z) > 1; // and so do the crates
      c.root.position.x += (b.x - c.root.position.x) * (far ? 1 : 0.5);
      c.root.position.z += (b.y - c.root.position.z) * (far ? 1 : 0.5);
      c.x = b.x; c.y = b.y;
      const age = this.time - c.born;
      const fall = Math.max(0, 1 - age / 0.45);
      c.box.position.y = 0.36 + Math.sin(this.time * 2.6 + b.id) * 0.05 + fall * fall * 4;
      c.box.rotation.y = this.time * 1.4 + b.id;
      c.box.rotation.x = fall * 1.5;
      const pulse = 0.5 + Math.sin(this.time * 4 + b.id) * 0.2;
      (c.halo.material as THREE.MeshBasicMaterial).opacity = b.blink ? (Math.sin(this.time * 18) > 0 ? 0.7 : 0.1) : pulse;
      (c.beam.material as THREE.MeshBasicMaterial).opacity = (b.blink ? 0.08 : b.gold ? 0.3 : 0.16) * (1 - fall);
      c.box.visible = !b.blink || Math.sin(this.time * 18) > -0.6;
      if (Math.random() < (b.gold ? 0.4 : 0.06)) this.glow.emit({ x: b.x + (Math.random() - 0.5) * (b.gold ? 1 : 0.5), y: 0.2, z: b.y + (Math.random() - 0.5) * (b.gold ? 1 : 0.5), vy: b.gold ? 1.4 : 0.8, life: 0.6, s0: b.gold ? 0.08 : 0.05, s1: 0.01, c0: 0xffffff, c1: tint });
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
        if (b.heavy) m.scale.setScalar(1.75); // « Gros calibre » (iteration 29)
        m.rotation.order = 'YXZ';
        m.userData.mat = m.material;
        this.scene.add(m);
        this.bullets.set(b.id, m);
      }
      // « Passe-muraille » (iteration 52): see-through until it is out the other side of its wall
      if (!!b.ghost !== !!m.userData.ghost) {
        m.userData.ghost = !!b.ghost;
        m.material = b.ghost ? this.ghostMat : m.userData.mat;
        m.renderOrder = b.ghost ? 4 : 0;
      }
      if (b.ghost && Math.random() < 45 * dt) this.glow.emit({ x: b.x, y: 0.45, z: b.y, vy: 0.3, life: 0.45, s0: 0.12, s1: 0.02, c0: 0xffffff, c1: BONUS_INFO.ghost.color });
      m.position.set(b.x, 0.45, b.y);
      m.rotation.y = -Math.atan2(b.vy, b.vx);
      m.rotation.z = Math.PI / 2;
      // trails
      if (b.heavy && Math.random() < 50 * dt) this.glow.emit({ x: b.x, y: 0.45, z: b.y, life: 0.3, s0: 0.14, s1: 0.03, c0: 0xd8c8ff, c1: BONUS_INFO.heavy.color });
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
      if (!g && mn.seed !== undefined) g = this.newSeed(mn);
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
        if (mn.remote) {
          // « Détonateur » (iteration 52): a little antenna with a green light on top, the mine never blinks red by itself
          const ant = new THREE.Mesh(geo.antenna, this.antennaMat);
          ant.position.set(0.09, 0.3, -0.05);
          ant.rotation.z = -0.25;
          const tip = new THREE.Mesh(geo.mineLed, this.remoteOff);
          tip.position.set(0.13, 0.47, -0.05);
          tip.name = 'tip';
          g.add(ant, tip);
          g.userData.remote = true;
        }
        g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
        g.position.set(mn.x, 0, mn.y);
        this.scene.add(g);
        this.mines.set(mn.id, g);
      }
      if (g.userData.seed) { this.syncSeed(g, mn); continue; }
      // mines ride the belts (iteration 16): glide to the new spot, jump when a portal took them
      const far = Math.abs(mn.x - g.position.x) + Math.abs(mn.y - g.position.z) > 1;
      g.position.x += (mn.x - g.position.x) * (far ? 1 : 0.5);
      g.position.z += (mn.y - g.position.z) * (far ? 1 : 0.5);
      // « Les dunes » (iteration 36): laid in the sand, a mine sinks in until only its cap shows; it pops up when its fuse is lit
      // « La neige » (iteration 42): under the snow, the same
      const snowy = this.onSnowR(mn.x, mn.y);
      const buried = !mn.blink && (snowy || this.onSand(mn.x, mn.y));
      const depth = buried ? -0.115 : 0;
      if (buried && !g.userData.buried && g.position.y > -0.01) {
        for (let k = 0; k < 6; k++) this.smoke.emit({ x: mn.x + (Math.random() - 0.5) * 0.3, y: 0.06, z: mn.y + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 1.2, vy: 0.5 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 1.2, life: 0.7, s0: 0.08, s1: 0.22, c0: snowy ? 0xffffff : 0xe2b56a, c1: snowy ? 0xe4eef8 : 0xf1dcae, drag: 2 });
      }
      g.userData.buried = buried;
      g.position.y += (depth - g.position.y) * (buried ? 0.06 : 0.35);
      const led = g.getObjectByName('led') as THREE.Mesh;
      const on = mn.blink ? Math.sin(this.time * 22) > 0 : Math.sin(this.time * 3) > 0.6;
      led.material = on ? this.ledOn : this.ledOff;
      if (g.userData.remote) {
        const tip = g.getObjectByName('tip') as THREE.Mesh;
        tip.material = mn.blink ? (on ? this.ledOn : this.ledOff) : Math.sin(this.time * 4 + mn.id) > 0.3 ? this.remoteOn : this.remoteOff;
        if (!mn.blink) led.material = this.ledOff; // quiet: only its antenna says it is waiting
      }
      if (on && mn.blink && Math.random() < 0.3) this.glow.emit({ x: mn.x, y: 0.2, z: mn.y, life: 0.12, s0: 0.12, s1: 0.02, c0: 0xff3030 });
    }
    for (const [id, g] of this.mines) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        if (g.userData.ring) this.scene.remove(g.userData.ring);
        this.mines.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------- « Le Mortier » (iteration 34)

  private lobs = new Map<number, { ball: THREE.Mesh; shadow: THREE.Mesh; ring: THREE.Mesh; core: THREE.Mesh; puffT: number }>();

  /**
   * The cannonballs in the air: each flies in a high arc toward its target, its shadow growing on the floor, while a
   * red ring tightens on the spot where it will land (the warning everyone can read, sound or not).
   */
  syncLobs(list: RLob[]) {
    const seen = new Set<number>();
    for (const l of list) {
      seen.add(l.id);
      let v = this.lobs.get(l.id);
      if (!v) {
        const ball = new THREE.Mesh(mortarGeo.flight, cannonballMat);
        ball.castShadow = true;
        const shadow = new THREE.Mesh(geo.disc, lobShadowMat.clone());
        shadow.rotation.x = -Math.PI / 2;
        const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xff3a24, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(l.x1, 0.045, l.y1);
        const core = new THREE.Mesh(geo.disc, new THREE.MeshBasicMaterial({ color: 0xff5a30, transparent: true, opacity: 0, depthWrite: false }));
        core.rotation.x = -Math.PI / 2;
        core.position.set(l.x1, 0.04, l.y1);
        core.scale.setScalar(MORTAR_BLAST);
        this.scene.add(ball, shadow, ring, core);
        v = { ball, shadow, ring, core, puffT: 0 };
        this.lobs.set(l.id, v);
      }
      const u = Math.min(1, Math.max(0, l.t / l.dur));
      const d = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
      const peak = 1.6 + d * 0.2;
      const x = l.x0 + (l.x1 - l.x0) * u, z = l.y0 + (l.y1 - l.y0) * u;
      const h = 0.62 * (1 - u) + 4 * peak * u * (1 - u) + 0.17 * u;
      v.ball.position.set(x, h, z);
      v.ball.rotation.x += 0.15;
      v.shadow.position.set(x, 0.03, z);
      v.shadow.scale.setScalar(0.12 + 0.1 * (1 - h / (peak + 0.6)));
      (v.shadow.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.25 * u;
      // the ring closes in on the blast's edge, flickering faster and faster
      const flick = 0.5 + 0.5 * Math.sin(this.time * (8 + u * 36));
      v.ring.scale.setScalar(MORTAR_BLAST * (1 + (1 - u) * 0.9));
      (v.ring.material as THREE.MeshBasicMaterial).opacity = (0.35 + 0.55 * u) * (0.65 + 0.35 * flick);
      (v.core.material as THREE.MeshBasicMaterial).opacity = 0.06 + 0.2 * u * u;
      // a thin trail of smoke behind the ball
      v.puffT -= 1 / 60;
      if (v.puffT <= 0 && u < 0.97) {
        v.puffT = 0.05;
        this.smoke.emit({ x, y: h, z, vy: 0.1, life: 0.5, s0: 0.06, s1: 0.16, c0: 0x9a8f80, c1: 0xd8d0c4, drag: 2 });
      }
    }
    for (const [id, v] of this.lobs) {
      if (seen.has(id)) continue;
      this.scene.remove(v.ball, v.shadow, v.ring, v.core);
      (v.shadow.material as THREE.Material).dispose();
      (v.ring.material as THREE.Material).dispose();
      (v.core.material as THREE.Material).dispose();
      this.lobs.delete(id);
    }
  }

  /** The Mortier fires (iteration 34): its barrel kicks back and a puff of smoke rises from it. */
  lobShot(id: number, x: number, y: number, tx: number, ty: number) {
    const v = this.tanks.get(id);
    if (v) { v.recoil = 1; v.seenT = 1.6; }
    const a = Math.atan2(ty - y, tx - x);
    const mx = x + Math.cos(a) * 0.3, mz = y + Math.sin(a) * 0.3;
    for (let i = 0; i < 12; i++) {
      this.smoke.emit({ x: mx, y: 0.85, z: mz, vx: Math.cos(a) * 0.6 + (Math.random() - 0.5) * 0.6, vy: 1 + Math.random() * 1.2, vz: Math.sin(a) * 0.6 + (Math.random() - 0.5) * 0.6, life: 0.7 + Math.random() * 0.4, s0: 0.08, s1: 0.28, c0: 0xcfc6b8, c1: 0xf2ede6, drag: 2.5 });
    }
    this.glow.emit({ x: mx, y: 0.85, z: mz, life: 0.12, s0: 0.35, s1: 0.1, c0: 0xffd080 });
  }

  /** A cannonball lands: a burst, a shock ring as wide as its reach, splinters and dust. */
  lobLand(x: number, y: number) {
    this.explosion(x, y, false, 0xc9a66b);
    const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, y);
    this.scene.add(ring);
    this.shocks.push({ mesh: ring, t: 0, max: 0.4, size: MORTAR_BLAST * 1.2 });
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
      this.debris.emit({ x, y: 0.2, z: y, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 3, vz: Math.sin(a) * sp, life: 0.9 + Math.random() * 0.5, s0: 0.05, s1: 0.03, c0: Math.random() < 0.5 ? 0xb88a5a : 0x5a4636, c1: 0x3a2a1a, grav: 9, drag: 0.8 });
    }
    this.shake = Math.max(this.shake, 0.3);
  }

  /** Where the Semeur last sowed: its new seeds fly out of there (iteration 25). */
  private sowFrom?: { x: number; y: number; at: number };

  /** A giant seed of the Semeur: a striped wooden seed with a sprout, and a ring on the floor that shows its reach. */
  private newSeed(mn: RMine): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Group();
    const shell = new THREE.Mesh(sowerGeo.seed, seedMat.clone());
    shell.scale.set(1, 0.78, 0.86);
    shell.position.y = 0.24;
    const seam = new THREE.Mesh(sowerGeo.seam, seamMat);
    seam.position.y = 0.24;
    seam.scale.set(1, 0.86, 1);
    const stem = new THREE.Mesh(sowerGeo.stem, leafMat);
    stem.position.y = 0.5;
    const leaf = new THREE.Mesh(sowerGeo.leaf, leafMat);
    leaf.scale.set(0.9, 0.3, 0.45);
    leaf.position.set(0.07, 0.6, 0);
    leaf.rotation.z = 0.4;
    const led = new THREE.Mesh(geo.mineLed, this.ledOff);
    led.position.set(0, 0.47, 0.12);
    led.name = 'led';
    body.add(shell, seam, stem, leaf, led);
    body.traverse((o) => { o.castShadow = true; });
    g.add(body);
    const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(SEED_BLAST);
    ring.position.set(mn.x, 0.035, mn.y);
    this.scene.add(ring);
    const age = mn.seed ?? 0;
    const from = this.sowFrom && this.time - this.sowFrom.at < 0.6 && age < SEED_FLIGHT ? this.sowFrom : undefined;
    g.userData = { seed: true, body, shell: shell.material, ring, born: this.time - age, fx: from?.x ?? mn.x, fy: from?.y ?? mn.y };
    g.position.set(mn.x, 0, mn.y);
    this.scene.add(g);
    this.mines.set(mn.id, g);
    return g;
  }

  private syncSeed(g: THREE.Group, mn: RMine) {
    const ud = g.userData as { body: THREE.Group; shell: THREE.MeshStandardMaterial; ring: THREE.Mesh; born: number; fx: number; fy: number };
    const age = this.time - ud.born;
    const u = Math.min(1, age / SEED_FLIGHT);
    // in the air: an arc from the hopper to where it lands, spinning
    if (u < 1) {
      g.position.set(ud.fx + (mn.x - ud.fx) * u, Math.sin(Math.PI * u) * 1.6, ud.fy + (mn.y - ud.fy) * u);
      ud.body.rotation.z = u * 7;
    } else {
      if (ud.body.rotation.z) {
        ud.body.rotation.z = 0;
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2;
          this.smoke.emit({ x: mn.x, y: 0.1, z: mn.y, vx: Math.cos(a) * 1.4, vy: 0.3, vz: Math.sin(a) * 1.4, life: 0.5, s0: 0.08, s1: 0.2, c0: 0xc9a77a, c1: 0xefe0c4, drag: 3 });
        }
      }
      g.position.x += (mn.x - g.position.x) * 0.5;
      g.position.z += (mn.y - g.position.z) * 0.5;
      g.position.y = 0;
    }
    // it swells as it ripens, glows, then blinks fast before it bursts
    const ripe = Math.min(1, Math.max(0, age - SEED_FLIGHT) / (SEED_RIPEN[0] - SEED_FLIGHT));
    const pulse = mn.blink ? 0.5 + 0.5 * Math.sin(this.time * 24) : 0.5 + 0.5 * Math.sin(this.time * (3 + ripe * 6));
    const sc = 0.9 + ripe * 0.22 + (mn.blink ? pulse * 0.08 : 0);
    ud.body.scale.set(sc, sc * (1 + (mn.blink ? pulse * 0.06 : 0)), sc);
    ud.shell.emissiveIntensity = ripe * 0.25 + (mn.blink ? pulse * 0.9 : 0);
    const ring = ud.ring;
    ring.position.set(g.position.x, 0.035, g.position.z);
    (ring.material as THREE.MeshBasicMaterial).opacity = u < 1 ? 0 : 0.18 + ripe * 0.25 + (mn.blink ? pulse * 0.35 : 0);
    (ring.material as THREE.MeshBasicMaterial).color.setHex(mn.blink ? 0xff4020 : 0xff9a3a);
    const led = g.getObjectByName('led') as THREE.Mesh;
    led.material = (mn.blink ? pulse > 0.5 : pulse > 0.85) ? this.ledOn : this.ledOff;
  }

  /** The Semeur sows (iteration 25): its hopper shakes, a puff of chaff, and the seeds fly out of it. */
  sow(x: number, y: number, id: number) {
    this.sowFrom = { x, y, at: this.time };
    const v = this.tanks.get(id);
    if (v?.hopper) v.hopper.userData.shake = 1;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 2;
      this.debris.emit({ x, y: 1, z: y, vx: Math.cos(a) * s, vy: 2 + Math.random() * 3, vz: Math.sin(a) * s, life: 0.9 + Math.random() * 0.5, s0: 0.05, s1: 0.03, c0: Math.random() < 0.5 ? 0xe8b04a : 0x7fd05a, c1: 0x8a6a2a, grav: 9, drag: 0.6 });
    }
  }

  /** A seed bursts: a wide shock wave, a shower of leaves and chaff. */
  seedBurst(x: number, y: number, r: number) {
    const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, y);
    this.scene.add(ring);
    this.shocks.push({ mesh: ring, t: 0, max: 0.55, size: r * 1.15 });
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3.5;
      this.debris.emit({ x, y: 0.4, z: y, vx: Math.cos(a) * s, vy: 2 + Math.random() * 4, vz: Math.sin(a) * s, life: 1.2 + Math.random() * 0.8, s0: 0.06 + Math.random() * 0.05, s1: 0.03, c0: Math.random() < 0.6 ? 0x6fcf4f : 0xe8b04a, c1: 0x3a5a1a, grav: 6, drag: 1.2 });
    }
    this.shake = Math.max(this.shake, 0.45);
  }

  // ---------------------------------------------------------------- effects

  muzzle(x: number, y: number, ang: number, rocket: boolean, shooterId: number) {
    const v = this.tanks.get(shooterId);
    if (v) { v.recoil = 1; v.seenT = 1.6; }
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

  /** « Détonateur » (iteration 52): its owner presses the button, a ring of radio waves pulses out of the mine. */
  detonate(x: number, y: number) {
    for (const k of [0, 1]) {
      const ring = new THREE.Mesh(geo.shock, new THREE.MeshBasicMaterial({ color: BONUS_INFO.remote.color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.5 + k * 0.15, y);
      this.scene.add(ring);
      this.shocks.push({ mesh: ring, t: 0, max: 0.22 + k * 0.1, size: 0.5 + k * 0.4 });
    }
    for (let i = 0; i < 8; i++) this.glow.emit({ x, y: 0.5, z: y, vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random(), vz: (Math.random() - 0.5) * 1.5, life: 0.25, s0: 0.07, s1: 0.01, c0: 0xffffff, c1: BONUS_INFO.remote.color, grav: 4 });
  }

  /** « Passe-muraille » (iteration 52): a puff of pale wisps where a ghost shell goes into a wall (0), out of it (1) or fades inside (2). */
  ghostPuff(x: number, y: number, phase: number) {
    const n = phase === 1 ? 10 : 14;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * (phase === 2 ? 0.8 : 1.4);
      this.glow.emit({ x, y: 0.5, z: y, vx: Math.cos(a) * sp, vy: 0.6 + Math.random() * 0.8, vz: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.3, s0: 0.12, s1: 0.02, c0: 0xffffff, c1: BONUS_INFO.ghost.color, drag: 2 });
    }
    if (phase !== 1) for (let i = 0; i < 4; i++) this.smoke.emit({ x: x + (Math.random() - 0.5) * 0.2, y: 0.55, z: y + (Math.random() - 0.5) * 0.2, vy: 0.5, life: 0.7, s0: 0.1, s1: 0.28, c0: 0xe8fff8, c1: 0xf6fffc, drag: 2 });
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
    this.snowBlast(x, y, radius); // the blast blows the snow away (iteration 42)
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
    if ((this.canvas.clientWidth || innerWidth) !== this.sizeW || (this.canvas.clientHeight || innerHeight) !== this.sizeH) this.resize();
    this.time += dt;
    this.glow.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    this.animatePortals(dt);
    this.animateTunnels(dt);
    this.animateSnow(dt);
    this.animateWind(dt);
    this.animateFog(dt);
    this.animateFlags(dt);
    this.animateCrown(dt);
    if (this.beltMesh) this.beltTex.offset.x = (this.beltTex.offset.x - dt * BELT_SPEED) % 1;
    if (this.night !== this.nightTarget) this.night = Math.min(this.nightTarget, (performance.now() - this.nightStart) / 1200); // real time, even at a low frame rate
    this.applyNight();
    this.animateStorm(dt);
    this.animateQuakes(dt);
    this.animateRising(dt);
    if (this.gates.size || this.lifts.size || this.switches.length) this.animateGates(dt);
    this.animateFalling(dt);
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
    this.stepSnowLayer(dt);
    if (this.scratchCtx) {
      // the skate scratches fade slowly (a few seconds), as the ice smooths over
      this.scratchFade += dt;
      if (this.scratchFade > 0.5) {
        this.scratchFade = 0;
        const g = this.scratchCtx;
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = 'rgba(0,0,0,0.06)';
        g.fillRect(0, 0, W * SPX, H * SPX);
        g.globalCompositeOperation = 'source-over';
        this.scratchDirty = true;
      }
      this.scratchTimer -= dt;
      if (this.scratchDirty && this.scratchTimer <= 0) { this.scratchTex!.needsUpdate = true; this.scratchDirty = false; this.scratchTimer = 0.1; }
    }
    this.shake *= Math.exp(-dt * 8);
    this.cameraPose(dt);
    this.camera.position.copy(this.posePos);
    const rc = this.replayCam;
    if (rc && rc.k > 0.001) {
      // « Le ralenti » (iteration 32): the camera leans toward the decisive moment and comes closer
      const k = Math.min(1, rc.k);
      this.camLook.set(this.poseLook.x + (rc.x - this.poseLook.x) * k * 0.8, 0, this.poseLook.z + (rc.y - this.poseLook.z) * k * 0.8);
      this.camera.position.subVectors(this.posePos, this.poseLook).multiplyScalar(1 - 0.5 * k).add(this.camLook);
      this.camera.lookAt(this.camLook);
      this.camLeaned = true;
    } else if (this.camLeaned || this.camBlend > 0 || this.camWasMoving) {
      this.camLeaned = false;
      this.camWasMoving = this.camBlend > 0;
      this.camera.lookAt(this.poseLook);
    }
    if (this.shake * this.shakeScale > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * this.shakeScale;
      this.camera.position.z += (Math.random() - 0.5) * this.shake * this.shakeScale;
    }
    this.renderer.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------- « La couronne » (iteration 50)

  private crown?: { group: THREE.Group; cushion: THREE.Group; jewel: THREE.Group; halo: THREE.Mesh; aura: THREE.Mesh; mats: THREE.Material[]; geos: THREE.BufferGeometry[]; hx: number; hy: number; state: number; spin: number; pop: number; tilt: number };

  /** The crown on its red cushion at (x, y) (undefined: no crown on this table). */
  setCrown(home: [number, number] | undefined) {
    if (this.crown) {
      this.scene.remove(this.crown.group);
      for (const m of this.crown.mats) m.dispose();
      for (const g of this.crown.geos) g.dispose();
      this.crown = undefined;
    }
    if (!home) return;
    const [hx, hy] = home;
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc93a, roughness: 0.25, metalness: 0.7, emissive: 0xb07800, emissiveIntensity: 0.9, side: THREE.DoubleSide }); // it glows a little: seen at night too
    const velvet = new THREE.MeshStandardMaterial({ color: 0xc0283a, roughness: 0.95 });
    const ruby = new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.15, metalness: 0.2, emissive: 0x7a0018, emissiveIntensity: 0.6 });
    const sapphire = new THREE.MeshStandardMaterial({ color: 0x3d7bff, roughness: 0.15, metalness: 0.2, emissive: 0x0a2a80, emissiveIntensity: 0.6 });
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffd45a, transparent: true, opacity: 0, depthWrite: false });
    const auraMat = new THREE.MeshBasicMaterial({ color: 0xffd45a, transparent: true, opacity: 0.55, depthWrite: false });
    const geos: THREE.BufferGeometry[] = [
      new THREE.CylinderGeometry(0.17, 0.155, 0.1, 24, 1, true),
      new THREE.ConeGeometry(0.045, 0.13, 8),
      new THREE.SphereGeometry(0.03, 10, 8),
      new THREE.SphereGeometry(0.038, 10, 8),
      new RoundedBoxGeometry(0.72, 0.16, 0.72, 3, 0.07),
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.RingGeometry(0.5, 0.6, 40).rotateX(-Math.PI / 2),
      new THREE.RingGeometry(0.42, 0.56, 40).rotateX(-Math.PI / 2),
      new THREE.TorusGeometry(0.16, 0.018, 6, 24),
    ];
    const [bandG, spikeG, tipG, gemG, padG, tasselG, haloG, auraG, rimG] = geos;
    const jewel = new THREE.Group();
    const band = new THREE.Mesh(bandG, gold);
    band.position.y = 0.05;
    const rim = new THREE.Mesh(rimG, gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.005;
    jewel.add(band, rim);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const sp = new THREE.Mesh(spikeG, gold);
      sp.position.set(Math.cos(a) * 0.15, 0.16, Math.sin(a) * 0.15);
      const tip = new THREE.Mesh(tipG, gold);
      tip.position.set(Math.cos(a) * 0.15, 0.235, Math.sin(a) * 0.15);
      const gem = new THREE.Mesh(gemG, i % 2 ? sapphire : ruby);
      gem.position.set(Math.cos(a + Math.PI / 5) * 0.168, 0.05, Math.sin(a + Math.PI / 5) * 0.168);
      jewel.add(sp, tip, gem);
    }
    jewel.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    const cushion = new THREE.Group();
    const pad = new THREE.Mesh(padG, velvet);
    pad.position.y = 0.09;
    pad.castShadow = pad.receiveShadow = true;
    cushion.add(pad);
    for (const [cx, cz] of [[-0.34, -0.34], [0.34, -0.34], [-0.34, 0.34], [0.34, 0.34]]) {
      const ts = new THREE.Mesh(tasselG, gold);
      ts.position.set(cx, 0.1, cz);
      cushion.add(ts);
    }
    cushion.position.set(hx, 0, hy);
    const halo = new THREE.Mesh(haloG, haloMat);
    halo.position.y = 0.03;
    const aura = new THREE.Mesh(auraG, auraMat);
    aura.position.y = 0.028;
    const group = new THREE.Group();
    group.add(cushion, jewel, halo, aura);
    this.scene.add(group);
    this.crown = { group, cushion, jewel, halo, aura, mats: [gold, velvet, ruby, sapphire, haloMat, auraMat], geos, hx, hy, state: 0, spin: 0, pop: 0, tilt: 0 };
    this.syncCrown({ x: hx, y: hy, holder: 0, state: 0, left: 0 });
  }

  /** Place the crown: on its cushion, on its wearer's turret (as drawn this frame), or dropped on the floor where it fell. */
  syncCrown(c: RCrown | undefined) {
    const v = this.crown;
    if (!v || !c) return;
    if (c.state !== v.state) { v.pop = 1; v.state = c.state; }
    const halo = v.halo.material as THREE.MeshBasicMaterial;
    v.aura.visible = false;
    if (c.state === 1) {
      const t = this.tanks.get(c.holder);
      const shown = !!t && t.root.visible;
      v.jewel.visible = shown;
      halo.opacity = 0;
      if (t && shown) {
        // on its wearer's head, a little above the turret; a golden ring follows it on the floor
        v.jewel.position.set(t.root.position.x, t.root.position.y + 0.62 * t.scale + Math.sin(this.time * 3) * 0.03, t.root.position.z);
        v.jewel.scale.setScalar(1.9 + v.pop * 0.8);
        v.tilt = 0;
        v.aura.visible = true;
        v.aura.position.set(t.root.position.x, 0.028, t.root.position.z);
        v.aura.scale.setScalar(t.scale * (1 + 0.08 * Math.sin(this.time * 4)));
      }
    } else {
      v.jewel.visible = true;
      const home = c.state === 0;
      v.jewel.position.set(c.x, home ? 0.2 + Math.sin(this.time * 2) * 0.03 : 0.03, c.y);
      v.jewel.scale.setScalar(home ? 2 + v.pop * 0.6 : 1.8);
      v.tilt = home ? 0 : 0.5;
      v.halo.position.set(c.x, 0.03, c.y);
      if (c.state === 2) {
        // dropped: a ring that blinks faster as it is about to fly home
        const u = Math.max(0, Math.min(1, c.left / CROWN_RETURN));
        halo.opacity = 0.35 + 0.45 * (Math.sin(this.time * (6 + (1 - u) * 14)) > 0 ? 1 : 0.2);
        v.halo.scale.setScalar(0.7 + u * 0.6);
      } else {
        halo.opacity = 0.25 + 0.15 * Math.sin(this.time * 2.5);
        v.halo.scale.setScalar(1);
      }
    }
  }

  private animateCrown(dt: number) {
    const v = this.crown;
    if (!v) return;
    v.spin += dt * (v.state === 1 ? 1.6 : v.state === 0 ? 0.9 : 0);
    v.pop = Math.max(0, v.pop - dt * 3);
    v.jewel.rotation.set(v.tilt, v.spin, v.tilt * 0.4);
  }

  // -------------------------------------------------------------- « Drapeaux » (iteration 24)

  private ctf?: { group: THREE.Group; flags: FlagView[]; rings: THREE.Mesh[]; mats: THREE.Material[] };
  private flagGeo = {
    pole: new THREE.CylinderGeometry(0.035, 0.04, 1.3, 8),
    knob: new THREE.SphereGeometry(0.065, 12, 8),
    foot: new THREE.CylinderGeometry(0.13, 0.18, 0.08, 16),
    pad: new THREE.CircleGeometry(0.9, 40).rotateX(-Math.PI / 2),
    rim: new THREE.RingGeometry(0.8, 0.92, 48).rotateX(-Math.PI / 2),
    halo: new THREE.RingGeometry(0.42, 0.52, 40).rotateX(-Math.PI / 2),
    teamRing: new THREE.RingGeometry(0.43, 0.53, 32).rotateX(-Math.PI / 2),
  };
  private poleMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 });

  /** The bases of a flag round (undefined: none), and a ring of its team's colour under each tank. */
  setCtf(bases: [number, number][] | undefined, teamOf?: (id: number) => number | undefined) {
    if (this.ctf) {
      this.scene.remove(this.ctf.group);
      for (const r of this.ctf.rings) r.parent?.remove(r);
      for (const f of this.ctf.flags) f.cloth.geometry.dispose();
      for (const m of this.ctf.mats) m.dispose();
      this.ctf = undefined;
    }
    if (!bases) return;
    const group = new THREE.Group();
    const mats: THREE.Material[] = [];
    const flags = bases.slice(0, 2).map(([x, y], i): FlagView => {
      const color = TEAM_COLORS[i];
      const padMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false });
      const rimMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
      const clothMat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.18 });
      const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
      mats.push(padMat, rimMat, clothMat, haloMat);
      const pad = new THREE.Mesh(this.flagGeo.pad, padMat);
      pad.position.set(x, 0.018, y);
      const rim = new THREE.Mesh(this.flagGeo.rim, rimMat);
      rim.position.set(x, 0.02, y);
      const root = new THREE.Group();
      const foot = new THREE.Mesh(this.flagGeo.foot, this.poleMat);
      foot.position.y = 0.04;
      const pole = new THREE.Mesh(this.flagGeo.pole, this.poleMat);
      pole.position.y = 0.65;
      const knob = new THREE.Mesh(this.flagGeo.knob, goldMat);
      knob.position.y = 1.32;
      const clothGeo = new THREE.PlaneGeometry(0.62, 0.4, 10, 2);
      clothGeo.translate(0.31 + 0.03, 1.08, 0);
      const cloth = new THREE.Mesh(clothGeo, clothMat);
      pole.castShadow = cloth.castShadow = true;
      root.add(foot, pole, knob, cloth);
      root.position.set(x, 0, y);
      const halo = new THREE.Mesh(this.flagGeo.halo, haloMat);
      halo.position.y = 0.03;
      root.add(halo);
      group.add(pad, rim, root);
      return { root, cloth, base: Float32Array.from(clothGeo.attributes.position.array as ArrayLike<number>), halo, rim, foot, ang: i === 0 ? 0 : Math.PI, px: x, py: y, carried: false, phase: i * 2.1 };
    });
    const rings: THREE.Mesh[] = [];
    if (teamOf) {
      const ringMats = TEAM_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false }));
      mats.push(...ringMats);
      for (const [id, v] of this.tanks) {
        const team = teamOf(id);
        if (team !== 1 && team !== 2) continue;
        const r = new THREE.Mesh(this.flagGeo.teamRing, ringMats[team - 1]);
        r.position.y = 0.026;
        v.root.add(r);
        rings.push(r);
      }
    }
    this.scene.add(group);
    this.ctf = { group, flags, rings, mats };
  }

  /** Place the flags: at home, on the back of their carrier (as drawn this frame), or dropped where it fell. */
  syncFlags(list: RFlag[]) {
    if (!this.ctf) return;
    this.ctf.flags.forEach((v, i) => {
      const f = list.find((o) => o.team === i + 1);
      v.root.visible = !!f;
      if (!f) return;
      let x = f.x, y = f.y;
      v.carried = false;
      if (f.state === 1) {
        const t = this.tanks.get(f.carrier);
        if (t && t.root.visible) {
          const back = -t.hull.rotation.y + Math.PI;
          x = t.root.position.x + Math.cos(back) * 0.2 * t.scale;
          y = t.root.position.z + Math.sin(back) * 0.2 * t.scale;
          v.carried = true;
        } else v.root.visible = false; // a carrier out of sight (an invisible tank, at night under a tunnel): its flag hides too
      }
      v.root.position.set(x, v.carried ? 0.32 : 0, y);
      v.root.scale.setScalar(v.carried ? 0.72 : 1);
      v.foot.visible = !v.carried;
      const halo = v.halo.material as THREE.MeshBasicMaterial;
      if (f.state === 2) {
        // dropped: a ring that blinks faster as it is about to fly home
        const u = Math.max(0, Math.min(1, f.left / CTF_RETURN));
        halo.opacity = 0.35 + 0.45 * (Math.sin(this.time * (6 + (1 - u) * 14)) > 0 ? 1 : 0.2);
        v.halo.scale.setScalar(0.7 + u * 0.6);
      } else halo.opacity = 0;
      // the base rim glows while its flag is at home
      (v.rim.material as THREE.MeshBasicMaterial).opacity = f.state === 0 ? 0.8 : 0.25 + 0.2 * Math.sin(this.time * 5);
    });
  }

  private animateFlags(dt: number) {
    if (!this.ctf) return;
    for (const v of this.ctf.flags) {
      // the cloth trails behind a moving flag, and drifts in the breeze otherwise
      const dx = v.root.position.x - v.px, dy = v.root.position.z - v.py;
      v.px = v.root.position.x; v.py = v.root.position.z;
      const moving = Math.hypot(dx, dy) > 0.004 && Math.hypot(dx, dy) < 0.5;
      const want = moving ? Math.atan2(dy, -dx) : v.ang + Math.sin(this.time * 0.7 + v.phase) * 0.004;
      let d = want - v.ang;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      v.ang += d * Math.min(1, dt * (moving ? 6 : 1));
      v.root.rotation.y = v.ang;
      const pos = v.cloth.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      const speed = moving ? 13 : 6;
      for (let k = 0; k < a.length; k += 3) {
        const u = (v.base[k] - 0.03) / 0.62; // 0 at the pole, 1 at the tip
        a[k + 2] = Math.sin(this.time * speed - u * 5 + v.phase) * 0.07 * u;
        a[k + 1] = v.base[k + 1] - u * u * 0.04;
      }
      pos.needsUpdate = true;
      v.cloth.geometry.computeVertexNormals();
    }
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

  /** A Pilleur snatches a crate: its sack gulps and grows a little fatter. */
  steal(id: number) {
    const sk = this.tanks.get(id)?.sack;
    if (!sk) return;
    sk.userData.gulp = 1;
    sk.userData.loot = ((sk.userData.loot as number | undefined) ?? 0) + 1;
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
