import { DUST_SATS, INPUT_VB, OUTPUT_VB, droppedChangeValue, inputCost, pickCoins, planTx, type TxPlan } from '../model/bitcoin';
import { FEE_MAX, FEE_MIN, currentPlan, invoiceOf, selectedCoins, type Mode, type State, type TxRecord } from '../model/store';
import { INVOICES, shortTxid, walletTotal, type Utxo } from '../model/wallet';
import { btc, compact, plural, sats } from '../util/format';
import { html, setHtml, type SafeHtml } from '../util/html';

export interface HudActions {
  setMode(m: Mode): void;
  send(): void;
  next(): void;
  pick(): void;
  clear(): void;
  setFee(rate: number): void;
  toggleHow(): void;
  toggleSound(): void;
  toggleHide(): void;
  nextCamera(): void;
  removeInput(id: string): void;
  highlightTerm(term: string | null): void;
}

/** Phones and tablets: say "tap", not "click". */
export const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

class Ticker {
  private cur = 0;
  private target = 0;
  private primed = false;
  constructor(
    private el: HTMLElement,
    private fmt: (n: number) => string = sats,
  ) {}
  set(v: number) {
    this.target = v;
    if (!this.primed) {
      this.cur = v;
      this.primed = true;
      this.el.textContent = this.fmt(v);
    }
  }
  update(dt: number) {
    if (this.cur === this.target) return;
    const d = this.target - this.cur;
    const step = d * (1 - Math.exp(-14 * dt));
    this.cur = Math.abs(d) < 1 ? this.target : this.cur + step;
    this.el.textContent = this.fmt(Math.round(this.cur));
  }
}

export class Hud {
  private root = $('hud');
  private tickers: Record<string, Ticker>;
  private tip = $('tip');
  private coachEl = $('coach');
  private toastsEl = $('toasts');
  private camBadgeEl = $('cam-badge');
  private receiptEl = $('receipt');
  private narratorEl = $('narrator');
  private feeInput = $<HTMLInputElement>('fee');
  private announcerEl = $('announcer');
  private camTimer = 0;
  private lastCoach = '';
  private lastNarration = '';
  private lastChips = '';
  private announceTimer = 0;
  private howWasOpen = false;

