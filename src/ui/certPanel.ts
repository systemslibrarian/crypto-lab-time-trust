/**
 * Certificate panel: a real DER cert, really parsed and Ed25519-verified on
 * every clock change. The stepper shows the verifier pipeline so the learner
 * SEES that stages 1–2 (parse, signature) produce identical output at every
 * clock position and only stage 3 (the time window) ever changes.
 */
import { decide, type Decision } from '../core/decision';
import { toHex } from '../core/bytes';
import type { Scenario } from '../scenario';
import { fmtUtc } from '../time/clock';
import { parseCertificate, tamperSignatureBit, verifyCertSignature, type Certificate } from '../x509/cert';
import { validityChecks, validityState } from '../x509/validity';
import type { ClockControl } from './clockPanel';
import { byId, clear, el } from './dom';
import { resultBlock } from './verdict';

const STATE_LABEL = {
  'not-yet-valid': 'NOT YET VALID (RFC 5280: clock < notBefore)',
  valid: 'WITHIN VALIDITY (notBefore ≤ clock ≤ notAfter)',
  expired: 'EXPIRED (clock > notAfter)',
} as const;

function hexDump(cert: Certificate): HTMLElement {
  const hex = toHex(cert.der);
  const sigHex = toHex(cert.signature);
  const sigAt = hex.lastIndexOf(sigHex);
  // validity SEQUENCE: two 13-char UTCTimes wrapped — locate by encoded bytes
  const nb = hex.indexOf('301e170d'); // SEQUENCE(30) len(1e) UTCTime(17) len(0d)
  const box = el('div', {
    class: 'hexdump',
    tabindex: '0',
    role: 'region',
    'aria-label': 'certificate DER hex dump',
  });
  if (nb >= 0 && sigAt > nb) {
    box.append(
      hex.slice(0, nb),
      el('span', { class: 'hl-validity' }, hex.slice(nb, nb + 64)),
      hex.slice(nb + 64, sigAt),
      el('span', { class: 'hl-sig' }, hex.slice(sigAt)),
    );
  } else {
    box.append(hex);
  }
  return box;
}

