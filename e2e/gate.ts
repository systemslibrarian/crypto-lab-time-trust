import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate on Time Trust.
 *
 * WHAT THE SPEC THIS REPLACES ACTUALLY DID. Its whole drive was one `prepare()`
 * function, and every line of it removed information:
 *
 *  1. IT INJECTED MOTION SUPPRESSION —
 *     `*,*::before,*::after{animation:none!important;transition:none!important}`
 *     through `addStyleTag`. That BYPASSED this stylesheet's two
 *     `@media (prefers-reduced-motion: reduce)` blocks instead of exercising
 *     them, which is the only way to find out whether cancelling
 *     `panel-flash` — the alarm cue every preset fires — strands anything. It
 *     also reached further than the lab's own blocks do: the shared top bar's
 *     `.cl-btn` transitions and the skip link's `top` transition are outside
 *     them and stayed live in the real rendering while being killed in the
 *     measured one.
 *
 *  2. IT ASSEMBLED A DOCUMENT NO VISITOR CAN REACH. It walked
 *     `[hidden],[role="tabpanel"]`, removed `hidden`, cleared inline `display`
 *     and added `active is-active open` to each. On this page exactly one
 *     element is `[hidden]`: the guided tour's `role="status"` banner, which is
 *     EMPTY until `showTourStep()` fills it. So the scan measured a bordered,
 *     tinted, empty live region that no reader can produce — and never measured
 *     the four real tour steps, each of which carries a step counter, a pinned
 *     sentence and two buttons. (It also proved nothing about `[hidden]`
 *     itself; `boot` below asserts the computed `display` instead, because
 *     `[hidden]` has specificity (0,1,0) and any later class rule silently beats
 *     it.)
 *
 *  3. IT SWALLOWED EVERY MISSING CONTROL. Every click was
 *     `.click().catch(() => {})`, so a control that had been renamed, removed or
 *     never rendered SKIPPED SILENTLY instead of failing, and the run stayed
 *     green while measuring a page the drive never actually built.
 *
 *  4. ITS DRIVE WAS A REGEX OVER BUTTON LABELS.
 *     `if (/run|verify|request|send|replay|intercept|split|copy/.test(label))`,
 *     applied to every `#app button` in DOM order. That is not a walk through
 *     what the lab teaches: it clicks "Replay to A", "Replay to B" and
 *     "Replay to C" with no clock movement between them, so all three reject
 *     for the same dull reason and the one state the panel exists for — a
 *     replay that server A's slow clock calls fresh — is never built. It presses
 *     "Verify code" with an empty box. And it never touches a slider, a
 *     `<select>`, a checkbox, the zoom pair, the moment buttons, or the tour's
 *     Next.
 *
 *  5. IT SCANNED ONCE, AT THE END, AFTER OVERWRITING EVERYTHING. The last thing
 *     `prepare()` did was set `#master-clock` to T+21m and dispatch `input` —
 *     which re-renders the certificate, JWT, URL, node and replay-clock panels
 *     from scratch. Every result the button sweep had produced was replaced
 *     before the single `scan()` looked, and the four `waitForTimeout(400)`-ish
 *     waits were the only synchronisation anywhere.
 *
 *  6. IT SCANNED ONE VIEWPORT. No viewport override anywhere, so every test ran
 *     at 1280 and the `@media (max-width: 640px)` block that collapses
 *     `.grid-2` and `.grid-3` to one column had never been rendered.
 *
 *  7. ITS 1.4.11 CHECK WAS SELF-CONFIRMING. `measureControlBorders()` queried
 *     `input, textarea, select` filtered to text-ish types — which is exactly,
 *     and only, the selector `--ctl-border` is applied to
 *     (`.field input[type='text'], .field input[type='number'], .field select`).
 *     That token is defined once and used once; `--border`, a SURFACE divider,
 *     is used eighteen times — including on `#app button`, which is EVERY
 *     button on this page. The check reported the one place the rule was already
 *     kept and never looked at the rest, where the real number was 1.65:1.
 *
 * And `scan()` asserted `violations` alone, which is not a complete oracle:
 * reflow (1.4.10) and non-text contrast (1.4.11) have no axe rule at all, and
 * `incomplete` — where a prohibited `aria-label` and every unresolvable surface
 * land — was never read.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 *
 * This page has real work for it even under reduced motion. The lab's own
 * reduced-motion blocks cancel only `.panel-flash` and `.step`'s transition;
 * the shared top bar's `.cl-btn` (`transition: background .15s, border-color
 * .15s, color .15s`) and the skip link (`transition: top .15s ease`) are
 * outside them and still animate. It also covers `lab.scrollTo()`, which every
 * preset and every tour step calls with `behavior: 'smooth'`.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders invisible for every reader with the preference set.
 *
 * This lab has exactly one animation and it is the shape that has to be checked
 * rather than reasoned about: `.panel-flash` runs `panel-flash 0.9s`, which is
 * the alarm cue `lab.flashAlarm()` fires on the whole `<section>` whenever a
 * preset, a tour step or a threshold crossing produces a wrong verdict — and the
 * reduced-motion block cancels it with `animation: none`. It animates
 * `box-shadow` from a `--bad-text` ring to `transparent`, so cancelling it
 * leaves the section exactly where the animation would have ended and no content
 * depends on it. The drive fires it many times (every preset calls it), so this
 * assertion is under load. What would break it is someone animating `opacity`
 * from 0, which is why this measures rather than reads.
 *
 * `aria-hidden` subtrees are excluded. On this page that is the pass/fail glyphs
 * `verdict.ts` emits (`✓ ✗ ⚠`), each of which sits immediately beside its own
 * words in the same ink, and the timeline `<svg>` — which is `aria-hidden` with
 * a `.visually-hidden` prose summary beside it, and whose graphic parts are
 * measured by `auditTimelineGraphics` below precisely because both oracles stop
 * at `aria-hidden`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. A renderer that throws halfway through leaves an earlier state on
 * screen, and a gate that scans that state reports green for a page that is
 * broken. That matters here because every panel renders by building a DOM tree
 * and appending it in one go: a throw partway through `renderStep` leaves the
 * PREVIOUS step on screen, and the drive's own `expect`s would be the only
 * thing that noticed. Attach before `boot`, assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark: the shared bar.
 *
 * This page has two `<header>` elements — the shared `.cl-topbar`, which
 * declares `role="banner"`, and `.cl-hero`, which sits INSIDE `<main id="app">`.
 * (Time Trust nests its hero in `<main>`; that is a property of the markup, not
 * of the dedupe script, and asserting the outcome catches a change to either.)
 * Being scoped by `<main>` strips the hero's implicit banner role on its own,
 * and `index.html`'s `dedupeBanner()` also skips it for that reason
 * (`el.closest('main, …')` returns early). Asserting the OUTCOME rather than
 * either mechanism means a change to the nesting is caught too.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including the
 * lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. `playwright.config.ts` also sets
 * `contextOptions: { reducedMotion: 'reduce' }`; the assertion is what makes
 * that a measurement rather than a hope, and it is the difference between
 * exercising this stylesheet's reduced-motion blocks and the old spec's
 * `addStyleTag` override of them.
 *
 * `[hidden]` IS PROBED, NOT INFERRED. The attribute carries specificity (0,1,0),
 * identical to a class, so any later `.foo { display: … }` beats it and it
 * silently does nothing — a shape found in seven labs across this sweep. The one
 * element here that relies on it is the guided tour's `role="status"` banner,
 * which the spec this replaces stripped `hidden` from before its only scan,
 * measuring an empty live region no reader can produce. So the computed
 * `display` is read off the live element rather than reasoned about from CSS.
 *
 * The theme is seeded through `localStorage` rather than by clicking the
 * toggle, which also pins a real failure mode: `index.html`'s anti-flash script
 * reads `localStorage.getItem('theme')` and the shared bar's toggle writes
 * `localStorage.setItem('theme', …)`. If those keys drift apart the theme
 * silently stops persisting.
 *
 * The defaults are asserted at length because this lab is ENTIRELY defaults.
 * Everything on the page is a verifier already running against a shipped skew:
 * the resource server is 90 s ahead, TOTP tolerance is ±1 with the used-code
 * record ON, the three replay servers sit at −240/0/+240 s, the three nodes at
 * −120/0/+120 s, and the master clock is at T+0. Which half of this lab a
 * single-configuration gate measures depends entirely on those numbers, and one
 * of them shipping the other way round would mean the old gate had been scanning
 * the alarm states and never the clean ones, or the reverse.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the whole
  // test timeout and reports nothing useful. 20s turns that silent hang into a
  // named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);

  // The lab's own reduced-motion block, asserted rather than assumed. `.step`
  // declares `transition: border-color .25s, background-color .25s` and the
  // block cancels it; the stepper ships on the page at first paint.
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector('.step')!).transitionDuration),
    "the lab's own reduced-motion block must cancel the stepper transition"
  ).toBe('0s');

  // Every panel is mounted asynchronously by `src/main.ts` after `buildScenario()`
  // has generated real keys, so a navigation that resolves proves nothing.
  for (const id of [
    'clock-panel-body',
    'cert-panel-body',
    'jwt-panel-body',
    'totp-panel-body',
    'url-panel-body',
    'replay-panel-body',
    'nodes-panel-body',
  ]) {
    await expect(page.locator(`#${id}`)).not.toBeEmpty();
  }

  // ── `[hidden]` really hides, measured on the live element ────────────────
  // The attribute is written by `el()` as `hidden="hidden"`, not as a bare
  // boolean, which is why this asserts the value rather than emptiness.
  await expect(page.locator('.tour-banner')).toHaveAttribute('hidden', 'hidden');
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector('.tour-banner')!).display),
    '[hidden] has class-level specificity; a later rule silently beating it must fail here'
  ).toBe('none');
  await expect(page.locator('.tour-banner')).toBeHidden();

  // ── The master clock ships at T+0 ────────────────────────────────────────
  await expect(page.locator('#master-clock')).toHaveValue('0');
  await expect(page.locator('[data-testid="clock-now"]')).toContainText('(T+0s)');
  await expect(page.getByRole('button', { name: 'Zoom: first hours' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Zoom: full two days' })).toHaveAttribute('aria-pressed', 'false');

  // ── Every shipped skew, tolerance and switch ─────────────────────────────
  // These are the lab. A gate that assumed them would be describing a different
  // page from the one a reader loads.
  await expect(page.locator('#cert-tamper')).not.toBeChecked();
  await expect(page.locator('#jwt-rs-skew')).toHaveValue('90');
  await expect(page.locator('#jwt-leeway')).toHaveValue('0');
  await expect(page.locator('#totp-skew')).toHaveValue('0');
  await expect(page.locator('#totp-tol')).toHaveValue('1');
  await expect(page.locator('#totp-used')).toBeChecked();
  await expect(page.locator('#totp-input')).toHaveValue('');
  await expect(page.locator('#url-client-skew')).toHaveValue('0');
  await expect(page.locator('#url-server-skew')).toHaveValue('0');
  await expect(page.locator('#replay-skew-A')).toHaveValue('-240');
  await expect(page.locator('#replay-skew-B')).toHaveValue('0');
  await expect(page.locator('#replay-skew-C')).toHaveValue('240');
  await expect(page.locator('#node-skew-node-west')).toHaveValue('-120');
  await expect(page.locator('#node-skew-node-central')).toHaveValue('0');
  await expect(page.locator('#node-skew-node-east')).toHaveValue('120');

  // ── What has already run by itself at first paint ────────────────────────
  // The replay panel delivers the scenario request to server B on mount, and the
  // node panel verifies the same signature four times per render. Both are real
  // results on the arrival page and both are asserted so a silent failure to
  // mount cannot read as a clean scan.
  await expect(page.locator('[data-testid="replay-status"]')).toContainText('sent to server B at T+0');
  await expect(page.locator('[data-testid="nodes-counter"]')).toContainText('every single one VALID');
  await expect(page.locator('[data-testid="cert-state"]')).toContainText('WITHIN VALIDITY');
  await expect(page.locator('[data-testid="jwt-headline"]')).toContainText('Both servers agree: ACCEPT');
  // The event rail starts empty: nothing has crossed a threshold yet.
  await expect(page.locator('.event-rail li')).toHaveCount(0);

  // Two disclosures, both shut.
  await expect(page.locator('#app details')).toHaveCount(2);
  await expect(page.locator('#app details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and the spec this
 * replaces never rendered a narrow viewport, so the whole 380px column was
 * unmeasured. This page is full of the shapes that break it: an unbroken
 * base64url JWT and a full DER hex dump (both handled with
 * `overflow-wrap: anywhere` rather than `break-word`, which would not break
 * inside a token), a five-column node matrix and a three-column failure table,
 * the TOTP window strip whose `li`s are `flex: 1 0 6.4rem`, and `.grid-2` /
 * `.grid-3`, which are `repeat(auto-fit, minmax(19rem, 1fr))` at desktop and
 * collapse to a bare `1fr` below 640px — where a track's automatic minimum is
 * its content's min-content. The wide things are meant to scroll inside
 * `.timeline-wrap`, `.totp-scroll`, `.hexdump` and `.token-box`; the assertion
 * here is that none of them scrolls the DOCUMENT.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow-x: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. That cost
    // a run elsewhere in this fleet, and this page has a decoy behind every
    // `.scroll-x`.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1). If
 * it holds no focusable content it needs `tabindex="0"`, so it becomes a focus
 * target arrow keys can then scroll.
 *
 * This lab handles its known cases: every `.token-box`, the `.hexdump`, the
 * `.totp-scroll` strip and the node matrix's `.timeline-wrap` each carry
 * `tabindex="0"`, `role="region"` and an `aria-label`. The assertion stays
 * because those attributes are written out by hand at each of the six call
 * sites rather than produced by a helper, so they are a convention and not an
 * enforcement — and because the content inside them is the evidence for
 * everything this lab claims: the JWT bytes, the DER bytes, the acceptance-window
 * strip, and the per-node verdict matrix. The clock panel's OWN
 * `.timeline-wrap` is deliberately not in that list: it holds an
 * `aria-hidden` SVG at `width: 100%`, which cannot overflow, and the check
 * measures real overflow rather than trusting either fact.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * SC 1.4.11 (non-text contrast) for interactive controls: a control's boundary
 * has to be perceivable against what surrounds it.
 *
 * This is the old spec's `measureControlBorders()`, kept because the idea was
 * right, with its aim corrected. It queried `input, textarea, select` narrowed
 * to text-ish types — which is exactly, and only, the set `--ctl-border` is
 * applied to (`.field input[type='text'], .field input[type='number'],
 * .field select`). The palette defines that token once and uses it once;
 * `--border`, a SURFACE divider, is used eighteen times, INCLUDING on
 * `#app button` — which is every button on this page. So the check measured the
 * one control the rule was already kept for and never looked at the dozens of
 * controls where it was not.
 *
 * A control passes if EITHER
 *   - its fill differs from the surface behind it, or
 *   - it has a border that stands out from the surface behind it AND from its
 *     own fill (how `.field select` works: a `--panel-2` fill with a drawn
 *     `--ctl-border` edge).
 * so the score is `max(fill-vs-outside, min(border-vs-outside, border-vs-fill))`.
 * Taking the max of the two mechanisms is what keeps this from failing a
 * perfectly delineated solid button for having no border.
 *
 * Two deliberate exclusions:
 *  - `disabled` controls. WCAG exempts inactive components, and this page
 *    disables "Jump to the split-brain moment" whenever the resource-server
 *    skew is zero — a state the drive builds and scans deliberately, since it is
 *    also where the panel explains WHY the button cannot work.
 *  - anything outside `#app`. The shared top bar is not this lab's to change —
 *    every repo in the fleet carries a byte-identical copy — and its `.cl-btn`
 *    boundary is measured, ratcheted and reported by `nontext.ts` instead, which
 *    walks the whole document. Stated here so the exclusion is a decision rather
 *    than an oversight.
 */
export async function auditControlBoundaries(
  page: Page
): Promise<Array<{ sel: string; ratio: number }>> {
  return page.evaluate(() => {
    type C = { r: number; g: number; b: number; a: number };
    // Resolve through a canvas rather than a regex. The old spec's regex is
    // precisely what this replaces: it understood `rgb()`/`rgba()` and nothing
    // else, so `color-mix(in oklab, var(--accent) 22%, var(--panel-2))` — the
    // tour CTA's fill, the biggest button on the page — read as
    // `[0,0,0,0]` and was measured against a backdrop it does not have. The
    // hero aside and the tour banner are the same shape.
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    const parse = (s: string): C => {
      if (!s) return { r: 0, g: 0, b: 0, a: 0 };
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = s;
      const a = ctx.fillStyle;
      ctx.fillStyle = '#fff';
      ctx.fillStyle = s;
      if (a !== ctx.fillStyle) return { r: 0, g: 0, b: 0, a: 0 };
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! / 255 };
    };
    const over = (fg: C, bg: C): C => {
      const a = fg.a + bg.a * (1 - fg.a);
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      };
    };
    const lum = (c: C): number => {
      const f = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a: C, b: C): number => {
      const la = lum(a);
      const lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const backdrop = (start: Element | null): C => {
      const stack: C[] = [];
      for (let n = start; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.a > 0) {
          stack.push(c);
          if (c.a >= 1) break;
        }
      }
      let out: C = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i]!, out);
      return out;
    };
    const describe = (el: Element): string => {
      const cls = el.getAttribute('class');
      return (
        el.tagName.toLowerCase() +
        (el.id ? `#${el.id}` : '') +
        (cls ? `.${cls.trim().split(/\s+/).join('.')}` : '')
      );
    };

    const out: Array<{ sel: string; ratio: number }> = [];
    const app = document.getElementById('app');
    if (!app) return out;
    app
      .querySelectorAll<HTMLElement>(
        "button, select, textarea, input[type='text'], input[type='number']"
      )
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if ((el as HTMLButtonElement).disabled) return;
        if (el.closest('[hidden]')) return;
        const cs = getComputedStyle(el);
        const outside = backdrop(el.parentElement);
        const fillRaw = parse(cs.backgroundColor);
        const fill = fillRaw.a > 0 ? over(fillRaw, outside) : outside;
        const byFill = ratio(fill, outside);
        let byBorder = 1;
        if (parseFloat(cs.borderTopWidth) > 0) {
          const border = over(parse(cs.borderTopColor), fill);
          byBorder = Math.min(ratio(border, outside), ratio(border, fill));
        }
        out.push({
          sel: describe(el),
          ratio: Math.round(Math.max(byFill, byBorder) * 100) / 100,
        });
      });
    return out;
  });
}


