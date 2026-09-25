import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { sfx } from './audio/sfx';
import { fakeTxid, inputCost, pickCoins, planTx, type TxPlan } from './model/bitcoin';
import { FEE_MAX, FEE_MIN, currentPlan, invoiceOf, selectedCoins, store, type Mode, type State, type TxRecord } from './model/store';
import { nextId, walletTotal, type Invoice, type Utxo } from './model/wallet';
import { BalanceBar } from './scene/balanceBar';
import { CameraRig } from './scene/cameraRig';
import { CoinView } from './scene/coin';
import { Fx } from './scene/fx';
import { LAYOUT, coinSize, findWalletSpot, inputSlots, traySpot, type Disc } from './scene/layout';
import { Stage } from './scene/stage';
import { World } from './scene/world';
import { COARSE, Hud } from './ui/hud';
import { plural, sats } from './util/format';
import { clamp, damp, ease, tweens } from './util/tween';

const WARM = new THREE.Color('#ffe0b5');
const COOL = new THREE.Color('#cfe6ff');
const MUTE_KEY = 'coin-table:muted';

const sizeNorm = (c: CoinView) => clamp((c.r - 0.36) / 0.34);

function splitEquation(plan: TxPlan): string {
  const term = (cls: string, v: number, label: string) => `<span class="t ${cls}"><b>${sats(v)}</b><i>${label}</i></span>`;
  const parts = [
    term('in', plan.inputsTotal, 'in'),
    '<span class="op">=</span>',
    term('pay', plan.payment, 'payment'),
    '<span class="op">+</span>',
    term('fee', plan.fee, plan.dustToFee > 0 ? `fee · incl. ${sats(plan.dustToFee)} dust` : 'fee'),
  ];
  if (plan.hasChange) parts.push('<span class="op">+</span>', term('change', plan.change, 'change'));
  return `<div class="eq">${parts.join('')}</div>`;
}

export class App {
  private stage: Stage;
  private rig: CameraRig;
  private world: World;
  private fx: Fx;
  private bar: BalanceBar;
  private hud: Hud;

  /** Wallet coins, keyed by UTXO id. */
  private coins = new Map<string, CoinView>();
  /** Coins that now belong to the people we paid. */
  private tray: CoinView[] = [];
  /** Freshly minted outputs mid-flight, not yet committed to the wallet or tray. */
  private inFlight = new Set<CoinView>();
  /** Where spent coins used to sit, for the myth → reality reveal. */
  private ghosts: Array<Disc & { value: number }> = [];

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pointerIn = false;
  private down: { x: number; y: number; t: number } | null = null;
  private hovered: CoinView | null = null;
  private focusId: string | null = null;
  /** Until the first coin is picked, the pile shimmers and a callout points at it. */
  private hasPicked = false;
  private lastInput = 0;
  private inviteOrder: CoinView[] = [];
  private callout: CSS2DObject;
  private calloutOn = false;

  private time = 0;
  private last = performance.now();
  private mood = 0;
  private moodTarget = 0;
  /** Bumps on wallet reset so stale async beats can bail out. */
  private epoch = 0;
  private startMax = 1;

  constructor(host: HTMLElement) {
    this.stage = new Stage(host);
    this.rig = new CameraRig(this.stage.camera, this.stage.renderer.domElement, () => this.stage.baseFov);
    this.world = new World(this.stage.scene);
    this.fx = new Fx(this.stage.scene);
    this.bar = new BalanceBar(this.stage.scene);

    this.hud = new Hud({
      setMode: (m) => this.setMode(m),
      send: () => this.send(),
      next: () => this.nextBill(),
      pick: () => this.pickForMe(),
      clear: () => this.clearSelection(),
      setFee: (r) => this.setFee(r),
      toggleHow: () => store.set({ howOpen: !store.get().howOpen }),
      toggleSound: () => this.toggleMute(),
      toggleHide: () => store.set({ uiHidden: !store.get().uiHidden }),
      nextCamera: () => this.rig.nextShot(),
      removeInput: (id) => this.toggle(id),
      highlightTerm: (t) => this.highlightTerm(t),
    });

    this.rig.onShot = (shot, i, n) => this.hud.camBadge(shot ? `${i + 1}/${n} · ${shot.name}` : null);

    let muted = false;
    try {
      muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage unavailable: default to sound on */
    }
    sfx.setMuted(muted);
    store.set({ muted });

    const el = document.createElement('div');
    el.className = 'callout';
    el.innerHTML = `<span class="callout-arrow" aria-hidden="true"></span><span class="callout-body"><b>${COARSE ? 'Tap' : 'Click'} coins</b><small>No single coin covers this bill.<br />Combine whole ones.</small></span>`;
    this.callout = new CSS2DObject(el);
    this.callout.center.set(0, 0.5);
    this.callout.position.set(LAYOUT.wallet.x + LAYOUT.wallet.r + 0.25, 0.35, LAYOUT.wallet.z + 0.25);
    this.stage.scene.add(this.callout);

    store.subscribe((s, prev) => this.onState(s, prev));
    this.bindInput();
  }

