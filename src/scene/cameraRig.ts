import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { reducedMotion } from '../util/motion';
import { damp, ease } from '../util/tween';

export interface Shot {
  name: string;
  pos: [number, number, number];
  target: [number, number, number];
  /** Multiplier on the viewport's base FOV. */
  fov: number;
  /** Radians/sec of slow orbit while parked on this shot. */
  drift: number;
}

export const HOME: Shot = { name: 'Overview', pos: [0.5, 9.7, 15.3], target: [0.3, -0.15, 0.75], fov: 1, drift: 0 };

export const SHOTS: Shot[] = [
  { name: 'Table level', pos: [3.2, 2.0, 6.4], target: [-1.9, 0.25, 0.2], fov: 0.95, drift: 0.022 },
  { name: 'The wallet', pos: [-5.2, 3.5, 5.9], target: [-2.6, 0.1, 0.4], fov: 0.95, drift: 0.03 },
  { name: 'The transaction', pos: [1.3, 9.6, 10.0], target: [1.1, 0.4, -0.9], fov: 1, drift: 0.012 },
  { name: 'Their side', pos: [8.0, 3.4, 3.1], target: [3.2, 0.1, -0.8], fov: 0.95, drift: -0.03 },
  { name: 'From the miner', pos: [7.4, 4.6, -9.8], target: [0.4, 0, 0.4], fov: 0.95, drift: -0.018 },
  { name: 'Top-down ledger', pos: [0.3, 15.5, 1.4], target: [0.3, 0, 0.6], fov: 0.95, drift: 0.02 },
  { name: 'Overview', pos: [0.5, 9.7, 15.3], target: [0.3, -0.15, 0.75], fov: 1, drift: 0.016 },
];

/** Seconds per tour shot. */
const TOUR_HOLD = 7;

interface Flight {
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  from: THREE.Spherical;
  to: THREE.Spherical;
  fromFov: number;
  toFov: number;
  t: number;
  dur: number;
}

export class CameraRig {
  readonly controls: OrbitControls;
  shotIndex = -1;
  onShot: ((shot: Shot | null, index: number, total: number) => void) | null = null;
  private touring = false;
  private hold = 0;

