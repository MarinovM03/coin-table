import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { store, type State } from '../model/store';
import { walletTotal } from '../model/wallet';
import { BalanceBar } from '../scene/balanceBar';
import { CameraRig } from '../scene/cameraRig';
import type { CoinView } from '../scene/coin';
import { Coins } from '../scene/coins';
import { Fx } from '../scene/fx';
import { Stage } from '../scene/stage';
import { World } from '../scene/world';
import { Hud } from '../ui/hud';
import { clamp, damp, tweens } from '../util/tween';
import { Controller } from './controller';
import { Invite } from './invite';
import { bindKeyboard } from './keyboard';
import { Payments } from './payments';
import { Pointer } from './pointer';
import type { View } from './view';

const WARM = new THREE.Color('#ffe0b5');
const COOL = new THREE.Color('#cfe6ff');
const IDLE_AFTER = 20;

const sizeNorm = (c: CoinView) => clamp((c.r - 0.36) / 0.34);

export class App {
  private stage: Stage;
  private rig: CameraRig;
  private world: World;
  private fx: Fx;
  private bar: BalanceBar;
  private coins: Coins;
  private hud: Hud;
  private pointer: Pointer;
  private payments: Payments;
  private controller: Controller;
  private invite: Invite;

  private time = 0;
  private last = performance.now();
  private lastInput = 0;
  private mood = 0;
  private moodTarget = 0;

  constructor(host: HTMLElement) {
    this.stage = new Stage(host);
    this.rig = new CameraRig(this.stage.camera, this.stage.renderer.domElement, () => this.stage.baseFov);
    this.world = new World(this.stage.scene);
    this.fx = new Fx(this.stage.scene);
    this.bar = new BalanceBar(this.stage.scene);
    this.coins = new Coins(this.stage.scene, (c, arc) => this.landed(c, arc));
    this.hud = new Hud({
      setMode: (m) => this.controller.setMode(m),
      send: () => this.controller.send(),
      pick: () => this.controller.pickForMe(),
      clear: () => this.controller.clearSelection(),
      setFee: (r) => this.controller.setFee(r),
      toggleHow: () => this.controller.toggleHow(),
      toggleSound: () => this.controller.toggleMute(),
      toggleHide: () => this.controller.toggleHide(),
      nextCamera: () => this.rig.nextShot(),
      toggleInput: (id) => this.controller.toggle(id),
      highlightTerm: (t) => this.controller.highlightTerm(t),
    });
    const view: View = { stage: this.stage, rig: this.rig, world: this.world, fx: this.fx, bar: this.bar, coins: this.coins, hud: this.hud };
    this.pointer = new Pointer(view, (id) => this.controller.toggle(id));
    this.payments = new Payments(view, this.pointer);
    this.controller = new Controller(view, this.payments, this.pointer);

    this.rig.onShot = (shot, i, n) => this.hud.camBadge(shot ? `${i + 1}/${n} · ${shot.name}` : null);

    let gpuTimer = 0;
    this.stage.onContextLost = () => {
      this.hud.gpuLost(true);
      // Browsers don't always hand the context back; offer a reload if it stays gone.
      gpuTimer = window.setTimeout(() => this.hud.gpuStuck(), 4000);
    };
    this.stage.onContextRestored = () => {
      window.clearTimeout(gpuTimer);
      this.hud.gpuLost(false);
    };

    this.controller.restoreMute();
    this.invite = new Invite(this.stage.scene, this.coins);

    store.subscribe((s, prev) => this.onState(s, prev));
    this.trackActivity();
    bindKeyboard(view, this.controller);
    window.addEventListener('resize', () => this.rig.onResize());
  }

  start() {
    const s = store.get();
    this.bar.reset(walletTotal(s.utxos));
    this.syncTable(s, true);
    this.hud.render(s);
    this.stage.trimForLite();
    this.warmup();
    this.rig.intro();
    document.getElementById('veil')?.classList.add('is-off');
    let tick = 0;
    const loop = () => {
      requestAnimationFrame(loop);
      const idle = this.isIdle();
      if (idle && ++tick % 3 !== 0) return;
      this.frame(undefined, true, idle);
    };
    loop();
  }

