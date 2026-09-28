/**
 * SPEC §7.3 smoke test: build E1 (Problem 2.74) from a blank canvas with the
 * keyboard and mouse, run it, and read 870 mV on the probe badge.
 */
import { test, expect, type Page } from '@playwright/test';

// Default view: world (wx, wy) -> canvas pixel ((wx + 20) * 1.6, (wy + 20) * 1.6)
async function canvasPoint(page: Page, wx: number, wy: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('svg.canvas').boundingBox())!;
  return { x: box.x + (wx + 20) * 1.6, y: box.y + (wy + 20) * 1.6 };
}

async function click(page: Page, wx: number, wy: number) {
  const p = await canvasPoint(page, wx, wy);
  await page.mouse.click(p.x, p.y);
}

async function place(page: Page, key: string, wx: number, wy: number, rotate = false) {
  await page.keyboard.press(key);
  if (rotate) await page.keyboard.press('Space');
  await click(page, wx, wy);
}

async function setValue(page: Page, wx: number, wy: number, value: string) {
  const p = await canvasPoint(page, wx, wy);
  await page.mouse.dblclick(p.x, p.y);
  const input = page.locator('input.inline-edit');
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press('Enter');
}

test('build E1 from a blank canvas and read 870 mV', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('circuitworks.onboarded.tour', '1');
  });
  await page.goto('/#/');
  await expect(page.locator('svg.canvas')).toBeVisible();
  await page.locator('svg.canvas').click({ position: { x: 400, y: 300 } });

  // parts
  await place(page, 'v', 60, 120, true);
  await place(page, 'r', 140, 100, true);
  await place(page, 'r', 220, 100, true);
  await place(page, 'r', 140, 180, true);
  await place(page, 'r', 220, 180, true);
  await place(page, 'g', 60, 200);

  // wires (W, then click from point to point; a click on a pin or wire ends the wire)
  await page.keyboard.press('w');
  for (const [wx, wy] of [[60, 100], [60, 60], [220, 60], [220, 80]]) await click(page, wx, wy);
  for (const [wx, wy] of [[140, 60], [140, 80]]) await click(page, wx, wy);
  for (const [wx, wy] of [[140, 120], [140, 140], [220, 140], [220, 120]]) await click(page, wx, wy);
  for (const [wx, wy] of [[140, 140], [140, 160]]) await click(page, wx, wy);
  for (const [wx, wy] of [[220, 140], [220, 160]]) await click(page, wx, wy);
  for (const [wx, wy] of [[140, 200], [140, 220], [220, 220], [220, 200]]) await click(page, wx, wy);
  for (const [wx, wy] of [[60, 140], [60, 200]]) await click(page, wx, wy);
  for (const [wx, wy] of [[60, 200], [140, 220]]) await click(page, wx, wy);
  await page.keyboard.press('Escape');

  // no red pins left
  await expect(page.locator('circle.pin.open')).toHaveCount(0);

  // values
  await setValue(page, 60, 120, '2.5');
  await setValue(page, 140, 100, '10');
  await setValue(page, 220, 100, '10');
  await setValue(page, 140, 180, '15');
  await setValue(page, 220, 180, '25');

  // probe on the top wire, reference dragged to the middle wire
  await page.keyboard.press('p');
  await click(page, 100, 60);
  const from = await canvasPoint(page, 114, 74);
  const to = await canvasPoint(page, 180, 140);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();

  // run
  await page.locator('button.run').click();
  await expect(page.locator('.badge text')).toHaveText(/870 mV|0\.870 V/);
});