  start() {
    const s = store.get();
    this.startMax = walletTotal(s.utxos);
    this.bar.setMax(this.startMax);
    this.bar.setBalance(this.startMax, true);
    this.sync(s, true);
    this.hud.render(s);
    this.warmup();
    this.rig.intro();
    document.getElementById('veil')?.classList.add('is-off');
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    loop();
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

  private onState(s: State, prev: State) {
    if (s.mode !== prev.mode) this.applyMode(s, prev);
    if (s.muted !== prev.muted) sfx.setMuted(s.muted);
    this.sync(s);
    this.hud.render(s);
  }

  /** Make the coins on the table match the wallet (outside of choreographed beats). */
  private sync(s: State, intro = false) {
    if (s.phase === 'sending') return;
    const ids = new Set(s.utxos.map((u) => u.id));
    for (const [id, v] of this.coins) {
      if (!ids.has(id)) {
        v.dispose();
        this.coins.delete(id);
      }
    }
    let n = 0;
    for (const u of s.utxos) {
      const v = this.coins.get(u.id);
      if (v) v.utxo = u;
      else this.spawnWalletCoin(u, intro ? 0.35 + n++ * 0.085 : n++ * 0.06);
    }
    this.layout(s);
  }

  private takenDiscs(except?: CoinView): Disc[] {
    const out: Disc[] = [];
    for (const c of this.coins.values()) if (c !== except) out.push({ x: c.home.x, z: c.home.z, r: c.r });
    return out;
  }

  private spawnWalletCoin(u: Utxo, delay: number): CoinView {
    const v = new CoinView(u, u.origin !== 'seed');
    const { r } = coinSize(u.value);
    const spot = findWalletSpot(r, this.takenDiscs(), this.coins.size * 0.7);
    v.home.set(spot.x, 0, spot.z);
    v.setPosition(new THREE.Vector3(spot.x, 3.2 + Math.random() * 1.2, spot.z));
    v.moveTo(v.home, { dur: 0.55, arc: 0, delay, ease: ease.inCubic });
    v.onLand = (c, arc) => this.landed(c, arc);
    v.sinkTarget = v.sink = store.get().mode === 'myth' ? 1 : 0;
    this.coins.set(u.id, v);
    this.stage.scene.add(v.root);
    return v;
  }

  private landed(c: CoinView, arc: number) {
    sfx.clink(sizeNorm(c), clamp(0.45 + arc * 0.4, 0.3, 1));
    if (c.sink < 0.5) this.fx.shock(c.root.position, '#ffcf7a', c.r * 1.6, 0.5);
  }

  private layout(s: State) {
    const sel = s.selected;
    const selViews = sel.map((id) => this.coins.get(id)).filter((v): v is CoinView => !!v);
    const slots = inputSlots(selViews.map((v) => v.r));
    const now = performance.now();
    const cost = inputCost(s.feeRate);

    for (const v of this.coins.values()) {
      const i = sel.indexOf(v.utxo.id);
      const target = i >= 0 ? new THREE.Vector3(slots[i].x, 0, slots[i].z) : v.home;
      const dest = (v.root.userData.dest as THREE.Vector3 | undefined) ?? v.home;
      if (dest.distanceToSquared(target) > 1e-6 && v.root.position.distanceToSquared(target) > 1e-5) {
        v.moveTo(target, { arc: i >= 0 ? 0.9 : 0.7 });
      }
      v.root.userData.dest = target.clone();
      const selTarget = i >= 0 ? 1 : 0;
      if (selTarget !== v.selTarget) v.bump();
      v.selTarget = selTarget;
      v.warn = v.utxo.value <= cost;
      v.unconfirmed = !v.utxo.confirmed;
      v.focusTarget = this.focusId === v.utxo.id ? 1 : 0;
      v.setChip({
        selected: i >= 0,
        warn: v.warn,
        fresh: v.utxo.origin === 'change' && now - v.utxo.bornAt < 25_000,
        unconfirmed: !v.utxo.confirmed,
      });
    }
    for (const t of this.tray) t.unconfirmed = !t.utxo.confirmed;
    this.inviteOrder = [...this.coins.values()].sort((a, b) => a.home.x - b.home.x || a.home.z - b.home.z);

    const reality = s.mode === 'reality';
    this.world.inputsGlow.target = reality && sel.length ? 0.9 : 0;
    this.world.walletGlow.target = reality && s.phase === 'select' && sel.length === 0 ? 0.45 : 0.08;
  }

  private applyMode(s: State, prev: State) {
    const myth = s.mode === 'myth';
    sfx.shift(!myth);
    this.moodTarget = myth ? 1 : 0;
    this.clearHover();
    this.bar.setMax(Math.max(this.startMax, walletTotal(s.utxos)));
    this.bar.setBalance(walletTotal(s.utxos), prev.mode !== 'myth');
    this.bar.show(myth);

    const all = [...this.coins.values()].sort((a, b) => a.root.position.x - b.root.position.x);
    all.forEach((c, i) => {
      void tweens.wait(i * 0.045).then(() => {
        c.sinkTarget = myth ? 1 : 0;
      });
    });
    this.tray.forEach((c, i) => {
      void tweens.wait(0.2 + i * 0.05).then(() => {
        c.sinkTarget = myth ? 1 : 0;
      });
    });

    if (!myth && s.pendingReveal) {
      const tx = s.pendingReveal;
      const ep = this.epoch;
      void tweens.wait(0.75).then(() => ep === this.epoch && this.reveal(tx));
    }
  }

  /** After a myth-mode payment: show what actually happened to the pile. */
  private reveal(tx: TxRecord) {
    for (const g of this.ghosts) {
      const p = new THREE.Vector3(g.x, 0.02, g.z);
      this.fx.shock(p, '#ff7a5c', g.r * 2.4, 1.1);
      this.fx.floatText(p.clone().setY(0.5), `<s>${sats(g.value)}</s><small>spent</small>`, 'ft-spent', 3.2);
    }
    this.ghosts = [];
    if (tx.change) {
      const v = this.coins.get(tx.change.id);
      if (v) {
        this.fx.shock(v.root.position, '#ffcf7a', v.r * 3, 1);
        this.fx.floatText(v.root.position.clone().setY(0.7), `+${sats(tx.change.value)}<small>new change coin</small>`, 'ft-change', 3.4);
        v.hoverTarget = 1;
        void tweens.wait(1.6).then(() => {
          if (this.hovered !== v) v.hoverTarget = 0;
        });
      }
    }
    this.world.walletGlow.flash(1);
    const k = tx.inputs.length;
    this.hud.toast(
      `<b>Underneath:</b> ${k} ${plural(k, 'coin')} (${sats(tx.plan.inputsTotal)}) ${k === 1 ? 'was' : 'were'} spent whole${
        tx.change ? `, and a new ${sats(tx.change.value)} coin came back as change` : ''
      }. Same total. Different pile.`,
      'good',
      6500,
    );
    sfx.chime();
    store.set({ pendingReveal: null });
  }

  private toggle(id: string) {
    let s = store.get();
    if (s.mode !== 'reality' || s.phase === 'sending') return;
    if (!this.coins.has(id)) return;
    if (s.phase === 'receipt') {
      this.nextBill();
      s = store.get();
    }
    const adding = !s.selected.includes(id);
    this.hasPicked = true;
    store.set({ selected: adding ? [...s.selected, id] : s.selected.filter((x) => x !== id) });
    sfx.tick(adding ? 1.15 : 0.8);
  }

  private clearSelection() {
    const s = store.get();
    if (s.phase === 'sending' || s.selected.length === 0) return;
    store.set({ selected: [] });
    sfx.tick(0.7);
  }

  private pickForMe() {
    let s = store.get();
    if (s.mode !== 'reality' || s.phase === 'sending') return;
    if (s.phase === 'receipt') {
      this.nextBill();
      s = store.get();
    }
    const inv = invoiceOf(s);
    const picked = pickCoins(s.utxos, inv.amount, s.feeRate);
    if (!picked) {
      sfx.deny();
      this.hud.toast(`Your whole wallet can’t cover ${sats(inv.amount)} plus the fee. <kbd>⇧R</kbd> resets it.`, 'warn');
      return;
    }
    this.hasPicked = true;
    store.set({ selected: picked.map((u) => u.id) });
    const plan = currentPlan(store.get());
    sfx.tick(1.3);
    this.hud.toast(
      plan.hasChange
        ? `Picked ${picked.length} ${plural(picked.length, 'coin')} with the least waste: fee now plus the cost of a change coin later.`
        : `Picked ${picked.length} ${plural(picked.length, 'coin')} that avoid change entirely — wallets love a near-exact match.`,
      '',
      3800,
    );
  }

  private setFee(rate: number) {
    const r = Math.round(clamp(rate, FEE_MIN, FEE_MAX));
    if (r === store.get().feeRate) return;
    store.set({ feeRate: r });
    sfx.tick(0.6 + (r / FEE_MAX) * 0.9);
  }

  private setMode(m: Mode) {
    const s = store.get();
    if (s.mode === m) return;
    if (s.phase === 'sending') {
      sfx.deny();
      return;
    }
    if (s.phase === 'receipt') this.hud.hideReceipt();
    store.set({
      mode: m,
      phase: 'select',
      invoiceIndex: s.phase === 'receipt' ? s.invoiceIndex + 1 : s.invoiceIndex,
      selected: m === 'myth' ? [] : s.selected,
    });
  }

  private toggleMute() {
    const muted = !store.get().muted;
    store.set({ muted });
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!muted) sfx.tick(1.2);
  }

