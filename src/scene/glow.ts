import * as THREE from 'three';
import { damp } from '../util/tween';

export function glowRingTexture(ticks = 0): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const cx = S / 2;
  const g = ctx.createRadialGradient(cx, cx, cx * 0.8, cx, cx, cx);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  if (ticks) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2;
      const r0 = cx * 0.66;
      const r1 = cx * (i % 3 === 0 ? 0.76 : 0.71);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowRectTexture(w: number, h: number): THREE.CanvasTexture {
  const S = 1024;
  const H = Math.round((S * h) / w);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const pad = 40;
  ctx.shadowColor = 'rgba(255,255,255,1)';
  ctx.shadowBlur = 26;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 5;
  const r = (H - pad * 2) / 2;
  ctx.beginPath();
  ctx.roundRect(pad, pad, S - pad * 2, H - pad * 2, r);
  ctx.stroke();
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function additive(map: THREE.Texture, color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

export class Glow {
  level = 0;
  target = 0;
  pulse = 0;
  constructor(
    readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
    private max = 1,
  ) {}
  update(dt: number, time: number) {
    this.level += (this.target - this.level) * damp(6, dt);
    this.pulse = Math.max(0, this.pulse - dt * 1.4);
    const breathe = 0.85 + Math.sin(time * 2.2) * 0.15;
    this.mesh.material.opacity = Math.min(1.5, (this.level * breathe + this.pulse) * this.max);
    this.mesh.visible = this.mesh.material.opacity > 0.002;
  }
  flash(v = 1) {
    this.pulse = Math.max(this.pulse, v);
  }
}
