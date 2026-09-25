import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { damp } from '../util/tween';
import { LAYOUT, TABLE_RADIUS } from './layout';
import { glowTexture, radialTexture, tableTextures } from './textures';

const BRASS = new THREE.MeshStandardMaterial({ color: '#b98d4a', metalness: 1, roughness: 0.32 });

function glowRingTexture(ticks = 0): THREE.CanvasTexture {
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

function glowRectTexture(w: number, h: number): THREE.CanvasTexture {
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

function additive(map: THREE.Texture, color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
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

class Glow {
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

export class World {
  readonly group = new THREE.Group();
  readonly walletGlow: Glow;
  readonly inputsGlow: Glow;
  readonly txGlow: Glow;
  readonly txRunes: Glow;
  readonly recipientGlow: Glow;
  readonly miner: Miner;
  private dust: THREE.Points;
  private dustVel: Float32Array;
  private cone: THREE.Mesh;
  txSpin = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const R = TABLE_RADIUS;

    const { map, rough } = tableTextures();
    const top = new THREE.Mesh(
      new THREE.CircleGeometry(R, 160),
      new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, metalness: 0.0, envMapIntensity: 0.45 }),
    );
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.group.add(top);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.02, 0.075, 20, 220), BRASS);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.02;
    rim.castShadow = true;
    this.group.add(rim);

    const woodMat = new THREE.MeshStandardMaterial({ color: '#1c1411', roughness: 0.55, metalness: 0.1 });
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R - 0.25, 0.55, 160, 1, true), woodMat);
    apron.position.y = -0.3;
    this.group.add(apron);
    const under = new THREE.Mesh(new THREE.CircleGeometry(R - 0.25, 96), woodMat);
    under.rotation.x = Math.PI / 2;
    under.position.y = -0.575;
    this.group.add(under);
    const band = new THREE.Mesh(new THREE.TorusGeometry(R - 0.12, 0.025, 10, 200), BRASS);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.42;
    this.group.add(band);

    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 3.4, 48), woodMat);
    column.position.y = -2.3;
    this.group.add(column);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 0.25, 64), woodMat);
    foot.position.y = -3.95;
    this.group.add(foot);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ color: '#0b0c0f', roughness: 0.35, metalness: 0.2 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -4.08;
    floor.receiveShadow = true;
    this.group.add(floor);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 26),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(255,200,140,0.14)', 'rgba(0,0,0,0)'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -4.06;
    this.group.add(pool);

    this.buildVault();

    const ringTex = glowRingTexture();
    const W = LAYOUT.wallet;
    const wallet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(ringTex, '#ffbf5e'));
    wallet.rotation.x = -Math.PI / 2;
    wallet.scale.setScalar(W.r * 2 * 1.25);
    wallet.position.set(W.x, 0.004, W.z);
    this.group.add(wallet);
    this.walletGlow = new Glow(wallet, 0.5);

    const S = LAYOUT.inputs;
    const inputs = new THREE.Mesh(
      new THREE.PlaneGeometry(S.w + 0.5, S.d + 0.5),
      additive(glowRectTexture(S.w + 0.5, S.d + 0.5), '#ffcf7a'),
    );
    inputs.rotation.x = -Math.PI / 2;
    inputs.position.set(S.x, 0.004, S.z);
    this.group.add(inputs);
    this.inputsGlow = new Glow(inputs, 0.55);

    const T = LAYOUT.tx;
    const tx = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(ringTex, '#ffb14a'));
    tx.rotation.x = -Math.PI / 2;
    tx.scale.setScalar(T.r * 2 * 1.25);
    tx.position.set(T.x, 0.005, T.z);
    this.group.add(tx);
    this.txGlow = new Glow(tx, 0.9);

    const runes = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(glowRingTexture(60), '#ffd08a'));
    runes.rotation.x = -Math.PI / 2;
    runes.scale.setScalar(T.r * 2 * 1.6);
    runes.position.set(T.x, 0.006, T.z);
    this.group.add(runes);
    this.txRunes = new Glow(runes, 0.8);

    const Rc = LAYOUT.recipient;
    const trayR = Rc.r;
    const trayProfile = [
      new THREE.Vector2(0.001, 0.012),
      new THREE.Vector2(trayR * 0.9, 0.012),
      new THREE.Vector2(trayR * 0.97, 0.05),
      new THREE.Vector2(trayR * 1.02, 0.1),
      new THREE.Vector2(trayR * 1.08, 0.1),
      new THREE.Vector2(trayR * 1.1, 0.06),
      new THREE.Vector2(trayR * 1.1, 0.0),
    ];
    const tray = new THREE.Mesh(new THREE.LatheGeometry(trayProfile, 96), BRASS);
    tray.position.set(Rc.x, 0, Rc.z);
    tray.castShadow = true;
    tray.receiveShadow = true;
    this.group.add(tray);
    const felt = new THREE.Mesh(
      new THREE.CircleGeometry(trayR * 0.92, 64),
      new THREE.MeshStandardMaterial({ color: '#141821', roughness: 1 }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.position.set(Rc.x, 0.014, Rc.z);
    felt.receiveShadow = true;
    this.group.add(felt);
    const rglow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(ringTex, '#9fd4ff'));
    rglow.rotation.x = -Math.PI / 2;
    rglow.scale.setScalar(trayR * 2 * 1.45);
    rglow.position.set(Rc.x, 0.02, Rc.z);
    this.group.add(rglow);
    this.recipientGlow = new Glow(rglow, 0.8);

    // Fake volumetric light cone.
    this.cone = new THREE.Mesh(
      new THREE.ConeGeometry(6.4, 12.5, 64, 1, true),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color('#ffcf9a') }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying float vH; varying vec3 vN; varying vec3 vV;
          void main() {
            vH = uv.y;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vN = normalize(mat3(modelMatrix) * normal);
            vV = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uTime;
          varying float vH; varying vec3 vN; varying vec3 vV;
          void main() {
            // Interpolated vectors can nudge |dot| past 1; pow() of a negative is NaN.
            float facing = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
            float edge = pow(1.0 - facing, 1.6);
            float fall = smoothstep(0.0, 0.35, vH) * smoothstep(1.0, 0.55, vH);
            float a = (1.0 - edge) * fall * 0.045 * (0.9 + 0.1 * sin(uTime * 0.7));
            gl_FragColor = vec4(uColor * a, a);
          }`,
      }),
    );
    this.cone.position.set(0.5, 12.5 / 2 - 0.1, 1.8);
    this.group.add(this.cone);

    const N = 420;
    const pos = new Float32Array(N * 3);
    this.dustVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * 6;
      pos[i * 3] = Math.cos(a) * d;
      pos[i * 3 + 1] = Math.random() * 7 + 0.2;
      pos[i * 3 + 2] = Math.sin(a) * d;
      this.dustVel[i * 3] = (Math.random() - 0.5) * 0.04;
      this.dustVel[i * 3 + 1] = (Math.random() - 0.3) * 0.03;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({
        map: glowTexture(),
        color: '#ffd9a8',
        size: 0.045,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.group.add(this.dust);

    this.miner = new Miner();
    this.group.add(this.miner.group);
  }

  private buildVault() {
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#101218', roughness: 0.6, metalness: 0.3 });
    const trimMat = new THREE.MeshStandardMaterial({ color: '#2a2217', roughness: 0.4, metalness: 0.8, emissive: '#3a2a12', emissiveIntensity: 0.25 });
    const pillarGeo = new THREE.BoxGeometry(1.3, 22, 1.3);
    const trimGeo = new THREE.BoxGeometry(1.45, 0.1, 1.45);
    const count = 14;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.11;
      const d = 27;
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(Math.cos(a) * d, 3.5, Math.sin(a) * d);
      p.lookAt(0, 3.5, 0);
      this.group.add(p);
      for (const y of [-3.8, 0.2, 5.5]) {
        const t = new THREE.Mesh(trimGeo, trimMat);
        t.position.set(p.position.x, y, p.position.z);
        t.rotation.copy(p.rotation);
        this.group.add(t);
      }
    }
    const stripMat = new THREE.MeshBasicMaterial({ color: '#3b2c16', toneMapped: false });
    for (let i = 0; i < count; i++) {
      const a = ((i + 0.5) / count) * Math.PI * 2 + 0.11;
      const d = 27.4;
      for (let k = 0; k < 3; k++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.04, 0.04), stripMat);
        s.position.set(Math.cos(a) * d, -1.2 + k * 1.6, Math.sin(a) * d);
        s.lookAt(0, s.position.y, 0);
        s.rotateY(Math.PI / 2);
        this.group.add(s);
      }
    }
  }

  update(dt: number, time: number) {
    this.walletGlow.update(dt, time);
    this.inputsGlow.update(dt, time);
    this.txGlow.update(dt, time);
    this.txRunes.update(dt, time);
    this.recipientGlow.update(dt, time);
    this.txRunes.mesh.rotation.z += dt * (0.15 + this.txSpin * 2.5);

    (this.cone.material as THREE.ShaderMaterial).uniforms.uTime.value = time;

    const p = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += (this.dustVel[i] + Math.sin(time * 0.3 + i) * 0.01) * dt;
      arr[i + 1] += this.dustVel[i + 1] * dt;
      arr[i + 2] += (this.dustVel[i + 2] + Math.cos(time * 0.27 + i) * 0.01) * dt;
      if (arr[i + 1] > 7.5) arr[i + 1] = 0.2;
      if (arr[i + 1] < 0.1) arr[i + 1] = 7.2;
      if (Math.hypot(arr[i], arr[i + 2]) > 6.5) {
        arr[i] *= -0.9;
        arr[i + 2] *= -0.9;
      }
    }
    p.needsUpdate = true;

    this.miner.update(dt, time);
  }
}

/** Fees fly here; a pulse means the transaction was included in a block. */
export class Miner {
  readonly group = new THREE.Group();
  readonly anchor = new THREE.Vector3(LAYOUT.miner.x, LAYOUT.miner.y, LAYOUT.miner.z);
  readonly label: CSS2DObject;
  readonly labelEl: HTMLDivElement;
  private head: THREE.Group;
  private coreMat: THREE.MeshStandardMaterial;
  private edgeMat: THREE.LineBasicMaterial;
  private light: THREE.PointLight;
  private energy = 0;
  private pulseT = 0;
  private fees = 0;

  constructor() {
    const M = LAYOUT.miner;
    this.group.position.set(M.x, M.y, M.z);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(box);
    this.edgeMat = new THREE.LineBasicMaterial({ color: '#ffcf7a', transparent: true, opacity: 0.85, toneMapped: false });
    this.coreMat = new THREE.MeshStandardMaterial({
      color: '#1a1408',
      emissive: '#ff9f3a',
      emissiveIntensity: 0.25,
      roughness: 0.4,
      metalness: 0.2,
      transparent: true,
      opacity: 0.85,
    });

    this.head = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.72), this.coreMat);
    this.head.add(core, new THREE.LineSegments(edges, this.edgeMat));
    this.head.scale.setScalar(1.05);
    this.group.add(this.head);

    const chainMat = new THREE.LineBasicMaterial({ color: '#a8804a', transparent: true, opacity: 0.35 });
    const linkMat = new THREE.LineBasicMaterial({ color: '#a8804a', transparent: true, opacity: 0.25 });
    const prev = new THREE.Vector3();
    for (let i = 1; i <= 5; i++) {
      const b = new THREE.LineSegments(edges, chainMat.clone());
      (b.material as THREE.LineBasicMaterial).opacity = 0.34 - i * 0.05;
      b.position.set(-i * 1.9, i * 0.05, -i * 1.1);
      b.scale.setScalar(0.9);
      b.rotation.y = i * 0.15;
      this.group.add(b);
      const link = new THREE.BufferGeometry().setFromPoints([prev.clone(), b.position.clone()]);
      this.group.add(new THREE.Line(link, linkMat));
      prev.copy(b.position);
    }

    this.light = new THREE.PointLight('#ffa64d', 0, 9, 2);
    this.group.add(this.light);

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'world-tag world-tag--miner';
    this.labelEl.innerHTML = `<b>Miner</b><span>collects the fee for putting your transaction in a block</span><em class="fees"></em>`;
    this.label = new CSS2DObject(this.labelEl);
    this.label.position.set(0, -1.05, 0);
    this.group.add(this.label);
  }

  /** Called as fee sparks arrive. */
  absorb(amount: number) {
    this.fees += amount;
    this.energy = Math.min(1.6, this.energy + 0.35);
    const el = this.labelEl.querySelector('.fees');
    if (el) el.textContent = `+${amount.toLocaleString('en-US')} sats in fees`;
    this.labelEl.classList.add('is-hot');
  }

  /** Draw the eye without adding fees (used by the glossary). */
  nudge(text: string) {
    this.energy = Math.min(1.6, this.energy + 0.5);
    const el = this.labelEl.querySelector('.fees');
    if (el) el.textContent = text;
    this.labelEl.classList.add('is-hot');
  }

  /** Block found. */
  pulse() {
    this.pulseT = 1;
    this.labelEl.classList.remove('is-hot');
  }

  get totalFees() {
    return this.fees;
  }

  update(dt: number, time: number) {
    this.energy = Math.max(0, this.energy - dt * 0.25);
    this.pulseT = Math.max(0, this.pulseT - dt * 1.2);
    const e = 0.25 + this.energy * 1.4 + this.pulseT * 5;
    this.coreMat.emissiveIntensity = e;
    this.edgeMat.opacity = 0.6 + this.energy * 0.3 + this.pulseT * 0.4;
    this.light.intensity = this.energy * 10 + this.pulseT * 40;
    this.head.rotation.y += dt * (0.25 + this.energy * 1.5);
    this.head.rotation.x = Math.sin(time * 0.4) * 0.18;
    this.head.position.y = Math.sin(time * 0.9) * 0.08;
    const s = 1.05 + this.pulseT * 0.35;
    this.head.scale.setScalar(s);
  }
}
