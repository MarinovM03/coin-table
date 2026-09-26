import type * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { store } from '../model/store';
import type { Coins } from '../scene/coins';
import { LAYOUT } from '../scene/layout';
import { COARSE } from '../ui/dom';
import { html, setHtml } from '../util/html';
import { damp } from '../util/tween';

export class Invite {
  private callout: CSS2DObject;
  private calloutOn = false;
  private hasPicked = false;

  constructor(
    scene: THREE.Scene,
    private coins: Coins,
  ) {
    const el = document.createElement('div');
    el.className = 'callout';
    setHtml(el, html`<span class="callout-arrow" aria-hidden="true"></span><span class="callout-body"><b>${COARSE ? 'Tap' : 'Click'} coins</b><small>No single coin covers this bill.<br />Combine whole ones.</small></span>`);
    this.callout = new CSS2DObject(el);
    this.callout.center.set(0, 0.5);
    this.callout.position.set(LAYOUT.wallet.x + LAYOUT.wallet.r + 0.25, 0.35, LAYOUT.wallet.z + 0.25);
    scene.add(this.callout);
  }

  update(dt: number, t: number, idleFor: number) {
    const s = store.get();
    if (s.selected.length) this.hasPicked = true;
    const ready = s.mode === 'reality' && s.phase === 'select' && s.selected.length === 0 && t > 1.3;
    const on = ready && (!this.hasPicked || idleFor > 9);
    this.coins.leftToRight.forEach((c, i) => {
      const wave = on ? Math.max(0, Math.sin(t * 2.3 - i * 0.55)) ** 10 : 0;
      c.invite += (wave - c.invite) * damp(14, dt);
    });
    const show = ready && !this.hasPicked && !s.uiHidden && !s.howOpen;
    if (show !== this.calloutOn) {
      this.calloutOn = show;
      this.callout.element.classList.toggle('is-on', show);
    }
  }
}
