import { describe, expect, it } from 'vitest';
import { planTx } from './bitcoin';
import { finishedRound, store, type Mode, type State } from './store';
import { applyTx, buildTx, confirmTx } from './tx';
import { INVOICES, walletTotal, type Invoice } from './wallet';

const base = store.get();
const coin = (value: number) => base.utxos.find((u) => u.value === value)!;
const pay = (values: number[], invoice: Invoice, mode: Mode = 'reality') =>
  buildTx(values.map(coin), planTx(values, invoice.amount, 10), invoice, mode);
const merge = (s: State, patch: Partial<State>): State => ({ ...s, ...patch });

describe('buildTx', () => {
  it('creates the payment and the change as two outputs of one transaction', () => {
    const tx = pay([48_000, 8_400], INVOICES[0]);
    expect(tx.payment).toMatchObject({ value: 50_000, txid: tx.txid, origin: 'payment', confirmed: false });
    expect(tx.change).toMatchObject({ value: 4_310, txid: tx.txid, origin: 'change', confirmed: false });
    expect([tx.payment.vout, tx.change?.vout].sort()).toEqual([0, 1]);
  });

  it('makes no change output when the plan has none', () => {
    const tx = pay([22_000, 900], INVOICES[1]);
    expect(tx.change).toBeNull();
    expect(tx.payment.vout).toBe(0);
  });
});

describe('applyTx', () => {
  const tx = pay([48_000, 8_400], INVOICES[0]);
  const paid = merge({ ...base, selected: tx.inputs.map((u) => u.id) }, applyTx(base, tx));

  it('spends the inputs whole and adds the change coin', () => {
    expect(paid.utxos.map((u) => u.value)).not.toContain(48_000);
    expect(paid.utxos.map((u) => u.value)).not.toContain(8_400);
    expect(paid.utxos).toContain(tx.change);
    expect(paid.utxos).toHaveLength(base.utxos.length - 1);
  });

  it('loses exactly the payment and the fee', () => {
    expect(walletTotal(base.utxos) - walletTotal(paid.utxos)).toBe(tx.payment.value + tx.plan.fee);
  });

  it('records the payment and moves on to the receipt', () => {
    expect(paid).toMatchObject({ phase: 'receipt', selected: [], lastTx: tx, paid: [tx.payment], history: [tx], pendingReveal: [] });
  });

  it('queues myth-mode payments to be revealed later', () => {
    const myth = pay([48_000, 8_400], INVOICES[0], 'myth');
    expect(applyTx(base, myth).pendingReveal).toEqual([myth]);
  });
});

describe('confirmTx', () => {
  it('confirms that transaction’s outputs and no others', () => {
    const first = pay([48_000, 8_400], INVOICES[0]);
    const second = pay([18_750], INVOICES[3]);
    let s = merge(base, applyTx(base, first));
    s = merge(s, applyTx(s, second));
    s = merge(s, confirmTx(s, first));
    const byId = (id: string) => s.utxos.find((u) => u.id === id) ?? s.paid.find((u) => u.id === id);
    expect(byId(first.payment.id)?.confirmed).toBe(true);
    expect(byId(first.change!.id)?.confirmed).toBe(true);
    expect(byId(second.payment.id)?.confirmed).toBe(false);
    expect(byId(second.change!.id)?.confirmed).toBe(false);
  });
});

describe('finishedRound', () => {
  const round = [
    pay([48_000, 8_400], INVOICES[0]),
    pay([22_000, 900], INVOICES[1]),
    pay([39_500, 31_500], INVOICES[2]),
    pay([18_750], INVOICES[3]),
  ];

  it('is null until the last bill of a round is paid', () => {
    expect(finishedRound(base)).toBeNull();
    expect(finishedRound({ ...base, invoiceIndex: 2, history: round.slice(0, 2) })).toBeNull();
  });

  it('sums up only the round that just finished', () => {
    const earlier = pay([31_500], INVOICES[1]);
    const s = { ...base, invoiceIndex: 2 * INVOICES.length, history: [earlier, ...round] };
    expect(finishedRound(s)).toEqual({ bills: 4, coinsIn: 7, changeCoins: 3, fees: 2_090 + 1_900 + 2_090 + 1_410 });
  });
});
