/**
 * Distributed-nodes panel: one Ed25519-signed token, three verifiers, three
 * clocks. The accept/reject matrix changes while a counter proves that no
 * cryptographic input changed at all.
 */
import type { Scenario } from '../scenario';
import { verifyToken } from '../token/token';
import { fmtSkew, fmtUtc } from '../time/clock';
import type { ClockControl } from './clockPanel';
import { byId, clear, el } from './dom';
import type { Lab } from './lab';
import { integrityLine, mathChip, verdictChip } from './verdict';

export function renderNodesPanel(clock: ClockControl, scenario: Scenario, lab: Lab): void {
  const host = byId<HTMLElement>('nodes-panel-body');
  clear(host);

  const nodes = [
    { name: 'node-west', skewSec: -120 },
    { name: 'node-central', skewSec: 0 },
    { name: 'node-east', skewSec: 120 },
  ];
  let verifications = 0;
  let flips = 0;
  let lastMatrix = '';

  const [p, s] = scenario.nodeToken.encoded.split('.');
  const tokenBox = el(
    'div',
    { class: 'token-box', tabindex: '0', role: 'region', 'aria-label': 'the signed node token' },
    el('span', { class: 'tok-p' }, p),
    '.',
    el('span', { class: 'tok-s' }, s),
  );

  const tbody = el('tbody', {});
  const table = el(
    'table',
    {},
    el('caption', { class: 'visually-hidden' }, 'Per-node verification matrix'),
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col' }, 'Node'),
        el('th', { scope: 'col' }, 'Local clock'),
        el('th', { scope: 'col' }, 'Cryptographic result'),
        el('th', { scope: 'col' }, 'Verdict'),
        el('th', { scope: 'col' }, 'vs true clock'),
      ),
    ),
    tbody,
  );
  const counterLine = el('p', { class: 'readout', role: 'status', 'aria-live': 'polite' });
  const slidersHost = el('div', { class: 'grid-3' });

  function render(nowMs: number): void {
    const trueSec = Math.floor(nowMs / 1000);
    const truth = verifyToken(scenario.tokenKeys.publicKey, scenario.nodeToken.encoded, trueSec);
    verifications++;
    clear(tbody);
    const verdicts: string[] = [];
    let anyInvalidSig = !truth.crypto[0].ok;
    for (const n of nodes) {
      const dec = verifyToken(scenario.tokenKeys.publicKey, scenario.nodeToken.encoded, trueSec + n.skewSec);
      verifications++;
      anyInvalidSig ||= !dec.crypto[0].ok;
      verdicts.push(dec.verdict);
      tbody.append(
        el(
          'tr',
          {},
          el('th', { scope: 'row' }, n.name),
          el('td', { class: 'mono' }, `${fmtUtc((trueSec + n.skewSec) * 1000)} (${fmtSkew(n.skewSec)})`),
          el('td', {}, mathChip(dec)),
          el('td', {}, verdictChip(dec)),
          el('td', {}, integrityLine(dec, truth.verdict)),
        ),
      );
    }
    const matrix = verdicts.join(',');
    if (lastMatrix && matrix !== lastMatrix) {
      flips++;
      const accepts = verdicts.filter((v) => v === 'accept').length;
      if (accepts > 0 && accepts < verdicts.length) {
        lab.emit('Nodes', `token now disagrees across nodes (${accepts}/${verdicts.length} accept) — signature valid on all`);
      }
    }
    lastMatrix = matrix;
    const line =
      `Since page load: ${verifications} real Ed25519 verifications of the same 64-byte signature — ` +
      `${anyInvalidSig ? 'SOME INVALID (unexpected!)' : 'every single one VALID'} — while the accept/reject matrix has changed ${flips} time${flips === 1 ? '' : 's'}. ` +
      'The cryptographic input never changed; only clocks did.';
    counterLine.textContent = line;
  }

  for (const n of nodes) {
    const slider = el('input', { type: 'range', id: `node-skew-${n.name}`, min: '-600', max: '600', step: '30', value: String(n.skewSec) });
    const label = el('label', { for: `node-skew-${n.name}` }, `${n.name} clock skew: ${fmtSkew(n.skewSec)}`);
    slider.addEventListener('input', () => {
      n.skewSec = Number(slider.value);
      label.textContent = `${n.name} clock skew: ${fmtSkew(n.skewSec)}`;
      slider.setAttribute('aria-valuetext', fmtSkew(n.skewSec));
      render(clock.get());
    });
    slidersHost.append(el('div', { class: 'subcard' }, el('div', { class: 'field' }, label, slider)));
  }

  host.append(
    tokenBox,
    el('p', { class: 'readout' }, `token payload: {"sub":"${scenario.nodeToken.payload.sub}","exp":${scenario.nodeToken.payload.exp}} — exp = ${fmtUtc(scenario.nodeToken.payload.exp * 1000)} (T+30 m)`),
    slidersHost,
    el('div', { class: 'timeline-wrap', tabindex: '0', role: 'region', 'aria-label': 'per-node verification matrix' }, table),
    counterLine,
    el(
      'p',
      { class: 'scope-note' },
      'This is what "the token is valid" means in a distributed system: nothing. Valid WHERE, according to WHOSE clock? A session revoked "in 5 minutes" is revoked at different real moments on every node — and on a node whose clock is far enough behind, never quite when you think.',
    ),
  );
  clock.subscribe(render);
  render(clock.get());

  lab.register('nodes', { sectionId: 'nodes-panel', title: 'Distributed nodes, one token' });
}
