import { describe, expect, it } from 'vitest';
import { LAYOUT, TABLE_RADIUS, coinSize, findWalletSpot, inputSlots, type Disc } from './layout';

const VALUES = [48_000, 39_500, 31_500, 22_000, 18_750, 13_400, 8_400, 3_100, 900, 9_310, 4_310, 120];

function overlap(a: Disc, b: Disc): number {
  return a.r + b.r - Math.hypot(a.x - b.x, a.z - b.z);
}

function slotDiscs(values: number[]): Disc[] {
  const radii = values.map((v) => coinSize(v).r);
  return inputSlots(radii).map((p, i) => ({ ...p, r: radii[i] }));
}

describe('inputSlots', () => {
  it('never overlaps any selection the wallet can actually make', () => {
    for (let n = 1; n <= 9; n++) {
      for (const order of [VALUES, [...VALUES].reverse()]) {
        const discs = slotDiscs(order.slice(0, n));
        for (let i = 0; i < discs.length; i++) {
          for (let j = i + 1; j < discs.length; j++) expect(overlap(discs[i], discs[j])).toBeLessThanOrEqual(1e-9);
        }
      }
    }
  });

  it('keeps even oversized selections on the table', () => {
    for (let n = 1; n <= VALUES.length; n++) {
      for (const d of slotDiscs(VALUES.slice(0, n))) expect(Math.hypot(d.x, d.z) + d.r).toBeLessThan(TABLE_RADIUS);
    }
  });

  it('keeps a small selection in a single row, in selection order', () => {
    const slots = inputSlots([0.6, 0.5, 0.4]);
    expect(new Set(slots.map((s) => s.z)).size).toBe(1);
    expect(slots[0].x).toBeLessThan(slots[1].x);
    expect(slots[1].x).toBeLessThan(slots[2].x);
    expect(slots[0].z).toBe(LAYOUT.inputs.z);
  });
});

describe('findWalletSpot', () => {
  it('packs the whole demo wallet without overlaps', () => {
    const taken: Disc[] = [];
    VALUES.slice(0, 9).forEach((v, i) => {
      const { r } = coinSize(v);
      const spot = findWalletSpot(r, taken, i * 0.7);
      for (const t of taken) expect(overlap({ ...spot, r }, t)).toBeLessThan(0);
      taken.push({ ...spot, r });
    });
  });
});
