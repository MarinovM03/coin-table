import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './style.css';
import { App } from './app';

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot() {
  const host = document.getElementById('stage');
  if (!host) return;
  if (!webglOk()) {
    host.innerHTML = '<p class="nogl">This lab needs WebGL. Try a recent Chrome, Firefox, Safari or Edge.</p>';
    return;
  }
  // Coin faces are drawn to canvas with the bundled fonts, so give them a beat to load.
  await Promise.race([
    Promise.all([
      document.fonts.load('800 64px "JetBrains Mono Variable"'),
      document.fonts.load('600 32px "Inter Variable"'),
      document.fonts.load('italic 32px "Instrument Serif"'),
    ]),
    new Promise((r) => setTimeout(r, 900)),
  ]);
  const app = new App(host);
  app.start();
  if (import.meta.env.DEV) (window as unknown as { __coin: App }).__coin = app;
}

void boot();
