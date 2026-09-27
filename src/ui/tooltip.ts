import { INPUT_VB, inputCost } from '../model/bitcoin';
import type { State } from '../model/store';
import { shortTxid, type Utxo } from '../model/wallet';
import { sats } from '../util/format';
import { html, setHtml, type SafeHtml } from '../util/html';
import { $, COARSE } from './dom';

export class Tooltip {
  private el = $('tip');
  private canvas = $('gl');
  private on = false;
  private key = '';
  private w = 270;
  private h = 130;

  show(u: Utxo, x: number, y: number, s: State, selected: boolean, mine: boolean, byKeys: boolean) {
    // Called every frame while hovering: move it every time, rebuild it only when it changes.
    const key = `${u.id}|${u.confirmed}|${s.feeRate}|${selected}|${mine}|${byKeys}`;
    if (key !== this.key) {
      this.key = key;
      setHtml(this.el, mine ? yourCoin(u, s, selected, byKeys) : theirCoin(u));
      this.w = this.el.offsetWidth;
      this.h = this.el.offsetHeight;
    }
    const px = Math.min(Math.max(12, x + 16), window.innerWidth - this.w - 12);
    const above = y - this.h - 28;
    const py = above > 12 ? above : y + 36;
    this.el.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
    this.el.classList.add('is-on');
    if (!this.on) {
      this.on = true;
      this.canvas.setAttribute('aria-describedby', 'tip');
    }
  }

  hide() {
    this.el.classList.remove('is-on');
    if (this.on) {
      this.on = false;
      this.canvas.removeAttribute('aria-describedby');
    }
  }
}

function theirCoin(u: Utxo): SafeHtml {
  return html`
    <div class="tip-v">${sats(u.value)} <small>sats</small> <span class="pill pay">theirs</span>${u.confirmed ? '' : html`<span class="pill pending">unconfirmed</span>`}</div>
    <div class="tip-from">${u.from}</div>
    <div class="tip-op"><span>outpoint</span> ${shortTxid(u.txid)}:${u.vout}</div>
    <div class="tip-act">A UTXO in their wallet now. Only their key can spend it.</div>`;
}

function yourCoin(u: Utxo, s: State, selected: boolean, byKeys: boolean): SafeHtml {
  const cost = inputCost(s.feeRate);
  const warn = u.value <= cost;
  const origin =
    u.origin === 'change' ? html`<span class="pill change">change</span>` : u.origin === 'payment' ? html`<span class="pill pay">received</span>` : '';
  const pending = !u.confirmed ? html`<span class="pill pending">unconfirmed</span>` : '';
  const verb = byKeys ? 'Press Enter' : COARSE ? 'Tap' : 'Click';
  return html`
    <div class="tip-v">${sats(u.value)} <small>sats</small> ${origin}${pending}</div>
    <div class="tip-from">${u.from}</div>
    <div class="tip-op"><span>outpoint</span> ${shortTxid(u.txid)}:${u.vout}</div>
    <div class="tip-cost ${warn ? 'bad' : ''}">Spending it adds ≈${INPUT_VB} vB → <b>${sats(cost)}</b> sats of fee${
      warn ? ' — more than it’s worth right now' : ''
    }</div>
    <div class="tip-act">${selected ? `${verb} to put it back` : `${verb} to use it — the whole coin`}</div>`;
}

export function describeCoin(u: Utxo, s: State, selected: boolean): string {
  const cost = inputCost(s.feeRate);
  const worth = u.value <= cost ? ', more than it’s worth' : '';
  return `${sats(u.value)} sats${selected ? ', in the inputs' : ''}. ${u.from}. Spending it adds about ${INPUT_VB} vB, ${sats(cost)} sats of fee${worth}. Enter ${selected ? 'puts it back' : 'uses it'}.`;
}
