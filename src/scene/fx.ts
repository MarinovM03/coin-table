import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { clamp, damp } from '../util/tween';
import { glowTexture } from './textures';

interface Spark {
  sprite: THREE.Sprite;
  curve: THREE.QuadraticBezierCurve3;
  t: number;
  dur: number;
  onArrive?: () => void;
}

interface Tag {
  obj: CSS2DObject;
  target: THREE.Object3D;
  lift: number;
  t: number;
  life: number;
  out: boolean;
}

interface Trail {
  target: THREE.Object3D;
  mat: THREE.SpriteMaterial;
  t: number;
  dur: number;
  acc: number;
}

interface Mote {
  sprite: THREE.Sprite;
  t: number;
  life: number;
  size: number;
}

interface Courier {
  obj: THREE.Object3D;
  curve: THREE.QuadraticBezierCurve3;
  t: number;
  dur: number;
}

interface Shock {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  t: number;
  dur: number;
  size: number;
}

export class Fx {
  readonly group = new THREE.Group();
  private glow = glowTexture();
  private sparks: Spark[] = [];
  private shocks: Shock[] = [];
  private orb: THREE.Mesh;
  private orbHalo: THREE.Sprite;
  private orbLight: THREE.PointLight;
  private orbLevel = 0;
  private orbTarget = 0;
  private ringGeo = new THREE.RingGeometry(0.92, 1, 96);
  private tags: Tag[] = [];
  private trails: Trail[] = [];
  private motes: Mote[] = [];
  private couriers: Courier[] = [];
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 48, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc46b').multiplyScalar(3), toneMapped: false }),
    );
    this.orbHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glow, color: '#ff9d3c', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.orbHalo.scale.setScalar(2.4);
    this.orbLight = new THREE.PointLight('#ffae55', 0, 7, 2);
    this.orb.add(this.orbHalo, this.orbLight);
    this.orb.visible = false;
    this.group.add(this.orb);
  }

  /** Spawns one of each effect far below the floor so its shaders compile at load. */
  warm() {
    const far = new THREE.Vector3(0, -80, 0);
    this.orb.visible = true;
    this.sparkStream(far, far.clone().setX(1), 1);
    this.shock(far);
  }

  placeOrb(p: THREE.Vector3) {
    this.orb.position.copy(p);
  }

  setOrb(level: number) {
    this.orbTarget = level;
  }

  sparkStream(a: THREE.Vector3, b: THREE.Vector3, count: number, opts: { color?: THREE.ColorRepresentation; spread?: number; loft?: number; onArrive?: (i: number) => void } = {}) {
    const color = new THREE.Color(opts.color ?? '#ffc36b');
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      s.scale.setScalar(0.22 + Math.random() * 0.16);
      const spread = opts.spread ?? 0.35;
      const start = a.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * 0.2, (Math.random() - 0.5) * spread));
      const mid = a.clone().lerp(b, 0.5);
      mid.y += opts.loft ?? 2.2;
      mid.x += (Math.random() - 0.5) * 1.4;
      mid.z += (Math.random() - 0.5) * 1.4;
      s.position.copy(start);
      this.group.add(s);
      this.sparks.push({
        sprite: s,
        curve: new THREE.QuadraticBezierCurve3(start, mid, b.clone()),
        t: -i * 0.035,
        dur: 0.9 + Math.random() * 0.35,
        onArrive: opts.onArrive ? () => opts.onArrive!(i) : undefined,
      });
    }
  }

  shock(p: THREE.Vector3, color: THREE.ColorRepresentation = '#ffcf7a', size = 1.6, dur = 0.7) {
    const mesh = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(p);
    mesh.position.y = Math.max(0.01, p.y);
    this.group.add(mesh);
    this.shocks.push({ mesh, t: 0, dur, size });
  }

  /** A label that follows a moving object and fades out after `life` seconds. */
  followTag(target: THREE.Object3D, html: string, cls: string, life: number, lift = 0.62) {
    const el = document.createElement('div');
    el.className = `flow-tag ${cls}`;
    el.innerHTML = `<div class="flow-inner">${html}</div>`;
    const obj = new CSS2DObject(el);
    obj.center.set(0.5, 1);
    target.getWorldPosition(obj.position);
    obj.position.y += lift;
    this.group.add(obj);
    this.tags.push({ obj, target, lift, t: 0, life, out: false });
  }

  trail(target: THREE.Object3D, color: THREE.ColorRepresentation, dur: number) {
    const mat = new THREE.SpriteMaterial({
      map: this.glow,
      color,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.trails.push({ target, mat, t: 0, dur, acc: 0 });
  }

  /** An invisible object flying a lofted arc, for a label to follow. */
  courier(a: THREE.Vector3, b: THREE.Vector3, loft: number, dur: number): THREE.Object3D {
    const obj = new THREE.Object3D();
    obj.position.copy(a);
    this.group.add(obj);
    const mid = a.clone().lerp(b, 0.5);
    mid.y += loft;
    this.couriers.push({ obj, curve: new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone()), t: 0, dur });
    return obj;
  }

  floatText(p: THREE.Vector3, html: string, cls = '', life = 2.2): CSS2DObject {
    const el = document.createElement('div');
    el.className = `float-tag ${cls}`;
    // The renderer owns the outer element's transform, so animate an inner wrapper.
    el.innerHTML = `<div class="float-inner">${html}</div>`;
    el.style.setProperty('--life', `${life}s`);
    const o = new CSS2DObject(el);
    o.position.copy(p);
    this.group.add(o);
    window.setTimeout(() => {
      o.removeFromParent();
      el.remove();
    }, life * 1000 + 50);
    return o;
  }

  update(dt: number, time: number) {
    for (let i = this.tags.length - 1; i >= 0; i--) {
      const g = this.tags[i];
      g.t += dt;
      if (g.target.parent) {
        g.target.getWorldPosition(this.tmp);
        g.obj.position.set(this.tmp.x, this.tmp.y + g.lift, this.tmp.z);
      }
      if (!g.out && g.t > g.life - 0.45) {
        g.out = true;
        g.obj.element.classList.add('is-out');
      }
      if (g.t >= g.life) {
        g.obj.removeFromParent();
        g.obj.element.remove();
        this.tags.splice(i, 1);
      }
    }

    for (let i = this.couriers.length - 1; i >= 0; i--) {
      const c = this.couriers[i];
      c.t += dt;
      const k = clamp(c.t / c.dur);
      c.curve.getPoint(k * k * (3 - 2 * k), c.obj.position);
      if (c.t > c.dur + 3) {
        c.obj.removeFromParent();
        this.couriers.splice(i, 1);
      }
    }

    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      tr.t += dt;
      tr.acc += dt;
      if (tr.target.parent && tr.t < tr.dur) {
        while (tr.acc > 0.018) {
          tr.acc -= 0.018;
          const sp = new THREE.Sprite(tr.mat);
          tr.target.getWorldPosition(sp.position);
          sp.position.y += 0.05;
          this.group.add(sp);
          this.motes.push({ sprite: sp, t: 0, life: 0.5, size: 0.5 });
        }
      }
      if (tr.t > tr.dur + 0.6) {
        tr.mat.dispose();
        this.trails.splice(i, 1);
      }
    }
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.t += dt;
      const k = clamp(m.t / m.life);
      m.sprite.scale.setScalar(Math.max(0.001, m.size * (1 - k)));
      if (k >= 1) {
        m.sprite.removeFromParent();
        this.motes.splice(i, 1);
      }
    }

    this.orbLevel += (this.orbTarget - this.orbLevel) * damp(7, dt);
    const lv = this.orbLevel;
    this.orb.visible = lv > 0.01;
    const wob = 1 + Math.sin(time * 18) * 0.04 * lv;
    this.orb.scale.setScalar(Math.max(0.001, lv * wob));
    this.orbHalo.material.opacity = clamp(lv, 0, 1) * 0.9;
    this.orbLight.intensity = lv * 14;

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      if (s.t < 0) {
        s.sprite.visible = false;
        continue;
      }
      s.sprite.visible = true;
      const k = clamp(s.t / s.dur);
      const e = k * k * (3 - 2 * k);
      s.curve.getPoint(e, s.sprite.position);
      s.sprite.material.opacity = Math.sin(Math.PI * Math.min(1, k * 1.15)) * 0.95 + 0.05;
      if (k >= 1) {
        s.onArrive?.();
        s.sprite.removeFromParent();
        s.sprite.material.dispose();
        this.sparks.splice(i, 1);
      }
    }

    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.t += dt;
      const k = clamp(s.t / s.dur);
      const e = 1 - Math.pow(1 - k, 3);
      s.mesh.scale.setScalar(0.2 + e * s.size);
      s.mesh.material.opacity = (1 - k) * 0.9;
      if (k >= 1) {
        s.mesh.removeFromParent();
        s.mesh.material.dispose();
        this.shocks.splice(i, 1);
      }
    }
  }
}