  refreshTextures() {
    this.coins.redrawFaces();
    this.world.refreshTable();
  }

  /** Dev/testing aid: advance the simulation without requestAnimationFrame. */
  async step(seconds: number, fps = 60) {
    const n = Math.ceil(seconds * fps);
    for (let i = 0; i < n; i++) {
      this.frame(1 / fps, i === n - 1);
      // Let awaited beats continue between frames, like they would under rAF.
      await new Promise((r) => setTimeout(r, 0));
    }
    this.last = performance.now();
  }

  private isIdle(): boolean {
    if (this.time - this.lastInput < IDLE_AFTER || tweens.busy || this.rig.busy) return false;
    if (store.get().phase === 'sending' || this.coins.inFlight.size) return false;
    for (const c of this.coins.wallet.values()) if (c.moving) return false;
    return true;
  }

  /**
   * Compile every shader up front (hidden things included) so the first spend
   * or mode switch doesn't stutter while the GPU builds programs.
   */
  private warmup() {
    const st = this.stage;
    this.bar.group.visible = true;
    this.fx.warm();
    st.renderer.compile(st.scene, st.camera);
    this.bar.group.visible = false;
  }

  private trackActivity() {
    const unlock = () => {
      sfx.unlock();
      this.lastInput = this.time;
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    // A touch only counts as the gesture that may start audio once the finger lifts.
    window.addEventListener('pointerup', unlock, { capture: true });
    window.addEventListener('touchend', unlock, { capture: true, passive: true });
    window.addEventListener(
      'pointermove',
      () => {
        this.lastInput = this.time;
      },
      { passive: true },
    );
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => sfx.setHidden(document.hidden));
  }

  private onState(s: State, prev: State) {
    if (s.mode !== prev.mode) this.applyMode(s, prev);
    if (s.muted !== prev.muted) sfx.setMuted(s.muted);
    this.syncTable(s);
    this.hud.render(s);
  }

  private syncTable(s: State, intro = false) {
    if (s.phase === 'sending') return;
    this.coins.sync(s, intro);
    const reality = s.mode === 'reality';
    this.world.inputsGlow.target = reality && s.selected.length ? 0.9 : 0;
    this.world.walletGlow.target = reality && s.phase === 'select' && s.selected.length === 0 ? 0.45 : 0.08;
  }

  private applyMode(s: State, prev: State) {
    const myth = s.mode === 'myth';
    sfx.shift(!myth);
    this.moodTarget = myth ? 1 : 0;
    this.pointer.clearHover();
    this.bar.setBalance(walletTotal(s.utxos), prev.mode !== 'myth');
    this.bar.show(myth);
    this.coins.sinkAll(myth);
    if (!myth && s.pendingReveal.length) this.payments.revealPending();
  }

  private landed(c: CoinView, arc: number) {
    sfx.clink(sizeNorm(c), clamp(0.45 + arc * 0.4, 0.3, 1));
    if (c.sink < 0.5) this.fx.shock(c.root.position, '#ffcf7a', c.r * 1.6, 0.5);
  }

  private frame(fixedDt?: number, draw = true, throttled = false) {
    const now = performance.now();
    const real = (now - this.last) / 1000;
    const dt = fixedDt ?? Math.min(0.1, real);
    this.last = now;
    // Throttled frames are slow on purpose; they say nothing about the GPU.
    if (fixedDt === undefined && !throttled) this.stage.adapt(real);
    this.time += dt;
    const t = this.time;

    tweens.tick(dt);
    this.rig.update(dt);
    this.pointer.update();

    this.invite.update(dt, t, t - this.lastInput);
    this.coins.dropExpiredBadges(store.get(), now);
    this.coins.update(dt, t);
    this.world.update(dt, t);
    this.fx.update(dt, t);
    this.bar.update(dt);
    this.hud.update(dt);

    this.mood += (this.moodTarget - this.mood) * damp(3, dt);
    this.stage.key.color.copy(WARM).lerp(COOL, this.mood);
    this.stage.key.intensity = 440 - this.mood * 110;
    this.stage.bloom.strength = 0.55 - this.mood * 0.1;

    if (draw) this.stage.render(t);
  }
}
