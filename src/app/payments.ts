import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { pickCoins, planTx, type TxPlan } from '../model/bitcoin';
import { currentPlan, invoiceOf, selectedCoins, store, type TxRecord } from '../model/store';
import { applyTx, buildTx, confirmTx } from '../model/tx';
import type { Utxo } from '../model/wallet';
import { CoinView } from '../scene/coin';
import { LAYOUT, findWalletSpot } from '../scene/layout';
import { plural, sats } from '../util/format';
import { html, type SafeHtml } from '../util/html';
import { clamp, ease, tweens } from '../util/tween';
import type { Pointer } from './pointer';
import type { View } from './view';

const OUTPUT_HEAT = 0.55;
/** Trails start once a coin has cleared the orb's glow, so they don't streak through it. */
const TRAIL_DELAY = 0.2;

function splitEquation(plan: TxPlan): SafeHtml {
  const term = (cls: string, v: number, label: string) => html`<span class="t ${cls}"><b>${sats(v)}</b><i>${label}</i></span>`;
  const parts = [
    term('in', plan.inputsTotal, 'in'),
    html`<span class="op">=</span>`,
    term('pay', plan.payment, 'payment'),
    html`<span class="op">+</span>`,
    term('fee', plan.fee, plan.dustToFee > 0 ? `fee · incl. ${sats(plan.dustToFee)} leftover` : 'fee'),
  ];
  if (plan.hasChange) parts.push(html`<span class="op">+</span>`, term('change', plan.change, 'change'));
  return html`<div class="eq">${parts}</div>`;
}

export class Payments {
  /** Bumps on wallet reset so stale async beats can bail out. */
  private epoch = 0;

  constructor(
    private view: View,
    private pointer: Pointer,
  ) {}

  cancel() {
    this.epoch++;
  }