  constructor(actions: HudActions) {
    this.tickers = {
      total: new Ticker($('stat-total'), (n) => `${sats(n)} sats`),
      inSum: new Ticker($('in-sum')),
      pay: new Ticker($('pay-v')),
      fee: new Ticker($('fee-v')),
      change: new Ticker($('change-v')),
      bankBal: new Ticker($('bank-bal')),
      bankNew: new Ticker($('bank-new')),
    };

    for (const b of document.querySelectorAll<HTMLButtonElement>('#modes button')) {
      b.addEventListener('click', () => actions.setMode(b.dataset.mode as Mode));
    }
    $('btn-send').addEventListener('click', () => actions.send());
    $('btn-pick').addEventListener('click', () => actions.pick());
    $('btn-clear').addEventListener('click', () => actions.clear());
    $('btn-how').addEventListener('click', () => actions.toggleHow());
    $('how-close').addEventListener('click', () => actions.toggleHow());
    $('btn-sound').addEventListener('click', () => actions.toggleSound());
    $('btn-hide').addEventListener('click', () => actions.toggleHide());
    $('unhide').addEventListener('click', () => actions.toggleHide());
    $('btn-cam').addEventListener('click', () => actions.nextCamera());
    $('gpu-reload').addEventListener('click', () => window.location.reload());

    this.feeInput.min = String(FEE_MIN);
    this.feeInput.max = String(FEE_MAX);
    this.feeInput.addEventListener('input', () => actions.setFee(Number(this.feeInput.value)));
    // A focused slider owns its navigation keys; everything else stays a shortcut.
    const sliderKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
    this.feeInput.addEventListener('keydown', (e) => {
      if (sliderKeys.has(e.key)) e.stopPropagation();
    });

    $('in-chips').addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (chip?.dataset.id) actions.removeInput(chip.dataset.id);
    });

    const how = $('how');
    how.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-term]');
      if (t) actions.highlightTerm(t.dataset.term ?? null);
    });
    how.addEventListener('pointerleave', () => actions.highlightTerm(null));
  }

  update(dt: number) {
    for (const t of Object.values(this.tickers)) t.update(dt);
    if (this.camTimer > 0) {
      this.camTimer -= dt;
      if (this.camTimer <= 0) this.camBadgeEl.classList.remove('is-on');
    }
  }

  render(s: State) {
    const body = document.body;
    body.dataset.mode = s.mode;
    body.dataset.phase = s.phase;
    body.classList.toggle('ui-hidden', s.uiHidden);
    body.classList.toggle('labels-off', !s.labels);
    body.classList.toggle('how-open', s.howOpen);
    const how = $('how');
    how.inert = !s.howOpen;
    this.root.inert = s.uiHidden;
    if (s.howOpen !== this.howWasOpen) {
      this.howWasOpen = s.howOpen;
      if (s.howOpen) $('how-close').focus({ preventScroll: true });
      else if (how.contains(document.activeElement)) $('btn-how').focus({ preventScroll: true });
    }
    $('btn-how').classList.toggle('is-on', s.howOpen);
    $('btn-sound').classList.toggle('is-muted', s.muted);

    for (const b of document.querySelectorAll<HTMLButtonElement>('#modes button')) {
      const on = b.dataset.mode === s.mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }

    // While the receipt is up, the ledger freezes on the transaction that just happened.
    const done = s.phase === 'receipt' && s.lastTx ? s.lastTx : null;
    const inv = done ? done.invoice : invoiceOf(s);
    const plan = done ? done.plan : currentPlan(s);
    const total = walletTotal(s.utxos);
    $('ledger').classList.toggle('is-paid', !!done);

    this.tickers.total.set(total);
    $('stat-count').textContent = String(s.utxos.length);
    $('stat-rate').textContent = `${s.feeRate} sat/vB`;

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
    const mythPlan = done ? done.plan : this.mythPlan(s);

    this.renderReality(s, plan, done ? done.inputs : selectedCoins(s));
    this.renderMyth(s, mythPlan, !!done);

    const send = $<HTMLButtonElement>('btn-send');
    const ready = s.mode === 'myth' ? !!mythPlan : plan.ok;
    send.disabled = s.phase === 'sending';
    send.classList.toggle('is-ready', (s.phase === 'select' && ready) || !!done);
    send.classList.toggle('is-next', !!done);
    send.querySelector('.lbl')!.textContent = done
      ? 'Next bill'
      : ready
        ? `Send ${compact(inv.amount)}`
        : s.mode === 'myth' || plan.inputCount
          ? 'Not enough'
          : 'Pick coins';

    this.renderNarration(s, plan);
    this.renderCoach(s, plan);
  }

  private mythPlan(s: State): TxPlan | null {
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
    const chipsHtml = html`${coins.map((c) =>
      spent
        ? html`<span class="chip is-spent">${sats(c.value)}</span>`
        : html`<button type="button" class="chip" data-id="${c.id}" title="Remove from inputs">${sats(c.value)}<i>×</i></button>`,
    )}`;
    if (chipsHtml.value !== this.lastChips) {
      this.lastChips = chipsHtml.value;
      setHtml(chips, chipsHtml);
    }
    chips.classList.toggle('empty', coins.length === 0);

    const note = $('change-note');
    const rowChange = this.root.querySelector('.row-change')!;
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

  private renderNarration(s: State, plan: TxPlan) {
    const inv = invoiceOf(s);
    const n = s.utxos.length;
    let t: SafeHtml;
    if (s.mode === 'myth') {
      t =
        s.phase === 'receipt'
          ? html`The number went down. That’s all this view can show. Press <kbd>2</kbd> — the coins underneath changed shape.`
          : html`The bank-app picture: one number, and paying just subtracts. Press <kbd>Space</kbd> to pay ${inv.to}, then <kbd>2</kbd> to look underneath.`;
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
      t = s.phase === 'receipt' ? html`Press <kbd>2</kbd> to see what actually happened` : html`Press <kbd>Space</kbd> to pay ${sats(inv.amount)}`;
    else if (s.phase === 'receipt')
      t = s.history.length === 1 ? html`Now press <kbd>1</kbd> to see how most people picture it` : html`Press <kbd>Space</kbd> for the next bill`;
    else if (plan.inputCount === 0) t = html`${COARSE ? 'Tap' : 'Click'} coins to cover <b>${sats(inv.amount)}</b> + fee`;
    else if (!plan.ok) t = html`Add a coin — <b>${sats(plan.shortBy)}</b> short`;
    else t = html`Press <kbd>Space</kbd> to send`;
    const key = t?.value ?? '';
    if (key !== this.lastCoach) {
      this.lastCoach = key;
      setHtml(this.coachEl, t ? html`<span>${t}</span>` : html``);
      this.coachEl.classList.toggle('is-on', !!t);
    }
  }

  showTip(u: Utxo, x: number, y: number, s: State, selected: boolean, mine: boolean) {
    // Called every frame while hovering: move it every time, rebuild it only when it changes.
    const key = `${u.id}|${u.confirmed}|${s.feeRate}|${selected}|${mine}`;
    if (key !== this.tipKey) {
      this.tipKey = key;
      setHtml(this.tip, mine ? this.tipMine(u, s, selected) : this.tipTheirs(u));
      this.tipW = this.tip.offsetWidth;
      this.tipH = this.tip.offsetHeight;
    }
    // Above the coin so its neighbours stay visible; below if there's no room.
    const px = Math.min(Math.max(12, x + 16), window.innerWidth - this.tipW - 12);
    const above = y - this.tipH - 28;
    const py = above > 12 ? above : y + 36;
    this.tip.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
    this.tip.classList.add('is-on');
  }

  private tipTheirs(u: Utxo): SafeHtml {
    return html`
      <div class="tip-v">${sats(u.value)} <small>sats</small> <span class="pill pay">theirs</span>${u.confirmed ? '' : html`<span class="pill pending">unconfirmed</span>`}</div>
      <div class="tip-from">${u.from}</div>
      <div class="tip-op"><span>outpoint</span> ${shortTxid(u.txid)}:${u.vout}</div>
      <div class="tip-act">A UTXO in their wallet now. Only their key can spend it.</div>`;
  }

  private tipMine(u: Utxo, s: State, selected: boolean): SafeHtml {
    const cost = inputCost(s.feeRate);
    const warn = u.value <= cost;
    const origin =
      u.origin === 'change' ? html`<span class="pill change">change</span>` : u.origin === 'payment' ? html`<span class="pill pay">received</span>` : '';
    const pending = !u.confirmed ? html`<span class="pill pending">unconfirmed</span>` : '';
    const verb = COARSE ? 'Tap' : 'Click';
    return html`
      <div class="tip-v">${sats(u.value)} <small>sats</small> ${origin}${pending}</div>
      <div class="tip-from">${u.from}</div>
      <div class="tip-op"><span>outpoint</span> ${shortTxid(u.txid)}:${u.vout}</div>
      <div class="tip-cost ${warn ? 'bad' : ''}">Spending it adds ≈${INPUT_VB} vB → <b>${sats(cost)}</b> sats of fee${
        warn ? ' — more than it’s worth right now' : ''
      }</div>
      <div class="tip-act">${selected ? `${verb} to put it back` : `${verb} to use it — the whole coin`}</div>`;
  }

  hideTip() {
    this.tip.classList.remove('is-on');
  }

  private tipKey = '';
  private tipW = 270;
  private tipH = 130;

  toast(content: SafeHtml, kind: '' | 'good' | 'warn' | 'myth' = '', ms = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    setHtml(el, content);
    this.toastsEl.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-on'));
    window.setTimeout(() => {
      el.classList.remove('is-on');
      window.setTimeout(() => el.remove(), 500);
    }, ms);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstElementChild?.remove();
  }

  camBadge(name: string | null) {
    if (!name) {
      this.camBadgeEl.classList.remove('is-on');
      return;
    }
    setHtml(this.camBadgeEl, html`<span class="rec"></span>CAM ${name}<small><kbd>C</kbd> next · <kbd>R</kbd> or drag to take over</small>`);
    this.camBadgeEl.classList.add('is-on');
    this.camTimer = 3.2;
  }

  flashWarn() {
    const ledger = $('ledger');
    ledger.classList.remove('shake');
    void ledger.offsetWidth;
    ledger.classList.add('shake');
  }

  showReceipt(tx: TxRecord, walletCount: number, firstTime: boolean) {
    const inv = tx.invoice;
    const p = tx.plan;
    setHtml(
      $('rc-hint'),
      tx.mode === 'myth'
        ? html`Press <kbd>2</kbd> to see what really happened`
        : firstTime
          ? html`Now try <kbd>1</kbd> — how most people picture this`
          : html`Change coins are real coins: spend them next.`,
    );
    $('rc-txid').textContent = shortTxid(tx.txid);
    const status = $('rc-status');
    status.textContent = 'unconfirmed';
    status.className = 'rc-status';

    if (tx.mode === 'myth') {
      $('rc-kicker').textContent = 'Balance updated';
      setHtml(
        $('rc-flow'),
        html`
        <div class="myth-flow">
          <span class="big">−${sats(inv.amount + p.fee)}</span>
          <span class="sub">${sats(inv.amount)} to ${inv.to} + ${sats(p.fee)} fee</span>
        </div>`,
      );
      $('rc-say').textContent =
        'Simple, right? That’s the story apps tell. But nothing was “subtracted.” Underneath, whole coins were spent and a new one probably came back as change.';
    } else {
      $('rc-kicker').textContent = 'Transaction broadcast';
      const ins = tx.inputs.map((u) => html`<span class="rc-coin in">${sats(u.value)}</span>`);
      const outs = [
        html`<span class="rc-coin pay">${sats(tx.payment.value)}<em>→ ${inv.to}</em></span>`,
        tx.change ? html`<span class="rc-coin change">${sats(tx.change.value)}<em>→ you (change)</em></span>` : '',
        html`<span class="rc-coin fee">${sats(p.fee)}<em>→ miner (the gap)</em></span>`,
      ];
      setHtml(
        $('rc-flow'),
        html`
        <div class="rc-col"><span class="rc-k">Inputs · spent whole</span>${ins}</div>
        <div class="rc-arrow"><span>tx</span></div>
        <div class="rc-col"><span class="rc-k">Outputs · new coins</span>${outs}</div>`,
      );
      const k = tx.inputs.length;
      const changeLine = tx.change
        ? html`<b class="change">${sats(tx.change.value)}</b> back to you as change`
        : p.dustToFee > 0
          ? html`no change — the ${sats(p.dustToFee)} leftover couldn’t pay for a change coin worth keeping`
          : html`no change needed`;
      setHtml(
        $('rc-say'),
        html`You spent ${k} ${plural(k, 'coin')} worth ${sats(p.inputsTotal)} — whole. The transaction made ${sats(tx.payment.value)} for ${inv.to} and ${changeLine}. The <b class="fee">${sats(p.fee)}</b> nobody claimed is the fee. Your wallet: ${walletCount} ${plural(walletCount, 'coin')}.`,
      );
    }
    this.receiptEl.classList.add('is-on');
    this.receiptEl.inert = false;
    this.announcerEl.textContent = `${$('rc-kicker').textContent}. ${$('rc-say').textContent}`;
  }

  confirmReceipt() {
    const status = $('rc-status');
    status.textContent = 'in a block ✓';
    status.className = 'rc-status ok';
  }

  hideReceipt() {
    this.receiptEl.classList.remove('is-on');
    this.receiptEl.inert = true;
  }

  gpuLost(on: boolean) {
    const el = $('gpu-lost');
    el.hidden = !on;
    el.classList.remove('is-stuck');
  }

  gpuStuck() {
    $('gpu-lost').classList.add('is-stuck');
  }

  pulseModes() {
    const m = $('modes');
    m.classList.remove('beckon');
    void m.offsetWidth;
    m.classList.add('beckon');
  }

  setTermHighlight(term: string | null) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-term]')) {
      el.classList.toggle('is-lit', !!term && el.dataset.term === term);
    }
    document.body.dataset.term = term ?? '';
  }
}
