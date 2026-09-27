import type { TxRecord } from '../model/store';
import { shortTxid } from '../model/wallet';
import { plural, sats } from '../util/format';
import { html, setHtml } from '../util/html';
import { $, PRESS, hint } from './dom';

export class Receipt {
  private el = $('receipt');

  show(tx: TxRecord, walletCount: number, firstTime: boolean) {
    const inv = tx.invoice;
    const p = tx.plan;
    setHtml(
      $('rc-hint'),
      tx.mode === 'myth'
        ? html`${PRESS} ${hint('2', 'What Bitcoin does')} to see what really happened`
        : firstTime
          ? html`Now try ${hint('1', 'What people think')} — how most people picture this`
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
    this.el.classList.add('is-on');
    this.el.inert = false;
    $('announcer').textContent = `${$('rc-kicker').textContent}. ${$('rc-say').textContent}`;
  }

  confirm() {
    const status = $('rc-status');
    status.textContent = 'in a block ✓';
    status.className = 'rc-status ok';
  }

  hide() {
    this.el.classList.remove('is-on');
    this.el.inert = true;
  }
}
