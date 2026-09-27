import { expect, test } from '@playwright/test';

test('pay a bill with two whole coins, then see it through the myth view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');
  await expect(page.locator('#stat-count')).toHaveText('9');
  await expect(page.locator('#inv-to')).toHaveText('Bike shop');
  await expect(page.locator('.coin-chip')).toHaveCount(9);

  // Coins are focused largest-first with the arrow keys: 48,000 then (six more) 8,400.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');

  await expect(page.locator('#in-sum')).toHaveText('56,400');
  await expect(page.locator('#fee-v')).toHaveText('2,090');
  await expect(page.locator('#change-v')).toHaveText('4,310');

  await page.keyboard.press('Space');
  await expect(page.locator('#receipt')).toHaveClass(/is-on/, { timeout: 30_000 });
  await expect(page.locator('#rc-say')).toContainText('4,310 back to you as change');
  await expect(page.locator('#stat-count')).toHaveText('8');
  await expect(page.locator('#stat-total')).toHaveText('133,460 sats');

  await page.keyboard.press('1');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'myth');
  await expect(page.locator('#inv-to')).toHaveText('Roastery');
  const previewFee = (await page.locator('#bank-fee').textContent())?.replace('−', '');
  await page.keyboard.press('Space');
  await expect(page.locator('#receipt')).toHaveClass(/is-on/, { timeout: 30_000 });
  await expect(page.locator('#rc-flow .sub')).toContainText(`+ ${previewFee} fee`);

  await page.keyboard.press('2');
  await expect(page.locator('.toast', { hasText: 'Underneath:' })).toBeVisible();

  expect(errors).toEqual([]);
});

test('ships with a strict Content-Security-Policy that the page never violates', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  await expect(page.locator('.coin-chip')).toHaveCount(9);
  expect(violations).toEqual([]);
});

test('tells screen readers which coin the arrow keys are on', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.coin-chip')).toHaveCount(9);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#announcer')).toHaveText(/^Coin 1 of 9: 48,000 sats\. Paid for a freelance logo\..*Enter uses it\.$/);
  await expect(page.locator('#gl')).toHaveAttribute('aria-describedby', 'tip');
  await expect(page.locator('#tip')).toContainText('Press Enter to use it');
  await page.keyboard.press('Escape');
  await expect(page.locator('#gl')).not.toHaveAttribute('aria-describedby', 'tip');
});
