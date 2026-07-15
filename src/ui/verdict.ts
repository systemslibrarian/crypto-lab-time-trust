/**
 * Renders a Decision as THREE separate indicators — this is the lab's visual
 * contract (see core/decision.ts):
 *
 *   1. the cryptographic result   (dashed "math" chip — never drives color of 2/3)
 *   2. the security verdict       (neutral outlined chip, icon + text)
 *   3. the integrity line         (the ONLY strongly-colored element: green when
 *      the verdict matches what a truthful clock would produce, ALARM when a
 *      lying clock produced the wrong decision)
 *
 * A wrong ACCEPT therefore renders as alarm-red even though every signature
 * check on screen says "valid" — which is the point of the whole lab.
 */
import type { Decision } from '../core/decision';
import { el } from './dom';

export function mathChip(dec: Decision): HTMLElement {
  const wrap = el('span', {});
  for (const c of dec.crypto) {
    wrap.append(
      el(
        'span',
        { class: `chip chip-math ${c.ok ? 'is-ok' : 'is-bad'}` },
        `${c.ok ? '✓' : '✗'} ${c.label}: ${c.ok ? 'VALID' : 'INVALID'}`,
      ),
      ' ',
    );
  }
  return wrap;
}

export function verdictChip(dec: Decision): HTMLElement {
  const accept = dec.verdict === 'accept';
  return el('span', { class: 'chip chip-verdict' }, `Verdict: ${accept ? 'ACCEPT ✓' : 'REJECT ✗'}`);
}

/**
 * `trueVerdict` = what the same verifier would decide if its clock told the
 * truth (or what a spec-compliant verifier would decide, for replay cases).
 */
export function integrityLine(
  dec: Decision,
  trueVerdict: 'accept' | 'reject',
  wrongText?: string,
): HTMLElement {
  if (dec.verdict === trueVerdict) {
    return el(
      'p',
      { class: 'integrity is-ok' },
      el('span', { 'aria-hidden': 'true' }, '✓'),
      el('span', {}, 'Consistent with the true clock — this decision is correct.'),
    );
  }
  return el(
    'p',
    { class: 'integrity is-alarm' },
    el('span', { 'aria-hidden': 'true' }, '⚠'),
    el(
      'span',
      {},
      wrongText ??
        `WRONG — a truthful clock would say ${trueVerdict.toUpperCase()}. The clock lied; the math never did.`,
    ),
  );
}

export function checksList(dec: Decision): HTMLElement {
  const ul = el('ul', { class: 'checks' });
  for (const c of dec.policy) {
    ul.append(
      el(
        'li',
        { class: c.pass ? 'pass' : 'fail' },
        el('span', { class: 'icon', 'aria-hidden': 'true' }, c.pass ? '✓' : '✗'),
        el('span', {}, `${c.name}: ${c.pass ? 'pass' : 'FAIL'}`, el('span', { class: 'detail' }, c.detail)),
      ),
    );
  }
  return ul;
}

/** The standard result block: math chip · verdict chip · checks · integrity. */
export function resultBlock(
  dec: Decision,
  trueVerdict: 'accept' | 'reject' | null,
  wrongText?: string,
): HTMLElement {
  const block = el('div', { class: 'result-block' });
  const chips = el('p', { class: 'control-row' }, mathChip(dec), verdictChip(dec));
  block.append(chips, checksList(dec));
  if (trueVerdict !== null) block.append(integrityLine(dec, trueVerdict, wrongText));
  return block;
}
