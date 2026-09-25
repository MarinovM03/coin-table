import { DUST_SATS, INPUT_VB, inputCost, type TxPlan } from '../model/bitcoin';
import { FEE_MAX, FEE_MIN, currentPlan, invoiceOf, selectedCoins, type Mode, type State, type TxRecord } from '../model/store';
import { INVOICES, shortTxid, walletTotal, type Utxo } from '../model/wallet';
import { btc, compact, plural, sats } from '../util/format';

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
  private camTimer = 0;
  private lastCoach = '';
  private lastNarration = '';

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
    $('btn-next').addEventListener('click', () => actions.next());
    $('btn-pick').addEventListener('click', () => actions.pick());
    $('btn-clear').addEventListener('click', () => actions.clear());
    $('btn-how').addEventListener('click', () => actions.toggleHow());
    $('how-close').addEventListener('click', () => actions.toggleHow());
    $('btn-sound').addEventListener('click', () => actions.toggleSound());
    $('btn-hide').addEventListener('click', () => actions.toggleHide());
    $('unhide').addEventListener('click', () => actions.toggleHide());
    $('btn-cam').addEventListener('click', () => actions.nextCamera());

    this.feeInput.min = String(FEE_MIN);
    this.feeInput.max = String(FEE_MAX);
    this.feeInput.addEventListener('input', () => actions.setFee(Number(this.feeInput.value)));
    // Arrow keys on a focused slider shouldn't also drive the coin focus.
    this.feeInput.addEventListener('keydown', (e) => e.stopPropagation());

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
    $('how').setAttribute('aria-hidden', String(!s.howOpen));
    $('btn-how').classList.toggle('is-on', s.howOpen);
    $('btn-sound').classList.toggle('is-muted', s.muted);

    for (const b of document.querySelectorAll<HTMLButtonElement>('#modes button')) {
      const on = b.dataset.mode === s.mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
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
    $('fee-rate').textContent = String(s.feeRate);
    const pct = ((s.feeRate - FEE_MIN) / (FEE_MAX - FEE_MIN)) * 100;
    this.feeInput.style.setProperty('--p', `${pct}%`);

    this.renderReality(s, plan, done ? done.inputs : selectedCoins(s));
    this.renderMyth(s, plan, !!done);

    const send = $<HTMLButtonElement>('btn-send');
    const canSend = s.phase === 'select' && (s.mode === 'myth' ? this.mythPlanOk(s) : plan.ok);
    send.disabled = s.phase === 'sending';
    send.classList.toggle('is-ready', canSend || !!done);
    send.classList.toggle('is-next', !!done);
    send.querySelector('.lbl')!.textContent = done
      ? 'Next bill'
      : s.mode === 'myth' || plan.ok
        ? `Send ${compact(inv.amount)}`
        : plan.inputCount
          ? 'Not enough'
          : 'Pick coins';

    this.renderNarration(s, plan);
    this.renderCoach(s, plan);
  }

  private mythPlanOk(s: State): boolean {
    return walletTotal(s.utxos) > invoiceOf(s).amount;
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
    const html = coins
      .map((c) =>
        spent
          ? `<span class="chip is-spent">${sats(c.value)}</span>`
          : `<button class="chip" data-id="${c.id}" title="Remove from inputs">${sats(c.value)}<i>×</i></button>`,
      )
      .join('');
    if (chips.innerHTML !== html) chips.innerHTML = html;
    chips.classList.toggle('empty', coins.length === 0);

    const note = $('change-note');
    const rowChange = this.root.querySelector('.row-change')!;
    rowChange.classList.toggle('is-none', plan.ok && !plan.hasChange);
    note.textContent = plan.ok && !plan.hasChange ? (plan.dustToFee > 0 ? 'none · dust → fee' : 'none · exact') : 'back to you';

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
    let msg = '';
    let kind = '';
    if (spent) {
      msg = '';
    } else if (plan.inputCount > 0 && !plan.ok) {
      msg = `Short by <b>${sats(plan.shortBy)}</b> sats — add another coin.`;
      kind = 'is-bad';
    } else if (plan.ok && plan.dustToFee > 0) {
      msg = `The ${sats(plan.dustToFee)} left over is under the ${DUST_SATS}-sat dust limit, so there’s no change coin — it tips the miner instead.`;
      kind = 'is-info';
    } else if (plan.ok) {
      const worst = coins.find((c) => c.value <= inputCost(s.feeRate));
      if (worst) {
        msg = `That ${sats(worst.value)}-sat coin costs ${sats(inputCost(s.feeRate))} in fees to spend at ${s.feeRate} sat/vB. It’s losing you money.`;
        kind = 'is-warn';
      } else if (coins.length >= 3) {
        msg = `Every input adds ≈${INPUT_VB} vB. Fewer, bigger coins = smaller fee.`;
        kind = 'is-info';
      }
    }
    warn.innerHTML = msg;
    warn.className = `warn ${kind}`;
  }

  private renderMyth(s: State, plan: TxPlan, paid: boolean) {
    const total = walletTotal(s.utxos);
    const inv = paid && s.lastTx ? s.lastTx.invoice : invoiceOf(s);
    // In the bank picture the fee is just "some fee": use a typical 1-in, 2-out size.
    const fee = plan.ok ? plan.fee : 141 * s.feeRate;
    // After paying, show the before → after of the payment that just happened.
    const before = paid ? total + inv.amount + fee : total;
    this.tickers.bankBal.set(before);
    $('bank-to').textContent = inv.to;
    $('bank-pay').textContent = `−${sats(inv.amount)}`;
    $('bank-fee').textContent = `−${sats(fee)}`;
    this.tickers.bankNew.set(Math.max(0, before - inv.amount - fee));
  }

  private renderNarration(s: State, plan: TxPlan) {
    const inv = invoiceOf(s);
    const n = s.utxos.length;
    let t = '';
    if (s.mode === 'myth') {
      t =
        s.phase === 'receipt'
          ? `The number went down. That’s all this view can show. Press <kbd>2</kbd> — the coins underneath changed shape.`
          : `The bank-app picture: one number, and paying just subtracts. Press <kbd>Space</kbd> to pay ${inv.to}, then <kbd>2</kbd> to look underneath.`;
    } else if (s.phase === 'sending') {
      t = `Inputs are consumed whole. New outputs are being created…`;
    } else if (s.phase === 'receipt' && s.lastTx) {
      const tx = s.lastTx;
      t = `Done: ${tx.inputs.length} ${plural(tx.inputs.length, 'coin')} in, ${tx.change ? 2 : 1} out. Your wallet now holds ${n} ${plural(n, 'coin')}.`;
    } else if (plan.inputCount === 0) {
      const biggest = Math.max(0, ...s.utxos.map((u) => u.value));
      t =
        biggest < inv.amount
          ? `${inv.to} wants <b>${sats(inv.amount)}</b> sats. Your biggest coin is ${sats(biggest)} — and coins don’t split. Combine a few whole ones.`
          : `${inv.to} wants <b>${sats(inv.amount)}</b> sats. There’s no “${compact(inv.amount)}” in your wallet — just ${n} separate coins. Pick some.`;
    } else if (!plan.ok) {
      t =
        plan.inputCount === 1
          ? `One ${sats(plan.inputsTotal)} coin isn’t enough, and you can’t break off part of another. <b class="bad">${sats(plan.shortBy)} short</b> — add a whole coin.`
          : `${plan.inputCount} coins = ${sats(plan.inputsTotal)}. Still <b class="bad">${sats(plan.shortBy)} short</b> once the fee is counted — add another whole coin.`;
    } else if (plan.hasChange) {
      const k = plan.inputCount;
      t = `${k === 1 ? 'One coin' : `${k} whole coins`} (${sats(plan.inputsTotal)}) cover it. Nothing splits, so the transaction makes new coins: ${sats(plan.payment)} for ${inv.to}, <b class="fee">${sats(plan.fee)}</b> to the miner, <b class="change">${sats(plan.change)}</b> back to you.`;
    } else if (plan.dustToFee > 0) {
      t = `Nearly exact. The ${sats(plan.dustToFee)} leftover is too small to be its own coin, so the miner gets it.`;
    } else {
      t = `Exact match — no change coin needed. Rare in the wild; wallets search for these.`;
    }
    if (t !== this.lastNarration) {
      this.lastNarration = t;
      this.narratorEl.innerHTML = t;
      this.narratorEl.classList.remove('bump');
      void this.narratorEl.offsetWidth;
      this.narratorEl.classList.add('bump');
    }
  }

  private renderCoach(s: State, plan: TxPlan) {
    let t = '';
    const inv = invoiceOf(s);
    if (s.phase === 'sending') t = '';
    else if (s.mode === 'myth') t = s.phase === 'receipt' ? 'Press <kbd>2</kbd> to see what actually happened' : `Press <kbd>Space</kbd> to pay ${sats(inv.amount)}`;
    else if (s.phase === 'receipt') t = s.history.length === 1 ? 'Now press <kbd>1</kbd> to see how most people picture it' : 'Press <kbd>Space</kbd> for the next bill';
    else if (plan.inputCount === 0) t = `${COARSE ? 'Tap' : 'Click'} coins to cover <b>${sats(inv.amount)}</b> + fee`;
    else if (!plan.ok) t = `Add a coin — <b>${sats(plan.shortBy)}</b> short`;
    else t = 'Press <kbd>Space</kbd> to send';
    if (t !== this.lastCoach) {
      this.lastCoach = t;
      this.coachEl.innerHTML = t ? `<span>${t}</span>` : '';
      this.coachEl.classList.toggle('is-on', !!t);
    }
  }

  showTip(u: Utxo, x: number, y: number, s: State, selected: boolean, mine: boolean) {
    // Called every frame while hovering: move it every time, rebuild it only when it changes.
    const key = `${u.id}|${u.confirmed}|${s.feeRate}|${selected}|${mine}`;
    if (key !== this.tipKey) {
      this.tipKey = key;
      this.tip.innerHTML = mine ? this.tipMine(u, s, selected) : this.tipTheirs(u);
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

  private tipTheirs(u: Utxo): string {
    return `
      <div class="tip-v">${sats(u.value)} <small>sats</small> <span class="pill pay">theirs</span>${u.confirmed ? '' : '<span class="pill pending">unconfirmed</span>'}</div>
      <div class="tip-from">${u.from}</div>
      <div class="tip-op"><span>outpoint</span> ${shortTxid(u.txid)}:${u.vout}</div>
      <div class="tip-act">A UTXO in their wallet now. Only their key can spend it.</div>`;
  }

  private tipMine(u: Utxo, s: State, selected: boolean): string {
    const cost = inputCost(s.feeRate);
    const warn = u.value <= cost;
    const origin =
      u.origin === 'change' ? '<span class="pill change">change</span>' : u.origin === 'payment' ? '<span class="pill pay">received</span>' : '';
    const pending = !u.confirmed ? '<span class="pill pending">unconfirmed</span>' : '';
    const verb = COARSE ? 'Tap' : 'Click';
    return `
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

  toast(html: string, kind: '' | 'good' | 'warn' | 'myth' = '', ms = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = html;
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
    this.camBadgeEl.innerHTML = `<span class="rec"></span>CAM ${name}<small><kbd>C</kbd> next · <kbd>R</kbd> or drag to take over</small>`;
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
    $('rc-hint').innerHTML =
      tx.mode === 'myth'
        ? 'Press <kbd>2</kbd> to see what really happened'
        : firstTime
          ? 'Now try <kbd>1</kbd> — how most people picture this'
          : 'Change coins are real coins: spend them next.';
    $('rc-txid').textContent = shortTxid(tx.txid);
    const status = $('rc-status');
    status.textContent = 'unconfirmed';
    status.className = 'rc-status';

    if (tx.mode === 'myth') {
      $('rc-kicker').textContent = 'Balance updated';
      $('rc-flow').innerHTML = `
        <div class="myth-flow">
          <span class="big">−${sats(inv.amount + p.fee)}</span>
          <span class="sub">${sats(inv.amount)} to ${inv.to} + ${sats(p.fee)} fee</span>
        </div>`;
      $('rc-say').innerHTML = `Simple, right? That’s the story apps tell. But nothing was “subtracted.” Underneath, whole coins were spent and a new one probably came back as change.`;
      $('btn-next').querySelector('.lbl')!.textContent = 'Next bill';
    } else {
      $('rc-kicker').textContent = 'Transaction broadcast';
      const ins = tx.inputs.map((u) => `<span class="rc-coin in">${sats(u.value)}</span>`).join('');
      const outs = [
        `<span class="rc-coin pay">${sats(tx.payment.value)}<em>→ ${inv.to}</em></span>`,
        tx.change ? `<span class="rc-coin change">${sats(tx.change.value)}<em>→ you (change)</em></span>` : '',
        `<span class="rc-coin fee">${sats(p.fee)}<em>→ miner (the gap)</em></span>`,
      ].join('');
      $('rc-flow').innerHTML = `
        <div class="rc-col"><span class="rc-k">Inputs · spent whole</span>${ins}</div>
        <div class="rc-arrow"><span>tx</span></div>
        <div class="rc-col"><span class="rc-k">Outputs · new coins</span>${outs}</div>`;
      const k = tx.inputs.length;
      const changeLine = tx.change
        ? `<b class="change">${sats(tx.change.value)}</b> back to you as change`
        : p.dustToFee > 0
          ? `no change (the ${sats(p.dustToFee)} leftover was dust)`
          : 'no change needed';
      $('rc-say').innerHTML = `You spent ${k} ${plural(k, 'coin')} worth ${sats(p.inputsTotal)} — whole. The transaction made ${sats(tx.payment.value)} for ${inv.to} and ${changeLine}. The <b class="fee">${sats(p.fee)}</b> nobody claimed is the fee. Your wallet: ${walletCount} ${plural(walletCount, 'coin')}.`;
      $('btn-next').querySelector('.lbl')!.textContent = 'Next bill';
    }
    this.receiptEl.classList.add('is-on');
  }

  confirmReceipt() {
    const status = $('rc-status');
    status.textContent = 'in a block ✓';
    status.className = 'rc-status ok';
  }

  hideReceipt() {
    this.receiptEl.classList.remove('is-on');
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
