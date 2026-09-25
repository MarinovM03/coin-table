import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Utxo } from '../model/wallet';
import { shortTxid } from '../model/wallet';
import { compact } from '../util/format';
import { clamp, damp, ease } from '../util/tween';
import { coinSize } from './layout';
import { coinFaceTexture, contactShadowTexture, reedTexture } from './textures';

export const GOLD = new THREE.Color('#e7b75f');
export const GOLD_FRESH = new THREE.Color('#f3cf7e');
const HEAT = new THREE.Color('#ff9a3c');
const HILITE = new THREE.Color('#ffbe55');
const SEL_RING = new THREE.Color('#ffd68a');
const HOVER_RING = new THREE.Color('#fff3d6');
const WARN_RING = new THREE.Color('#ff6a5a');
const POP_TIME = 0.34;

let reed: THREE.Texture | null = null;
let blob: THREE.Texture | null = null;
const blobGeo = new THREE.PlaneGeometry(1, 1);
const ringGeo = new THREE.RingGeometry(1.1, 1.24, 72);
const hitGeo = new THREE.CylinderGeometry(1, 1, 1, 24);
const faceGeo = new THREE.CircleGeometry(1, 72);
const hitMat = new THREE.MeshBasicMaterial({ visible: false });

function edgeGeometry(r: number, t: number): THREE.LatheGeometry {
  const b = Math.min(t * 0.28, 0.025);
  const h = t / 2;
  const pts = [
    new THREE.Vector2(r * 0.9, -h + 0.004),
    new THREE.Vector2(r - b, -h),
    new THREE.Vector2(r - b * 0.2, -h + b * 0.5),
    new THREE.Vector2(r, -h + b),
    new THREE.Vector2(r, h - b),
    new THREE.Vector2(r - b * 0.2, h - b * 0.5),
    new THREE.Vector2(r - b, h),
    new THREE.Vector2(r * 0.9, h - 0.004),
  ];
  return new THREE.LatheGeometry(pts, 96);
}

interface Move {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  flips: number;
  ease: (t: number) => number;
  resolve: () => void;
}

