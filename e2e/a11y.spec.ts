import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate for Time Trust.
 *
 * The lab is driven along everything it teaches, and EVERY state is scanned
 * while it is on screen: the arrival page at T+0, where every verifier has
 * already run; the certificate stepper mid-walk and finished, its DER dump
 * disclosed, and its signature bit flipped and un-flipped; all six "jump to"
 * moments, which are the verdict-flip states the whole lab is built on; both
 * timeline zooms; the JWT split-brain, its opposite skew, its widened leeway,
 * and the zero-skew state where the jump button is `disabled` and the panel
 * explains why; the TOTP panel's replay-with-nothing-captured branch, a code
 * that matches no window, an accepted first use, a retired verdict, a replay
 * caught by the used-code record and — with the record off — a replay accepted
 * by a genuine HMAC match; both ends of the tolerance select and the phone-skew
 * slider; the signed URL rolled back on the client (nothing) and on the server
 * (resurrected); a replay walked through all three servers WITH the clock moved
 * between, so each rejects or accepts for its own different reason; both node
 * skews at their extremes; all four scenario presets; and the guided tour walked
 * one real step at a time, plus both of its exits.
 *
 * Four configurations: {dark, light} × {1280, 380}. The spec this replaces ran
 * four tests, all at Playwright's default 1280 viewport, so the
 * `@media (max-width: 640px)` block that collapses `.grid-2` and `.grid-3` to a
 * single column had never been rendered by any test in this repo.
 *
 * See `gate.ts` for what the old spec did: it injected motion suppression over
 * the lab's own reduced-motion blocks, stripped `hidden` from the guided tour's
 * `role="status"` banner to scan it EMPTY, swallowed every missing control with
 * `.catch(() => {})`, drove the page by regex-matching button labels, scanned
 * ONCE after setting the master clock had already re-rendered every panel it had
 * built, and pointed its 1.4.11 check at exactly the selectors `--ctl-border`
 * was applied to.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(900_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(900_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}
