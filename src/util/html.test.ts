import { describe, expect, it } from 'vitest';
import { html } from './html';

describe('html', () => {
  it('escapes interpolated text', () => {
    expect(html`<b>${'<img src=x onerror=alert(1)>'}</b>`.value).toBe('<b>&lt;img src=x onerror=alert(1)&gt;</b>');
  });

  it('escapes quotes so values cannot break out of an attribute', () => {
    expect(html`<a title="${'" onmouseover="x'}">`.value).toBe('<a title="&quot; onmouseover=&quot;x">');
  });

  it('keeps nested markup and arrays of markup as markup', () => {
    const items = ['a&b', 'c'].map((t) => html`<li>${t}</li>`);
    expect(html`<ul>${items}</ul>`.value).toBe('<ul><li>a&amp;b</li><li>c</li></ul>');
  });

  it('renders numbers and skips null, undefined and false', () => {
    expect(html`${42}|${null}|${undefined}|${false}|${0}`.value).toBe('42||||0');
  });
});
