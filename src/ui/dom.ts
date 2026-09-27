import { html } from '../util/html';

/** Phones and tablets: say "tap", not "click". */
export const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const PRESS = COARSE ? 'Tap' : 'Press';

export const hint = (key: string, label: string) => (COARSE ? html`<b>${label}</b>` : html`<kbd>${key}</kbd>`);

export const refillHint = () => (COARSE ? html`Tap <b>Refill wallet</b> to start over.` : html`<kbd>⇧R</kbd> refills the wallet.`);

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};