  private flight: Flight | null = null;
  private keys = new Set<string>();
  private fovMul = 1;
  private punch = 0;
  private shake = 0;
  private driftRate = 0;
  private tmp = new THREE.Vector3();
  private shakeOff = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private baseFov: () => number,
  ) {
    this.controls = new OrbitControls(camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.075;
    c.minDistance = 3.2;
    c.maxDistance = 22;
    c.maxPolarAngle = Math.PI * 0.47;
    c.minPolarAngle = 0.02;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.8;
    c.panSpeed = 0.8;
    c.screenSpacePanning = false;
    c.addEventListener('start', () => this.release());

    this.lastScale = this.distScale();
    camera.position.copy(this.shotPos(HOME));
    c.target.set(...HOME.target);
    c.update();
  }

  /** User grabbed the camera: drop any cinematic. */
  release() {
    if (this.shotIndex !== -1 || this.flight) {
      this.flight = null;
      this.shotIndex = -1;
      this.touring = false;
      this.driftRate = 0;
      this.onShot?.(null, -1, SHOTS.length);
    }
  }

  keyDown(code: string) {
    this.keys.add(code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Equal', 'Minus'].includes(code)) this.release();
  }

  keyUp(code: string) {
    this.keys.delete(code);
  }

  clearKeys() {
    this.keys.clear();
  }

  private lastScale = 1;

  /** Re-frame only when the screen changes shape class (e.g. a phone rotating). */
  onResize() {
    const k = this.distScale();
    if (k !== this.lastScale) {
      this.lastScale = k;
      this.home(0.9);
    }
  }

  /** Portrait screens see less width, so every shot backs off to keep the table in frame. */
  private distScale(): number {
    const a = this.camera.aspect;
    return a < 0.8 ? 1.5 : a < 1.2 ? 1.18 : 1;
  }

  private shotPos(shot: Shot): THREE.Vector3 {
    const t = new THREE.Vector3(...shot.target);
    return new THREE.Vector3(...shot.pos).sub(t).multiplyScalar(this.distScale()).add(t);
  }

  flyTo(shot: Shot, dur = 1.6) {
    this.controls.maxDistance = 22 * this.distScale();
    const fromTarget = this.controls.target.clone();
    const toTarget = new THREE.Vector3(...shot.target);
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(fromTarget));
    const to = new THREE.Spherical().setFromVector3(this.shotPos(shot).sub(toTarget));
    // Swing the short way round.
    let dTheta = to.theta - from.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    to.theta = from.theta + dTheta;
    this.flight = { fromTarget, toTarget, from, to, fromFov: this.fovMul, toFov: shot.fov, t: 0, dur };
    this.driftRate = shot.drift;
  }

  home(dur = 1.3) {
    this.shotIndex = -1;
    this.touring = false;
    this.flyTo(HOME, dur);
    this.driftRate = 0;
    this.onShot?.(null, -1, SHOTS.length);
  }

  /** Starts the tour, or skips ahead within it. */
  nextShot() {
    this.touring = true;
    this.goShot((this.shotIndex + 1) % SHOTS.length);
  }

  private goShot(i: number, dur = 2.2) {
    this.shotIndex = i;
    this.hold = 0;
    const shot = SHOTS[i];
    this.flyTo(shot, dur);
    this.onShot?.(shot, i, SHOTS.length);
  }

  /** While touring, cut to the transaction so the spend plays out in frame. */
  spotlightSpend() {
    if (!this.touring) return;
    const i = SHOTS.findIndex((s) => s.name === 'The transaction');
    if (i >= 0 && i !== this.shotIndex) this.goShot(i, 1.1);
    this.hold = -4;
  }

  get busy(): boolean {
    return !!this.flight || this.touring || this.keys.size > 0 || this.punch > 0.001 || this.shake > 0;
  }

  /** Brief FOV punch-in. */
  kick(amount = 0.06) {
    if (reducedMotion()) return;
    this.punch = Math.max(this.punch, amount);
  }

  rumble(amount = 0.05) {
    if (reducedMotion()) return;
    this.shake = Math.max(this.shake, amount);
  }

  intro() {
    if (reducedMotion()) {
      this.camera.position.copy(this.shotPos(HOME));
      this.controls.target.set(...HOME.target);
      this.controls.update();
      return;
    }
    this.camera.position.set(3, 15.5, 21).multiplyScalar(this.distScale());
    this.controls.target.set(0.3, 0.6, 0);
    this.fovMul = 1.08;
    this.flyTo(HOME, 2.6);
    this.driftRate = 0;
  }

  update(dt: number) {
    const cam = this.camera;
    const c = this.controls;
    cam.position.sub(this.shakeOff);
    this.shakeOff.set(0, 0, 0);

    if (this.flight) {
      const f = this.flight;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = ease.inOutCubic(k);
      c.target.lerpVectors(f.fromTarget, f.toTarget, e);
      // Interpolate in spherical coordinates so moves orbit rather than cut through the table.
      const lerp = THREE.MathUtils.lerp;
      const sph = new THREE.Spherical(
        lerp(f.from.radius, f.to.radius, e),
        Math.max(0.05, lerp(f.from.phi, f.to.phi, e) - Math.sin(Math.PI * e) * 0.12),
        lerp(f.from.theta, f.to.theta, e),
      );
      cam.position.setFromSpherical(sph).add(c.target);
      this.fovMul = f.fromFov + (f.toFov - f.fromFov) * e;
      if (k >= 1) this.flight = null;
    } else if (this.driftRate !== 0 && !reducedMotion()) {
      this.tmp.copy(cam.position).sub(c.target);
      this.tmp.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.driftRate * dt);
      cam.position.copy(c.target).add(this.tmp);
    }

    const k = this.keys;
    if (k.size) {
      const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 2.4 : 1;
      const dist = cam.position.distanceTo(c.target);
      const speed = (1.2 + dist * 0.35) * fast * dt;
      const fwd = new THREE.Vector3().subVectors(c.target, cam.position).setY(0).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize();
      const move = new THREE.Vector3();
      if (k.has('KeyW')) move.add(fwd);
      if (k.has('KeyS')) move.sub(fwd);
      if (k.has('KeyD')) move.add(right);
      if (k.has('KeyA')) move.sub(right);
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed);
        c.target.add(move);
        cam.position.add(move);
        // Keep the look-at point over (or near) the table.
        const lim = 7;
        const len = Math.hypot(c.target.x, c.target.z);
        if (len > lim) {
          const back = new THREE.Vector3(c.target.x, 0, c.target.z).multiplyScalar(1 - lim / len);
          c.target.sub(back);
          cam.position.sub(back);
        }
      }
      const rot = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
      if (rot) {
        this.tmp.copy(cam.position).sub(c.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, rot * 1.2 * fast * dt);
        cam.position.copy(c.target).add(this.tmp);
      }
      const zoom = (k.has('Equal') || k.has('NumpadAdd') ? 1 : 0) - (k.has('Minus') || k.has('NumpadSubtract') ? 1 : 0);
      if (zoom) {
        this.tmp.copy(cam.position).sub(c.target);
        const d = THREE.MathUtils.clamp(this.tmp.length() * (1 - zoom * 1.1 * dt), c.minDistance, c.maxDistance);
        this.tmp.setLength(d);
        cam.position.copy(c.target).add(this.tmp);
      }
    }

    if (this.touring && !this.flight) {
      this.hold += dt;
      if (this.hold > TOUR_HOLD) this.goShot((this.shotIndex + 1) % SHOTS.length);
    }

    c.update();

    this.punch += (0 - this.punch) * damp(3, dt);
    this.shake = Math.max(0, this.shake - dt * 0.12);
    const fov = this.baseFov() * this.fovMul * (1 - this.punch);
    if (Math.abs(cam.fov - fov) > 1e-4) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    if (this.shake > 0) {
      const s = this.shake;
      this.shakeOff.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0);
      cam.position.add(this.shakeOff);
    }
  }
}
