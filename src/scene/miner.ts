import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { html, setHtml } from '../util/html';
import { LAYOUT } from './layout';

export class Miner {
  readonly group = new THREE.Group();
  readonly anchor = new THREE.Vector3(LAYOUT.miner.x, LAYOUT.miner.y, LAYOUT.miner.z);
  readonly label: CSS2DObject;
  readonly labelEl: HTMLDivElement;
  private head: THREE.Group;
  private coreMat: THREE.MeshStandardMaterial;
  private edgeMat: THREE.LineBasicMaterial;
  private light: THREE.PointLight;
  private energy = 0;
  private pulseT = 0;
  private fees = 0;

  constructor() {
    const M = LAYOUT.miner;
    this.group.position.set(M.x, M.y, M.z);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(box);
    this.edgeMat = new THREE.LineBasicMaterial({ color: '#ffcf7a', transparent: true, opacity: 0.85, toneMapped: false });
    this.coreMat = new THREE.MeshStandardMaterial({
      color: '#1a1408',
      emissive: '#ff9f3a',
      emissiveIntensity: 0.25,
      roughness: 0.4,
      metalness: 0.2,
      transparent: true,
      opacity: 0.85,
    });

    this.head = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.72), this.coreMat);
    this.head.add(core, new THREE.LineSegments(edges, this.edgeMat));
    this.head.scale.setScalar(1.05);
    this.group.add(this.head);

    const chainMat = new THREE.LineBasicMaterial({ color: '#a8804a', transparent: true, opacity: 0.35 });
    const linkMat = new THREE.LineBasicMaterial({ color: '#a8804a', transparent: true, opacity: 0.25 });
    const prev = new THREE.Vector3();
    for (let i = 1; i <= 5; i++) {
      const b = new THREE.LineSegments(edges, chainMat.clone());
      (b.material as THREE.LineBasicMaterial).opacity = 0.34 - i * 0.05;
      b.position.set(-i * 1.9, i * 0.05, -i * 1.1);
      b.scale.setScalar(0.9);
      b.rotation.y = i * 0.15;
      this.group.add(b);
      const link = new THREE.BufferGeometry().setFromPoints([prev.clone(), b.position.clone()]);
      this.group.add(new THREE.Line(link, linkMat));
      prev.copy(b.position);
    }

    this.light = new THREE.PointLight('#ffa64d', 0, 9, 2);
    this.group.add(this.light);

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'world-tag world-tag--miner';
    setHtml(this.labelEl, html`<b>Miner</b><span>collects the fee for putting your transaction in a block</span><em class="fees"></em>`);
    this.label = new CSS2DObject(this.labelEl);
    this.label.position.set(0, -1.05, 0);
    this.group.add(this.label);
  }

  absorb(amount: number) {
    this.fees += amount;
    this.energy = Math.min(1.6, this.energy + 0.35);
    const el = this.labelEl.querySelector('.fees');
    if (el) el.textContent = `+${amount.toLocaleString('en-US')} sats in fees`;
    this.labelEl.classList.add('is-hot');
  }

  /** Draw the eye without adding fees (used by the glossary). */
  nudge(text: string) {
    this.energy = Math.min(1.6, this.energy + 0.5);
    const el = this.labelEl.querySelector('.fees');
    if (el) el.textContent = text;
    this.labelEl.classList.add('is-hot');
  }

  pulse() {
    this.pulseT = 1;
    this.labelEl.classList.remove('is-hot');
  }

  get totalFees() {
    return this.fees;
  }

  update(dt: number, time: number) {
    this.energy = Math.max(0, this.energy - dt * 0.25);
    this.pulseT = Math.max(0, this.pulseT - dt * 1.2);
    const e = 0.25 + this.energy * 1.4 + this.pulseT * 5;
    this.coreMat.emissiveIntensity = e;
    this.edgeMat.opacity = 0.6 + this.energy * 0.3 + this.pulseT * 0.4;
    this.light.intensity = this.energy * 10 + this.pulseT * 40;
    this.head.rotation.y += dt * (0.25 + this.energy * 1.5);
    this.head.rotation.x = Math.sin(time * 0.4) * 0.18;
    this.head.position.y = Math.sin(time * 0.9) * 0.08;
    const s = 1.05 + this.pulseT * 0.35;
    this.head.scale.setScalar(s);
  }
}
