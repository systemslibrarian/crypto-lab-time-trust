/**
 * TOTP panel: a real RFC 6238 prover ("phone") and verifier sharing a secret.
 * The window strip SHOWS the acceptance band; the tolerance control widens it
 * and, with it, the replay window. Codes are computed with real HMAC-SHA-1 on
 * every update.
 */
import { toHex } from '../core/bytes';
import type { Scenario } from '../scenario';
import { hotp } from '../otp/hotp';
import { TOTP_STEP_SEC, totp, totpCounter, verifyTotp } from '../otp/totp';
import { fmtSkew, fmtUtc } from '../time/clock';
import type { ClockControl } from './clockPanel';
import { byId, clear, el } from './dom';

const STRIP_HALF = 3; // show T−3 … T+3

export function renderTotpPanel(clock: ClockControl, scenario: Scenario): void {
  const host = byId<HTMLElement>('totp-panel-body');
  clear(host);

  const key = scenario.totpSecret;
  let phoneSkewSec = 0;
  let tolerance = 1;
  let trackUsed = true;
  const usedCodes = new Set<string>();
  let captured: { code: string; mintedAtMs: number } | null = null;

  const phoneCode = el('p', { class: 'clock-now' });
  const phoneClock = el('p', { class: 'readout' });
  const stripHost = el('div', {
    class: 'totp-scroll',
    tabindex: '0',
    role: 'region',
    'aria-label': 'verifier acceptance windows',
  });
  const bandNote = el('p', { class: 'readout' });

  const skewSlider = el('input', { type: 'range', id: 'totp-skew', min: '-120', max: '120', step: '5', value: '0' });
  const skewLabel = el('label', { for: 'totp-skew' }, '');

  const tolSelect = el(
    'select',
    { id: 'totp-tol' },
    el('option', { value: '0' }, '0 — exact window only'),
    el('option', { value: '1', selected: 'selected' }, '±1 window (a common default)'),
    el('option', { value: '2' }, '±2 windows'),
    el('option', { value: '3' }, '±3 windows'),
  );

  const usedToggle = el('input', { type: 'checkbox', id: 'totp-used', checked: 'checked' });

  const codeInput = el('input', {
    type: 'text',
    id: 'totp-input',
    inputmode: 'numeric',
    autocomplete: 'off',
    maxlength: '6',
  });
  const submitBtn = el('button', { type: 'button', class: 'primary' }, 'Verify code');
  const fillBtn = el('button', { type: 'button' }, 'Copy the phone’s code into the box');
  const captureBtn = el('button', { type: 'button' }, 'Intercept (capture) the phone’s current code');
  const replayBtn = el('button', { type: 'button' }, 'Replay the intercepted code');
  const capturedNote = el('p', { class: 'readout' }, 'Nothing intercepted yet.');
  const resultHost = el('div', { role: 'status', 'aria-live': 'polite' });

  let seq = 0;
  async function render(nowMs: number): Promise<void> {
    const my = ++seq;
    const verifierSec = Math.floor(nowMs / 1000);
    const phoneSec = verifierSec + phoneSkewSec;
    const phoneCounter = totpCounter(phoneSec);
    const verifierCounter = totpCounter(verifierSec);
    const code = await totp(key, phoneSec);
    const strip: Array<{ counter: number; code: string }> = [];
    for (let cnt = verifierCounter - STRIP_HALF; cnt <= verifierCounter + STRIP_HALF; cnt++) {
      if (cnt < 0) continue;
      strip.push({ counter: cnt, code: await hotp(key, cnt) });
    }
    if (my !== seq) return;

    phoneCode.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
    phoneClock.textContent = `phone clock ${fmtUtc(phoneSec * 1000)} (${fmtSkew(phoneSkewSec)}) → counter T=${phoneCounter}`;

    const ul = el('ul', { class: 'totp-strip' });
    for (const w of strip) {
      const inBand = Math.abs(w.counter - verifierCounter) <= tolerance;
      const isPhone = w.counter === phoneCounter;
      const li = el(
        'li',
        { class: `${inBand ? 'in-band' : ''} ${isPhone ? 'is-phone' : ''}`.trim() },
        el('span', { class: 'totp-tag' }, `T${w.counter === verifierCounter ? '' : (w.counter > verifierCounter ? '+' : '−') + Math.abs(w.counter - verifierCounter)}`),
        el('span', { class: 'totp-code' }, w.code),
        el('span', { class: 'totp-tag' }, `${inBand ? 'ACCEPTED' : 'refused'}${isPhone ? ' · PHONE IS HERE' : ''}`),
      );
      ul.append(li);
    }
    clear(stripHost);
    stripHost.append(ul);

    const bandSec = (2 * tolerance + 1) * TOTP_STEP_SEC;
    bandNote.textContent =
      `Verifier counter T=${verifierCounter}; accept band = ${2 * tolerance + 1} windows = ${bandSec} s of wall-clock time. ` +
      `A code intercepted at the start of its window stays replayable for up to ${(tolerance + 1) * TOTP_STEP_SEC} s` +
      (trackUsed ? ' — unless the verifier’s used-code record catches it first.' : ' — and this verifier keeps NO used-code record.');
  }

  async function submit(codeStr: string, isReplay: boolean): Promise<void> {
    const verifierSec = Math.floor(clock.get() / 1000);
    const r = await verifyTotp(key, codeStr, verifierSec, tolerance, trackUsed ? usedCodes : null);
    clear(resultHost);
    const mathLine = el(
      'p',
      { class: 'control-row' },
      el(
        'span',
        { class: `chip chip-math ${r.matchedCounter !== null ? 'is-ok' : 'is-bad'}` },
        r.matchedCounter !== null
          ? `✓ HOTP match: code = HOTP(K, ${r.matchedCounter})`
          : '✗ no HOTP match in the checked band',
      ),
      el('span', { class: 'chip chip-verdict' }, `Verdict: ${r.accepted ? 'ACCEPT ✓' : 'REJECT ✗'}`),
    );
    const details = el(
      'p',
      { class: 'readout' },
      r.matchedCounter !== null
        ? `matched window ${r.matchedCounter} (verifier is at ${totpCounter(verifierSec)}, tolerance ±${tolerance})`
        : `code "${codeStr}" ≠ HOTP(K, c) for every c in the checked band — it may belong to an older window this policy refuses to look at`,
      r.replayDetected ? ' · one-time-use record: ALREADY USED' : '',
    );
    resultHost.append(mathLine, details);
    if (isReplay && r.accepted) {
      resultHost.append(
        el(
          'p',
          { class: 'integrity is-alarm' },
          el('span', { 'aria-hidden': 'true' }, '⚠'),
          el(
            'span',
            {},
            'WRONG — this exact code was already used once. RFC 6238 §5.2 REQUIRES a verifier to refuse a previously used code; this one kept no record, so a real HMAC match let a replay in.',
          ),
        ),
      );
    } else if (isReplay && r.replayDetected) {
      resultHost.append(
        el(
          'p',
          { class: 'integrity is-ok' },
          el('span', { 'aria-hidden': 'true' }, '✓'),
          el('span', {}, 'Replay caught — the used-code record did what RFC 6238 §5.2 requires.'),
        ),
      );
    } else if (r.accepted) {
      resultHost.append(
        el(
          'p',
          { class: 'integrity is-ok' },
          el('span', { 'aria-hidden': 'true' }, '✓'),
          el('span', {}, 'First use of this code inside the band — accepting it is correct.'),
        ),
      );
    }
  }

  skewSlider.addEventListener('input', () => {
    phoneSkewSec = Number(skewSlider.value);
    skewLabel.textContent = `Phone clock skew: ${fmtSkew(phoneSkewSec)}`;
    skewSlider.setAttribute('aria-valuetext', fmtSkew(phoneSkewSec));
    void render(clock.get());
  });
  tolSelect.addEventListener('change', () => {
    tolerance = Number(tolSelect.value);
    void render(clock.get());
  });
  usedToggle.addEventListener('change', () => {
    trackUsed = (usedToggle as HTMLInputElement).checked;
    void render(clock.get());
  });
  submitBtn.addEventListener('click', () => void submit((codeInput as HTMLInputElement).value.trim(), false));
  fillBtn.addEventListener('click', () => {
    void (async () => {
      (codeInput as HTMLInputElement).value = await totp(key, Math.floor(clock.get() / 1000) + phoneSkewSec);
    })();
  });
  captureBtn.addEventListener('click', () => {
    void (async () => {
      const code = await totp(key, Math.floor(clock.get() / 1000) + phoneSkewSec);
      captured = { code, mintedAtMs: clock.get() };
      capturedNote.textContent = `Intercepted "${code}" at ${fmtUtc(captured.mintedAtMs)} — and the victim logged in with it (so it is on the used-code record). Now move the clock forward and replay it.`;
      await submit(code, false); // the victim's legitimate use
    })();
  });
  replayBtn.addEventListener('click', () => {
    if (!captured) {
      capturedNote.textContent = 'Nothing intercepted yet — capture a code first.';
      return;
    }
    void submit(captured.code, true);
  });

  skewLabel.textContent = 'Phone clock skew: 0 s';
  host.append(
    el(
      'div',
      { class: 'grid-2' },
      el(
        'div',
        { class: 'subcard' },
        el('h3', {}, 'Phone (prover)'),
        phoneCode,
        phoneClock,
        el('div', { class: 'field' }, skewLabel, skewSlider),
      ),
      el(
        'div',
        { class: 'subcard' },
        el('h3', {}, 'Server (verifier) — clock: true time'),
        el('div', { class: 'field' }, el('label', { for: 'totp-tol' }, 'Acceptance tolerance (policy, not crypto)'), tolSelect),
        el(
          'p',
          { class: 'control-row' },
          usedToggle,
          el('label', { for: 'totp-used' }, 'Keep a used-code record (RFC 6238 §5.2 REQUIRES this)'),
        ),
      ),
    ),
    stripHost,
    bandNote,
    el(
      'div',
      { class: 'control-row' },
      el('label', { for: 'totp-input' }, 'Enter a 6-digit code:'),
      codeInput,
      submitBtn,
      fillBtn,
    ),
    el('div', { class: 'control-row' }, captureBtn, replayBtn),
    capturedNote,
    resultHost,
    el(
      'p',
      { class: 'scope-note' },
      `Precision note: RFC 6238 §5.2 recommends accepting at most one time step BACKWARD (for transmission delay); the symmetric ±W band here is the looser policy many deployments actually run. Secret for this session (hex, in memory only): ${toHex(key)}. What this panel does not show: recovering the TOTP secret — an intercepted code replays, it does not reveal K.`,
    ),
  );
  clock.subscribe((ms) => void render(ms));
  void render(clock.get());
}