export class CoinView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly hit: THREE.Mesh;
  readonly r: number;
  readonly t: number;
  readonly edgeMat: THREE.MeshPhysicalMaterial;
  readonly faceMat: THREE.MeshPhysicalMaterial;
  readonly ring: THREE.Mesh;
  readonly ringMat: THREE.MeshBasicMaterial;
  readonly chip: CSS2DObject;
  readonly chipEl: HTMLDivElement;
  readonly faceTex: THREE.Texture;

  utxo: Utxo;
  /** Where the coin wants to rest when idle. */
  home = new THREE.Vector3();
  hover = 0;
  hoverTarget = 0;
  sel = 0;
  selTarget = 0;
  focus = 0;
  focusTarget = 0;
  glow = 0;
  /** 0 = on the table, 1 = sunk out of sight (myth mode). */
  sink = 0;
  sinkTarget = 0;
  /** 0 = solid coin, 1 = melted away into the transaction (driven by tweens). */
  melt = 0;
  /** Idle "click me" shimmer, 0..1. */
  invite = 0;
  /** Surface height under the coin for its contact shadow (the tray floor sits higher). */
  floorY = 0;
  warn = false;
  unconfirmed = false;
  onLand: ((c: CoinView, speed: number) => void) | null = null;
  readonly shadow: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;
  private pop = 0;
  private chipHover = false;

  private move: Move | null = null;
  private yaw: number;
  private spin = 0;
  private flip = 0;
  private seed = Math.random() * 100;

  constructor(utxo: Utxo, fresh = false) {
    this.utxo = utxo;
    const { r, t } = coinSize(utxo.value);
    this.r = r;
    this.t = t;

    reed ??= reedTexture();
    this.faceTex = coinFaceTexture(utxo.value, `${shortTxid(utxo.txid)}:${utxo.vout}`);
    const color = fresh ? GOLD_FRESH : GOLD;

    this.edgeMat = new THREE.MeshPhysicalMaterial({
      color,
      metalness: 1,
      roughness: 0.34,
      bumpMap: reed,
      bumpScale: 2.2,
      emissive: HEAT,
      emissiveIntensity: 0,
    });
    this.faceMat = new THREE.MeshPhysicalMaterial({
      color,
      metalness: 1,
      roughness: 0.36,
      map: this.faceTex,
      bumpMap: this.faceTex,
      bumpScale: 3.2,
      clearcoat: 0.35,
      clearcoatRoughness: 0.3,
      emissive: HEAT,
      emissiveIntensity: 0,
    });

    const edge = new THREE.Mesh(edgeGeometry(r, t), this.edgeMat);
    edge.castShadow = true;
    edge.receiveShadow = true;

    const top = new THREE.Mesh(faceGeo, this.faceMat);
    top.scale.setScalar(r * 0.905);
    top.rotation.x = -Math.PI / 2;
    top.position.y = t / 2 - 0.004;
    top.castShadow = true;
    top.receiveShadow = true;

    const bottom = new THREE.Mesh(faceGeo, this.faceMat);
    bottom.scale.setScalar(r * 0.905);
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -t / 2 + 0.004;

    this.body.add(edge, top, bottom);
    this.root.add(this.body);

    this.hit = new THREE.Mesh(hitGeo, hitMat);
    this.hit.scale.set(r * 1.08, t + 0.3, r * 1.08);
    this.hit.position.y = t / 2;
    this.hit.userData.coin = this;
    this.root.add(this.hit);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: SEL_RING,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.006;
    this.ring.scale.setScalar(r);
    this.ring.renderOrder = 2;
    this.root.add(this.ring);

    blob ??= contactShadowTexture();
    this.shadowMat = new THREE.MeshBasicMaterial({ map: blob, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.6 });
    this.shadow = new THREE.Mesh(blobGeo, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);

    this.chipEl = document.createElement('div');
    this.chipEl.className = 'coin-chip';
    this.chipEl.innerHTML = `<span class="v">${compact(utxo.value)}</span>`;
    this.chip = new CSS2DObject(this.chipEl);
    this.chip.position.set(0, t + 0.34, -r * 0.2);
    this.body.add(this.chip);

    this.yaw = (Math.random() - 0.5) * 0.5;
    this.body.rotation.y = this.yaw;
  }

  setPosition(p: THREE.Vector3) {
    this.root.position.copy(p);
  }

  moveTo(to: THREE.Vector3, opts: { dur?: number; arc?: number; flips?: number; delay?: number; ease?: (t: number) => number } = {}): Promise<void> {
    this.move?.resolve();
    const from = this.root.position.clone();
    const dist = from.distanceTo(to);
    return new Promise((resolve) => {
      this.move = {
        from,
        to: to.clone(),
        t: -(opts.delay ?? 0),
        dur: opts.dur ?? THREE.MathUtils.clamp(0.35 + dist * 0.09, 0.4, 0.9),
        arc: opts.arc ?? Math.min(1.4, 0.25 + dist * 0.16),
        flips: opts.flips ?? 0,
        ease: opts.ease ?? ease.inOutCubic,
        resolve,
      };
    });
  }

  get moving(): boolean {
    return this.move !== null;
  }

  /** Brief scale pop. */
  bump() {
    this.pop = POP_TIME;
  }

  update(dt: number, time: number) {
    const m = this.move;
    if (m) {
      m.t += dt;
      if (m.t >= 0) {
        const k = clamp(m.t / m.dur);
        const e = m.ease(k);
        this.root.position.lerpVectors(m.from, m.to, e);
        this.root.position.y += Math.sin(Math.PI * e) * m.arc;
        this.flip = e * m.flips * Math.PI * 2;
        this.spin = Math.sin(Math.PI * k) * 0.35;
        if (k >= 1) {
          this.move = null;
          this.flip = 0;
          this.spin = 0;
          this.onLand?.(this, m.arc);
          m.resolve();
        }
      }
    }

    this.hover += (this.hoverTarget - this.hover) * damp(16, dt);
    this.sel += (this.selTarget - this.sel) * damp(10, dt);
    this.focus += (this.focusTarget - this.focus) * damp(12, dt);
    this.sink += (this.sinkTarget - this.sink) * damp(5.5, dt);
    this.pop = Math.max(0, this.pop - dt);

    const hl = Math.max(this.hover, this.focus);
    const lift = hl * 0.24 + this.sel * 0.05 + this.invite * 0.06;
    const bob = hl > 0.05 ? Math.sin(time * 3 + this.seed) * 0.014 * hl : 0;
    this.body.position.y = this.t / 2 + lift + bob - this.sink * 0.5;
    this.body.rotation.set(
      this.flip + Math.sin(time * 2 + this.seed) * 0.03 * hl + this.spin * 0.4,
      this.yaw + hl * 0.14 + this.spin,
      hl * 0.06,
    );
    const popK = this.pop > 0 ? Math.sin((1 - this.pop / POP_TIME) * Math.PI) * 0.13 : 0;
    const s = (1 - this.sink * 0.65) * (1 - this.melt * 0.97) * (1 + hl * 0.07 + popK);
    this.body.scale.setScalar(s);

    // Red ring: the coin costs more in fees to spend than it's worth.
    const pulse = this.unconfirmed ? 0.35 + Math.sin(time * 4) * 0.2 : 0;
    const ringA = Math.max(this.sel * 0.9, hl * 0.95, this.invite * 0.6, pulse);
    this.ringMat.opacity = ringA * (1 - this.sink) * (1 - this.melt);
    if (this.warn && this.sel < 0.5) this.ringMat.color.copy(WARN_RING);
    else this.ringMat.color.copy(SEL_RING).lerp(HOVER_RING, hl);
    this.ring.scale.setScalar(this.r * (1 + hl * 0.1 + popK * 0.5 + Math.sin(time * 2.4) * 0.012 * this.sel));

    const heat = this.glow;
    if (heat > 0.01) {
      this.edgeMat.emissive.copy(HEAT);
      this.faceMat.emissive.copy(HEAT);
      this.edgeMat.emissiveIntensity = heat * 2.2;
      this.faceMat.emissiveIntensity = heat * 1.6;
    } else {
      const hi = hl * 0.3 + this.sel * 0.1 + this.invite * 0.28;
      this.edgeMat.emissive.copy(HILITE);
      this.faceMat.emissive.copy(HILITE);
      this.edgeMat.emissiveIntensity = hi * 0.8;
      this.faceMat.emissiveIntensity = hi * 0.5;
    }

    // Keep the shadow on the surface while the coin rises above it.
    const height = Math.max(0, this.root.position.y - this.floorY) + lift;
    this.shadow.position.y = this.floorY - this.root.position.y + 0.004;
    this.shadow.scale.setScalar(this.r * 2.55 * (1 + height * 0.35));
    this.shadowMat.opacity = (0.62 / (1 + height * 3)) * (1 - this.sink) * (1 - this.melt);

    const chipHover = hl > 0.5;
    if (chipHover !== this.chipHover) {
      this.chipHover = chipHover;
      this.chipEl.classList.toggle('is-hover', chipHover);
    }

    const hidden = this.sink > 0.97 || this.melt > 0.99;
    this.body.visible = !hidden;
    this.chip.visible = !hidden && this.sink < 0.3 && this.melt < 0.2;
  }

  setChip(state: { selected: boolean; warn: boolean; fresh: boolean; unconfirmed: boolean }) {
    const cl = this.chipEl.classList;
    cl.toggle('is-selected', state.selected);
    cl.toggle('is-warn', state.warn);
    cl.toggle('is-fresh', state.fresh);
    cl.toggle('is-pending', state.unconfirmed);
  }

  dispose() {
    this.move?.resolve();
    this.root.removeFromParent();
    this.chipEl.remove();
    this.faceTex.dispose();
    this.edgeMat.dispose();
    this.faceMat.dispose();
    this.ringMat.dispose();
    this.shadowMat.dispose();
    (this.body.children[0] as THREE.Mesh).geometry.dispose();
  }
}