  private nextBill() {
    const s = store.get();
    if (s.phase !== 'receipt') return;
    this.hud.hideReceipt();
    store.set({ phase: 'select', selected: [], invoiceIndex: s.invoiceIndex + 1 });
    const ns = store.get();
    const inv = invoiceOf(ns);
    if (!pickCoins(ns.utxos, inv.amount, ns.feeRate)) {
      this.hud.toast(`Not enough left for ${inv.to}. Hold <kbd>Shift</kbd> + <kbd>R</kbd> to refill the wallet.`, 'warn', 6000);
    } else {
      this.hud.toast(`New bill: <b>${inv.to}</b> — ${sats(inv.amount)} sats.`, '', 2600);
    }
    sfx.tick(1);
  }

  private send() {
    const s = store.get();
    if (s.phase === 'receipt') return this.nextBill();
    if (s.phase !== 'select') return;
    if (s.mode === 'myth') void this.runMythSpend();
    else void this.runSpend();
  }

  private resetWallet() {
    this.epoch++;
    tweens.clear();
    for (const v of this.coins.values()) v.dispose();
    this.coins.clear();
    for (const v of this.tray) v.dispose();
    this.tray = [];
    for (const v of this.inFlight) v.dispose();
    this.inFlight.clear();
    this.ghosts = [];
    this.focusId = null;
    this.clearHover();
    this.hud.hideReceipt();
    this.fx.setOrb(0);
    this.world.txSpin = 0;
    this.world.txGlow.target = 0;
    this.world.txRunes.target = 0;
    const mode = store.get().mode;
    store.resetWallet();
    if (mode !== 'reality') store.set({ mode });
    this.startMax = walletTotal(store.get().utxos);
    this.bar.setMax(this.startMax);
    this.bar.setBalance(this.startMax, true);
    const n = store.get().utxos.length;
    this.hud.toast(`Wallet refilled with the original ${n} coins.`, '', 2400);
  }

