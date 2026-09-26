/** Sizes assume native SegWit (P2WPKH, "bc1q…") single-sig inputs and outputs. */

export const SATS_PER_BTC = 100_000_000;

/** Fixed per-transaction overhead (version, counts, locktime, segwit marker) in vbytes. */
export const TX_OVERHEAD_VB = 10.5;
/** One P2WPKH input: outpoint + sequence + witness (signature + pubkey), ≈ 68 vB. */
export const INPUT_VB = 68;
/** One P2WPKH output: amount + script, 31 vB. */
export const OUTPUT_VB = 31;
/**
 * Bitcoin Core's default dust threshold for a P2WPKH output. Nodes won't relay
 * transactions that create smaller outputs. This is relay policy, not consensus.
 */
export const DUST_SATS = 294;

export function txVbytes(inputs: number, outputs: number): number {
  return Math.ceil(TX_OVERHEAD_VB + inputs * INPUT_VB + outputs * OUTPUT_VB);
}

/** What it costs, in fees, just to include one more coin as an input. */
export function inputCost(feeRate: number): number {
  return INPUT_VB * feeRate;
}

export function droppedChangeValue(plan: TxPlan): number {
  return plan.dustToFee - OUTPUT_VB * plan.feeRate;
}

/** Change smaller than this costs a big share of itself to spend later. */
export function minUsefulChange(feeRate: number): number {
  return 10 * inputCost(feeRate);
}

export interface TxPlan {
  inputsTotal: number;
  inputCount: number;
  payment: number;
  feeRate: number;
  vbytes: number;
  fee: number;
  /** Change output value, 0 when there is no change output. */
  change: number;
  hasChange: boolean;
  /** Leftover too small for its own output, silently added to the fee. */
  dustToFee: number;
  /** Missing sats (>0) when the selected coins can't cover payment + fee. */
  shortBy: number;
  ok: boolean;
}

/**
 * Plan a payment the way a typical wallet would:
 *   fee    = feeRate × size
 *   change = inputs − payment − fee
 * If the change would be dust, drop the change output and let the leftover
 * go to the miner as extra fee.
 */
export function planTx(inputs: readonly number[], payment: number, feeRate: number): TxPlan {
  const inputsTotal = inputs.reduce((a, b) => a + b, 0);
  const n = inputs.length;
  const base = { inputsTotal, inputCount: n, payment, feeRate };

  if (n > 0) {
    const vbWithChange = txVbytes(n, 2);
    const feeWithChange = vbWithChange * feeRate;
    const change = inputsTotal - payment - feeWithChange;
    if (change >= DUST_SATS) {
      return { ...base, vbytes: vbWithChange, fee: feeWithChange, change, hasChange: true, dustToFee: 0, shortBy: 0, ok: true };
    }
  }

  const vbNoChange = txVbytes(Math.max(n, 1), 1);
  const minFee = vbNoChange * feeRate;
  const leftover = inputsTotal - payment - minFee;
  if (n > 0 && leftover >= 0) {
    return {
      ...base,
      vbytes: vbNoChange,
      fee: minFee + leftover,
      change: 0,
      hasChange: false,
      dustToFee: leftover,
      shortBy: 0,
      ok: true,
    };
  }

  return {
    ...base,
    vbytes: vbNoChange,
    fee: minFee,
    change: 0,
    hasChange: false,
    dustToFee: 0,
    shortBy: Math.max(1, payment + minFee - inputsTotal),
    ok: false,
  };
}

/**
 * "Pick for me": search every combination of coins (the demo wallet is small)
 * and keep the one that wastes the least — fee paid now, plus the future cost
 * of creating and later spending a change output. Real wallets use smarter
 * searches (e.g. branch-and-bound) toward the same goal.
 */
export function pickCoins<T extends { value: number }>(coins: readonly T[], payment: number, feeRate: number): T[] | null {
  const n = coins.length;
  if (n === 0) return null;
  if (n > 16) return largestFirst(coins, payment, feeRate);

  let best: { mask: number; score: number; count: number; tiny: boolean; total: number } | null = null;
  const values = coins.map((c) => c.value);
  const changeCost = (OUTPUT_VB + INPUT_VB) * feeRate;
  const floor = minUsefulChange(feeRate);

  for (let mask = 1; mask < 1 << n; mask++) {
    const picked: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) picked.push(values[i]);
    const plan = planTx(picked, payment, feeRate);
    if (!plan.ok) continue;
    const score = plan.fee + (plan.hasChange ? changeCost : 0);
    const tiny = plan.hasChange && plan.change < floor;
    // Ties: fewer inputs, then avoid tiny change, then the smaller total (less value parked in change).
    const better =
      !best ||
      score < best.score ||
      (score === best.score &&
        (picked.length < best.count ||
          (picked.length === best.count && (tiny !== best.tiny ? !tiny : plan.inputsTotal < best.total))));
    if (better) best = { mask, score, count: picked.length, tiny, total: plan.inputsTotal };
  }
  if (!best) return null;
  return coins.filter((_, i) => best!.mask & (1 << i));
}

function largestFirst<T extends { value: number }>(coins: readonly T[], payment: number, feeRate: number): T[] | null {
  const sorted = [...coins].sort((a, b) => b.value - a.value);
  const picked: T[] = [];
  for (const c of sorted) {
    picked.push(c);
    if (planTx(picked.map((p) => p.value), payment, feeRate).ok) return picked;
  }
  return null;
}

/** A fake-but-plausible 64-hex txid. Demo data only — these don't exist on-chain. */
export function fakeTxid(seed?: number): string {
  let s = seed ?? Math.floor(Math.random() * 2 ** 31);
  let out = '';
  for (let i = 0; i < 64; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out += ((s >> 16) & 15).toString(16);
  }
  return out;
}
