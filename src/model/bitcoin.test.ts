import { describe, expect, it } from 'vitest';
import { DUST_SATS, droppedChangeValue, minUsefulChange, pickCoins, planTx, txVbytes } from './bitcoin';

const WALLET = [48_000, 39_500, 31_500, 22_000, 18_750, 13_400, 8_400, 3_100, 900].map((value) => ({ value }));

describe('txVbytes', () => {
  it('matches the P2WPKH size estimates', () => {
    expect(txVbytes(1, 1)).toBe(110); // 10.5 + 68 + 31
    expect(txVbytes(1, 2)).toBe(141);
    expect(txVbytes(2, 2)).toBe(209);
    expect(txVbytes(3, 2)).toBe(277);
  });
});

describe('planTx', () => {
  it('pays with change when there is plenty left over', () => {
    expect(planTx([48_000, 8_400], 50_000, 10)).toMatchObject({
      ok: true,
      vbytes: 209,
      fee: 2_090,
      change: 4_310,
      hasChange: true,
      dustToFee: 0,
    });
  });

  it('needs no change when the inputs match payment plus fee exactly', () => {
    expect(planTx([51_100], 50_000, 10)).toMatchObject({ ok: true, fee: 1_100, change: 0, hasChange: false, dustToFee: 0 });
  });

  it('gives the miner a leftover that cannot even pay for its own change output', () => {
    const plan = planTx([22_000, 900], 21_000, 10);
    expect(plan).toMatchObject({ ok: true, vbytes: 178, fee: 1_900, hasChange: false, dustToFee: 120 });
    expect(droppedChangeValue(plan)).toBe(120 - 31 * 10);
  });

  it('drops change that would be dust after paying for its own output', () => {
    const plan = planTx([39_500, 13_400], 50_000, 13);
    expect(plan).toMatchObject({ ok: true, fee: 2_900, hasChange: false, dustToFee: 586 });
    // 586 is above the dust limit, but a change output would cost 403 and leave only 183.
    expect(droppedChangeValue(plan)).toBe(183);
    expect(droppedChangeValue(plan)).toBeLessThan(DUST_SATS);
  });

  it('keeps change of exactly the dust limit', () => {
    expect(planTx([50_000 + 1_410 + DUST_SATS], 50_000, 10)).toMatchObject({ hasChange: true, change: DUST_SATS });
  });

  it('reports how short a selection is', () => {
    expect(planTx([48_000], 50_000, 10)).toMatchObject({ ok: false, shortBy: 3_100 });
    expect(planTx([48_000, 8_400], 50_000, 150)).toMatchObject({ ok: false, shortBy: 20_300 });
    expect(planTx([], 50_000, 10).ok).toBe(false);
  });

  it('never creates or destroys sats', () => {
    const selections = [[900], [13_400, 8_400], [48_000, 39_500, 3_100], [22_000, 900]];
    for (const rate of [1, 7, 10, 33, 150]) {
      for (const inputs of selections) {
        const plan = planTx(inputs, 21_000, rate);
        if (plan.ok) expect(plan.payment + plan.fee + plan.change).toBe(plan.inputsTotal);
      }
    }
  });
});

describe('pickCoins', () => {
  it('combines several coins for the first bill at any fee rate', () => {
    for (const rate of [1, 10, 25, 60]) {
      const picked = pickCoins(WALLET, 50_000, rate);
      expect(picked).not.toBeNull();
      expect(picked!.length).toBeGreaterThanOrEqual(2);
      expect(planTx(picked!.map((c) => c.value), 50_000, rate).ok).toBe(true);
    }
  });

  it('avoids leaving tiny change when an equally cheap pick exists', () => {
    const picked = pickCoins(WALLET, 50_000, 10)!.map((c) => c.value);
    expect(picked).toEqual([48_000, 13_400]);
    expect(planTx(picked, 50_000, 10).change).toBeGreaterThanOrEqual(minUsefulChange(10));
  });

  it('prefers a changeless pick when it wastes less', () => {
    const picked = pickCoins(WALLET, 21_000, 10)!.map((c) => c.value);
    expect(picked).toEqual([22_000, 900]);
    expect(planTx(picked, 21_000, 10).hasChange).toBe(false);
  });

  it('returns null when the whole wallet cannot pay', () => {
    expect(pickCoins([{ value: 1_000 }], 50_000, 10)).toBeNull();
    expect(pickCoins([], 1, 1)).toBeNull();
  });

  it('falls back to largest-first for wallets too big to search exhaustively', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ value: 5_000 + i }));
    const picked = pickCoins(many, 30_000, 5);
    expect(picked).not.toBeNull();
    expect(planTx(picked!.map((c) => c.value), 30_000, 5).ok).toBe(true);
  });
});
