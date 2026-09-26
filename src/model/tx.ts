import { fakeTxid, type TxPlan } from './bitcoin';
import type { Mode, State, TxRecord } from './store';
import { nextId, type Invoice, type Utxo } from './wallet';

export function buildTx(inputs: Utxo[], plan: TxPlan, invoice: Invoice, mode: Mode): TxRecord {
  const txid = fakeTxid();
  const now = performance.now();
  // Many wallets shuffle output order so the change isn't obvious.
  const changeFirst = plan.hasChange && Math.random() < 0.5;
  const payment: Utxo = {
    id: nextId('p'),
    txid,
    vout: changeFirst ? 1 : 0,
    value: invoice.amount,
    from: `Your payment to ${invoice.to} · ${invoice.memo}`,
    origin: 'payment',
    bornAt: now,
    confirmed: false,
  };
  const change: Utxo | null = plan.hasChange
    ? { id: nextId('c'), txid, vout: changeFirst ? 0 : 1, value: plan.change, from: `Change from paying ${invoice.to}`, origin: 'change', bornAt: now, confirmed: false }
    : null;
  return { txid, invoice, inputs, payment, change, plan, mode };
}

export function applyTx(s: State, tx: TxRecord): Partial<State> {
  const spent = new Set(tx.inputs.map((u) => u.id));
  const utxos = s.utxos.filter((u) => !spent.has(u.id));
  if (tx.change) utxos.push(tx.change);
  return {
    utxos,
    selected: [],
    paid: [...s.paid, tx.payment],
    history: [...s.history, tx],
    lastTx: tx,
    pendingReveal: tx.mode === 'myth' ? [...s.pendingReveal, tx] : s.pendingReveal,
    phase: 'receipt',
  };
}

export function confirmTx(s: State, tx: TxRecord): Partial<State> {
  const ids = new Set([tx.payment.id, tx.change?.id]);
  const mark = (u: Utxo) => (ids.has(u.id) ? { ...u, confirmed: true } : u);
  return { utxos: s.utxos.map(mark), paid: s.paid.map(mark) };
}