  private buildTx(inputs: Utxo[], plan: TxPlan, inv: Invoice, mode: Mode): TxRecord {
    const txid = fakeTxid();
    const now = performance.now();
    // Many wallets shuffle output order so the change isn't obvious.
    const changeFirst = plan.hasChange && Math.random() < 0.5;
    const payment: Utxo = {
      id: nextId('p'),
      txid,
      vout: changeFirst ? 1 : 0,
      value: inv.amount,
      from: `Your payment to ${inv.to} · ${inv.memo}`,
      origin: 'payment',
      bornAt: now,
      confirmed: false,
    };
    const change: Utxo | null = plan.hasChange
      ? { id: nextId('c'), txid, vout: changeFirst ? 0 : 1, value: plan.change, from: `Change from paying ${inv.to}`, origin: 'change', bornAt: now, confirmed: false }
      : null;
    return { txid, invoice: inv, inputs, payment, change, plan, mode };
  }

  private trayHeight(): number {
    return this.tray.reduce((h, c) => h + c.t * 0.92, 0);
  }

  private async runSpend() {
    const s = store.get();
    const plan = currentPlan(s);
    if (!plan.ok) {
      sfx.deny();
      this.hud.flashWarn();
      if (plan.inputCount === 0) this.hud.toast('Pick at least one coin first — click one on the table.', 'warn', 2600);
      return;
    }
    const ep = this.epoch;
    const inv = invoiceOf(s);
    const inputs = selectedCoins(s);
    const views = inputs.map((u) => this.coins.get(u.id)).filter((v): v is CoinView => !!v);
    const tx = this.buildTx(inputs, plan, inv, 'reality');
    this.focusId = null;
    this.clearHover();
    store.set({ phase: 'sending' });
    this.rig.spotlightSpend();

    const T = new THREE.Vector3(LAYOUT.tx.x, 0, LAYOUT.tx.z);
    const orbPos = T.clone().setY(0.6);

    // 1. Inputs fly into the transaction ring.
    this.world.inputsGlow.flash(1.2);
    this.world.txGlow.target = 0.5;
    this.world.txRunes.target = 0.5;
    sfx.whoosh(0.8, 0.1);
    let y = 0;
    await Promise.all(
      views.map((v, i) => {
        const p = T.clone();
        p.y = y;
        p.x += Math.sin(i * 2.1) * 0.06;
        p.z += Math.cos(i * 2.1) * 0.06;
        y += v.t * 0.95;
        return v.moveTo(p, { dur: 0.72, arc: 1.25, delay: i * 0.1 });
      }),
    );
    if (ep !== this.epoch) return;

    // 2. Inputs melt into the orb.
    sfx.forge(1.05);
    this.world.txSpin = 1;
    this.world.txGlow.target = 1;
    this.world.txRunes.target = 1;
    this.fx.placeOrb(orbPos);
    const sum =
      views.length > 1 && views.length <= 4
        ? `${views.map((v) => sats(v.utxo.value)).join(' + ')} = ${sats(plan.inputsTotal)}`
        : sats(plan.inputsTotal);
    this.fx.floatText(
      orbPos.clone().setY(1.3),
      `${sum}<small>${views.length} whole ${plural(views.length, 'coin')} in · none can be split</small>`,
      'ft-in',
      1.25,
    );
    this.rig.kick(0.05);
    const baseY = views.map((v) => v.root.position.y);
    await tweens.run({
      duration: 1.0,
      ease: ease.inCubic,
      update: (t) => {
        views.forEach((v, i) => {
          v.glow = t;
          v.melt = t;
          v.root.position.y = baseY[i] + t * (0.55 - baseY[i] * 0.5);
        });
        this.fx.setOrb(0.25 + t * 0.85);
      },
    });
    if (ep !== this.epoch) return;

    const spentDiscs = views.map((v) => ({ x: v.home.x, z: v.home.z, r: v.r, value: v.utxo.value }));
    for (const v of views) {
      v.dispose();
      this.coins.delete(v.utxo.id);
    }
    for (const g of spentDiscs) this.fx.shock(new THREE.Vector3(g.x, 0.02, g.z), '#ff7a5c', g.r * 1.8, 0.8);
    this.fx.shock(T, '#ffb14a', 2.8, 0.9);
    this.rig.rumble(0.05);
    sfx.clink(0.9, 1);

    // 3. Outputs emerge under the split equation.
    this.fx.floatText(orbPos.clone().setY(2.0), splitEquation(plan), 'ft-eq', 3.6);
    const payView = new CoinView(tx.payment, true);
    payView.melt = 1;
    payView.glow = 1;
    payView.setPosition(orbPos.clone().setY(0.3));
    payView.onLand = (c, arc) => this.landed(c, arc);
    this.stage.scene.add(payView.root);
    this.inFlight.add(payView);

    let changeView: CoinView | null = null;
    if (tx.change) {
      changeView = new CoinView(tx.change, true);
      const spot = findWalletSpot(changeView.r, this.takenDiscs(), 1.3 + this.coins.size, true);
      changeView.home.set(spot.x, 0, spot.z);
      changeView.melt = 1;
      changeView.glow = 1;
      changeView.setPosition(orbPos.clone().setY(0.3));
      changeView.onLand = (c, arc) => this.landed(c, arc);
      this.stage.scene.add(changeView.root);
      this.inFlight.add(changeView);
    }

    await tweens.run({
      duration: 0.45,
      ease: ease.outBack,
      update: (t) => {
        payView.melt = 1 - t;
        if (changeView) changeView.melt = 1 - t;
      },
    });
    if (ep !== this.epoch) return;
    // Hold so the equation can be read.
    await tweens.wait(0.5);
    if (ep !== this.epoch) return;

    // 4. Outputs fly to their owners; the fee streams to the miner.
    const sparkCount = Math.round(clamp(plan.fee / 90, 12, 48));
    let feeLanded = false;
    this.fx.sparkStream(orbPos, this.world.miner.anchor, sparkCount, {
      color: '#ff9a55',
      loft: 2.6,
      onArrive: (i) => {
        if (!feeLanded) {
          feeLanded = true;
          this.world.miner.absorb(plan.fee);
        }
        if (i % 5 === 0) sfx.tick(2.2);
      },
    });
    const courier = this.fx.courier(orbPos, this.world.miner.anchor, 2.6, 1.1);
    this.fx.followTag(courier, `<em>Fee</em><b>${sats(plan.fee)}</b><span>→ miner</span>`, 'fee', 3.3, 0.3);

    const tp = traySpot(this.tray.length, this.trayHeight());
    const trayPos = new THREE.Vector3(tp.x, tp.y, tp.z);
    payView.home.copy(trayPos);
    payView.floorY = 0.016;
    this.fx.followTag(payView.root, `<em>Payment</em><b>${sats(tx.payment.value)}</b><span>→ ${inv.to}</span>`, 'pay', 3.9);
    this.fx.trail(payView.root, '#8fcaff', 1.2);
    if (changeView && tx.change) {
      this.fx.followTag(changeView.root, `<em>Change</em><b>${sats(tx.change.value)}</b><span>→ back to you</span>`, 'change', 4.1);
      this.fx.trail(changeView.root, '#ffcf7a', 1.2);
    }
    sfx.whoosh(1, 0.12);
    const flights: Promise<void>[] = [payView.moveTo(trayPos, { dur: 1.15, arc: 1.9, flips: 1 })];
    if (changeView) flights.push(changeView.moveTo(changeView.home, { dur: 1.05, arc: 1.6, flips: 1, delay: 0.12 }));
    void tweens.run({
      duration: 1.1,
      ease: ease.outCubic,
      update: (t) => {
        payView.glow = 1 - t;
        if (changeView) changeView.glow = 1 - t;
        this.fx.setOrb(1 - t);
      },
    });
    await Promise.all(flights);
    if (ep !== this.epoch) return;

    this.world.recipientGlow.flash(1.2);
    this.fx.shock(trayPos, '#8fcaff', 1.9, 0.8);
    if (changeView) {
      this.world.walletGlow.flash(0.9);
      this.fx.shock(changeView.home, '#ffcf7a', changeView.r * 3, 0.8);
    }
    this.world.txSpin = 0;
    this.world.txGlow.target = 0;
    this.world.txRunes.target = 0;
    this.fx.setOrb(0);

    // 5. Commit to state.
    this.inFlight.clear();
    this.tray.push(payView);
    if (changeView && tx.change) this.coins.set(tx.change.id, changeView);
    const spentIds = new Set(inputs.map((u) => u.id));
    const cur = store.get();
    const utxos = cur.utxos.filter((u) => !spentIds.has(u.id));
    if (tx.change) utxos.push(tx.change);
    store.set({
      utxos,
      selected: [],
      paid: [...cur.paid, tx.payment],
      history: [...cur.history, tx],
      lastTx: tx,
      phase: 'receipt',
    });
    this.hud.showReceipt(tx, utxos.length, cur.history.length === 0);
    if (cur.history.length === 0) {
      void tweens.wait(1.2).then(() => ep === this.epoch && this.hud.pulseModes());
    }
    this.scheduleConfirm(tx, ep);
  }

