/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy — hand-measure before acting on it.
 *
 * What the live oracle finds on this lab, over {dark, light} × {1280, 380} and
 * every state the drive builds, is exactly the two entries below — both in the
 * SHARED Crypto Lab top bar, and neither one this repo's to fix.
 *
 * `.cl-btn` draws its edge as
 * `1px solid color-mix(in srgb, var(--accent, #35d6bb) 38%, transparent)` over
 * the bar's fixed `#0b1512`. This lab's `--accent` is `#0891b2`, so the
 * composited edge resolves to rgb(10, 68, 79): 1.73:1 against the bar,
 * IDENTICALLY IN BOTH THEMES, because the bar is always dark and `--accent` is
 * one value shared by both themes here. The number is accent-dependent, which is
 * why sibling repos in this fleet record different ones for byte-identical CSS.
 * `CLAUDE.md` is explicit that a change every lab should get is a deliberate
 * reviewed fleet-wide pass and never an overwrite driven from one repo, so it is
 * measured here, ratcheted here, and reported upward.
 *
 * Everything inside `<main id="app">`, the hero and the footer is audited with
 * no exemption and comes back clean. One finding that WAS here has been fixed
 * rather than baselined, and its absence from this file is the ratchet working:
 * `#app button`, which drew its edge with the surface-divider `--border` at
 * 1.65:1 against its card and 1.48:1 against its own near-identical fill. That
 * is every button on the page; it now uses `--ctl-border` at 3.88:1 / 5.05:1.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {
  'control-boundary|a.cl-btn': { ratio: 1.73, required: 3, unverified: false },
};
