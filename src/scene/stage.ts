import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const LITE_RATIO = 0.5;

/** Vignette, film grain and slight chromatic fringing toward the edges. */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.035 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      c.x *= uAspect;
      float d = length(c);
      vec2 dir = (vUv - 0.5) * 0.0025 * smoothstep(0.25, 0.9, d);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir).b;
      float vig = smoothstep(1.05, 0.28, d * uVignette);
      col *= mix(0.42, 1.0, vig);
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * A stray NaN pixel is invisible in an 8-bit framebuffer, but bloom's blur
 * spreads it until the whole frame goes black. Scrub the HDR buffer first.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(64.0)), c.a);
    }
  `,
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly labels: CSS2DRenderer;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private finish: ShaderPass;
  readonly key: THREE.SpotLight;
  /** Lens for the current viewport; the camera rig scales it per shot. */
  baseFov = 32;
  /** Render scale: past 1.5 the HDR + bloom chain costs far more than it shows. */
  private maxRatio = Math.min(window.devicePixelRatio, 1.5);
  private ratio = this.maxRatio;
  private avgDt = 1 / 60;
  private slowFor = 0;
  private fastFor = 0;
  private clock = 0;
  private lastStepUp = -Infinity;
  /** Seconds to wait before judging frame times (shader compiles at start, resizes after a step). */
  private settle = 1.5;
  private lost = false;
  readonly lite: boolean;
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.lite = isSoftwareRenderer(this.renderer.getContext());
    if (this.lite) this.maxRatio = this.ratio = LITE_RATIO;
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = !this.lite;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.id = 'gl';
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute(
      'aria-label',
      'A table with your wallet’s coins. Use the arrow keys and Enter to pick coins, and Space to pay; the panel on the right shows the numbers.',
    );
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.setSize(window.innerWidth, window.innerHeight);
    this.labels.domElement.id = 'labels';
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 120);

    const bg = new THREE.Color('#06070a');
    this.scene.background = bg;
    this.scene.fog = new THREE.FogExp2(bg, 0.022);

    this.buildEnvironment();
    // Dimmed so reflections don't light up the dark vault.
    this.scene.environmentIntensity = 0.42;

    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', () => {
      this.lost = true;
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.buildEnvironment();
      this.onContextRestored?.();
    });

    // Soft-edged pool: the table rim falls off into shadow.
    this.key = new THREE.SpotLight('#ffe0b5', 440, 0, 0.55, 0.75, 2);
    this.key.position.set(0.3, 12.8, 2.4);
    this.key.target.position.set(-0.1, 0, 0.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0002;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    this.key.shadow.camera.near = 4;
    this.key.shadow.camera.far = 20;
    this.scene.add(this.key, this.key.target);

    // Cool back light so coin edges separate from the dark.
    const rim = new THREE.DirectionalLight('#7aa7ff', 1.3);
    rim.position.set(-5, 4, -8);
    this.scene.add(rim);

    const kick = new THREE.PointLight('#ffb36b', 14, 14, 2);
    kick.position.set(6.5, 2.2, 1.5);
    this.scene.add(kick);

    this.scene.add(new THREE.HemisphereLight('#1d2533', '#050505', 0.3));

    const w = window.innerWidth;
    const h = window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.65, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const old = this.scene.environment;
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    old?.dispose();
    pmrem.dispose();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    // Narrow screens: widen the lens so the whole table stays in frame.
    this.baseFov = w / h < 0.8 ? 52 : w / h < 1.2 ? 40 : 32;
    this.camera.fov = this.baseFov;
    // Frame the table in the space the HUD leaves free: nudge left of the
    // ledger on desktop, up above the bottom sheet on phones.
    if (w > 860) this.camera.setViewOffset(w, h, Math.min(150, w * 0.1), -h * 0.015, w, h);
    else this.camera.setViewOffset(w, h, 0, h * 0.2, w, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.ratio);
    this.labels.setSize(w, h);
    this.finish.uniforms.uAspect.value = w / h;
  }

  get renderScale(): number {
    return this.ratio;
  }

  adapt(dt: number) {
    if (dt > 1) return;
    this.clock += dt;
    if (this.settle > 0) {
      this.settle -= dt;
      return;
    }
    // Time-based smoothing, so a 2 fps machine reacts as fast as a 60 fps one.
    this.avgDt += (Math.min(dt, 0.25) - this.avgDt) * (1 - Math.exp(-dt / 0.4));
    this.slowFor = this.avgDt > 1 / 50 ? this.slowFor + dt : Math.max(0, this.slowFor - dt * 0.5);
    this.fastFor = this.avgDt < 1 / 57 ? this.fastFor + dt : 0;
    if (this.slowFor > 1.5 && this.ratio > (this.lite ? LITE_RATIO : 0.75)) {
      if (this.clock - this.lastStepUp < 6) this.maxRatio = this.ratio - 0.25;
      this.setRatio(this.ratio - 0.25);
    } else if (this.fastFor > 8 && this.ratio < this.maxRatio) {
      this.lastStepUp = this.clock;
      this.setRatio(this.ratio + 0.25);
    }
  }

  private setRatio(r: number) {
    this.ratio = Math.min(this.maxRatio, Math.max(this.lite ? LITE_RATIO : 0.75, r));
    this.renderer.setPixelRatio(this.ratio);
    this.composer.setPixelRatio(this.ratio);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.slowFor = 0;
    this.fastFor = 0;
    this.avgDt = 1 / 60;
    this.settle = 0.75;
  }

  /**
   * In lite mode, drop the decorative point lights (miner, orb, balance bar,
   * kicker). Every light is evaluated for every pixel even at zero intensity,
   * which a software renderer feels. Call once, after the scene is built.
   */
  trimForLite() {
    if (!this.lite) return;
    this.scene.traverse((o) => {
      if (o instanceof THREE.PointLight) o.visible = false;
    });
  }

  render(time: number) {
    if (this.lost) return;
    if (this.lite) this.renderer.render(this.scene, this.camera);
    else {
      this.finish.uniforms.uTime.value = time;
      this.composer.render();
    }
    this.labels.render(this.scene, this.camera);
  }
}

function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  let name = String(gl.getParameter(gl.RENDERER));
  // Chrome reports a generic name unless asked for the unmasked one; Firefox already gives the real one.
  if (/webkit webgl/i.test(name)) {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  }
  return /swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(name);
}
