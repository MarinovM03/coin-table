import { DUST_SATS, INPUT_VB, OUTPUT_VB, droppedChangeValue, inputCost, pickCoins, planTx, type TxPlan } from '../model/bitcoin';
import { FEE_MAX, FEE_MIN, invoiceOf, selectedCoins, type State, type TxRecord } from '../model/store';
import { INVOICES, walletTotal, type Utxo } from '../model/wallet';
import { btc, compact, plural, sats } from '../util/format';
import { html, setHtml } from '../util/html';
import { $, COARSE } from './dom';
import { Ticker } from './ticker';

export interface LedgerActions {
  send(): void;
  pick(): void;
  clear(): void;
  setFee(rate: number): void;
  toggleInput(id: string): void;
}

export class Ledger {
  private el = $('ledger');
  private feeInput = $<HTMLInputElement>('fee');
  private tickers = {
    inSum: new Ticker($('in-sum')),
    pay: new Ticker($('pay-v')),
    fee: new Ticker($('fee-v')),
    change: new Ticker($('change-v')),
    bankBal: new Ticker($('bank-bal')),
    bankNew: new Ticker($('bank-new')),
  };
  private lastChips = '';

  constructor(actions: LedgerActions) {
    $('btn-send').addEventListener('click', () => actions.send());
    $('btn-pick').addEventListener('click', () => actions.pick());
    $('btn-clear').addEventListener('click', () => actions.clear());

    this.feeInput.min = String(FEE_MIN);
    this.feeInput.max = String(FEE_MAX);
    this.feeInput.addEventListener('input', () => actions.setFee(Number(this.feeInput.value)));
    const sliderKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
    this.feeInput.addEventListener('keydown', (e) => {
      if (sliderKeys.has(e.key)) e.stopPropagation();
    });

    $('in-chips').addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (chip?.dataset.id) actions.toggleInput(chip.dataset.id);
    });
  }

  update(dt: number) {
    for (const t of Object.values(this.tickers)) t.update(dt);
  }

  render(s: State, done: TxRecord | null, plan: TxPlan) {
    const inv = done ? done.invoice : invoiceOf(s);
    this.el.classList.toggle('is-paid', !!done);

    $('inv-to').textContent = inv.to;
    $('inv-memo').textContent = `${inv.memo} · ${btc(inv.amount)}`;
    $('inv-amt').textContent = sats(inv.amount);
    $('inv-n').textContent = `bill ${(s.invoiceIndex % INVOICES.length) + 1}/${INVOICES.length}`;

    this.feeInput.value = String(s.feeRate);
    this.feeInput.disabled = s.phase === 'sending';
    $('fee-rate').textContent = String(s.feeRate);
    const pct = ((s.feeRate - FEE_MIN) / (FEE_MAX - FEE_MIN)) * 100;
    this.feeInput.style.setProperty('--p', `${pct}%`);

    // The bank view previews exactly what the payment will do: the wallet's own coin pick.
    const mythPlan = done ? done.plan : bankPlan(s);

    this.renderReality(s, plan, done ? done.inputs : selectedCoins(s));
    this.renderMyth(s, mythPlan, !!done);

    const send = $<HTMLButtonElement>('btn-send');
    const ready = s.mode === 'myth' ? !!mythPlan : plan.ok;
    const broke = !done && !mythPlan;
    send.disabled = s.phase === 'sending';
    send.classList.toggle('is-ready', (s.phase === 'select' && (ready || broke)) || !!done);
    send.classList.toggle('is-next', !!done);
    send.querySelector('.lbl')!.textContent = done
      ? 'Next bill'
      : broke
        ? 'Refill wallet'
        : ready
          ? `Send ${compact(inv.amount)}`
          : s.mode === 'myth' || plan.inputCount
            ? 'Not enough'
            : 'Pick coins';
  }

  shake() {
    this.el.classList.remove('shake');
    void this.el.offsetWidth;
    this.el.classList.add('shake');
  }

  private renderReality(s: State, plan: TxPlan, coins: Utxo[]) {
    this.tickers.inSum.set(plan.inputsTotal);
    this.tickers.pay.set(plan.payment);
    this.tickers.fee.set(plan.inputCount ? plan.fee : 0);
    this.tickers.change.set(plan.ok ? plan.change : 0);

    $('in-count').textContent = coins.length ? `${coins.length} ${plural(coins.length, 'coin')}` : 'none yet';
    $('fee-math').textContent = plan.inputCount
      ? plan.dustToFee > 0
        ? `${plan.feeRate} × ${plan.vbytes} vB + ${sats(plan.dustToFee)} leftover`
        : `${plan.feeRate} sat/vB × ${plan.vbytes} vB`
      : `${s.feeRate} sat/vB × size`;

    const chips = $('in-chips');
    const spent = s.phase === 'receipt';
    // Coins on a phone screen are smaller than a fingertip, so touch devices also get the wallet as buttons.
    const choose = COARSE && !spent;
    const list = choose ? [...s.utxos].sort((a, b) => b.value - a.value) : coins;
    const chipsHtml = html`${list.map((c) => {
      if (spent) return html`<span class="chip is-spent">${sats(c.value)}</span>`;
      if (!choose)
        return html`<button type="button" class="chip" data-id="${c.id}" title="Remove from inputs" aria-label="Remove ${sats(c.value)} from inputs">${sats(c.value)}<i aria-hidden="true">×</i></button>`;
      const on = s.selected.includes(c.id);
      return html`<button type="button" class="chip${on ? ' is-in' : ''}" data-id="${c.id}" aria-pressed="${on ? 'true' : 'false'}">${sats(c.value)}</button>`;
    })}`;
    if (chipsHtml.value !== this.lastChips) {
      this.lastChips = chipsHtml.value;
      setHtml(chips, chipsHtml);
    }
    chips.classList.toggle('empty', list.length === 0);
    chips.classList.toggle('is-chooser', choose);

    const note = $('change-note');
    const rowChange = this.el.querySelector('.row-change')!;
    rowChange.classList.toggle('is-none', plan.ok && !plan.hasChange);
    note.textContent = plan.ok && !plan.hasChange ? (plan.dustToFee > 0 ? 'none · leftover → fee' : 'none · exact') : 'back to you';

    const split = $('split');
    const denom = Math.max(plan.inputsTotal, plan.payment + plan.fee, 1);
    const w = (v: number) => `${(Math.max(0, v) / denom) * 100}%`;
    const segs = split.children as HTMLCollectionOf<HTMLElement>;
    const any = plan.inputCount > 0;
    const covered = Math.min(plan.inputsTotal, plan.payment + plan.fee);
    const payW = plan.ok ? plan.payment : Math.min(plan.inputsTotal, plan.payment);
    const feeW = plan.ok ? plan.fee : Math.max(0, covered - payW);
    segs[0].style.width = w(any ? payW : 0);
    segs[1].style.width = w(any ? feeW : 0);
    segs[2].style.width = w(plan.ok ? plan.change : 0);
    segs[3].style.width = w(any && !plan.ok ? plan.shortBy : 0);
    split.classList.toggle('is-empty', plan.inputCount === 0);

    const warn = $('warn');
    let msg = html``;
    let kind = '';
    if (spent) {
      msg = html``;
    } else if (plan.inputCount > 0 && !plan.ok) {
      msg = html`Short by <b>${sats(plan.shortBy)}</b> sats — add another coin.`;
      kind = 'is-bad';
    } else if (plan.ok && plan.dustToFee > 0) {
      const outputFee = OUTPUT_VB * plan.feeRate;
      const wouldBe = droppedChangeValue(plan);
      msg =
        wouldBe <= 0
          ? html`The ${sats(plan.dustToFee)} left over can’t even pay the ${sats(outputFee)}-sat fee for its own change output, so there’s no change coin — it goes to the miner.`
          : html`A change coin would be worth just ${sats(wouldBe)} after paying ${sats(outputFee)} for its own output — under the ${DUST_SATS}-sat dust limit. So there’s no change coin, and the ${sats(plan.dustToFee)} goes to the miner.`;
      kind = 'is-info';
    } else if (plan.ok) {
      const worst = coins.find((c) => c.value <= inputCost(s.feeRate));
      if (worst) {
        msg = html`That ${sats(worst.value)}-sat coin costs ${sats(inputCost(s.feeRate))} in fees to spend at ${s.feeRate} sat/vB. It’s losing you money.`;
        kind = 'is-warn';
      } else if (coins.length >= 3) {
        msg = html`Every input adds ≈${INPUT_VB} vB. Fewer, bigger coins = smaller fee.`;
        kind = 'is-info';
      }
    }
    setHtml(warn, msg);
    warn.className = `warn ${kind}`;
  }

  private renderMyth(s: State, plan: TxPlan | null, paid: boolean) {
    const total = walletTotal(s.utxos);
    const inv = paid && s.lastTx ? s.lastTx.invoice : invoiceOf(s);
    const fee = plan?.fee ?? 0;
    // After paying, show the before → after of the payment that just happened.
    const before = paid ? total + inv.amount + fee : total;
    this.tickers.bankBal.set(before);
    $('bank-to').textContent = inv.to;
    $('bank-pay').textContent = `−${sats(inv.amount)}`;
    $('bank-fee').textContent = plan ? `−${sats(fee)}` : 'not enough funds';
    this.tickers.bankNew.set(plan ? before - inv.amount - fee : before);
  }
}

function bankPlan(s: State): TxPlan | null {
  const inv = invoiceOf(s);
  const picked = pickCoins(s.utxos, inv.amount, s.feeRate);
  return picked
    ? planTx(
        picked.map((u) => u.value),
        inv.amount,
        s.feeRate,
      )
    : null;
}
