import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function prepare(page: Page): Promise<void> {
  await page.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important}` });
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true));
    document.querySelectorAll<HTMLElement>('[hidden],[role="tabpanel"]').forEach((el) => {
      el.removeAttribute('hidden');
      el.style.display = '';
      el.classList.add('active', 'is-active', 'open');
    });
  });
  // run a scenario preset so alarm states, the event rail, and flashes render
  await page.getByRole('button', { name: /Resurrect an expired URL/ }).click().catch(() => {});
  // open the guided tour so its banner is on screen for the scan
  await page.getByRole('button', { name: /Take the 30-second tour/ }).click().catch(() => {});
  // drive the live demo so dynamic result regions render before the scan
  for (const b of await page.locator('#app button').all()) {
    const label = ((await b.textContent()) || '').toLowerCase();
    if (/run|verify|request|send|replay|intercept|split|copy/.test(label)) await b.click().catch(() => {});
  }
  // move the master clock so verdicts (incl. alarm states) are on screen
  await page.locator('#master-clock').fill('1260').catch(() => {}); // T+21 m
  await page.locator('#master-clock').dispatchEvent('input').catch(() => {});
  await page.waitForTimeout(400);
}

async function scan(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5) })),
  ).toEqual([]);
}

test('no WCAG A/AA violations — dark theme', async ({ page }) => {
  await page.goto('.');
  await prepare(page);
  await scan(page);
});

test('no WCAG A/AA violations — light theme', async ({ page }) => {
  await page.goto('.');
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await prepare(page);
  await scan(page);
});
