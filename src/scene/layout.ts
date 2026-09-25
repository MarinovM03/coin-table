import * as THREE from 'three';

export const TABLE_RADIUS = 5.55;

/** World units, y up, table top at y = 0. */
export const LAYOUT = {
  wallet: { x: -2.85, z: 0.45, r: 2.1 },
  inputs: { x: 1.1, z: 3.1, w: 5.0, d: 1.4 },
  tx: { x: 0.95, z: -0.95, r: 0.95 },
  recipient: { x: 3.8, z: -0.8, r: 1.05 },
  miner: { x: 6.2, y: 1.3, z: -6.9 },
  bar: { x: 0, z: 0.9, len: 7.2 },
} as const;

const LOG_MIN = Math.log10(500);
const LOG_MAX = Math.log10(200_000);

/** Size grows with log(value) so big coins read bigger without dwarfing small ones. */
export function coinSize(value: number): { r: number; t: number } {
  const k = THREE.MathUtils.clamp((Math.log10(Math.max(1, value)) - LOG_MIN) / (LOG_MAX - LOG_MIN), 0, 1);
  return { r: 0.36 + 0.34 * k, t: 0.07 + 0.05 * k };
}

export interface Disc {
  x: number;
  z: number;
  r: number;
}

/** Golden-angle spiral search: organic-looking but deterministic across reloads. */
export function findWalletSpot(r: number, taken: readonly Disc[], seed = 0, front = false): { x: number; z: number } {
  const W = LAYOUT.wallet;
  const gap = 0.07;
  const golden = Math.PI * (3 - Math.sqrt(5));
  let best: { x: number; z: number; score: number } | null = null;
  for (let i = 0; i < 900; i++) {
    const d = 0.16 * Math.sqrt(i + seed * 3.1);
    const a = i * golden + seed;
    const x = W.x + Math.cos(a) * d;
    const z = W.z + Math.sin(a) * d * 0.95;
    if (Math.hypot(x - W.x, z - W.z) + r > W.r + 0.35) continue;
    let ok = true;
    for (const t of taken) {
      if (Math.hypot(t.x - x, t.z - z) < t.r + r + gap) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (!front) return { x, z };
    // Change coins land on the camera side of the pile, where they're seen.
    const score = z - W.z - Math.hypot(x - W.x, z - W.z) * 0.35;
    if (!best || score > best.score) best = { x, z, score };
  }
  if (best) return best;
  // Wallet is crowded: spill toward the back of the table.
  return { x: W.x + (Math.random() - 0.5) * 2, z: W.z - W.r - 0.6 };
}

export function inputSlots(radii: readonly number[]): Array<{ x: number; z: number }> {
  const S = LAYOUT.inputs;
  const gap = 0.14;
  const total = radii.reduce((a, r) => a + r * 2, 0) + gap * Math.max(0, radii.length - 1);
  const squeeze = total > S.w - 0.4 ? (S.w - 0.4) / total : 1;
  let x = S.x - (total * squeeze) / 2;
  return radii.map((r) => {
    const cx = x + r * squeeze;
    x += (r * 2 + gap) * squeeze;
    return { x: cx, z: S.z };
  });
}

export function traySpot(n: number, heightBelow: number): { x: number; z: number; y: number } {
  const R = LAYOUT.recipient;
  const a = n * 2.39996 + 0.6;
  const d = n === 0 ? 0 : 0.12 + (n % 3) * 0.05;
  return { x: R.x + Math.cos(a) * d, z: R.z + Math.sin(a) * d, y: 0.035 + heightBelow };
}