/**
 * SC 1.4.11 for the graphic BOTH oracles are blind to: the master timeline.
 *
 * The `<svg>` is `aria-hidden="true"` — correctly, since a
 * `.visually-hidden` paragraph beside it states every window in prose — and
 * `aria-hidden` is the one place `contrast.ts` and axe's `color-contrast` rule
 * BOTH stop looking, by design and for the same reason. That makes it the
 * page's blind spot, and this page's blind spot happens to contain its headline
 * visualization: four fixed validity bars and a NOW cursor the reader drags
 * across them, which is the entire argument the lab is making.
 *
 * Three parts are measured, and only three, because only three are required to
 * understand the content:
 *  - the validity-window bar stroke, which is where each window begins and ends;
 *  - the NOW cursor, which is the one thing that moves;
 *  - the axis and row labels, which say what each bar is and when.
 * The hour rules are drawn at `stroke-opacity: 0.18` and are deliberately NOT
 * measured: they are decorative grid lines, and the axis labels beneath them
 * carry the same information at full strength.
 *
 * Returns every measurement so a regression names which part moved.
 */
export async function auditTimelineGraphics(
  page: Page
): Promise<Array<{ what: string; ratio: number }>> {
  return page.evaluate(() => {
    type C = { r: number; g: number; b: number; a: number };
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    const parse = (s: string): C => {
      if (!s) return { r: 0, g: 0, b: 0, a: 0 };
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = s;
      const a = ctx.fillStyle;
      ctx.fillStyle = '#fff';
      ctx.fillStyle = s;
      if (a !== ctx.fillStyle) return { r: 0, g: 0, b: 0, a: 0 };
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! / 255 };
    };
    const over = (fg: C, bg: C): C => {
      const a = fg.a + bg.a * (1 - fg.a);
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      };
    };
    const lum = (c: C): number => {
      const f = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a: C, b: C): number => {
      const la = lum(a);
      const lb = lum(b);
      return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
    };
    const backdrop = (start: Element | null): C => {
      const stack: C[] = [];
      for (let n = start; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.a > 0) {
          stack.push(c);
          if (c.a >= 1) break;
        }
      }
      let out: C = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i]!, out);
      return out;
    };

    const out: Array<{ what: string; ratio: number }> = [];
    const svg = document.querySelector<SVGSVGElement>('#clock-panel-body svg');
    if (!svg) return out;
    const surface = backdrop(svg.parentElement);
    const bar = svg.querySelector('rect');
    if (bar) {
      out.push({
        what: 'validity-window bar stroke vs the timeline surface',
        ratio: ratio(over(parse(getComputedStyle(bar).stroke), surface), surface),
      });
    }
    // The NOW cursor is the LAST <line> appended; the earlier ones are the
    // decorative hour rules.
    const lines = Array.from(svg.querySelectorAll('line'));
    const now = lines[lines.length - 1];
    if (now) {
      out.push({
        what: 'NOW cursor vs the timeline surface',
        ratio: ratio(over(parse(getComputedStyle(now).stroke), surface), surface),
      });
    }
    for (const t of Array.from(svg.querySelectorAll('text'))) {
      const cs = getComputedStyle(t);
      out.push({
        what: `timeline label "${(t.textContent ?? '').slice(0, 18)}" vs the timeline surface`,
        ratio: ratio(over(parse(cs.fill), surface), surface),
      });
    }
    return out;
  });
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run. It
 * is a debugging aid only: `A11Y_COLLECT` is never set in CI or in the committed
 * workflow, and a run with it set prints every finding as it happens and then
 * fails at the end, so a green collection run cannot be mistaken for a green
 * gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function expectScrollersReachableSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectScrollersReachable(page, label);
  try {
    await expectScrollersReachable(page, label);
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

/**
 * The 1.4.11 ratchet, soft-wrapped the same way as every other oracle here.
 *
 * IT IS CALLED FROM `scan()`, not from inside another oracle's soft wrapper.
 * Fleet-wide, `expectNoNewNonTextFailures` was called from the body of
 * `expectScrollersReachableSoft`, AFTER that function's
 * `if (!COLLECTING) return …` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves clean
 * against a baseline captured while nothing had ever looked.
 */
async function expectNoNewNonTextFailuresSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectNoNewNonTextFailures(page, label);
  try {
    await expectNoNewNonTextFailures(page, label);
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

async function expectNoHorizontalOverflowSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectNoHorizontalOverflow(page, label);
  try {
    await expectNoHorizontalOverflow(page, label);
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no text
 * node.
 *
 * `style.css` declares no `content` property, so the generated-content half has
 * nothing to find today; it runs at every state anyway, so the first one added
 * is measured on the day it lands.
 *
 * The backlog is real, so this does not block on it — but a check that merely
 * logs is not a gate. So it ratchets: anything NOT in the baseline fails,
 * anything in the baseline that got WORSE fails, and anything in the baseline
 * that has been FIXED fails until its entry is deleted. That last rule is what
 * stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it. Opt-in via env, and the run is
  // deliberately left failing at the end by `expectBaselineNotStale` so a
  // capture pass can never be mistaken for a passing gate.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(
        `WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`
      );
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Eight assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically. Everything else in that bucket is a real result axe
 *    simply could not finish — including `aria-prohibited-attr`, which is where
 *    an `aria-label` on a role-less element hides, a defect that never reaches
 *    the violations array at all — and every `aria-label` on this page is on an
 *    element that carries a role, which was checked rather than assumed.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node,
 *    which matters here because `.integrity.is-ok` / `.is-alarm` and
 *    `.chip-math.is-bad` — the three surfaces every verdict on this page lands
 *    on — are `rgba()` fills over a panel that is itself over the page, and the
 *    tour banner and hero aside are `color-mix()`.
 *  - non-text contrast for interactive controls — SC 1.4.11.
 *  - the master timeline's graphic parts — SC 1.4.11 inside an `aria-hidden`
 *    subtree, which is the one place BOTH other oracles stop by design.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])` axe therefore runs those
  // FOUR best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. `withTags(TAGS)` selects 69 of axe-core
  // 4.12's 105 rule definitions; the chained form executes 4.
  //
  // Running the two sets separately and merging is the only way to have both.
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them, and this page has
  // the shape they catch: a shared sticky `<header role="banner">` above a
  // `<main>` that contains a second `<header>`, with the hero's
  // `<aside role="complementary">` inside it.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  const boundaries = await auditControlBoundaries(page);
  expect(boundaries.length, `no controls found to measure in state: ${label}`).toBeGreaterThan(0);
  const undelineated = Array.from(
    new Set(boundaries.filter((b) => b.ratio < 3).map((b) => `${b.ratio}:1 ${b.sel}`))
  );
  softExpect(undelineated, `control boundaries under 3:1 (SC 1.4.11) in state: ${label}`, []);

  const timeline = await auditTimelineGraphics(page);
  expect(
    timeline.length,
    `the master timeline must be measurable in state: ${label}`
  ).toBeGreaterThan(3);
  const dimTimeline = timeline.filter((m) => m.ratio < 3).map((m) => `${m.ratio}:1 ${m.what}`);
  softExpect(
    dimTimeline,
    `timeline graphics under 3:1 (SC 1.4.11) in state: ${label}`,
    []
  );

  await expectNoNewNonTextFailuresSoft(page, label);
  await expectScrollersReachableSoft(page, label);
  await expectNoHorizontalOverflowSoft(page, label);
}


// ── The drive ───────────────────────────────────────────────────────────────

/**
 * Open one shut disclosure by clicking its summary, and assert it opened.
 *
 * The disclosure is located by its own summary text rather than by a
 * `:not([open])` selector, because that selector stops matching the instant the
 * click succeeds and the post-condition would then be asserted against nothing.
 * Shut-ness is asserted first, as a precondition, so this cannot silently pass
 * on an already-open element — and it is a `click`, not `d.open = true`, which
 * is what the spec this replaces did to both of them.
 */
async function openDetails(page: Page, summaryText: string | RegExp): Promise<void> {
  const details = page
    .locator('#app details')
    .filter({ has: page.locator('summary', { hasText: summaryText }) })
    .first();
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').first().click();
  await expect(details).toHaveAttribute('open', '');
}

/**
 * Move the master clock and wait for the panels to catch up.
 *
 * The clock is a `range` input whose `input` listener fans out to every panel;
 * three of those panels re-verify asynchronously (`await Promise.all([...])`
 * over real Ed25519 and HMAC). So the completion signal is not the slider's
 * value — it is the readout the clock panel writes synchronously PLUS the
 * asynchronous panels' own text. Waiting on the readout alone would scan a page
 * whose verifiers are still one clock behind.
 */
async function setClock(page: Page, offsetSec: number, expectLabel: string): Promise<void> {
  await page.locator('#master-clock').fill(String(offsetSec));
  await expect(page.locator('[data-testid="clock-now"]')).toContainText(expectLabel);
  await settle(page);
}

/**
 * Drive the lab through every state that renders a verdict, scanning each.
 *
 * Seven things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, AND IT IS ALREADY RUNNING. Unlike most
 *    labs in this fleet nothing here ships empty: at T+0 the certificate is
 *    within validity, both JWT servers agree, the replay panel has already
 *    delivered its request to server B, and the node matrix has four real
 *    Ed25519 verifications on it. That is the page a reader meets and the old
 *    spec went straight past it.
 *
 *  - EVERY MOMENT BUTTON IS PRESSED AND SCANNED. The six "Jump to" moments are
 *    the lab's verdict-flip states — JWT expired, URL expired, token expired,
 *    cert expired, cert not-yet-valid — and each is the only route to a
 *    different combination of `.integrity.is-alarm` and `.chip-math.is-bad`
 *    surfaces. The old spec set the clock ONCE, to T+21m, at the very end.
 *
 *  - THE ALARM SURFACES ARE REACHED THROUGH THE ATTACKS THAT PRODUCE THEM.
 *    `.integrity.is-alarm` — the only strongly-coloured element in the whole
 *    visual contract — appears when a lying clock produces a wrong decision. The
 *    drive builds each one: the resurrected URL (server clock rolled back an
 *    hour on an expired link), the JWT split-brain, the replay that server A's
 *    slow clock calls fresh, and the TOTP replay accepted with the used-code
 *    record off.
 *
 *  - BOTH SIDES OF EVERY FORK. The tamper toggle on AND off; the used-code
 *    record on AND off; a TOTP code that matches AND one that does not; a replay
 *    caught by the cache AND one that slips past it; a JWT skew that splits the
 *    two servers AND a zero skew, which is also the only state where "Jump to
 *    the split-brain moment" is `disabled` and the panel explains why.
 *
 *  - EVERY SLIDER IS DRIVEN TO AN EXTREME, not just nudged. A defect that only
 *    exists at the end of a range is a real class in this fleet, and here the
 *    extremes are where the strings get longest and the layout is tightest: the
 *    ±3600 s URL skews, the ±120 s TOTP phone skew that pushes the phone outside
 *    the strip entirely, and the ±600 s node skews.
 *
 *  - THE GUIDED TOUR IS WALKED, ONE STEP AT A TIME. Four steps, each of which
 *    applies a preset AND fills the `role="status"` banner with a step counter,
 *    a pinned sentence and two buttons. The spec this replaces revealed that
 *    banner EMPTY by stripping its `hidden` attribute, and never rendered a
 *    single real step.
 *
 *  - NO FIXED TIMEOUTS. Every panel re-renders through an async verify; each has
 *    a DOM completion signal — a headline sentence, a status line, a verdict
 *    chip, a counter — and the drive waits on those. The certificate stepper is
 *    the one genuinely timed thing on the page (`setTimeout(advance, 420)`), and
 *    it is waited out by its own end condition: no `.step.is-active` left.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);

  await scanAt('first paint at T+0: everything fresh, every verifier already run');

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('skip link focused');

  await openDetails(page, 'The longer framing');
  await scanAt('the intro disclosure open, with the two indicator chips in prose');

  // ── 1 · Certificate ──────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Run verification step-by-step' }).click();
  await expect(page.locator('.step.is-active')).toHaveCount(1);
  await scanAt('cert stepper running, step 1 highlighted');
  // Its own end condition, not a sleep: the walker clears every highlight.
  await expect(page.locator('.step.is-active')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('[data-testid="cert-sig-note"]')).toContainText('result every time: VALID');
  await scanAt('cert stepper finished, all four steps filled');

  await openDetails(page, 'For experts: the DER bytes');
  await expect(page.locator('.hexdump')).toBeVisible();
  await scanAt('the DER hex dump disclosed, validity and signature bytes highlighted');

  await page.locator('#cert-tamper').check();
  await expect(page.locator('[data-testid="cert-sig-note"]')).toContainText('tampered (1 bit flipped)');
  await expect(page.locator('#cert-panel .chip-math.is-bad')).toHaveCount(1);
  await scanAt('one signature bit flipped: the math itself fails, at every clock');

  await page.locator('#cert-tamper').uncheck();
  await expect(page.locator('[data-testid="cert-sig-note"]')).toContainText('unchanged');
  await scanAt('tamper switched back off, the genuine certificate restored');

  // ── The master clock: every moment the lab ships ─────────────────────────
  await page.getByRole('button', { name: 'T+16 m — JWT expired' }).click();
  await expect(page.locator('[data-testid="clock-now"]')).toContainText('T+16m');
  await expect(page.locator('[data-testid="jwt-headline"]')).toContainText('Both servers agree: REJECT');
  // The event rail is deliberately NOT asserted here: at T+16m with the shipped
  // +90 s skew BOTH servers are past `exp`, so they agree, and `jwtPanel` emits
  // only on a disagreement. Asserting a rail entry here would have been an
  // assumption about the lab rather than a measurement of it. It is asserted at
  // the split-brain state below, where the emit really happens.
  await expect(page.locator('.event-rail li')).toHaveCount(0);
  await scanAt('T+16m: the JWT is expired at both servers, so they agree and nothing is logged');

  await page.getByRole('button', { name: 'T+21 m — URL expired' }).click();
  await expect(page.locator('[data-testid="clock-now"]')).toContainText('T+21m');
  await expect(page.locator('#url-panel .integrity')).toBeVisible();
  await scanAt('T+21m: the signed URL has expired at true time');

  await page.getByRole('button', { name: 'T+31 m — token expired' }).click();
  await expect(page.locator('[data-testid="clock-now"]')).toContainText('T+31m');
  await expect(page.locator('[data-testid="nodes-counter"]')).toContainText('every single one VALID');
  await scanAt('T+31m: the node token has expired while every signature stayed valid');

  await page.getByRole('button', { name: 'T+25 h — cert expired' }).click();
  await expect(page.locator('[data-testid="cert-state"]')).toContainText('EXPIRED');
  await scanAt('T+25h: the certificate is expired — same signature, different verdict');

  await page.getByRole('button', { name: 'T−90 m — cert not yet valid' }).click();
  await expect(page.locator('[data-testid="cert-state"]')).toContainText('NOT YET VALID');
  await scanAt('T−90m: the certificate is not yet valid, the third verdict over one signature');

  // The zoom pair — a two-button toggle group whose state is `aria-pressed`, and
  // the only route to the two-day timeline.
  await page.getByRole('button', { name: 'Zoom: full two days' }).click();
  await expect(page.getByRole('button', { name: 'Zoom: full two days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Zoom: first hours' })).toHaveAttribute('aria-pressed', 'false');
  await scanAt('timeline zoomed to the full two days');
  await page.getByRole('button', { name: 'Zoom: first hours' }).click();
  await expect(page.getByRole('button', { name: 'Zoom: first hours' })).toHaveAttribute('aria-pressed', 'true');

  // The step buttons, at both extremes of the clock's own range.
  await page.getByRole('button', { name: 'move clock forward one day' }).click();
  await scanAt('stepped forward a day: past every window on the page');
  await page.getByRole('button', { name: 'Reset to T+0' }).click();
  await expect(page.locator('[data-testid="clock-now"]')).toContainText('(T+0s)');
  await scanAt('reset to T+0');

  // ── 2 · JWT split-brain ──────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Jump to the split-brain moment' }).click();
  await expect(page.locator('[data-testid="jwt-headline"]')).toContainText('SPLIT-BRAIN');
  await expect(page.locator('#jwt-panel .integrity.is-alarm')).toHaveCount(1);
  // THIS is where the event rail fires, and it is also the first state on the
  // page where `flashAlarm` runs — the one animation the reduced-motion block
  // cancels.
  await expect(page.locator('.event-rail li').first()).toContainText('split-brain');
  await scanAt('JWT split-brain: valid at one server, expired at the other, one signature');

  // Zero skew is the only state where the jump button is `disabled` and the
  // panel says why — an inactive control WCAG exempts and a gate must still see.
  await page.locator('#jwt-rs-skew').fill('0');
  await expect(page.getByRole('button', { name: 'Jump to the split-brain moment' })).toBeDisabled();
  await expect(page.locator('#jwt-panel')).toContainText('needs a non-zero skew');
  await scanAt('JWT skew zeroed: the split-brain button disabled and explained');

  await page.locator('#jwt-rs-skew').fill('-300');
  await expect(page.locator('#jwt-panel')).toContainText('local clock = true time −5 min');
  await scanAt('JWT resource server five minutes BEHIND, the opposite skew');

  await page.locator('#jwt-leeway').fill('300');
  await expect(page.locator('[data-testid="jwt-headline"]')).toBeVisible();
  await scanAt('JWT leeway widened to 300 s — the band-aid, applied to every token');
  await page.locator('#jwt-leeway').fill('0');
  await page.locator('#jwt-rs-skew').fill('90');

  // ── 3 · TOTP ─────────────────────────────────────────────────────────────
  // Replay before anything was intercepted: the empty-state branch.
  await page.getByRole('button', { name: 'Replay the intercepted code' }).click();
  await expect(page.locator('#totp-panel')).toContainText('Nothing intercepted yet — capture a code first.');
  await scanAt('TOTP replay pressed with nothing intercepted');

  // A code that is simply wrong — the no-HOTP-match branch.
  await page.locator('#totp-input').fill('000000');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.locator('[data-testid="totp-result"]')).toContainText('no HOTP match');
  await scanAt('TOTP rejected a code that matches no window in the band');

  await page.getByRole('button', { name: 'Copy the phone’s code into the box' }).click();
  await expect(page.locator('#totp-input')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.locator('#totp-panel .integrity.is-ok')).toHaveCount(1);
  await scanAt('TOTP accepted a first-use code inside the band');

  // Moving the clock retires the verdict rather than leaving a stale ACCEPT on
  // an aria-live region — a state with its own rendering and its own text.
  await setClock(page, 90, 'T+1m 30s');
  await expect(page.locator('[data-testid="totp-retired"]')).toContainText('Previous verdict retired');
  await scanAt('TOTP verdict retired because the verifier it described no longer exists');

  await page.getByRole('button', { name: 'Intercept (capture) the phone’s current code' }).click();
  await expect(page.locator('#totp-panel')).toContainText('and the victim logged in with it');
  await scanAt('TOTP code intercepted and legitimately used once');

  await page.getByRole('button', { name: 'Replay the intercepted code' }).click();
  await expect(page.locator('#totp-panel .integrity.is-ok')).toContainText('Replay caught');
  await scanAt('TOTP replay caught by the RFC-required used-code record');

  // Now the same replay with the record OFF — the alarm the panel exists for.
  await page.locator('#totp-used').uncheck();
  await page.getByRole('button', { name: 'Intercept (capture) the phone’s current code' }).click();
  await page.getByRole('button', { name: 'Replay the intercepted code' }).click();
  await expect(page.locator('#totp-panel .integrity.is-alarm')).toContainText('RFC 6238 §5.2 REQUIRES');
  await scanAt('TOTP replay ACCEPTED with no used-code record: a real HMAC match let it in');
  await page.locator('#totp-used').check();

  // Both ends of the tolerance select, which is what widens the replay window.
  await page.locator('#totp-tol').selectOption('0');
  await expect(page.locator('[data-testid="totp-band"]')).toContainText('accept band = 1 windows');
  await expect(page.locator('.totp-strip li.in-band')).toHaveCount(1);
  await scanAt('TOTP tolerance 0: one window accepted, six refused');

  await page.locator('#totp-tol').selectOption('3');
  await expect(page.locator('[data-testid="totp-band"]')).toContainText('accept band = 7 windows');
  await expect(page.locator('.totp-strip li.in-band')).toHaveCount(7);
  await scanAt('TOTP tolerance ±3: the whole strip accepted, and the replay window with it');
  await page.locator('#totp-tol').selectOption('1');

  // The phone skew at its extreme, which is the only way the phone's own window
  // leaves the strip entirely.
  await page.locator('#totp-skew').fill('120');
  await expect(page.locator('#totp-panel')).toContainText('phone clock');
  await scanAt('TOTP phone clock +2 minutes, four windows ahead of the verifier');
  await page.locator('#totp-skew').fill('0');

  // ── 4 · Signed URL ───────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Jump past expiry (T+21 m)' }).click();
  await expect(page.locator('[data-testid="clock-now"]')).toContainText('T+21m');
  await expect(page.locator('#url-panel')).toContainText('The URL is expired at true time');
  await scanAt('the signed URL is dead at true time');

  await page.locator('#url-client-skew').fill('-3600');
  await expect(page.locator('[data-testid="url-client-view"]')).toContainText('the client believes the URL is still fresh');
  await expect(page.locator('#url-panel')).toContainText('The URL is expired at true time');
  await scanAt('client clock rolled back an hour: the client is wrong and nothing changes');

  await page.locator('#url-server-skew').fill('-3600');
  await expect(page.locator('#url-panel .integrity.is-alarm')).toContainText('resurrected it');
  await scanAt('SERVER clock rolled back: the dead URL is served, with no forgery at all');

  await page.getByRole('button', { name: 'Request the file' }).click();
  await expect(page.locator('#url-panel .integrity.is-alarm')).toHaveCount(1);
  await scanAt('the file requested again against the rolled-back server clock');

  await page.locator('#url-server-skew').fill('3600');
  await expect(page.locator('#url-panel')).toContainText('SERVER clock offset: +60 min');
  await scanAt('server clock an hour FAST, the opposite end of the same slider');
  await page.locator('#url-server-skew').fill('0');
  await page.locator('#url-client-skew').fill('0');

  // ── 5 · Replay cache across skewed clocks ────────────────────────────────
  await page.getByRole('button', { name: 'Reset to T+0' }).click();
  await expect(page.locator('[data-testid="clock-now"]')).toContainText('(T+0s)');
  await page.getByRole('button', { name: /^Send a fresh request/ }).click();
  await expect(page.locator('[data-testid="replay-status"]')).toContainText('Fresh request sent to server B');
  await scanAt('a fresh request sent to server B and cached there');

  // The clock MUST move before the replays, or all three servers reject for the
  // same dull reason and the panel's whole point is never built. This is the
  // step the old spec's label-regex sweep could not express.
  await setClock(page, 240, 'T+4m');
  await scanAt('four minutes later, before any replay');

  await page.getByRole('button', { name: 'Replay to B' }).click();
  await expect(page.locator('[data-testid="replay-status"]')).toContainText('replay cache caught it');
  await scanAt('replay to B: caught by its own cache');

  await page.getByRole('button', { name: 'Replay to C' }).click();
  await expect(page.locator('[data-testid="replay-status"]')).toContainText('Replay to server C: REJECT');
  await scanAt('replay to C: rejected because its fast clock calls it ancient');

  await page.getByRole('button', { name: 'Replay to A' }).click();
  await expect(page.locator('[data-testid="replay-status"]')).toContainText('Replay to server A: ACCEPT');
  await expect(page.locator('[data-testid="replay-server-A"] .integrity.is-alarm')).toHaveCount(1);
  await scanAt('replay to A ACCEPTED: a slow clock re-opened a window nothing cryptographic closed');

  await page.locator('#replay-skew-A').fill('-360');
  await expect(page.locator('[data-testid="replay-server-A"]')).toContainText('Server A clock skew: −6 min');
  await scanAt('server A driven to its maximum lag');
  await page.locator('#replay-skew-A').fill('-240');

  // ── 6 · Distributed nodes ────────────────────────────────────────────────
  await setClock(page, 30 * 60, 'T+30m');
  await scanAt('T+30m: the node token sits exactly on its own expiry');

  await page.locator('#node-skew-node-west').fill('-600');
  await expect(page.locator('#nodes-panel')).toContainText('node-west clock skew: −10 min');
  await expect(page.locator('[data-testid="nodes-counter"]')).toContainText('every single one VALID');
  await scanAt('node-west ten minutes behind: the matrix disagrees, every signature still valid');

  await page.locator('#node-skew-node-east').fill('600');
  await expect(page.locator('#nodes-panel')).toContainText('node-east clock skew: +10 min');
  await scanAt('both extremes at once: twenty minutes of disagreement over one token');
  await page.locator('#node-skew-node-west').fill('-120');
  await page.locator('#node-skew-node-east').fill('120');

  // ── The scenario presets ─────────────────────────────────────────────────
  // Each preset sets the clock AND per-panel controls AND fires `flashAlarm` on
  // its target section — the one animation on the page, exercised under the
  // reduced-motion preference rather than under an injected override.
  for (const [name, signal] of [
    ['JWT split-brain', '#jwt-panel .integrity.is-alarm'],
    ['Resurrect an expired URL', '#url-panel .integrity.is-alarm'],
    ['Replay slips through', '[data-testid="replay-status"]'],
    ['TOTP window too wide', '[data-testid="totp-band"]'],
  ] as const) {
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await expect(page.locator(signal).first()).toBeVisible();
    await scanAt(`preset "${name}" applied`);
  }

  // ── The guided tour, one real step at a time ─────────────────────────────
  await expect(page.locator('.tour-banner')).toBeHidden();
  await page.getByRole('button', { name: /Take the 30-second tour/ }).click();
  for (let i = 1; i <= 4; i++) {
    await expect(page.locator('.tour-banner')).toBeVisible();
    await expect(page.locator('.tour-step-n')).toContainText(`TOUR — STEP ${i} OF 4`);
    await expect(page.locator('.tour-pin')).not.toBeEmpty();
    await scanAt(`guided tour step ${i} of 4`);
    if (i < 4) await page.getByRole('button', { name: 'Next →' }).click();
  }
  await page.getByRole('button', { name: 'Finish tour' }).click();
  await expect(page.locator('.tour-banner')).toBeHidden();
  await scanAt('tour finished, the banner withdrawn');

  // And the Exit route, which is a different button on the same banner.
  await page.getByRole('button', { name: /Take the 30-second tour/ }).click();
  await expect(page.locator('.tour-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('.tour-banner')).toBeHidden();
  await scanAt('tour exited early, the banner withdrawn again');

  // Everything the page can render has now been rendered; the event rail is
  // full and both disclosures are open.
  await expect(page.locator('.event-rail li')).toHaveCount(4);
  await scanAt('the finished page, event rail at its four-entry cap');
}
