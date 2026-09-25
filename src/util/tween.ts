export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
} satisfies Record<string, Ease>;

interface TweenSpec {
  duration: number; // seconds
  delay?: number;
  ease?: Ease;
  update: (t: number) => void;
}

interface Active {
  spec: TweenSpec;
  elapsed: number;
  resolve: () => void;
  cancelled: boolean;
}

/** Frame-driven tweens so everything shares one clock (and pauses with the tab). */
class Tweens {
  private active: Active[] = [];

  run(spec: TweenSpec): Promise<void> & { cancel: () => void } {
    let entry!: Active;
    const p = new Promise<void>((resolve) => {
      entry = { spec, elapsed: -(spec.delay ?? 0), resolve, cancelled: false };
      this.active.push(entry);
    }) as Promise<void> & { cancel: () => void };
    p.cancel = () => {
      entry.cancelled = true;
    };
    return p;
  }

  wait(seconds: number): Promise<void> {
    return this.run({ duration: seconds, update: () => {} });
  }

  tick(dt: number) {
    if (this.active.length === 0) return;
    const still: Active[] = [];
    // Iterate a snapshot: callbacks may schedule new tweens.
    const list = this.active;
    this.active = [];
    for (const a of list) {
      if (a.cancelled) {
        a.resolve();
        continue;
      }
      a.elapsed += dt;
      if (a.elapsed < 0) {
        still.push(a);
        continue;
      }
      const raw = a.spec.duration <= 0 ? 1 : Math.min(1, a.elapsed / a.spec.duration);
      a.spec.update((a.spec.ease ?? ease.inOutCubic)(raw));
      if (raw >= 1) a.resolve();
      else still.push(a);
    }
    this.active = still.concat(this.active);
  }

  clear() {
    for (const a of this.active) a.resolve();
    this.active = [];
  }
}

export const tweens = new Tweens();

/** Frame-rate independent exponential smoothing factor. */
export function damp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
