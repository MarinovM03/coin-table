import { SATS_PER_BTC } from '../model/bitcoin';

const nf = new Intl.NumberFormat('en-US');

export const sats = (n: number) => nf.format(Math.round(n));
export const satsUnit = (n: number) => `${sats(n)} sats`;

export function btc(n: number): string {
  const v = n / SATS_PER_BTC;
  return `${v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} BTC`;
}

/** e.g. 48k, 18.75k, 900 */
export function compact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(k < 10 ? 2 : 1).replace(/0+$/, '').replace(/\.$/, '')}k`;
  }
  return String(n);
}

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
