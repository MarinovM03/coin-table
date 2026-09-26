import * as THREE from 'three';
import { inputCost } from '../model/bitcoin';
import type { State } from '../model/store';
import type { Utxo } from '../model/wallet';
import { ease, tweens } from '../util/tween';
import { CoinView } from './coin';
import { coinSize, findWalletSpot, inputSlots, traySpot, type Disc } from './layout';

const FRESH_MS = 25_000;

export class Coins {
  /** Wallet coins, keyed by UTXO id. */
  readonly wallet = new Map<string, CoinView>();
  /** Coins that now belong to the people we paid. */
  tray: CoinView[] = [];
  /** Freshly minted outputs mid-flight, not yet committed to the wallet or tray. */
  readonly inFlight = new Set<CoinView>();
  /** Where spent coins used to sit, for the myth → reality reveal. */
  ghosts: Array<Disc & { value: number }> = [];
  leftToRight: CoinView[] = [];
  private badgeExpiry = 0;

  constructor(
    private scene: THREE.Scene,
    readonly onLand: (c: CoinView, arc: number) => void,
  ) {}

  sync(s: State, intro = false) {
    const ids = new Set(s.utxos.map((u) => u.id));
    for (const [id, v] of this.wallet) {
      if (!ids.has(id)) {
        v.dispose();
        this.wallet.delete(id);
      }
    }
    let n = 0;
    for (const u of s.utxos) {
      const v = this.wallet.get(u.id);
      if (v) v.utxo = u;
      else this.spawn(u, intro ? 0.35 + n++ * 0.085 : n++ * 0.06, s.mode === 'myth');
    }
    this.layout(s);
  }

  layout(s: State) {
    const sel = s.selected;
    const selViews = sel.map((id) => this.wallet.get(id)).filter((v): v is CoinView => !!v);
    const slots = inputSlots(selViews.map((v) => v.r));
    const now = performance.now();
    const cost = inputCost(s.feeRate);
    let expiry = 0;

    for (const v of this.wallet.values()) {
      const i = sel.indexOf(v.utxo.id);
      const target = i >= 0 ? new THREE.Vector3(slots[i].x, 0, slots[i].z) : v.home;
      const dest = (v.root.userData.dest as THREE.Vector3 | undefined) ?? v.home;
      if (dest.distanceToSquared(target) > 1e-6 && v.root.position.distanceToSquared(target) > 1e-5) {
        v.moveTo(target, { arc: i >= 0 ? 0.9 : 0.7 });
      }
      v.root.userData.dest = target.clone();
      const selTarget = i >= 0 ? 1 : 0;
      if (selTarget !== v.selTarget) v.bump();
      v.selTarget = selTarget;
      v.warn = v.utxo.value <= cost;
      v.unconfirmed = !v.utxo.confirmed;
      v.focusTarget = s.focusId === v.utxo.id ? 1 : 0;
      const fresh = v.utxo.origin === 'change' && now - v.utxo.bornAt < FRESH_MS;
      if (fresh) expiry = expiry ? Math.min(expiry, v.utxo.bornAt + FRESH_MS) : v.utxo.bornAt + FRESH_MS;
      v.setChip({ selected: i >= 0, warn: v.warn, fresh, unconfirmed: !v.utxo.confirmed });
    }
    this.badgeExpiry = expiry;
    for (const t of this.tray) t.unconfirmed = !t.utxo.confirmed;
    this.leftToRight = [...this.wallet.values()].sort((a, b) => a.home.x - b.home.x || a.home.z - b.home.z);
  }

  dropExpiredBadges(s: State, now: number) {
    if (this.badgeExpiry && now > this.badgeExpiry && s.phase !== 'sending') this.layout(s);
  }

  takenDiscs(): Disc[] {
    const out: Disc[] = [];
    for (const c of this.wallet.values()) out.push({ x: c.home.x, z: c.home.z, r: c.r });
    return out;
  }

  nextTraySpot() {
    return traySpot(this.tray.length, this.tray.reduce((h, c) => h + c.t * 0.92, 0));
  }

  sinkAll(sunk: boolean) {
    const all = [...this.wallet.values()].sort((a, b) => a.root.position.x - b.root.position.x);
    all.forEach((c, i) => {
      void tweens.wait(i * 0.045).then(() => {
        c.sinkTarget = sunk ? 1 : 0;
      });
    });
    this.tray.forEach((c, i) => {
      void tweens.wait(0.2 + i * 0.05).then(() => {
        c.sinkTarget = sunk ? 1 : 0;
      });
    });
  }

  update(dt: number, t: number) {
    for (const c of this.wallet.values()) c.update(dt, t);
    for (const c of this.tray) c.update(dt, t);
    for (const c of this.inFlight) c.update(dt, t);
  }

  redrawFaces() {
    for (const c of this.wallet.values()) c.redrawFace();
    for (const c of this.tray) c.redrawFace();
    for (const c of this.inFlight) c.redrawFace();
  }

  clear() {
    for (const v of this.wallet.values()) v.dispose();
    this.wallet.clear();
    for (const v of this.tray) v.dispose();
    this.tray = [];
    for (const v of this.inFlight) v.dispose();
    this.inFlight.clear();
    this.ghosts = [];
  }

  private spawn(u: Utxo, delay: number, sunk: boolean): CoinView {
    const v = new CoinView(u, u.origin !== 'seed');
    const { r } = coinSize(u.value);
    const spot = findWalletSpot(r, this.takenDiscs(), this.wallet.size * 0.7);
    v.home.set(spot.x, 0, spot.z);
    v.setPosition(new THREE.Vector3(spot.x, 3.2 + Math.random() * 1.2, spot.z));
    v.moveTo(v.home, { dur: 0.55, arc: 0, delay, ease: ease.inCubic });
    v.onLand = this.onLand;
    v.sinkTarget = v.sink = sunk ? 1 : 0;
    this.wallet.set(u.id, v);
    this.scene.add(v.root);
    return v;
  }
}
