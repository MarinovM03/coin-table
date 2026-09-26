import { store } from '../model/store';
import { type Command, commandFor } from '../ui/keys';
import { html } from '../util/html';
import type { Controller } from './controller';
import type { View } from './view';

// Movement keys go by position (WASD is ZQSD on AZERTY); everything else by
// the character printed on the key, so shortcuts work on any layout.
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'ShiftLeft', 'ShiftRight']);
const REPEATABLE = new Set<Command>(['fee-down', 'fee-up', 'next-coin', 'prev-coin']);

export function bindKeyboard(view: View, controller: Controller) {
  window.addEventListener('keydown', (e) => onKey(e, view, controller));
  window.addEventListener('keyup', (e) => view.rig.keyUp(e.code));
  window.addEventListener('blur', () => view.rig.clearKeys());
  // Buttons shouldn't keep focus after a mouse click, or Space would press them again.
  document.addEventListener('pointerup', () => {
    const a = document.activeElement;
    if (a instanceof HTMLButtonElement || (a instanceof HTMLInputElement && a.type === 'range')) a.blur();
  });
}

function onKey(e: KeyboardEvent, { rig, hud }: View, controller: Controller) {
  // AltGr arrives as Ctrl+Alt on Windows and is how many layouts type [ ] and /.
  const altGr = e.getModifierState('AltGraph');
  if (e.metaKey || ((e.ctrlKey || e.altKey) && !altGr)) return;
  const t = e.target as HTMLElement | null;
  if (t instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
  if (t instanceof HTMLTextAreaElement || t?.isContentEditable || (t instanceof HTMLInputElement && t.type !== 'range')) return;
  if (MOVE_KEYS.has(e.code)) {
    rig.keyDown(e.code);
    return;
  }
  const cmd = commandFor(e);
  if (!cmd) return;
  if (e.repeat && !REPEATABLE.has(cmd)) return;
  const s = store.get();

  switch (cmd) {
    case 'myth':
      controller.setMode('myth');
      break;
    case 'reality':
      controller.setMode('reality');
      break;
    case 'send':
      e.preventDefault();
      controller.send();
      break;
    case 'enter':
      e.preventDefault();
      if (s.focusId && s.mode === 'reality') controller.toggle(s.focusId);
      else controller.send();
      break;
    case 'next-coin':
    case 'prev-coin':
      e.preventDefault();
      controller.cycleFocus(cmd === 'next-coin' ? 1 : -1);
      break;
    case 'pick':
      controller.pickForMe();
      break;
    case 'clear':
      controller.clearSelection();
      break;
    case 'fee-down':
      controller.setFee(s.feeRate - (e.shiftKey ? 10 : 1));
      break;
    case 'fee-up':
      controller.setFee(s.feeRate + (e.shiftKey ? 10 : 1));
      break;
    case 'camera':
      rig.nextShot();
      break;
    case 'reset':
      if (e.shiftKey) controller.resetWallet();
      else {
        rig.home();
        hud.toast(html`View reset. <kbd>⇧R</kbd> resets the wallet too.`, '', 1800);
      }
      break;
    case 'hide':
      e.preventDefault();
      controller.toggleHide();
      break;
    case 'how':
      controller.toggleHow();
      break;
    case 'mute':
      controller.toggleMute();
      break;
    case 'labels':
      controller.toggleLabels();
      break;
    case 'escape':
      if (s.howOpen) store.set({ howOpen: false });
      else if (s.focusId) {
        store.set({ focusId: null });
        hud.tooltip.hide();
      } else rig.release();
      break;
  }
}
