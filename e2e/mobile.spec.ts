import { expect, type Page, test } from '@playwright/test';

async function settle(page: Page) {
  await expect(page.locator('.callout')).toHaveClass(/is-on/, { timeout: 30_000 });
  const tag = page.locator('.coin-chip').filter({ hasText: /^48k$/ });
  let last = '';
  let still = 0;
  await expect
    .poll(
      async () => {
        const b = await tag.boundingBox();
        const now = b ? `${Math.round(b.x)},${Math.round(b.y)}` : '';
        still = now !== '' && now === last ? still + 1 : 0;
        last = now;
        return still >= 2;
      },
      { intervals: [400], timeout: 30_000 },
    )
    .toBe(true);
}

async function tapCoin(page: Page, label: string, expected: string) {
  const tag = page.locator('.coin-chip').filter({ hasText: new RegExp(`^${label}$`) });
  await expect(async () => {
    const box = await tag.boundingBox();
    if (!box) throw new Error(`no coin labelled ${label}`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2 + 8);
    await expect(page.locator('#in-count')).toHaveText(expected, { timeout: 3000 });
  }).toPass({ timeout: 30_000 });
}

function coveredCoins(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.coin-chip')]
      .filter((chip) => {
        const r = chip.getBoundingClientRect();
        if (!r.width) return false;
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2 + 8)?.id !== 'gl';
      })
      .map((chip) => chip.textContent),
  );
}

test('pays a bill by touch, then flips between the two views', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');
  await expect(page.locator('.coin-chip')).toHaveCount(9);
  await expect(page.locator('.callout b')).toHaveText('Tap coins');
  await settle(page);

  await tapCoin(page, '48k', '1 coin');
  await page.locator('#in-chips button', { hasText: '8,400' }).tap();
  await expect(page.locator('#in-chips button[aria-pressed="true"]')).toHaveText(['48,000', '8,400']);
  await expect(page.locator('#in-sum')).toHaveText('56,400');

  await page.locator('#btn-send').tap();
  await expect(page.locator('#receipt')).toHaveClass(/is-on/, { timeout: 30_000 });
  await expect(page.locator('#rc-hint')).toHaveText('Now try What people think — how most people picture this');
  expect(await coveredCoins(page)).toEqual([]);

  await page.locator('#modes button[data-mode="myth"]').tap();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'myth');
  await page.locator('#btn-send').tap();
  await expect(page.locator('#receipt')).toHaveClass(/is-on/, { timeout: 30_000 });
  await page.locator('#modes button[data-mode="reality"]').tap();
  await expect(page.locator('.toast', { hasText: 'Underneath:' })).toBeVisible();

  expect(errors).toEqual([]);
});

test('keeps every control on screen and the coins clear of the panels', async ({ page }) => {
  await page.goto('/');
  await settle(page);
  for (const control of ['#btn-send', '#fee', '#modes', '#btn-how', '#btn-sound']) {
    await expect(page.locator(control)).toBeInViewport({ ratio: 1 });
  }
  expect(await coveredCoins(page)).toEqual([]);

  await page.locator('#btn-how').tap();
  await expect(page.locator('#how')).toBeInViewport({ ratio: 1 });
  expect(await coveredCoins(page)).toEqual([]);
});

test.describe('audio', () => {
  test.use({ bypassCSP: true });

  test('starts only after a touch', async ({ page }) => {
    await page.addInitScript(() => {
      const made: AudioContext[] = [];
      const Native = window.AudioContext;
      if (!Native) return;
      window.AudioContext = class extends Native {
        constructor(options?: AudioContextOptions) {
          super(options);
          made.push(this);
        }
      };
      Object.assign(window, { audioContexts: made });
    });
    const contexts = () => page.evaluate(() => (window as unknown as { audioContexts: AudioContext[] }).audioContexts.length);

    await page.goto('/');
    test.skip(await page.evaluate(() => typeof AudioContext === 'undefined'), 'This browser build has no Web Audio.');
    await expect(page.locator('.coin-chip')).toHaveCount(9);
    expect(await contexts()).toBe(0);
    await page.locator('#btn-sound').tap();
    expect(await contexts()).toBe(1);
    await expect(page.locator('#btn-sound')).toHaveClass(/is-muted/);
  });
});