  async payWithCoins() {
    const { stage, coins, world, fx, rig, hud } = this.view;
    const s = store.get();
    const plan = currentPlan(s);
    if (!plan.ok) {
      sfx.deny();
      hud.ledger.shake();
      if (plan.inputCount === 0) hud.toast(html`Pick at least one coin first — click one on the table.`, 'warn', 2600);
      return;
    }
    const ep = this.epoch;
    const inv = invoiceOf(s);
    const inputs = selectedCoins(s);
    const views = inputs.map((u) => coins.wallet.get(u.id)).filter((v): v is CoinView => !!v);
    const tx = buildTx(inputs, plan, inv, 'reality');
    this.pointer.clearHover();
    store.set({ focusId: null, phase: 'sending' });
    rig.spotlightSpend();

    const T = new THREE.Vector3(LAYOUT.tx.x, 0, LAYOUT.tx.z);
    const orbPos = T.clone().setY(0.6);

    // 1. Inputs fly into the transaction ring.
    world.inputsGlow.flash(1.2);
    world.setTxActivity(0.5);
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
    world.setTxActivity(1);
    fx.placeOrb(orbPos);
    const sum =
      views.length > 1 && views.length <= 4
        ? `${views.map((v) => sats(v.utxo.value)).join(' + ')} = ${sats(plan.inputsTotal)}`
        : sats(plan.inputsTotal);
    fx.floatText(
      orbPos.clone().setY(1.3),
      html`${sum}<small>${views.length} whole ${plural(views.length, 'coin')} in · none can be split</small>`,
      'ft-in',
      1.25,
    );
    rig.kick(0.05);
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
        fx.setOrb(0.25 + t * 0.85);
      },
    });
    if (ep !== this.epoch) return;

    const spentDiscs = views.map((v) => ({ x: v.home.x, z: v.home.z, r: v.r, value: v.utxo.value }));
    for (const v of views) {
      v.dispose();
      coins.wallet.delete(v.utxo.id);
    }
    for (const g of spentDiscs) fx.shock(new THREE.Vector3(g.x, 0.02, g.z), '#ff7a5c', g.r * 1.8, 0.8);
    fx.shock(T, '#ffb14a', 2.8, 0.9);
    rig.rumble(0.05);
    sfx.clink(0.9, 1);

    // 3. Outputs emerge under the split equation.
    fx.floatText(orbPos.clone().setY(2.0), splitEquation(plan), 'ft-eq', 3.6);
    const payView = new CoinView(tx.payment, true);
    payView.melt = 1;
    payView.glow = OUTPUT_HEAT;
    payView.setPosition(orbPos.clone().setY(0.3));
    payView.onLand = coins.onLand;
    stage.scene.add(payView.root);
    coins.inFlight.add(payView);

    let changeView: CoinView | null = null;
    if (tx.change) {
      changeView = new CoinView(tx.change, true);
      const spot = findWalletSpot(changeView.r, coins.takenDiscs(), 1.3 + coins.wallet.size, true);
      changeView.home.set(spot.x, 0, spot.z);
      changeView.melt = 1;
      changeView.glow = OUTPUT_HEAT;
      changeView.setPosition(orbPos.clone().setY(0.3));
      changeView.onLand = coins.onLand;
      stage.scene.add(changeView.root);
      coins.inFlight.add(changeView);
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
    fx.sparkStream(orbPos, world.miner.anchor, sparkCount, {
      color: '#ff9a55',
      loft: 2.6,
      onArrive: (i) => {
        if (!feeLanded) {
          feeLanded = true;
          world.miner.absorb(plan.fee);
        }
        if (i % 5 === 0) sfx.tick(2.2);
      },
    });
    const courier = fx.courier(orbPos, world.miner.anchor, 2.6, 1.1);
    fx.followTag(courier, html`<em>Fee</em><b>${sats(plan.fee)}</b><span>→ miner</span>`, 'fee', 3.3, 0.3);

    const tp = coins.nextTraySpot();
    const trayPos = new THREE.Vector3(tp.x, tp.y, tp.z);
    payView.home.copy(trayPos);
    payView.floorY = 0.016;
    fx.followTag(payView.root, html`<em>Payment</em><b>${sats(tx.payment.value)}</b><span>→ ${inv.to}</span>`, 'pay', 3.9);
    fx.trail(payView.root, '#8fcaff', 1.2, TRAIL_DELAY);
    if (changeView && tx.change) {
      fx.followTag(changeView.root, html`<em>Change</em><b>${sats(tx.change.value)}</b><span>→ back to you</span>`, 'change', 4.1);
      fx.trail(changeView.root, '#ffcf7a', 1.2, TRAIL_DELAY);
    }
    sfx.whoosh(1, 0.12);
    const flights: Promise<void>[] = [payView.moveTo(trayPos, { dur: 1.15, arc: 1.9, flips: 1 })];
    if (changeView) flights.push(changeView.moveTo(changeView.home, { dur: 1.05, arc: 1.6, flips: 1, delay: 0.12 }));
    void tweens.run({
      duration: 1.1,
      ease: ease.outCubic,
      update: (t) => {
        payView.glow = OUTPUT_HEAT * (1 - t);
        if (changeView) changeView.glow = OUTPUT_HEAT * (1 - t);
        fx.setOrb(1 - t);
      },
    });
    await Promise.all(flights);
    if (ep !== this.epoch) return;

    world.recipientGlow.flash(1.2);
    fx.shock(trayPos, '#8fcaff', 1.9, 0.8);
    if (changeView) {
      world.walletGlow.flash(0.9);
      fx.shock(changeView.home, '#ffcf7a', changeView.r * 3, 0.8);
    }
    world.setTxActivity(0);
    fx.setOrb(0);

    // 5. Commit to state.
    coins.inFlight.clear();
    coins.tray.push(payView);
    if (changeView && tx.change) coins.wallet.set(tx.change.id, changeView);
    const cur = store.get();
    store.set(applyTx(cur, tx));
    hud.receipt.show(tx, store.get().utxos.length, cur.history.length === 0);
    if (cur.history.length === 0) {
      void tweens.wait(1.2).then(() => ep === this.epoch && hud.pulseModes());
    }
    this.confirmLater(tx, ep);
  }

  async payFromBalance() {
    const { stage, coins, world, fx, bar, hud } = this.view;
    const s = store.get();
    const inv = invoiceOf(s);
    const picked = pickCoins(s.utxos, inv.amount, s.feeRate);
    if (!picked) {
      sfx.deny();
      hud.ledger.shake();
      hud.toast(html`Balance too low for ${sats(inv.amount)} plus fee. <kbd>⇧R</kbd> refills the wallet.`, 'warn');
      return;
    }
    const ep = this.epoch;
    const plan = planTx(
      picked.map((u) => u.value),
      inv.amount,
      s.feeRate,
    );
    const tx = buildTx(picked, plan, inv, 'myth');
    store.set({ phase: 'sending', selected: [] });

    const tp = coins.nextTraySpot();
    const trayPos = new THREE.Vector3(tp.x, tp.y + 0.3, tp.z);
    sfx.whoosh(1.1, 0.1);
    fx.floatText(new THREE.Vector3(LAYOUT.bar.x + 2.2, 2.2, LAYOUT.bar.z), html`−${sats(inv.amount + plan.fee)}`, 'ft-myth', 2.4);
    await bar.spend(inv.amount + plan.fee, trayPos);
    if (ep !== this.epoch) return;
    sfx.clink(0.4, 0.6);
    world.recipientGlow.flash(0.8);

    // The real transaction still happens underneath, with its outputs hidden.
    for (const u of picked) {
      const v = coins.wallet.get(u.id);
      if (v) coins.ghosts.push({ x: v.home.x, z: v.home.z, r: v.r, value: u.value });
    }
    for (const u of picked) {
      coins.wallet.get(u.id)?.dispose();
      coins.wallet.delete(u.id);
    }
    const payView = new CoinView(tx.payment, true);
    payView.home.set(tp.x, tp.y, tp.z);
    payView.setPosition(payView.home);
    payView.sink = payView.sinkTarget = 1;
    stage.scene.add(payView.root);
    coins.tray.push(payView);

    if (tx.change) {
      const cv = new CoinView(tx.change, true);
      const spot = findWalletSpot(cv.r, coins.takenDiscs(), 2.1 + coins.wallet.size, true);
      cv.home.set(spot.x, 0, spot.z);
      cv.setPosition(cv.home);
      cv.sink = cv.sinkTarget = 1;
      cv.onLand = coins.onLand;
      stage.scene.add(cv.root);
      coins.wallet.set(tx.change.id, cv);
    }

    const cur = store.get();
    store.set(applyTx(cur, tx));
    hud.receipt.show(tx, store.get().utxos.length, cur.history.length === 0);
    hud.pulseModes();
    this.confirmLater(tx, ep);
  }

  revealPending() {
    const ep = this.epoch;
    // If the player flips back to myth before this fires, keep the reveal for later.
    void tweens.wait(0.75).then(() => {
      const now = store.get();
      if (ep === this.epoch && now.mode === 'reality' && now.pendingReveal.length) this.reveal(now.pendingReveal);
    });
  }

  private reveal(txs: TxRecord[]) {
    const { coins, world, fx, hud } = this.view;
    for (const g of coins.ghosts) {
      const p = new THREE.Vector3(g.x, 0.02, g.z);
      fx.shock(p, '#ff7a5c', g.r * 2.4, 1.1);
      fx.floatText(p.clone().setY(0.5), html`<s>${sats(g.value)}</s><small>spent</small>`, 'ft-spent', 3.2);
    }
    coins.ghosts = [];
    // A change coin from an earlier payment may already have been spent by a later one.
    const changes = txs.map((tx) => tx.change).filter((u): u is Utxo => !!u && coins.wallet.has(u.id));
    for (const u of changes) {
      const v = coins.wallet.get(u.id)!;
      fx.shock(v.root.position, '#ffcf7a', v.r * 3, 1);
      fx.floatText(v.root.position.clone().setY(0.7), html`+${sats(u.value)}<small>new change coin</small>`, 'ft-change', 3.4);
      v.hoverTarget = 1;
      void tweens.wait(1.6).then(() => {
        if (this.pointer.hovered !== v) v.hoverTarget = 0;
      });
    }
    world.walletGlow.flash(1);

    const spent = txs.reduce((n, tx) => n + tx.inputs.length, 0);
    let msg: string;
    if (txs.length === 1) {
      const tx = txs[0];
      msg = `${spent} ${plural(spent, 'coin')} (${sats(tx.plan.inputsTotal)}) ${spent === 1 ? 'was' : 'were'} spent whole${
        tx.change ? `, and a new ${sats(tx.change.value)} coin came back as change` : ''
      }`;
    } else {
      msg = `${txs.length} payments spent ${spent} whole ${plural(spent, 'coin')}${
        changes.length ? `, and ${changes.length} new change ${plural(changes.length, 'coin')} ${changes.length === 1 ? 'is' : 'are'} in your wallet` : ''
      }`;
    }
    hud.toast(html`<b>Underneath:</b> ${msg}. Same total. Different pile.`, 'good', 6500);
    sfx.chime();
    store.set({ pendingReveal: [] });
  }

  /** Time-lapse: a miner includes the transaction a few seconds later. */
  private confirmLater(tx: TxRecord, ep: number) {
    const { coins, world, hud } = this.view;
    void tweens.wait(5.5).then(() => {
      if (ep !== this.epoch) return;
      world.miner.pulse();
      sfx.chime();
      const ids = new Set([tx.payment.id, tx.change?.id]);
      for (const t of coins.tray) if (ids.has(t.utxo.id)) t.utxo = { ...t.utxo, confirmed: true };
      store.set(confirmTx(store.get(), tx));
      if (store.get().lastTx?.txid === tx.txid) hud.receipt.confirm();
      hud.toast(html`⛏ Mined into a block. <span class="muted">Time-lapse — real blocks average about 10 minutes.</span>`, 'good', 4200);
    });
  }
}
