/**
 * Replay-cache panel: "reject anything older than 5 minutes" across three
 * servers whose clocks disagree. Replay caches are per-server; a replayed
 * request slips through the server whose slow clock still calls it fresh.
 */
import type { Scenario } from '../scenario';
import { DEFAULT_SKEW_WINDOW_SEC, makeRequest, serverCheck, type AuthRequest, type ServerCheck } from '../replay/replay';
import { fmtSkew, fmtUtc } from '../time/clock';
import type { ClockControl } from './clockPanel';
import { byId, clear, el } from './dom';
import { resultBlock } from './verdict';

interface Server {
  name: string;
  skewSec: number;
  cache: Set<string>;
  card: HTMLElement;
  resultHost: HTMLElement;
  clockLine: HTMLElement;
  seenOriginal: boolean;
}

export function renderReplayPanel(clock: ClockControl, scenario: Scenario): void {
  const host = byId<HTMLElement>('replay-panel-body');
  clear(host);

  let request: AuthRequest = scenario.initialRequest;
  const servers: Server[] = [
    { name: 'A', skewSec: -240, cache: new Set(), card: el('div', { class: 'subcard' }), resultHost: el('div', {}), clockLine: el('p', { class: 'readout' }), seenOriginal: false },
    { name: 'B', skewSec: 0, cache: new Set(), card: el('div', { class: 'subcard' }), resultHost: el('div', {}), clockLine: el('p', { class: 'readout' }), seenOriginal: false },
    { name: 'C', skewSec: 240, cache: new Set(), card: el('div', { class: 'subcard' }), resultHost: el('div', {}), clockLine: el('p', { class: 'readout' }), seenOriginal: false },
  ];

  const requestBox = el('div', { class: 'token-box', tabindex: '0', role: 'region', 'aria-label': 'the captured request' });
  const sendBtn = el('button', { type: 'button', class: 'primary' }, 'Send a fresh request (load balancer routes it to server B)');
  const statusLine = el('p', { class: 'readout', role: 'status', 'aria-live': 'polite' });

  function showRequest(): void {
    clear(requestBox);
    requestBox.append(
      `body: "${request.body}"`,
      el('br'),
      `timestamp (inside the MAC): ${request.timestampSec} = ${fmtUtc(request.timestampSec * 1000)}`,
      el('br'),
      `HMAC-SHA-256: ${request.mac.slice(0, 24)}…  👁 an eavesdropper has a byte-exact copy`,
    );
  }

  async function deliver(server: Server, isReplay: boolean): Promise<ServerCheck> {
    const trueSec = Math.floor(clock.get() / 1000);
    const serverSec = trueSec + server.skewSec;
    const r = await serverCheck(scenario.replaySecret, request, serverSec, server.cache);
    // what a spec-correct server (honest clock, own cache state BEFORE this delivery) would decide:
    const honestCache = new Set(server.cache);
    honestCache.delete(r.verdict === 'accept' ? request.mac : '');
    const truth = await serverCheck(scenario.replaySecret, request, trueSec, isReplay ? new Set([request.mac]) : honestCache);
    clear(server.resultHost);
    server.resultHost.append(
      resultBlock(
        r,
        truth.verdict,
        isReplay
          ? `WRONG — this is a replay, ${Math.abs(trueSec - request.timestampSec)} s after the original. This server's ${fmtSkew(server.skewSec)} clock computed age ${r.ageSec} s, called it fresh, and it had no cache entry because the original went elsewhere.`
          : `WRONG — at the true clock this request is ${truth.verdict === 'accept' ? 'fresh' : 'stale'}, but this server's skewed clock says ${r.verdict.toUpperCase()}.`,
      ),
    );
    return r;
  }

  function updateClockLines(nowMs: number): void {
    const trueSec = Math.floor(nowMs / 1000);
    for (const s of servers) {
      s.clockLine.textContent = `local clock ${fmtUtc((trueSec + s.skewSec) * 1000)} (${fmtSkew(s.skewSec)}) · replay cache: ${s.cache.size} entr${s.cache.size === 1 ? 'y' : 'ies'}`;
    }
  }

  sendBtn.addEventListener('click', () => {
    void (async () => {
      request = await makeRequest(scenario.replaySecret, 'POST /transfer amount=100 to=mallory', Math.floor(clock.get() / 1000));
      showRequest();
      servers.forEach((s) => (s.seenOriginal = false));
      const b = servers[1];
      b.seenOriginal = true;
      const r = await deliver(b, false);
      statusLine.textContent = `Fresh request sent to server B at ${fmtUtc(clock.get())}: ${r.verdict.toUpperCase()}. The eavesdropper captured it. Move the clock forward, then replay it to each server.`;
      updateClockLines(clock.get());
    })();
  });

  for (const s of servers) {
    const slider = el('input', { type: 'range', id: `replay-skew-${s.name}`, min: '-360', max: '360', step: '30', value: String(s.skewSec) });
    const label = el('label', { for: `replay-skew-${s.name}` }, `Server ${s.name} clock skew: ${fmtSkew(s.skewSec)}`);
    slider.addEventListener('input', () => {
      s.skewSec = Number(slider.value);
      label.textContent = `Server ${s.name} clock skew: ${fmtSkew(s.skewSec)}`;
      slider.setAttribute('aria-valuetext', fmtSkew(s.skewSec));
      updateClockLines(clock.get());
    });
    const replayBtn = el('button', { type: 'button' }, `Replay to ${s.name}`);
    replayBtn.addEventListener('click', () => {
      void (async () => {
        const r = await deliver(s, true);
        statusLine.textContent = `Replay to server ${s.name}: ${r.verdict.toUpperCase()}${r.replayDetected ? ' (replay cache caught it)' : ''}.`;
        updateClockLines(clock.get());
      })();
    });
    s.card.append(
      el('h3', {}, `Server ${s.name}`),
      s.clockLine,
      el('div', { class: 'field' }, label, slider),
      el('div', { class: 'control-row' }, replayBtn),
      s.resultHost,
    );
  }

  host.append(
    el(
      'p',
      {},
      `Policy on every server: accept a MAC-valid request whose timestamp is within ±${DEFAULT_SKEW_WINDOW_SEC} s of the local clock and which is not in the local replay cache (the Kerberos rule, RFC 4120 §3.1.3). The caches are per-server and not shared.`,
    ),
    requestBox,
    el('div', { class: 'control-row' }, sendBtn),
    statusLine,
    el('div', { class: 'grid-3' }, ...servers.map((s) => s.card)),
    el(
      'p',
      { class: 'scope-note' },
      'The recipe: send once (server B accepts and caches it), slide the clock ~6 minutes forward, then replay. B rejects it — cache hit. C rejects it — its fast clock says it is ancient. A accepts it — its slow clock computes a small age, and A never saw the original. Nothing cryptographic distinguishes the replay from the original; the bytes are identical.',
    ),
  );

  // initial state: the scenario request was legitimately sent to B at T+0
  void (async () => {
    const b = servers[1];
    b.seenOriginal = true;
    showRequest();
    await deliver(b, false);
    statusLine.textContent = 'At load, the request above was sent to server B at T+0 and accepted (it is in B’s cache). Move the clock forward ~6 minutes, then replay it to each server.';
    updateClockLines(clock.get());
  })();

  clock.subscribe(updateClockLines);
}
