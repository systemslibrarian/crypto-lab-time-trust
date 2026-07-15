/**
 * JWT panel: one HS256 token, two verifiers, two clocks. The split-brain
 * moment — simultaneously valid at the auth server and expired at the
 * resource server — is caused by nothing but a 90-second clock difference.
 */
import type { Scenario } from '../scenario';
import { verifyJwt } from '../jwt/jwt';
import { SEC, fmtSkew, fmtUtc } from '../time/clock';
import type { ClockControl } from './clockPanel';
import { byId, clear, el } from './dom';
import { resultBlock } from './verdict';

export function renderJwtPanel(clock: ClockControl, scenario: Scenario): void {
  const host = byId<HTMLElement>('jwt-panel-body');
  clear(host);

  const [h, p, s] = scenario.jwtToken.split('.');
  const tokenBox = el(
    'div',
    { class: 'token-box', tabindex: '0', role: 'region', 'aria-label': 'the JWT, base64url-encoded' },
    el('span', { class: 'tok-h' }, h),
    '.',
    el('span', { class: 'tok-p' }, p),
    '.',
    el('span', { class: 'tok-s' }, s),
  );

  const c = scenario.jwtClaims;
  const claimsTable = el(
    'table',
    {},
    el('caption', { class: 'visually-hidden' }, 'JWT time claims'),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Claim'), el('th', { scope: 'col' }, 'Value'), el('th', { scope: 'col' }, 'Meaning'))),
    el(
      'tbody',
      {},
      el('tr', {}, el('td', {}, el('code', {}, 'iat')), el('td', { class: 'mono' }, `${c.iat} = ${fmtUtc(c.iat * 1000)}`), el('td', {}, 'issued-at — informational only; RFC 7519 attaches no acceptance rule to it')),
      el('tr', {}, el('td', {}, el('code', {}, 'nbf')), el('td', { class: 'mono' }, `${c.nbf} = ${fmtUtc(c.nbf * 1000)}`), el('td', {}, 'not before — reject earlier than this')),
      el('tr', {}, el('td', {}, el('code', {}, 'exp')), el('td', { class: 'mono' }, `${c.exp} = ${fmtUtc(c.exp * 1000)}`), el('td', {}, 'expiration — the clock must be strictly before this')),
    ),
  );

  let rsSkewSec = 90;
  let leewaySec = 0;

  const skewSlider = el('input', {
    type: 'range',
    id: 'jwt-rs-skew',
    min: '-300',
    max: '300',
    step: '15',
    value: '90',
  });
  const skewLabel = el('label', { for: 'jwt-rs-skew' }, '');
  const leewayInput = el('input', { type: 'number', id: 'jwt-leeway', min: '0', max: '300', step: '15', value: '0' });

  const authCard = el('div', { class: 'subcard' });
  const rsCard = el('div', { class: 'subcard' });
  const headline = el('p', { class: 'readout', role: 'status', 'aria-live': 'polite' });

  const splitBtn = el('button', { type: 'button', class: 'primary' }, 'Jump to the split-brain moment');
  const splitNote = el('span', { class: 'readout' }, '');

  let seq = 0;
  async function render(nowMs: number): Promise<void> {
    const my = ++seq;
    const authNowSec = Math.floor(nowMs / 1000);
    const rsNowSec = authNowSec + rsSkewSec;
    const [auth, rs, truth] = await Promise.all([
      verifyJwt(scenario.jwtToken, scenario.jwtKey, authNowSec, leewaySec),
      verifyJwt(scenario.jwtToken, scenario.jwtKey, rsNowSec, leewaySec),
      verifyJwt(scenario.jwtToken, scenario.jwtKey, authNowSec, leewaySec), // truth = master clock
    ]);
    if (my !== seq) return;

    clear(authCard);
    authCard.append(
      el('h3', {}, 'Authorization server'),
      el('p', { class: 'readout' }, `local clock = true time = ${fmtUtc(authNowSec * 1000)}`),
      resultBlock(auth, truth.verdict),
    );
    clear(rsCard);
    rsCard.append(
      el('h3', {}, 'Resource server'),
      el('p', { class: 'readout' }, `local clock = true time ${fmtSkew(rsSkewSec)} = ${fmtUtc(rsNowSec * 1000)}`),
      resultBlock(
        rs,
        truth.verdict,
        `WRONG — at the true clock this token is ${truth.verdict === 'accept' ? 'still valid' : 'expired'}, but this server's skewed clock says ${rs.verdict.toUpperCase()}. Same bytes, same valid signature.`,
      ),
    );
    const line =
      auth.verdict === rs.verdict
        ? `Both servers agree: ${auth.verdict.toUpperCase()}.`
        : `SPLIT-BRAIN: auth server says ${auth.verdict.toUpperCase()}, resource server says ${rs.verdict.toUpperCase()} — the token bytes and the (valid) signature are identical on both sides.`;
    if (headline.textContent !== line) headline.textContent = line;
  }

  function updateControls(): void {
    skewLabel.textContent = `Resource server clock skew: ${fmtSkew(rsSkewSec)} (the auth server stays on true time)`;
    skewSlider.setAttribute('aria-valuetext', fmtSkew(rsSkewSec));
    splitBtn.disabled = rsSkewSec === 0;
    splitNote.textContent =
      rsSkewSec === 0 ? ' (needs a non-zero skew — with equal clocks the servers can never disagree)' : '';
  }

  skewSlider.addEventListener('input', () => {
    rsSkewSec = Number(skewSlider.value);
    updateControls();
    void render(clock.get());
  });
  leewayInput.addEventListener('input', () => {
    leewaySec = Math.max(0, Number(leewayInput.value) || 0);
    void render(clock.get());
  });
  splitBtn.addEventListener('click', () => {
    // pick a master time where the two clocks fall on opposite sides of exp+leeway
    const boundaryMs = (scenario.jwtClaims.exp + leewaySec) * 1000;
    clock.set(boundaryMs - Math.round((rsSkewSec * 1000) / 2) - (rsSkewSec > 0 ? 0 : SEC));
  });

  host.append(
    tokenBox,
    claimsTable,
    el(
      'div',
      { class: 'field' },
      skewLabel,
      skewSlider,
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'jwt-leeway' }, 'Verifier leeway in seconds (RFC 7519: "some small leeway, usually no more than a few minutes")'),
      leewayInput,
    ),
    el('div', { class: 'control-row' }, splitBtn, splitNote),
    el('div', { class: 'grid-2' }, authCard, rsCard),
    headline,
    el(
      'p',
      { class: 'scope-note' },
      'Leeway is the standard band-aid for skew — but notice what it does: it widens acceptance for every token at every verifier, honest or not. It trades an availability failure for a longer attack window; it does not authenticate the clock.',
    ),
  );
  clock.subscribe((ms) => void render(ms));
  updateControls();
  void render(clock.get());
}
