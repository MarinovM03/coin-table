import { sats } from '../util/format';

export class Ticker {
  private cur = 0;
  private target = 0;
  private primed = false;
  constructor(
    private el: HTMLElement,
    private fmt: (n: number) => string = sats,
  ) {}
  set(v: number) {
    this.target = v;
    if (!this.primed) {
      this.cur = v;
      this.primed = true;
      this.el.textContent = this.fmt(v);
    }
  }
  update(dt: number) {
    if (this.cur === this.target) return;
    const d = this.target - this.cur;
    const step = d * (1 - Math.exp(-14 * dt));
    this.cur = Math.abs(d) < 1 ? this.target : this.cur + step;
    this.el.textContent = this.fmt(Math.round(this.cur));
  }
}