  private async runMythSpend() {
    const s = store.get();
    const inv = invoiceOf(s);
    const picked = pickCoins(s.utxos, inv.amount, s.feeRate);
    if (!picked) {
      sfx.deny();
      this.hud.flashWarn();
      this.hud.toast(`Balance too low for ${sats(inv.amount)} plus fee. <kbd>⇧R</kbd> refills the wallet.`, 'warn');
      return;
    }
    const ep = this.epoch;
    const plan = planTx(
      picked.map((u) => u.value),
      inv.amount,
      s.feeRate,
    );
    const tx = this.buildTx(picked, plan, inv, 'myth');
    store.set({ phase: 'sending', selected: [] });

    const tp = traySpot(this.tray.length, this.trayHeight());
    const trayPos = new THREE.Vector3(tp.x, tp.y + 0.3, tp.z);
    sfx.whoosh(1.1, 0.1);
    this.fx.floatText(new THREE.Vector3(LAYOUT.bar.x + 2.2, 2.2, LAYOUT.bar.z), `−${sats(inv.amount + plan.fee)}`, 'ft-myth', 2.4);
    await this.bar.spend(inv.amount + plan.fee, trayPos);
    if (ep !== this.epoch) return;
    sfx.clink(0.4, 0.6);
    this.world.recipientGlow.flash(0.8);

    // The real transaction still happens underneath, with its outputs hidden.
    this.ghosts = picked.map((u) => {
      const v = this.coins.get(u.id)!;
      return { x: v.home.x, z: v.home.z, r: v.r, value: u.value };
    });
    for (const u of picked) {
      this.coins.get(u.id)?.dispose();
      this.coins.delete(u.id);
    }
    const payView = new CoinView(tx.payment, true);
    payView.home.set(tp.x, tp.y, tp.z);
    payView.setPosition(payView.home);
    payView.sink = payView.sinkTarget = 1;
    this.stage.scene.add(payView.root);
    this.tray.push(payView);

    if (tx.change) {
      const cv = new CoinView(tx.change, true);
      const spot = findWalletSpot(cv.r, this.takenDiscs(), 2.1 + this.coins.size, true);
      cv.home.set(spot.x, 0, spot.z);
      cv.setPosition(cv.home);
      cv.sink = cv.sinkTarget = 1;
      cv.onLand = (c, arc) => this.landed(c, arc);
      this.stage.scene.add(cv.root);
      this.coins.set(tx.change.id, cv);
    }

    const cur = store.get();
    const ids = new Set(picked.map((u) => u.id));
    const utxos = cur.utxos.filter((u) => !ids.has(u.id));
    if (tx.change) utxos.push(tx.change);
    store.set({
      utxos,
      paid: [...cur.paid, tx.payment],
      history: [...cur.history, tx],
      lastTx: tx,
      pendingReveal: tx,
      phase: 'receipt',
    });
    this.hud.showReceipt(tx, utxos.length, cur.history.length === 0);
    this.hud.pulseModes();
    this.scheduleConfirm(tx, ep);
  }

