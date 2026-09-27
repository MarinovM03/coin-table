import { pickCoins, type TxPlan } from '../model/bitcoin';
import { invoiceOf, type State } from '../model/store';
import { walletTotal } from '../model/wallet';
import { compact, plural, sats } from '../util/format';
import { html, setHtml, type SafeHtml } from '../util/html';
import { $, COARSE, PRESS, hint, refillHint } from './dom';

export class Narrator {
  private narratorEl = $('narrator');
  private coachEl = $('coach');
  private announcerEl = $('announcer');
  private lastNarration = '';
  private lastCoach = '';
  private announceTimer = 0;

  render(s: State, plan: TxPlan) {
    this.renderNarration(s, plan);
    this.renderCoach(s, plan);
  }

  private renderNarration(s: State, plan: TxPlan) {
    const inv = invoiceOf(s);
    const n = s.utxos.length;
    let t: SafeHtml;
    if (s.phase === 'select' && !pickCoins(s.utxos, inv.amount, s.feeRate)) {
      t = html`Your whole wallet holds ${sats(walletTotal(s.utxos))} sats — not enough for ${sats(inv.amount)} plus the fee. ${refillHint()}`;
    } else if (s.mode === 'myth') {
      t =
        s.phase === 'receipt'
          ? html`The number went down. That’s all this view can show. ${PRESS} ${hint('2', 'What Bitcoin does')} — the coins underneath changed shape.`
          : html`The bank-app picture: one number, and paying just subtracts. ${PRESS} ${hint('Space', 'Send')} to pay ${inv.to}, then ${hint('2', 'What Bitcoin does')} to look underneath.`;
    } else if (s.phase === 'sending') {
      t = html`Inputs are consumed whole. New outputs are being created…`;
    } else if (s.phase === 'receipt' && s.lastTx) {
      const tx = s.lastTx;
      t = html`Done: ${tx.inputs.length} ${plural(tx.inputs.length, 'coin')} in, ${tx.change ? 2 : 1} out. Your wallet now holds ${n} ${plural(n, 'coin')}.`;
    } else if (plan.inputCount === 0) {
      const biggest = Math.max(0, ...s.utxos.map((u) => u.value));
      t =
        biggest < inv.amount
          ? html`${inv.to} wants <b>${sats(inv.amount)}</b> sats. Your biggest coin is ${sats(biggest)} — and coins don’t split. Combine a few whole ones.`
          : html`${inv.to} wants <b>${sats(inv.amount)}</b> sats. There’s no “${compact(inv.amount)}” in your wallet — just ${n} separate coins. Pick some.`;
    } else if (!plan.ok) {
      t =
        plan.inputCount === 1
          ? html`One ${sats(plan.inputsTotal)} coin isn’t enough, and you can’t break off part of another. <b class="bad">${sats(plan.shortBy)} short</b> — add a whole coin.`
          : html`${plan.inputCount} coins = ${sats(plan.inputsTotal)}. Still <b class="bad">${sats(plan.shortBy)} short</b> once the fee is counted — add another whole coin.`;
    } else if (plan.hasChange) {
      const k = plan.inputCount;
      t = html`${k === 1 ? 'One coin' : `${k} whole coins`} (${sats(plan.inputsTotal)}) cover it. Nothing splits, so the transaction makes new coins: ${sats(plan.payment)} for ${inv.to}, <b class="fee">${sats(plan.fee)}</b> to the miner, <b class="change">${sats(plan.change)}</b> back to you.`;
    } else if (plan.dustToFee > 0) {
      t = html`Nearly exact. The ${sats(plan.dustToFee)} leftover can’t pay for a change coin worth keeping, so the miner gets it.`;
    } else {
      t = html`Exact match — no change coin needed. Rare in the wild; wallets search for these.`;
    }
    if (t.value !== this.lastNarration) {
      this.lastNarration = t.value;
      setHtml(this.narratorEl, t);
      this.narratorEl.classList.remove('bump');
      void this.narratorEl.offsetWidth;
      this.narratorEl.classList.add('bump');
      // Screen readers get the settled sentence, not every step of a slider drag.
      window.clearTimeout(this.announceTimer);
      this.announceTimer = window.setTimeout(() => {
        this.announcerEl.textContent = this.narratorEl.textContent ?? '';
      }, 700);
    }
  }

  private renderCoach(s: State, plan: TxPlan) {
    let t: SafeHtml | null;
    const inv = invoiceOf(s);
    if (s.phase === 'sending') t = null;
    else if (s.mode === 'myth')
      t = s.phase === 'receipt' ? html`${PRESS} ${hint('2', 'What Bitcoin does')} to see what actually happened` : html`${PRESS} ${hint('Space', 'Send')} to pay ${sats(inv.amount)}`;
    else if (s.phase === 'receipt')
      t =
        s.history.length === 1
          ? html`Now ${PRESS.toLowerCase()} ${hint('1', 'What people think')} to see how most people picture it`
          : COARSE
            ? html`Tap <b>Next bill</b>`
            : html`Press <kbd>Space</kbd> for the next bill`;
    else if (plan.inputCount === 0) t = html`${COARSE ? 'Tap' : 'Click'} coins to cover <b>${sats(inv.amount)}</b> + fee`;
    else if (!plan.ok) t = html`Add a coin — <b>${sats(plan.shortBy)}</b> short`;
    else t = COARSE ? html`Tap <b>Send</b>` : html`Press <kbd>Space</kbd> to send`;
    const key = t?.value ?? '';
    if (key !== this.lastCoach) {
      this.lastCoach = key;
      setHtml(this.coachEl, t ? html`<span>${t}</span>` : html``);
      this.coachEl.classList.toggle('is-on', !!t);
    }
  }
}
