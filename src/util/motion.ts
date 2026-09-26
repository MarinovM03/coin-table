const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let reduced = query?.matches ?? false;
query?.addEventListener('change', (e) => {
  reduced = e.matches;
});

export function reducedMotion(): boolean {
  return reduced;
}
