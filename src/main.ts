import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './style.css';
import { App } from './app/app';

function webgl2Ok(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    // Browsers cap live contexts, so release the probe straight away.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

function fail(host: HTMLElement, message: string) {
  document.body.classList.add('no-webgl');
  document.getElementById('veil')?.classList.add('is-off');
  const p = document.createElement('p');
  p.className = 'nogl';
  p.textContent = message;
  host.replaceChildren(p);
}

async function boot() {
  const host = document.getElementById('stage');
  if (!host) return;
  if (!webgl2Ok()) {
    fail(host, 'This lab needs WebGL 2. Try a recent Chrome, Firefox, Safari or Edge, or turn on hardware acceleration.');
    return;
  }
  // Coin faces are drawn to canvas with the bundled fonts, so give them a beat to load.
  const fonts = Promise.all([
    document.fonts.load('800 64px "JetBrains Mono Variable"'),
    document.fonts.load('600 32px "Inter Variable"'),
    document.fonts.load('italic 32px "Instrument Serif"'),
  ]);
  const loadedInTime = await Promise.race([
    fonts.then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((r) => setTimeout(() => r(false), 900)),
  ]);

  let app: App;
  try {
    app = new App(host);
    app.start();
  } catch (err) {
    console.error(err);
    fail(host, 'The 3D view could not start on this device. Try another browser or turn on hardware acceleration.');
    return;
  }
  if (!loadedInTime) void fonts.then(() => app.refreshTextures()).catch(() => {});
  if (import.meta.env.DEV) (window as unknown as { __coin: App }).__coin = app;
}

void boot();
