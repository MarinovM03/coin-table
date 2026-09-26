import { fakeTxid } from './bitcoin';

export type CoinOrigin = 'seed' | 'change' | 'payment';

export interface Utxo {
  id: string;
  txid: string;
  vout: number;
  value: number;
  /** One-line backstory of the transaction that created it. */
  from: string;
  origin: CoinOrigin;
  /** When it was created, in performance.now() ms (for "new" badges). */
  bornAt: number;
  confirmed: boolean;
}

export interface Invoice {
  to: string;
  memo: string;
  amount: number;
}

/** No single coin covers the first bill, so paying it means combining whole coins. */
const SEED: Array<Pick<Utxo, 'value' | 'from'>> = [
  { value: 48_000, from: 'Paid for a freelance logo' },
  { value: 39_500, from: 'Withdrawn from an exchange' },
  { value: 31_500, from: 'Change from buying a used book' },
  { value: 22_000, from: 'Birthday gift from a friend' },
  { value: 18_750, from: 'Sold an old bike lock' },
  { value: 13_400, from: 'Refund for a cancelled order' },
  { value: 8_400, from: 'A tip for a blog post' },
  { value: 3_100, from: 'Change from a coffee' },
  { value: 900, from: 'Leftover from an old payment' },
];

export const INVOICES: Invoice[] = [
  { to: 'Bike shop', memo: 'Brake repair', amount: 50_000 },
  { to: 'Roastery', memo: 'Bag of coffee beans', amount: 21_000 },
  { to: 'Record store', memo: 'A used turntable', amount: 64_000 },
  { to: 'A friend', memo: 'Splitting a pizza', amount: 12_500 },
];

let uid = 0;
export function nextId(prefix = 'u'): string {
  uid += 1;
  return `${prefix}${uid}`;
}

export function seedWallet(): Utxo[] {
  return SEED.map((s, i) => ({
    id: nextId(),
    txid: fakeTxid(7919 * (i + 3)),
    vout: (i * 5) % 3,
    value: s.value,
    from: s.from,
    origin: 'seed',
    bornAt: 0,
    confirmed: true,
  }));
}

export function walletTotal(utxos: readonly Utxo[]): number {
  return utxos.reduce((a, u) => a + u.value, 0);
}

export const shortTxid = (txid: string) => `${txid.slice(0, 6)}…${txid.slice(-4)}`;
