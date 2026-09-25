import * as THREE from 'three';
import { sats } from '../util/format';
import { LAYOUT, TABLE_RADIUS } from './layout';

export const FONT_MONO = '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';
export const FONT_SANS = '"Inter Variable", system-ui, -apple-system, Segoe UI, sans-serif';
export const FONT_SERIF = '"Instrument Serif", Georgia, serif';

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, color = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function textOnArc(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  spacing = 1,
  inward = false,
) {
  ctx.save();
  ctx.translate(cx, cy);
  let a = startAngle;
  for (const ch of text) {
    const w = ctx.measureText(ch).width * spacing;
    const da = w / r;
    ctx.save();
    if (inward) {
      ctx.rotate(a - da / 2);
      ctx.translate(0, -r);
      ctx.rotate(Math.PI);
    } else {
      ctx.rotate(a + da / 2);
      ctx.translate(0, -r);
    }
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += inward ? -da : da;
  }
  ctx.restore();
}

function measureArc(ctx: CanvasRenderingContext2D, text: string, r: number, spacing = 1) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width * spacing;
  return w / r;
}

/** Grayscale art used as both colour map (tints the metal) and bump map (bright = raised). */
export function coinFaceTexture(value: number, outpoint: string): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  const cx = S / 2;

  const g = ctx.createRadialGradient(cx, cx * 0.8, 10, cx, cx, cx);
  g.addColorStop(0, '#cfcfcf');
  g.addColorStop(0.75, '#b4b4b4');
  g.addColorStop(1, '#9a9a9a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = '#fff';
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const a = Math.random() * Math.PI;
    const l = 10 + Math.random() * 60;
    ctx.lineWidth = Math.random() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.lineWidth = 22;
  ctx.strokeStyle = '#f4f4f4';
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#6a6a6a';
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 25, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#ececec';
  const beads = 72;
  for (let i = 0; i < beads; i++) {
    const a = (i / beads) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * (cx - 42), cx + Math.sin(a) * (cx - 42), 4.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#f0f0f0';
  ctx.font = `600 27px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const top = 'UNSPENT TRANSACTION OUTPUT';
  const arcR = cx - 78;
  const span = measureArc(ctx, top, arcR, 1.18);
  textOnArc(ctx, top, cx, cx, arcR, -span / 2, 1.18);
  ctx.font = `500 22px ${FONT_MONO}`;
  const bottom = outpoint;
  const spanB = measureArc(ctx, bottom, arcR + 4, 1.05);
  textOnArc(ctx, bottom, cx, cx, arcR + 4, Math.PI + spanB / 2, 1.05, true);

  ctx.lineWidth = 2;
  ctx.strokeStyle = '#8c8c8c';
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 112, 0, Math.PI * 2);
  ctx.stroke();

  const label = sats(value);
  const fs = Math.min(118, 300 / (label.length * 0.62));
  ctx.font = `800 ${fs}px ${FONT_MONO}`;
  ctx.fillStyle = '#5e5e5e';
  ctx.fillText(label, cx + 3, cx - 6 + 3);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, cx, cx - 6);

  ctx.font = `700 30px ${FONT_SANS}`;
  ctx.fillStyle = '#efefef';
  const unit = 'S A T S';
  ctx.fillText(unit, cx, cx + fs * 0.5 + 18);

  return tex(c);
}

/** Vertical reeding for the coin edge (repeat along U). */
export function reedTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 8);
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, '#222');
  g.addColorStop(0.5, '#fff');
  g.addColorStop(1, '#222');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 8);
  const t = tex(c, false);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(90, 1);
  return t;
}

/** Canvas (px, py) ↔ world (x, z): px = (x/R + 1)/2·W, py = (z/R + 1)/2·H. */
export function tableTextures(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const W = 2048;
  const R = TABLE_RADIUS;
  const [c, ctx] = canvas(W);
  const [rc, rctx] = canvas(512);
  const P = (x: number, z: number): [number, number] => [((x / R + 1) / 2) * W, ((z / R + 1) / 2) * W];
  const L = (d: number) => (d / (2 * R)) * W;

  const base = ctx.createRadialGradient(W / 2, W * 0.55, 50, W / 2, W / 2, W / 2);
  base.addColorStop(0, '#23262b');
  base.addColorStop(0.6, '#181a1e');
  base.addColorStop(1, '#0e0f12');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, W);

  // The grain noise doubles as the roughness map.
  const img = rctx.createImageData(512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 212 + Math.random() * 43;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
    img.data[i + 3] = 255;
  }
  rctx.putImageData(img, 0, 0);
  const pat = ctx.createPattern(rc, 'repeat');
  if (pat) {
    ctx.globalAlpha = 0.06;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, W);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  const brass = 'rgba(201, 162, 92, 0.55)';
  const brassDim = 'rgba(201, 162, 92, 0.22)';
  const ink = 'rgba(231, 206, 160, 0.55)';

  ctx.strokeStyle = brass;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, W / 2 - 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, W / 2 - 58, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = brassDim;
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const r0 = W / 2 - 66;
    const r1 = r0 - (i % 10 === 0 ? 26 : 10);
    ctx.lineWidth = i % 10 === 0 ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(W / 2 + Math.cos(a) * r0, W / 2 + Math.sin(a) * r0);
    ctx.lineTo(W / 2 + Math.cos(a) * r1, W / 2 + Math.sin(a) * r1);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  {
    const [x, y] = P(LAYOUT.wallet.x, LAYOUT.wallet.z);
    const r = L(LAYOUT.wallet.r);
    ctx.setLineDash([14, 12]);
    ctx.strokeStyle = brassDim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ink;
    ctx.font = `600 40px ${FONT_SANS}`;
    const t = 'YOUR WALLET';
    const span = measureArc(ctx, t, r + 34, 1.35);
    textOnArc(ctx, t, x, y, r + 34, -span / 2, 1.35);
    ctx.font = `italic 36px ${FONT_SERIF}`;
    ctx.fillStyle = 'rgba(231, 206, 160, 0.4)';
    const sub = 'unspent outputs you can sign for';
    const span2 = measureArc(ctx, sub, r + 36, 1.04);
    textOnArc(ctx, sub, x, y, r + 36, Math.PI + span2 / 2, 1.04, true);
  }

  {
    const s = LAYOUT.inputs;
    const [x0, y0] = P(s.x - s.w / 2, s.z - s.d / 2);
    const [x1, y1] = P(s.x + s.w / 2, s.z + s.d / 2);
    ctx.strokeStyle = brassDim;
    ctx.lineWidth = 3;
    roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 60);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 60);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.font = `600 34px ${FONT_SANS}`;
    ctx.fillText('I N P U T S', (x0 + x1) / 2, y1 + 34);
    ctx.font = `italic 32px ${FONT_SERIF}`;
    ctx.fillStyle = 'rgba(231, 206, 160, 0.4)';
    ctx.fillText('coins you’re about to spend — whole, never in part', (x0 + x1) / 2, y1 + 74);
  }

  {
    const [x, y] = P(LAYOUT.tx.x, LAYOUT.tx.z);
    const r = L(LAYOUT.tx.r);
    ctx.strokeStyle = brassDim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
      ctx.lineTo(x + Math.cos(a) * r * (i % 4 === 0 ? 0.92 : 0.86), y + Math.sin(a) * r * (i % 4 === 0 ? 0.92 : 0.86));
      ctx.stroke();
    }
    ctx.fillStyle = ink;
    ctx.font = `600 30px ${FONT_SANS}`;
    const t = 'TRANSACTION';
    const span = measureArc(ctx, t, r + 30, 1.4);
    textOnArc(ctx, t, x, y, r + 30, -span / 2, 1.4);
  }

  {
    const [x, y] = P(LAYOUT.recipient.x, LAYOUT.recipient.z);
    const r = L(LAYOUT.recipient.r);
    ctx.fillStyle = ink;
    ctx.font = `600 30px ${FONT_SANS}`;
    const t = 'THEIR WALLET';
    const span = measureArc(ctx, t, r + 44, 1.4);
    textOnArc(ctx, t, x, y, r + 44, -span / 2, 1.4);
  }

  // Flow arrows: inputs → tx → recipient, tx → wallet (change).
  ctx.strokeStyle = 'rgba(201, 162, 92, 0.18)';
  ctx.lineWidth = 3;
  ctx.setLineDash([2, 16]);
  ctx.lineCap = 'round';
  const arrow = (ax: number, az: number, bx: number, bz: number, bend: number) => {
    const [x0, y0] = P(ax, az);
    const [x1, y1] = P(bx, bz);
    const mx = (x0 + x1) / 2 + (y1 - y0) * bend;
    const my = (y0 + y1) / 2 - (x1 - x0) * bend;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();
  };
  arrow(LAYOUT.inputs.x + 1.2, LAYOUT.inputs.z - 0.5, LAYOUT.tx.x, LAYOUT.tx.z + LAYOUT.tx.r + 0.1, 0.15);
  arrow(LAYOUT.tx.x + LAYOUT.tx.r + 0.15, LAYOUT.tx.z, LAYOUT.recipient.x - LAYOUT.recipient.r - 0.2, LAYOUT.recipient.z, 0.12);
  arrow(LAYOUT.tx.x - LAYOUT.tx.r - 0.15, LAYOUT.tx.z - 0.2, LAYOUT.wallet.x + LAYOUT.wallet.r + 0.2, LAYOUT.wallet.z - 0.3, -0.12);
  ctx.setLineDash([]);

  const map = tex(c);
  const rough = tex(rc, false);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  rough.repeat.set(6, 6);
  return { map, rough };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function glowTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return tex(c);
}

export function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return tex(c);
}

export function contactShadowTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.95)');
  g.addColorStop(0.42, 'rgba(0,0,0,0.7)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return tex(c);
}
