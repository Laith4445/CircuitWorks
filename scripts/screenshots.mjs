// Regenerate the README screenshots: node scripts/screenshots.mjs  (needs `npm run dev` on port 5174 or 5173)
import { chromium } from '@playwright/test';

const base = process.env.BASE ?? 'http://localhost:5174';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('circuitworks.onboarded.tour', '1'); });

async function shot(hash, name, run = true, extra) {
  await page.goto(`${base}/?shot=${name}${hash}`);
  await page.waitForSelector(hash.includes('selfcheck') ? 'table' : 'svg.canvas');
  await page.waitForTimeout(400);
  if (run) { await page.locator('button.run').click(); await page.waitForTimeout(600); }
  if (extra) await extra();
  await page.screenshot({ path: `docs/img/${name}.png` });
  console.log('wrote', name);
}

await shot('#/exercise/E1', 'e1-dc');
await shot('#/exercise/E4', 'e4-time', true, async () => {
  await page.locator('button:has-text("Keep")').click();
  const r1 = page.locator('text.value', { hasText: '12Ω' });
  await r1.dblclick();
  await page.locator('input.inline-edit').fill('2');
  await page.locator('input.inline-edit').press('Enter');
  await page.waitForTimeout(700);
  const plot = await page.locator('.plot svg').boundingBox();
  await page.mouse.move(plot.x + plot.width * 0.9, plot.y + plot.height * 0.5);
  await page.waitForTimeout(200);
});
await shot('#/exercise/E5', 'e5-bode');
await shot('#/exercise/E6', 'e6-switch');
await shot('#/selfcheck', 'selfcheck', false);
await browser.close();
