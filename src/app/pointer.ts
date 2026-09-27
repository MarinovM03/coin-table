import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { store } from '../model/store';
import type { CoinView } from '../scene/coin';
import type { View } from './view';

const slop = (touch: boolean) => (touch ? 14 : 6);

export class Pointer {
  hovered: CoinView | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pointerIn = false;
  private pressed = new Set<number>();
  private down: { id: number; x: number; y: number; t: number; touch: boolean } | null = null;

  constructor(
    private view: View,
    onTap: (id: string) => void,
  ) {
    const dom = view.stage.renderer.domElement;
    const { rig } = view;
    dom.addEventListener('pointermove', (e) => {
      this.pointerIn = true;
      const d = this.down;
      if (d && d.id === e.pointerId) {
        const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
        if (moved > 6 && this.hovered) this.clearHover();
        if (d.touch && moved > slop(true)) rig.holdStill(false);
      }
      this.aim(e);
    });
    dom.addEventListener('pointerleave', () => {
      this.pointerIn = false;
      this.clearHover();
    });
    dom.addEventListener('pointercancel', (e) => {
      this.pressed.delete(e.pointerId);
      this.down = null;
      rig.holdStill(false);
      this.clearHover();
    });
    dom.addEventListener('pointerdown', (e) => {
      if (e.isPrimary) this.pressed.clear();
      this.pressed.add(e.pointerId);
      // A second finger means pinch or pan, never a tap.
      if (this.pressed.size > 1) {
        this.down = null;
        rig.holdStill(false);
        return;
      }
      const touch = e.pointerType !== 'mouse';
      this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), touch };
      if (touch) rig.holdStill(true);
      this.aim(e);
    });
    dom.addEventListener('pointerup', (e) => {
      this.pressed.delete(e.pointerId);
      const d = this.down;
      if (!d || d.id !== e.pointerId) return;
      this.down = null;
      rig.holdStill(false);
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > slop(d.touch) || performance.now() - d.t > (d.touch ? 750 : 600)) return;
      this.aim(e);
      const hit = this.pick() ?? (d.touch ? this.pickNearest(e.clientX, e.clientY, 34) : null);
      if (hit && view.coins.wallet.get(hit.utxo.id) === hit) onTap(hit.utxo.id);
      if (d.touch) this.clearHover();
    });
  }

  update() {
    const { coins, stage, hud } = this.view;
    const dragging = this.down !== null;
    const s = store.get();
    let focusId = s.focusId;
    if (!this.pointerIn || dragging) {
      if (!focusId) return;
    }
    const hit = this.pointerIn && !dragging ? this.pick() : null;
    if (hit !== this.hovered) {
      if (this.hovered) this.hovered.hoverTarget = 0;
      this.hovered = hit;
      if (hit) {
        hit.hoverTarget = 1;
        sfx.tick(1.6);
        if (focusId) {
          focusId = null;
          store.set({ focusId });
        }
      }
      stage.renderer.domElement.style.cursor = hit && coins.wallet.get(hit.utxo.id) === hit ? 'pointer' : '';
    }
    const show = this.hovered ?? (focusId ? (coins.wallet.get(focusId) ?? null) : null);
    if (show && s.mode === 'reality' && !s.uiHidden) {
      const p = show.root.position.clone();
      p.y += show.t + 0.2;
      p.project(stage.camera);
      const x = (p.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
      const mine = coins.wallet.get(show.utxo.id) === show;
      hud.tooltip.show(show.utxo, x, y, s, s.selected.includes(show.utxo.id), mine, !this.hovered);
    } else {
      hud.tooltip.hide();
    }
  }

  clearHover() {
    if (this.hovered) this.hovered.hoverTarget = 0;
    this.hovered = null;
    this.view.stage.renderer.domElement.style.cursor = '';
    this.view.hud.tooltip.hide();
  }

  private aim(e: PointerEvent) {
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  private pick(): CoinView | null {
    const s = store.get();
    if (s.mode !== 'reality' || s.phase === 'sending') return null;
    const { coins, stage } = this.view;
    this.raycaster.setFromCamera(this.ndc, stage.camera);
    const targets: THREE.Object3D[] = [];
    for (const c of coins.wallet.values()) if (!c.moving || c.sel > 0.5) targets.push(c.hit);
    for (const c of coins.tray) targets.push(c.hit);
    const hits = this.raycaster.intersectObjects(targets, false);
    return (hits[0]?.object.userData.coin as CoinView | undefined) ?? null;
  }

  /** Touch fallback: the wallet coin whose on-screen disc is nearest the finger. */
  private pickNearest(x: number, y: number, maxPx: number): CoinView | null {
    const s = store.get();
    if (s.mode !== 'reality' || s.phase === 'sending') return null;
    const cam = this.view.stage.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const toPx = (v: THREE.Vector3): [number, number] => {
      v.project(cam);
      return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h];
    };
    let best: CoinView | null = null;
    let bestD = Infinity;
    for (const c of this.view.coins.wallet.values()) {
      if (c.moving && c.sel < 0.5) continue;
      const p = c.root.position.clone();
      p.y += c.t;
      const [cx, cy] = toPx(p.clone());
      const [ex] = toPx(p.add(new THREE.Vector3(c.r, 0, 0)));
      const d = Math.hypot(x - cx, y - cy) - Math.abs(ex - cx);
      if (d < maxPx && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}