  /** Time-lapse: a miner includes the transaction a few seconds later. */
  private scheduleConfirm(tx: TxRecord, ep: number) {
    void tweens.wait(5.5).then(() => {
      if (ep !== this.epoch) return;
      this.world.miner.pulse();
      sfx.chime();
      const cur = store.get();
      const ids = new Set([tx.payment.id, tx.change?.id]);
      const mark = (u: Utxo) => (ids.has(u.id) ? { ...u, confirmed: true } : u);
      for (const t of this.tray) if (ids.has(t.utxo.id)) t.utxo = { ...t.utxo, confirmed: true };
      store.set({ utxos: cur.utxos.map(mark), paid: cur.paid.map(mark) });
      if (store.get().lastTx?.txid === tx.txid) this.hud.confirmReceipt();
      this.hud.toast('⛏ Mined into a block. <span class="muted">Time-lapse — real blocks average about 10 minutes.</span>', 'good', 4200);
    });
  }

  private bindInput() {
    const dom = this.stage.renderer.domElement;
    const unlock = () => {
      sfx.unlock();
      this.lastInput = this.time;
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    dom.addEventListener('pointermove', (e) => {
      this.pointerIn = true;
      if (this.down && this.hovered && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) this.clearHover();
      this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    dom.addEventListener('pointerleave', () => {
      this.pointerIn = false;
      this.clearHover();
    });
    dom.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    dom.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || e.button !== 0) return;
      // Fingers wobble more than mice: be forgiving about what counts as a tap.
      const touch = e.pointerType !== 'mouse';
      const slop = touch ? 14 : 6;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > slop || performance.now() - d.t > (touch ? 750 : 600)) return;
      this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      const hit = this.pick() ?? (touch ? this.pickNearest(e.clientX, e.clientY, 26) : null);
      if (hit && this.coins.get(hit.utxo.id) === hit) this.toggle(hit.utxo.id);
      if (touch) this.clearHover();
    });

