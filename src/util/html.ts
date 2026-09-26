export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

type Part = SafeHtml | string | number | boolean | null | undefined | readonly Part[];

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function render(part: Part): string {
  if (part instanceof SafeHtml) return part.value;
  if (Array.isArray(part)) return part.map(render).join('');
  if (part === null || part === undefined || part === false) return '';
  return escapeHtml(String(part));
}

export function html(strings: TemplateStringsArray, ...parts: Part[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < parts.length; i++) out += render(parts[i]) + strings[i + 1];
  return new SafeHtml(out);
}

export function setHtml(el: Element, content: SafeHtml) {
  el.innerHTML = content.value;
}
