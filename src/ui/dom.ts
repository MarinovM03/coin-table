/** Phones and tablets: say "tap", not "click". */
export const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};