export function renderCertPanel(clock: ClockControl, scenario: Scenario): void {
  const host = byId<HTMLElement>('cert-panel-body');
  clear(host);

  const cert = scenario.cert;
  const tampered = parseCertificate(tamperSignatureBit(cert.der));
  let useTampered = false;
  let verifyCount = 0;
  let stepTimer: ReturnType<typeof setTimeout> | null = null;

  const summary = el(
    'p',
    { class: 'readout' },
    `subject CN=${cert.subjectCN} · serial ${cert.serial} · issued by CN=${cert.issuerCN}`,
    el('br'),
    `notBefore ${fmtUtc(cert.notBeforeMs)} · notAfter ${fmtUtc(cert.notAfterMs)}`,
  );

  const steps = [
    { k: 'STEP 1', title: 'Parse DER', out: el('span', { class: 'step-out' }) },
    { k: 'STEP 2', title: 'Verify Ed25519 signature over TBSCertificate', out: el('span', { class: 'step-out' }) },
    { k: 'STEP 3', title: 'Compare clock to validity window', out: el('span', { class: 'step-out' }) },
    { k: 'STEP 4', title: 'Decision', out: el('span', { class: 'step-out' }) },
  ];
  const stepEls = steps.map((s) =>
    el('li', { class: 'step' }, el('span', { class: 'step-k' }, `${s.k} — ${s.title}`), el('br'), s.out),
  );
  const stepper = el('ol', { class: 'stepper', style: 'list-style:none;padding:0' }, ...stepEls);

  const sigNote = el('p', { class: 'readout' });
  const resultHost = el('div', {}, el('p', {}, '…'));
  const stateLine = el('p', { class: 'readout', role: 'status', 'aria-live': 'polite' });

  function compute(nowMs: number): { dec: Decision; state: keyof typeof STATE_LABEL } {
    const c = useTampered ? tampered : cert;
    const sigOk = verifyCertSignature(c); // real Ed25519, every single time
    verifyCount++;
    const state = validityState(c.notBeforeMs, c.notAfterMs, nowMs);
    const dec = decide(
      [
        {
          ok: sigOk,
          label: 'Ed25519 signature over TBSCertificate',
          detail: `verify(sig=${toHex(c.signature).slice(0, 16)}…, tbs=${c.tbs.length} bytes, pk=${toHex(c.publicKey).slice(0, 16)}…) → ${sigOk ? 'valid' : 'INVALID'}`,
        },
      ],
      validityChecks(c.notBeforeMs, c.notAfterMs, nowMs),
    );
    return { dec, state };
  }

  function fillSteps(nowMs: number, dec: Decision, state: keyof typeof STATE_LABEL): void {
    const c = useTampered ? tampered : cert;
    steps[0].out.textContent = `CN=${c.subjectCN}, validity ${fmtUtc(c.notBeforeMs)} → ${fmtUtc(c.notAfterMs)} — same ${c.der.length} bytes every run`;
    steps[1].out.textContent = `${dec.crypto[0].detail} — this output does not depend on the clock`;
    steps[2].out.textContent = dec.policy.map((p) => `${p.detail} → ${p.pass ? 'pass' : 'FAIL'}`).join(' · ');
    steps[3].out.textContent = `${dec.verdict.toUpperCase()} — ${STATE_LABEL[state]}`;
    void nowMs;
  }

  function render(nowMs: number): void {
    const { dec, state } = compute(nowMs);
    fillSteps(nowMs, dec, state);
    sigNote.textContent = '';
    sigNote.append(
      `Signature bytes this session: ${toHex((useTampered ? tampered : cert).signature).slice(0, 24)}… — `,
      el(
        'strong',
        {},
        useTampered
          ? 'tampered (1 bit flipped): every verification now returns INVALID at every clock position.'
          : `unchanged. Verified ${verifyCount} times so far; result every time: VALID.`,
      ),
    );
    clear(resultHost);
    resultHost.append(resultBlock(dec, dec.verdict)); // no skew in this panel: verdicts here are always truthful
    const newState = `Certificate status at this clock: ${STATE_LABEL[state]}`;
    if (stateLine.textContent !== newState) stateLine.textContent = newState;
  }

  const runBtn = el('button', { type: 'button', class: 'primary' }, 'Run verification step-by-step');
  runBtn.addEventListener('click', () => {
    if (stepTimer) clearTimeout(stepTimer);
    render(clock.get());
    stepEls.forEach((s) => s.classList.remove('is-active'));
    let i = 0;
    const advance = () => {
      stepEls.forEach((s, j) => s.classList.toggle('is-active', j === i));
      i++;
      if (i < stepEls.length + 1) stepTimer = setTimeout(advance, 420);
      else stepEls.forEach((s) => s.classList.remove('is-active'));
    };
    advance();
  });

  const tamperToggle = el('input', { type: 'checkbox', id: 'cert-tamper' });
  tamperToggle.addEventListener('change', () => {
    useTampered = (tamperToggle as HTMLInputElement).checked;
    render(clock.get());
  });
  const expert = el(
    'details',
    {},
    el('summary', {}, 'For experts: the DER bytes, and attacking the math instead'),
    el(
      'p',
      {},
      'The full certificate, hex-encoded. The ',
      el('span', { class: 'hl-validity' }, 'highlighted validity bytes'),
      ' (two UTCTimes inside the TBSCertificate) and the ',
      el('span', { class: 'hl-sig' }, 'trailing signature bytes'),
      ' are what steps 2–3 consume. The dates ARE authenticated — they sit inside the signed TBS, so an attacker cannot edit them. What is NOT authenticated is the clock they are compared against.',
    ),
    hexDump(cert),
    el(
      'p',
      { class: 'control-row' },
      tamperToggle,
      el(
        'label',
        { for: 'cert-tamper' },
        'Flip one bit of the signature — attack the math instead of the clock (verification really fails)',
      ),
    ),
    el(
      'p',
      {},
      'Contrast the two attacks: flipping one signature bit is caught instantly by Ed25519 at any clock position. Moving the clock is never caught, because no cryptographic check reads the clock’s honesty.',
    ),
  );

  host.append(summary, el('div', { class: 'control-row' }, runBtn), stepper, sigNote, resultHost, stateLine, expert);
  clock.subscribe(render);
  render(clock.get());
}