    // Buttons shouldn't keep focus after a mouse click, or Space would press them again.
    document.addEventListener('pointerup', () => {
      const a = document.activeElement;
      if (a instanceof HTMLButtonElement || (a instanceof HTMLInputElement && a.type === 'range')) a.blur();
    });

    window.addEventListener('resize', () => this.rig.onResize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.rig.keyUp(e.code));
    window.addEventListener('blur', () => this.rig.clearKeys());
  }

  private onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
    const s = store.get();

    switch (e.code) {
      case 'KeyW':
      case 'KeyA':
      case 'KeyS':
      case 'KeyD':
      case 'KeyQ':
      case 'KeyE':
      case 'Equal':
      case 'Minus':
      case 'NumpadAdd':
      case 'NumpadSubtract':
      case 'ShiftLeft':
      case 'ShiftRight':
        this.rig.keyDown(e.code);
        return;
    }
    if (e.repeat && !['BracketLeft', 'BracketRight', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;

    switch (e.code) {
      case 'Digit1':
      case 'Numpad1':
        this.setMode('myth');
        break;
      case 'Digit2':
      case 'Numpad2':
        this.setMode('reality');
        break;
      case 'Space':
        e.preventDefault();
        this.send();
        break;
      case 'Enter':
      case 'NumpadEnter':
        e.preventDefault();
        if (this.focusId && s.mode === 'reality') this.toggle(this.focusId);
        else this.send();
        break;
      case 'ArrowRight':
      case 'ArrowLeft':
        e.preventDefault();
        this.cycleFocus(e.code === 'ArrowRight' ? 1 : -1);
        break;
      case 'KeyP':
        this.pickForMe();
        break;
      case 'KeyX':
        this.clearSelection();
        break;
      case 'BracketLeft':
        this.setFee(s.feeRate - (e.shiftKey ? 10 : 1));
        break;
      case 'BracketRight':
        this.setFee(s.feeRate + (e.shiftKey ? 10 : 1));
        break;
      case 'KeyC':
        this.rig.nextShot();
        break;
      case 'KeyR':
        if (e.shiftKey) this.resetWallet();
        else {
          this.rig.home();
          this.hud.toast('View reset. <kbd>⇧R</kbd> resets the wallet too.', '', 1800);
        }
        break;
      case 'Slash':
      case 'NumpadDivide':
      case 'IntlRo':
        e.preventDefault();
        store.set({ uiHidden: !s.uiHidden });
        break;
      case 'KeyH':
        store.set({ howOpen: !s.howOpen });
        break;
      case 'KeyM':
        this.toggleMute();
        break;
      case 'KeyL':
        store.set({ labels: !s.labels });
        break;
      case 'Escape':
        if (s.howOpen) store.set({ howOpen: false });
        else if (this.focusId) {
          this.focusId = null;
          this.layout(store.get());
          this.hud.hideTip();
        } else this.rig.release();
        break;
    }
  }

  private cycleFocus(dir: 1 | -1) {
    const s = store.get();
    if (s.mode !== 'reality' || s.phase === 'sending') return;
    const order = [...s.utxos].sort((a, b) => b.value - a.value).map((u) => u.id);
    if (!order.length) return;
    const i = this.focusId ? order.indexOf(this.focusId) : -1;
    const n = i < 0 ? (dir > 0 ? 0 : order.length - 1) : (i + dir + order.length) % order.length;
    this.focusId = order[n];
    this.clearHover();
    this.layout(s);
    sfx.tick(0.9 + n * 0.04);
  }

  private highlightTerm(term: string | null) {
    this.hud.setTermHighlight(term);
    const w = this.world;
    w.walletGlow.flash(term === 'utxo' ? 0.9 : 0);
    if (term === 'input') w.inputsGlow.flash(1);
    if (term === 'output' || term === 'change') {
      w.recipientGlow.flash(term === 'output' ? 1 : 0);
      w.walletGlow.flash(term === 'change' ? 0.8 : 0);
    }
    if (term === 'fee') {
      const total = this.world.miner.totalFees;
      this.world.miner.nudge(total ? `${sats(total)} sats collected so far` : 'the gap between inputs and outputs');
    }
  }

  private pick(): CoinView | null {
    const s = store.get();
    if (s.mode !== 'reality' || s.phase === 'sending') return null;
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    const targets: THREE.Object3D[] = [];
    for (const c of this.coins.values()) if (!c.moving || c.sel > 0.5) targets.push(c.hit);
    for (const c of this.tray) targets.push(c.hit);
    const hits = this.raycaster.intersectObjects(targets, false);
    return (hits[0]?.object.userData.coin as CoinView | undefined) ?? null;
  }

  /** Touch fallback: the wallet coin whose on-screen disc is nearest the finger. */
  private pickNearest(x: number, y: number, maxPx: number): CoinView | null {
    const s = store.get();
    if (s.mode !== 'reality' || s.phase === 'sending') return null;
    const cam = this.stage.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const toPx = (v: THREE.Vector3): [number, number] => {
      v.project(cam);
      return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h];
    };
    let best: CoinView | null = null;
    let bestD = Infinity;
    for (const c of this.coins.values()) {
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

  private clearHover() {
    if (this.hovered) this.hovered.hoverTarget = 0;
    this.hovered = null;
    this.stage.renderer.domElement.style.cursor = '';
    this.hud.hideTip();
  }

  private updateHover() {
    const dragging = this.down !== null;
    const s = store.get();
    if (!this.pointerIn || dragging) {
      if (!this.focusId) return;
    }
    const hit = this.pointerIn && !dragging ? this.pick() : null;
    if (hit !== this.hovered) {
      if (this.hovered) this.hovered.hoverTarget = 0;
      this.hovered = hit;
      if (hit) {
        hit.hoverTarget = 1;
        sfx.tick(1.6);
        if (this.focusId) {
          this.focusId = null;
          this.layout(s);
        }
      }
      this.stage.renderer.domElement.style.cursor = hit && this.coins.get(hit.utxo.id) === hit ? 'pointer' : '';
    }
    const show = this.hovered ?? (this.focusId ? this.coins.get(this.focusId) ?? null : null);
    if (show && s.mode === 'reality' && !s.uiHidden) {
      const p = show.root.position.clone();
      p.y += show.t + 0.2;
      p.project(this.stage.camera);
      const x = (p.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
      const mine = this.coins.get(show.utxo.id) === show;
      this.hud.showTip(show.utxo, x, y, s, s.selected.includes(show.utxo.id), mine);
    } else {
      this.hud.hideTip();
    }
  }

  /** Shimmer the pile until the first pick (and after a long idle); show the first-run callout. */
  private updateInvite(dt: number, t: number) {
    const s = store.get();
    const idle = t - this.lastInput > 9;
    const ready = s.mode === 'reality' && s.phase === 'select' && s.selected.length === 0 && t > 1.3;
    const on = ready && (!this.hasPicked || idle);
    this.inviteOrder.forEach((c, i) => {
      const wave = on ? Math.pow(Math.max(0, Math.sin(t * 2.3 - i * 0.55)), 10) : 0;
      c.invite += (wave - c.invite) * damp(14, dt);
    });
    const show = ready && !this.hasPicked && !s.uiHidden && !s.howOpen;
    if (show !== this.calloutOn) {
      this.calloutOn = show;
      this.callout.element.classList.toggle('is-on', show);
    }
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

  private frame(fixedDt?: number, draw = true) {
    const now = performance.now();
    const real = (now - this.last) / 1000;
    const dt = fixedDt ?? Math.min(0.05, real);
    this.last = now;
    if (fixedDt === undefined) this.stage.adapt(real);
    this.time += dt;
    const t = this.time;

    tweens.tick(dt);
    this.rig.update(dt);
    this.updateHover();

    this.updateInvite(dt, t);
    for (const c of this.coins.values()) c.update(dt, t);
    for (const c of this.tray) c.update(dt, t);
    for (const c of this.inFlight) c.update(dt, t);
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

