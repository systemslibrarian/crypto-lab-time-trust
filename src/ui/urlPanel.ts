/**
 * Signed-URL panel: whose clock is authoritative? The verifier function
 * literally has no client-clock parameter — the client slider is wired to
 * nothing but a label, and that's the lesson.
 */
import type { Scenario } from '../scenario';
import { verifySignedUrl } from '../url/signedurl';
import { MIN, fmtSkew, fmtUtc } from '../time/clock';
import { DEMO_EPOCH_MS } from '../time/clock';
import type { ClockControl } from './clockPanel';
import { byId, clear, el } from './dom';
import type { Lab } from './lab';
import { resultBlock } from './verdict';

export function renderUrlPanel(clock: ClockControl, scenario: Scenario, lab: Lab): void {
  const host = byId<HTMLElement>('url-panel-body');
  clear(host);

  let clientSkewSec = 0;
  let serverSkewSec = 0;

  const urlBox = el(
    'div',
    { class: 'token-box', tabindex: '0', role: 'region', 'aria-label': 'the signed URL' },
    `https://files.example${scenario.signedUrl.full}`,
  );

  const clientSlider = el('input', { type: 'range', id: 'url-client-skew', min: '-3600', max: '3600', step: '60', value: '0' });
  const clientLabel = el('label', { for: 'url-client-skew' }, '');
  const serverSlider = el('input', { type: 'range', id: 'url-server-skew', min: '-3600', max: '3600', step: '60', value: '0' });
  const serverLabel = el('label', { for: 'url-server-skew' }, '');

  const clientView = el('p', { class: 'readout' });
  const serverCard = el('div', {});
  const jumpBtn = el('button', { type: 'button' }, 'Jump past expiry (T+21 m)');
  const requestBtn = el('button', { type: 'button', class: 'primary' }, 'Request the file');
  const hint = el('p', { class: 'scope-note' });

  let seq = 0;
  let wasResurrected = false;
  async function render(nowMs: number): Promise<void> {
    const my = ++seq;
    const trueSec = Math.floor(nowMs / 1000);
    const serverSec = trueSec + serverSkewSec;
    const clientSec = trueSec + clientSkewSec;
    const [dec, truth] = await Promise.all([
      verifySignedUrl(scenario.urlSecret, scenario.signedUrl, serverSec),
      verifySignedUrl(scenario.urlSecret, scenario.signedUrl, trueSec),
    ]);
    if (my !== seq) return;

    const resurrected = truth.verdict === 'reject' && dec.verdict === 'accept';
    if (resurrected && !wasResurrected) {
      lab.emit('URL', 'expired URL resurrected by rolling the server clock back — no forgery');
      lab.flashAlarm('url-panel');
    }
    wasResurrected = resurrected;

    const clientThinks = clientSec <= scenario.signedUrl.expiresSec ? 'still fresh' : 'expired';
    clientView.textContent =
      `Client clock ${fmtUtc(clientSec * 1000)} (${fmtSkew(clientSkewSec)}) — the client believes the URL is ${clientThinks}. ` +
      'The server is never told; nothing you do to this clock reaches the verifier.';

    clear(serverCard);
    serverCard.append(
      el('p', { class: 'readout' }, `Server clock ${fmtUtc(serverSec * 1000)} (${fmtSkew(serverSkewSec)}) — this is the ONLY clock verifySignedUrl() takes.`),
      resultBlock(
        dec,
        truth.verdict,
        truth.verdict === 'reject'
          ? 'WRONG — in true time this URL expired. Rolling the SERVER clock back resurrected it: the MAC is genuinely valid, no forgery happened, and the file is served anyway.'
          : 'WRONG — in true time this URL is still valid, but this server clock rejects it.',
      ),
    );

    hint.textContent =
      truth.verdict === 'accept'
        ? 'Try it: jump past expiry, then (1) roll the CLIENT clock back an hour — nothing changes; (2) roll the SERVER clock back — the dead URL works again. Whose clock is authoritative, and can the attacker reach it?'
        : serverSkewSec < 0 && dec.verdict === 'accept'
          ? 'You just resurrected an expired URL without touching a single byte of cryptography. An attacker who can set this server’s clock (NTP spoofing, hypervisor control, a root shell) gets the same result.'
          : 'The URL is expired at true time. Roll the client clock back: nothing. Roll the server clock back: watch the verdict.';
  }

  clientSlider.addEventListener('input', () => {
    clientSkewSec = Number(clientSlider.value);
    clientLabel.textContent = `Client (browser) clock offset: ${fmtSkew(clientSkewSec)} — you control it, and it does not matter`;
    clientSlider.setAttribute('aria-valuetext', fmtSkew(clientSkewSec));
    void render(clock.get());
  });
  serverSlider.addEventListener('input', () => {
    serverSkewSec = Number(serverSlider.value);
    serverLabel.textContent = `SERVER clock offset: ${fmtSkew(serverSkewSec)} — the clock the verifier actually reads`;
    serverSlider.setAttribute('aria-valuetext', fmtSkew(serverSkewSec));
    void render(clock.get());
  });
  jumpBtn.addEventListener('click', () => clock.set(DEMO_EPOCH_MS + 21 * MIN));
  requestBtn.addEventListener('click', () => void render(clock.get()));

  clientLabel.textContent = 'Client (browser) clock offset: 0 s — you control it, and it does not matter';
  serverLabel.textContent = 'SERVER clock offset: 0 s — the clock the verifier actually reads';

  host.append(
    urlBox,
    el('p', { class: 'readout' }, `Signed for GET ${scenario.signedUrl.path}, expires ${fmtUtc(scenario.signedUrl.expiresSec * 1000)} (T+20 m). The expiry is INSIDE the MAC — editing it breaks the signature.`),
    el('div', { class: 'field' }, clientLabel, clientSlider),
    el('div', { class: 'field' }, serverLabel, serverSlider),
    el('div', { class: 'control-row' }, requestBtn, jumpBtn),
    clientView,
    serverCard,
    hint,
  );
  clock.subscribe((ms) => void render(ms));
  void render(clock.get());

  lab.register('url', {
    sectionId: 'url-panel',
    title: 'Signed URL — whose clock?',
    set(opts) {
      if (typeof opts.serverSkew === 'number') {
        serverSkewSec = opts.serverSkew;
        serverSlider.value = String(serverSkewSec);
        serverLabel.textContent = `SERVER clock offset: ${fmtSkew(serverSkewSec)} — the clock the verifier actually reads`;
        serverSlider.setAttribute('aria-valuetext', fmtSkew(serverSkewSec));
      }
      if (typeof opts.clientSkew === 'number') {
        clientSkewSec = opts.clientSkew;
        clientSlider.value = String(clientSkewSec);
        clientLabel.textContent = `Client (browser) clock offset: ${fmtSkew(clientSkewSec)} — you control it, and it does not matter`;
        clientSlider.setAttribute('aria-valuetext', fmtSkew(clientSkewSec));
      }
      void render(clock.get());
    },
  });
}
