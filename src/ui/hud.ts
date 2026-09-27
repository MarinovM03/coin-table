import { currentPlan, type Mode, type State } from '../model/store';
import { walletTotal } from '../model/wallet';
import { sats } from '../util/format';
import { html, setHtml, type SafeHtml } from '../util/html';
import { $ } from './dom';
import { Ledger, type LedgerActions } from './ledger';
import { Narrator } from './narrator';
import { Receipt } from './receipt';
import { Ticker } from './ticker';
import { Tooltip } from './tooltip';

export interface HudActions extends LedgerActions {
  setMode(m: Mode): void;
  toggleHow(): void;
  toggleSound(): void;
  toggleHide(): void;
  nextCamera(): void;
  highlightTerm(term: string | null): void;
}

export class Hud {
  readonly ledger: Ledger;
  readonly receipt = new Receipt();
  readonly tooltip = new Tooltip();
  private narrator = new Narrator();
  private root = $('hud');
  private total = new Ticker($('stat-total'), (n) => `${sats(n)} sats`);
  private toastsEl = $('toasts');
  private camBadgeEl = $('cam-badge');
  private camTimer = 0;
  private announceTimer = 0;
  private howWasOpen = false;

  constructor(actions: HudActions) {
    this.ledger = new Ledger(actions);

    for (const b of document.querySelectorAll<HTMLButtonElement>('#modes button')) {
      b.addEventListener('click', () => actions.setMode(b.dataset.mode as Mode));
    }
    $('btn-how').addEventListener('click', () => actions.toggleHow());
    $('how-close').addEventListener('click', () => actions.toggleHow());
    $('btn-sound').addEventListener('click', () => actions.toggleSound());
    $('btn-hide').addEventListener('click', () => actions.toggleHide());
    $('unhide').addEventListener('click', () => actions.toggleHide());
    $('btn-cam').addEventListener('click', () => actions.nextCamera());
    $('gpu-reload').addEventListener('click', () => window.location.reload());

    const how = $('how');
    how.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-term]');
      if (t) actions.highlightTerm(t.dataset.term ?? null);
    });
    how.addEventListener('pointerleave', () => actions.highlightTerm(null));
  }

  update(dt: number) {
    this.total.update(dt);
    this.ledger.update(dt);
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

    this.total.set(walletTotal(s.utxos));
    $('stat-count').textContent = String(s.utxos.length);
    $('stat-rate').textContent = `${s.feeRate} sat/vB`;

    // While the receipt is up, the ledger freezes on the transaction that just happened.
    const done = s.phase === 'receipt' && s.lastTx ? s.lastTx : null;
    const plan = done ? done.plan : currentPlan(s);
    this.ledger.render(s, done, plan);
    this.narrator.render(s, plan);
  }

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

  announce(text: string, delay = 0) {
    window.clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => {
      $('announcer').textContent = text;
    }, delay);
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
