import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { sats } from '../util/format';
import { clamp, damp, ease, tweens } from '../util/tween';
import { LAYOUT } from './layout';

const CYAN = new THREE.Color('#5fd0ff');

/** The "What people think" view: one balance in a glass tube, like a bank app. */
export class BalanceBar {
  readonly group = new THREE.Group();
  private tube: THREE.Mesh;
  private fill: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private chunk: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private light: THREE.PointLight;
  private tagEl: HTMLDivElement;
  private len = LAYOUT.bar.len;
  private max = 1;
  private shown = 0;
  private shownTarget = 0;
  private value = 0;
  private display = 0;

  constructor(scene: THREE.Scene) {
    const L = this.len;
    this.group.position.set(LAYOUT.bar.x, 0, LAYOUT.bar.z);
    scene.add(this.group);

    const glass = new THREE.MeshPhysicalMaterial({
      color: '#cfeeff',
      metalness: 0,
      roughness: 0.06,
      transparent: true,
      opacity: 0.16,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 2.5,
      depthWrite: false,
    });
    this.tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, L, 12, 48), glass);
    this.tube.rotation.z = Math.PI / 2;
    this.tube.renderOrder = 3;

    const fillGeo = new THREE.CylinderGeometry(0.22, 0.22, 1, 48, 1);
    this.fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(0.95), toneMapped: false }));
    this.fill.rotation.z = Math.PI / 2;

    this.chunk = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(1.3), toneMapped: false, transparent: true }));
    this.chunk.rotation.z = Math.PI / 2;
    this.chunk.visible = false;

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(L + 1.1, 0.08, 0.95),
      new THREE.MeshStandardMaterial({ color: '#0d1117', metalness: 0.6, roughness: 0.35 }),
    );
    plinth.position.y = -0.52;
    plinth.receiveShadow = true;

    const inner = new THREE.Group();
    inner.position.y = 0.6;
    inner.add(this.tube, this.fill);
    this.group.add(inner, plinth, this.chunk);
    this.chunk.userData.parentY = 0.6;

    const tickMat = new THREE.MeshBasicMaterial({ color: '#2b5a73', toneMapped: false });
    for (let i = 0; i <= 20; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, i % 5 === 0 ? 0.3 : 0.14), tickMat);
      t.position.set(-L / 2 + (i / 20) * L, -0.47, 0.25);
      this.group.add(t);
    }

    this.light = new THREE.PointLight('#5fd0ff', 0, 8, 2);
    this.light.position.set(0, 1.2, 0.6);
    this.group.add(this.light);

    this.tagEl = document.createElement('div');
    this.tagEl.className = 'bar-tag';
    this.tagEl.innerHTML = `<span class="k">Balance</span><span class="v">0</span><span class="u">sats</span>`;
    const tag = new CSS2DObject(this.tagEl);
    tag.position.set(0, 1.55, 0);
    this.group.add(tag);

    this.group.visible = false;
  }

  setMax(v: number) {
    this.max = Math.max(1, v);
  }

  setBalance(v: number, instant = false) {
    this.value = v;
    if (instant) this.display = v;
  }

  show(on: boolean) {
    this.shownTarget = on ? 1 : 0;
    this.tagEl.classList.toggle('is-on', on);
  }

  /** Peel `amount` off the end of the bar and send it flying to `to`. */
  async spend(amount: number, to: THREE.Vector3): Promise<void> {
    const L = this.len;
    const before = this.display;
    const f0 = clamp(before / this.max);
    const f1 = clamp((before - amount) / this.max);
    const w = Math.max(0.05, (f0 - f1) * L);
    const startX = -L / 2 + f1 * L + w / 2;
    this.chunk.visible = true;
    this.chunk.scale.set(1, w, 1);
    this.chunk.position.set(startX, 0.6, 0);
    this.chunk.material.opacity = 1;
    this.setBalance(before - amount, true);

    const from = this.chunk.position.clone();
    const local = this.group.worldToLocal(to.clone());
    await tweens.run({
      duration: 1.1,
      ease: ease.inOutCubic,
      update: (t) => {
        this.chunk.position.lerpVectors(from, local, t);
        this.chunk.position.y += Math.sin(Math.PI * t) * 1.6;
        const s = 1 - t * 0.6;
        this.chunk.scale.set(s, w * (1 - t * 0.7), s);
        this.chunk.rotation.x = t * Math.PI * 2;
        this.chunk.material.opacity = 1 - Math.max(0, t - 0.75) * 4;
      },
    });
    this.chunk.visible = false;
    this.chunk.rotation.x = 0;
  }

  update(dt: number) {
    this.shown += (this.shownTarget - this.shown) * damp(5, dt);
    const s = this.shown;
    this.group.visible = s > 0.01;
    if (!this.group.visible) return;
    this.group.position.y = (1 - ease.outCubic(s)) * -1.2;
    this.group.scale.setScalar(0.6 + 0.4 * s);

    this.display += (this.value - this.display) * damp(6, dt);
    const f = clamp(this.display / this.max);
    const w = Math.max(0.0001, f * this.len);
    this.fill.scale.set(1, w, 1);
    this.fill.position.x = -this.len / 2 + w / 2;
    this.light.intensity = 4 * s;

    const v = this.tagEl.querySelector('.v');
    if (v) v.textContent = sats(this.display);
  }
}
