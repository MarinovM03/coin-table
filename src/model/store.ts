import { planTx, type TxPlan } from './bitcoin';
import { INVOICES, seedWallet, type Invoice, type Utxo } from './wallet';

export type Mode = 'myth' | 'reality';
export type Phase = 'select' | 'sending' | 'receipt';

export interface TxRecord {
  txid: string;
  invoice: Invoice;
  inputs: Utxo[];
  payment: Utxo;
  change: Utxo | null;
  plan: TxPlan;
  mode: Mode;
}

export interface State {
  mode: Mode;
  phase: Phase;
  utxos: Utxo[];
  /** Selection order matters for layout, so this is an ordered list of ids. */
  selected: string[];
  feeRate: number;
  invoiceIndex: number;
  /** Coins that now belong to recipients (their UTXOs, shown in their tray). */
  paid: Utxo[];
  history: TxRecord[];
  lastTx: TxRecord | null;
  /** Myth-mode payments not yet shown underneath; revealed when reality mode is back. */
  pendingReveal: TxRecord[];
  uiHidden: boolean;
  labels: boolean;
  muted: boolean;
  howOpen: boolean;
}

type Listener = (s: State, prev: State) => void;

export const FEE_MIN = 1;
export const FEE_MAX = 150;
export const FEE_DEFAULT = 10;

function initialState(prev?: Partial<State>): State {
  return {
    mode: 'reality',
    phase: 'select',
    utxos: seedWallet(),
    selected: [],
    feeRate: FEE_DEFAULT,
    invoiceIndex: 0,
    paid: [],
    history: [],
    lastTx: null,
    pendingReveal: [],
    uiHidden: prev?.uiHidden ?? false,
    labels: prev?.labels ?? true,
    muted: prev?.muted ?? false,
    howOpen: prev?.howOpen ?? false,
  };
}

class Store {
  private state: State = initialState();
  private listeners = new Set<Listener>();

  get(): State {
    return this.state;
  }

  set(patch: Partial<State>) {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of this.listeners) l(this.state, prev);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  resetWallet() {
    const s = this.state;
    this.set(initialState({ uiHidden: s.uiHidden, labels: s.labels, muted: s.muted, howOpen: s.howOpen }));
  }
}

export const store = new Store();

export function invoiceOf(s: State): Invoice {
  return INVOICES[s.invoiceIndex % INVOICES.length];
}

export function selectedCoins(s: State): Utxo[] {
  const byId = new Map(s.utxos.map((u) => [u.id, u]));
  return s.selected.map((id) => byId.get(id)).filter((u): u is Utxo => !!u);
}

export function currentPlan(s: State): TxPlan {
  return planTx(
    selectedCoins(s).map((u) => u.value),
    invoiceOf(s).amount,
    s.feeRate,
  );
}
