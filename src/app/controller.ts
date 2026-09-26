import { sfx } from '../audio/sfx';
import { pickCoins } from '../model/bitcoin';
import { FEE_MAX, FEE_MIN, currentPlan, finishedRound, invoiceOf, store, type Mode, type State } from '../model/store';
import { walletTotal } from '../model/wallet';
import { plural, sats } from '../util/format';
import { html, type SafeHtml } from '../util/html';
import { clamp, tweens } from '../util/tween';
import type { Payments } from './payments';
import type { Pointer } from './pointer';
import type { View } from './view';

const MUTE_KEY = 'coin-table:muted';

/** What the player can do, whether from the keyboard, the HUD or the table. */
export class Controller {
  constructor(
    private view: View,
    private payments: Payments,
    private pointer: Pointer,
  ) {}

  restoreMute() {
    let muted = false;
    try {
      muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
    }
    sfx.setMuted(muted);
    store.set({ muted });
  }

  toggle(id: string) {
    let s = store.get();
    if (s.mode !== 'reality' || s.phase === 'sending') return;
    if (!this.view.coins.wallet.has(id)) return;
    if (s.phase === 'receipt') {
      this.nextBill();
      s = store.get();
    }
    const adding = !s.selected.includes(id);
    store.set({ selected: adding ? [...s.selected, id] : s.selected.filter((x) => x !== id) });
    sfx.tick(adding ? 1.15 : 0.8);
  }

  cycleFocus(dir: 1 | -1) {
    const s = store.get();
    if (s.mode !== 'reality' || s.phase === 'sending') return;
    const order = [...s.utxos].sort((a, b) => b.value - a.value).map((u) => u.id);
    if (!order.length) return;
    const i = s.focusId ? order.indexOf(s.focusId) : -1;
    const n = i < 0 ? (dir > 0 ? 0 : order.length - 1) : (i + dir + order.length) % order.length;
    this.pointer.clearHover();
    store.set({ focusId: order[n] });
    sfx.tick(0.9 + n * 0.04);
  }

  clearSelection() {
    const s = store.get();
    if (s.phase === 'sending' || s.selected.length === 0) return;
    store.set({ selected: [] });
    sfx.tick(0.7);
  }

  pickForMe() {
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
      this.view.hud.toast(html`Your whole wallet can’t cover ${sats(inv.amount)} plus the fee. <kbd>⇧R</kbd> resets it.`, 'warn');
      return;
    }
    store.set({ selected: picked.map((u) => u.id) });
    const plan = currentPlan(store.get());
    sfx.tick(1.3);
    this.view.hud.toast(
      plan.hasChange
        ? html`Picked ${picked.length} ${plural(picked.length, 'coin')} with the least waste: fee now plus the cost of a change coin later.`
        : html`Picked ${picked.length} ${plural(picked.length, 'coin')} that avoid change entirely — wallets love a near-exact match.`,
      '',
      3800,
    );
  }

  setFee(rate: number) {
    // The fee is fixed once a transaction is signed and on its way.
    if (store.get().phase === 'sending') return;
    const r = Math.round(clamp(rate, FEE_MIN, FEE_MAX));
    if (r === store.get().feeRate) return;
    store.set({ feeRate: r });
    sfx.tick(0.6 + (r / FEE_MAX) * 0.9);
  }

  setMode(m: Mode) {
    const s = store.get();
    if (s.mode === m) return;
    if (s.phase === 'sending') {
      sfx.deny();
      return;
    }
    if (s.phase === 'receipt') this.view.hud.receipt.hide();
    store.set({
      mode: m,
      phase: 'select',
      invoiceIndex: s.phase === 'receipt' ? s.invoiceIndex + 1 : s.invoiceIndex,
      selected: m === 'myth' ? [] : s.selected,
    });
    if (s.phase === 'receipt') {
      const summary = roundSummary(store.get());
      if (summary) this.view.hud.toast(summary, 'good', 8000);
    }
  }

  send() {
    const s = store.get();
    if (s.phase === 'receipt') return this.nextBill();
    if (s.phase !== 'select') return;
    if (s.mode === 'myth') void this.payments.payFromBalance();
    else void this.payments.payWithCoins();
  }

  nextBill() {
    const s = store.get();
    if (s.phase !== 'receipt') return;
    const { hud } = this.view;
    hud.receipt.hide();
    store.set({ phase: 'select', selected: [], invoiceIndex: s.invoiceIndex + 1 });
    const ns = store.get();
    const inv = invoiceOf(ns);
    const summary = roundSummary(ns);
    if (summary) {
      hud.toast(summary, 'good', 8000);
    } else if (!pickCoins(ns.utxos, inv.amount, ns.feeRate)) {
      hud.toast(html`Not enough left for ${inv.to}. Hold <kbd>Shift</kbd> + <kbd>R</kbd> to refill the wallet.`, 'warn', 6000);
    } else {
      hud.toast(html`New bill: <b>${inv.to}</b> — ${sats(inv.amount)} sats.`, '', 2600);
    }
    sfx.tick(1);
  }

  resetWallet() {
    const { coins, fx, world, bar, hud } = this.view;
    this.payments.cancel();
    tweens.clear();
    coins.clear();
    this.pointer.clearHover();
    hud.receipt.hide();
    fx.setOrb(0);
    world.setTxActivity(0);
    const mode = store.get().mode;
    store.resetWallet();
    if (mode !== 'reality') store.set({ mode });
    bar.reset(walletTotal(store.get().utxos));
    const n = store.get().utxos.length;
    hud.toast(html`Wallet refilled with the original ${n} coins.`, '', 2400);
  }

  toggleMute() {
    const muted = !store.get().muted;
    store.set({ muted });
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!muted) sfx.tick(1.2);
  }

  toggleHow() {
    store.set({ howOpen: !store.get().howOpen });
  }

  toggleHide() {
    store.set({ uiHidden: !store.get().uiHidden });
  }

  toggleLabels() {
    store.set({ labels: !store.get().labels });
  }

  highlightTerm(term: string | null) {
    const { hud, world } = this.view;
    hud.setTermHighlight(term);
    world.walletGlow.flash(term === 'utxo' ? 0.9 : 0);
    if (term === 'input') world.inputsGlow.flash(1);
    if (term === 'output' || term === 'change') {
      world.recipientGlow.flash(term === 'output' ? 1 : 0);
      world.walletGlow.flash(term === 'change' ? 0.8 : 0);
    }
    if (term === 'fee') {
      const total = world.miner.totalFees;
      world.miner.nudge(total ? `${sats(total)} sats collected so far` : 'the gap between inputs and outputs');
    }
  }
}

function roundSummary(s: State): SafeHtml | null {
  const r = finishedRound(s);
  return r
    ? html`<b>All ${r.bills} bills paid.</b> ${r.coinsIn} whole coins went in, ${r.changeCoins} change ${plural(r.changeCoins, 'coin')} came back, and ${sats(r.fees)} sats went to fees. The bills start over — <kbd>⇧R</kbd> refills the wallet.`
    : null;
}
