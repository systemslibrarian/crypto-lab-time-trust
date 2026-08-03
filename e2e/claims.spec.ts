/**
 * Functional coverage for the claims the lab makes on screen.
 *
 * The lab's thesis is that one movable clock changes SECURITY DECISIONS while
 * every cryptographic result stays identical, so the load-bearing states are:
 *   - a headline verdict derived from values the page itself printed
 *     (never a hardcoded expectation),
 *   - every failure / tamper path reaching failure AND naming its cause,
 *   - counters that stay internally consistent with what they counted,
 *   - the several surfaces that render one run agreeing with each other.
 *
 * Everything is read back out of the rendered DOM. Any uncaught page exception
 * or console error fails the test that provoked it.
 */
import { expect, test as base, type Page } from '@playwright/test';

const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(`pageerror: ${String(e)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push(`console.error: ${m.text()}`);
    });
    await use(errs);
    expect(errs, 'uncaught page exceptions / console errors').toEqual([]);
  },
});

/** Wait for the async panels (JWT, TOTP, URL, replay) to have painted a result. */
async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId('jwt-headline')).not.toHaveText('');
  await expect(page.getByTestId('totp-band')).toContainText('accept band');
  await expect(page.getByTestId('url-server')).toContainText('Verdict:');
  await expect(page.getByTestId('replay-server-B')).toContainText('Verdict:');
}

async function open(page: Page): Promise<void> {
  await page.goto('.');
  await ready(page);
}

/** Move the master clock to a signed offset in seconds from the demo epoch. */
async function setClock(page: Page, offsetSec: number): Promise<void> {
  // `fill` on a range input dispatches exactly one `input` event, which matters
  // for the panels that count how many times they re-verified.
  await page.locator('#master-clock').fill(String(offsetSec));
}

async function setRange(page: Page, id: string, value: number): Promise<void> {
  await page.locator(`#${id}`).fill(String(value));
}

/** "2026-07-15 12:00:00 UTC" -> epoch ms. Parses the page's own printed clocks. */
function parseUtc(s: string): number {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC/);
  if (!m) throw new Error(`not a lab timestamp: ${JSON.stringify(s)}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** All UTC timestamps in a blob, in order. */
function allUtc(s: string): number[] {
  return (s.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/g) ?? []).map(parseUtc);
}

function verdictOf(text: string): 'ACCEPT' | 'REJECT' {
  const m = text.match(/Verdict:\s*(ACCEPT|REJECT)/);
  if (!m) throw new Error(`no verdict in: ${JSON.stringify(text.slice(0, 200))}`);
  return m[1] as 'ACCEPT' | 'REJECT';
}

// ---------------------------------------------------------------- master clock

test('the clock readout, the slider and every panel agree about "now"', async ({ page, errors }) => {
  void errors;
  await open(page);

  for (const offsetSec of [0, 15 * 60, 25 * 3600]) {
    await setClock(page, offsetSec);
    const nowText = await page.getByTestId('clock-now').innerText();
    const nowMs = parseUtc(nowText);

    // the slider's accessible value text is generated separately from the
    // readout line — a screen-reader user must hear the same instant.
    const valueText = await page.locator('#master-clock').getAttribute('aria-valuetext');
    expect(parseUtc(String(valueText))).toBe(nowMs);

    // the JWT auth server and the URL client both restate the master clock
    // through their own formatting paths.
    const auth = await page.getByTestId('jwt-auth').innerText();
    expect(parseUtc(auth.split('local clock = true time = ')[1])).toBe(nowMs);
    const client = await page.getByTestId('url-client-view').innerText();
    expect(parseUtc(client.split('Client clock ')[1])).toBe(nowMs);
  }
});

// ------------------------------------------------------------------ 1 · cert

test('certificate verdict follows the page-computed clock/notAfter comparison', async ({ page, errors }) => {
  void errors;
  await open(page);

  // notBefore / notAfter as the panel itself printed them
  const summary = await page.locator('#cert-panel-body p.readout').first().innerText();
  const [notBefore, notAfter] = allUtc(summary);
  expect(notAfter).toBeGreaterThan(notBefore);

  for (const offsetSec of [-90 * 60, 0, 25 * 3600]) {
    await setClock(page, offsetSec);
    const nowMs = parseUtc(await page.getByTestId('clock-now').innerText());
    // expected verdict derived from values the page rendered, not from constants
    const expected = nowMs >= notBefore && nowMs <= notAfter ? 'ACCEPT' : 'REJECT';

    const step4 = await page.locator('#cert-panel-body li.step').nth(3).innerText();
    const chip = await page.locator('#cert-panel-body .chip-verdict').innerText();
    const state = await page.getByTestId('cert-state').innerText();

    // three surfaces, three code paths, one run
    expect(step4).toContain(expected);
    expect(verdictOf(chip)).toBe(expected);
    if (expected === 'ACCEPT') {
      expect(state).toContain('WITHIN VALIDITY');
    } else {
      expect(state).toMatch(nowMs < notBefore ? /NOT YET VALID/ : /EXPIRED/);
      // and the failing side is named
      expect(step4).toContain(nowMs < notBefore ? 'NOT YET VALID' : 'EXPIRED');
    }
  }
});

test('parse and signature stages are byte-identical across clock positions; only the date compare moves', async ({ page, errors }) => {
  void errors;
  await open(page);
  const step = (i: number) => page.locator('#cert-panel-body li.step').nth(i).innerText();

  await setClock(page, 0);
  const [p0, s0, d0] = [await step(0), await step(1), await step(2)];
  await setClock(page, 25 * 3600);
  const [p1, s1, d1] = [await step(0), await step(1), await step(2)];

  expect(p1).toBe(p0); // STEP 1 parse
  expect(s1).toBe(s0); // STEP 2 Ed25519 — the README's central claim
  expect(d1).not.toBe(d0); // STEP 3 date comparison
  expect(d0).toContain('pass');
  expect(d1).toContain('FAIL');
});

test('flipping one signature bit fails the signature check and names it as the cause', async ({ page, errors }) => {
  void errors;
  await open(page);
  await page.locator('#cert-panel-body details').first().evaluate((d: HTMLDetailsElement) => (d.open = true));
  await page.locator('#cert-tamper').check();

  const panel = page.locator('#cert-panel-body');
  await expect(panel.locator('.chip-math')).toContainText('INVALID');
  expect(verdictOf(await panel.locator('.chip-verdict').innerText())).toBe('REJECT');
  // the cause named is the signature, NOT the clock: both date checks still pass
  await expect(panel.locator('.chip-math')).toContainText('Ed25519 signature');
  const checks = await panel.locator('ul.checks').innerText();
  expect(checks).not.toContain('FAIL');
  await expect(page.getByTestId('cert-sig-note')).toContainText('tampered (1 bit flipped)');

  // the math attack is caught at EVERY clock position, unlike the clock attack
  await setClock(page, 25 * 3600);
  await expect(panel.locator('.chip-math')).toContainText('INVALID');
});

test('the verification counter never counts tampered runs as VALID ones', async ({ page, errors }) => {
  void errors;
  await open(page);
  await page.locator('#cert-panel-body details').first().evaluate((d: HTMLDetailsElement) => (d.open = true));
  const note = page.getByTestId('cert-sig-note');

  const readCount = async (): Promise<number> => {
    const t = await note.innerText();
    expect(t, 'the counter must never report an unexplained INVALID').not.toContain('unexpected');
    expect(t).toContain('result every time: VALID');
    const m = t.match(/Verified (\d+) times so far/);
    expect(m, `no count in: ${t}`).not.toBeNull();
    return Number(m![1]);
  };

  const before = await readCount();
  await page.locator('#cert-tamper').check();
  await expect(note).toContainText('tampered');
  await page.locator('#cert-tamper').uncheck();

  // exactly one further genuine-certificate verification happened (the re-render
  // on untamper). The tampered run returned INVALID and must not be folded into
  // a total whose sentence claims every result was VALID.
  expect(await readCount()).toBe(before + 1);
});

// ------------------------------------------------------------------- 2 · JWT

test('JWT split-brain: the headline and the two server cards report the same run', async ({ page, errors }) => {
  void errors;
  await open(page);
  await setRange(page, 'jwt-rs-skew', 90);
  await page.getByRole('button', { name: 'Jump to the split-brain moment' }).click();
  await expect(page.getByTestId('jwt-headline')).toContainText('SPLIT-BRAIN');

  const auth = await page.getByTestId('jwt-auth').innerText();
  const rs = await page.getByTestId('jwt-rs').innerText();
  const headline = await page.getByTestId('jwt-headline').innerText();

  const authV = verdictOf(auth);
  const rsV = verdictOf(rs);
  expect(authV).not.toBe(rsV); // the split really happened

  // the headline is built by a different expression than the cards' chips
  const hm = headline.match(/auth server says (ACCEPT|REJECT), resource server says (ACCEPT|REJECT)/);
  expect(hm, headline).not.toBeNull();
  expect(hm![1]).toBe(authV);
  expect(hm![2]).toBe(rsV);

  // both sides verified the SAME signature successfully — the clock did this
  expect(auth).toContain('HMAC-SHA-256 signature (HS256): VALID');
  expect(rs).toContain('HMAC-SHA-256 signature (HS256): VALID');

  // the wrong side raises the alarm and names the cause
  const wrong = rsV === authV ? '' : rs;
  expect(wrong).toMatch(/skewed clock says (ACCEPT|REJECT)/);

  // and the two clocks really are 90 s apart, per the page's own printed times
  const authClock = parseUtc(auth.split('local clock = true time = ')[1]);
  const rsClock = parseUtc(rs.split(/local clock = true time [+−]90 s = /)[1]);
  expect((rsClock - authClock) / 1000).toBe(90);
});

test('JWT: the exp check names itself when it fails, and leeway closes the split', async ({ page, errors }) => {
  void errors;
  await open(page);
  await setRange(page, 'jwt-rs-skew', 90);
  await page.getByRole('button', { name: 'Jump to the split-brain moment' }).click();
  await expect(page.getByTestId('jwt-headline')).toContainText('SPLIT-BRAIN');

  // the rejecting side says WHICH claim failed
  const rejecting = (await page.getByTestId('jwt-rs').innerText()).includes('REJECT')
    ? page.getByTestId('jwt-rs')
    : page.getByTestId('jwt-auth');
  await expect(rejecting.locator('ul.checks li.fail')).toContainText('exp (RFC 7519 §4.1.4)');
  await expect(rejecting.locator('ul.checks li.fail')).toContainText('FAIL');

  // leeway wider than the skew makes both verifiers agree again
  await page.locator('#jwt-leeway').fill('300');
  await page.locator('#jwt-leeway').dispatchEvent('input');
  await expect(page.getByTestId('jwt-headline')).toContainText('Both servers agree');
  const headline = await page.getByTestId('jwt-headline').innerText();
  const agreed = headline.match(/Both servers agree: (ACCEPT|REJECT)/)![1];
  expect(verdictOf(await page.getByTestId('jwt-auth').innerText())).toBe(agreed);
  expect(verdictOf(await page.getByTestId('jwt-rs').innerText())).toBe(agreed);
});

test('JWT: the split-brain control disables at zero skew and comes back', async ({ page, errors }) => {
  void errors;
  await open(page);
  const btn = page.getByRole('button', { name: 'Jump to the split-brain moment' });
  await expect(btn).toBeEnabled();
  await setRange(page, 'jwt-rs-skew', 0);
  await expect(btn).toBeDisabled();
  await expect(page.locator('#jwt-panel-body')).toContainText('with equal clocks the servers can never disagree');
  await setRange(page, 'jwt-rs-skew', 90);
  await expect(btn).toBeEnabled();
});

// ------------------------------------------------------------------ 3 · TOTP

test('TOTP acceptance band: the strip and the band summary count the same windows', async ({ page, errors }) => {
  void errors;
  await open(page);
  for (const tol of ['0', '1', '2', '3']) {
    await page.locator('#totp-tol').selectOption(tol);
    const band = await page.getByTestId('totp-band').innerText();
    const m = band.match(/accept band = (\d+) windows = (\d+) s/);
    expect(m, band).not.toBeNull();
    const windows = Number(m![1]);
    const seconds = Number(m![2]);

    // stated band vs the per-window marks the strip painted independently
    const accepted = await page.locator('#totp-panel-body .totp-strip li.in-band').count();
    expect(accepted).toBe(windows);
    expect(windows).toBe(2 * Number(tol) + 1);
    expect(seconds).toBe(windows * 30); // 30-second step
    await expect(page.locator('#totp-panel-body .totp-strip li.is-phone')).toHaveClass(/in-band/);
  }
});

test('TOTP: a wrong code fails and says why', async ({ page, errors }) => {
  void errors;
  await open(page);
  await page.locator('#totp-input').fill('000000');
  await page.getByRole('button', { name: 'Verify code' }).click();
  const res = page.getByTestId('totp-result');
  await expect(res).toContainText('no HOTP match in the checked band');
  expect(verdictOf(await res.innerText())).toBe('REJECT');
});

test('TOTP: with the RFC 6238 §5.2 used-code record ON, the replay is caught and named', async ({ page, errors }) => {
  void errors;
  await open(page);
  await expect(page.locator('#totp-used')).toBeChecked();
  await page.getByRole('button', { name: /Intercept \(capture\)/ }).click();
  const res = page.getByTestId('totp-result');
  await expect(res).toContainText('First use of this code inside the band');

  await page.getByRole('button', { name: 'Replay the intercepted code' }).click();
  await expect(res).toContainText('Replay caught');
  await expect(res).toContainText('one-time-use record: ALREADY USED');
  expect(verdictOf(await res.innerText())).toBe('REJECT');
  // the HMAC still matched — the record, not the math, stopped it
  await expect(res).toContainText('HOTP match');
});

test('TOTP: with the used-code record OFF, a real HMAC match lets the replay through and the page calls it WRONG', async ({ page, errors }) => {
  void errors;
  await open(page);
  await page.locator('#totp-used').uncheck();
  await page.getByRole('button', { name: /Intercept \(capture\)/ }).click();
  const res = page.getByTestId('totp-result');
  await expect(res).toContainText('HOTP match');

  await page.getByRole('button', { name: 'Replay the intercepted code' }).click();
  await expect(res).toContainText('this exact code was already used once');
  await expect(res).toContainText('RFC 6238 §5.2');
  expect(verdictOf(await res.innerText())).toBe('ACCEPT'); // the failure being demonstrated
  await expect(res.locator('.integrity.is-alarm')).toBeVisible();
});

test('a TOTP verdict does not outlive the verifier state it was computed from', async ({ page, errors }) => {
  void errors;
  await open(page);
  const res = page.getByTestId('totp-result');

  // a green ACCEPT on screen, describing this counter and this tolerance
  await page.getByRole('button', { name: /Copy the phone/ }).click();
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(res).toContainText('First use of this code inside the band');
  const counter = (await res.innerText()).match(/verifier is at (\d+)/)![1];

  // move the master clock into a different time step: that verdict is now
  // describing a verifier that no longer exists, so it must be retired rather
  // than left standing (it is announced on an aria-live region, too).
  await setClock(page, 3600);
  await expect(page.getByTestId('totp-retired')).toBeVisible();
  const after = await res.innerText();
  expect(after).not.toContain('ACCEPT');
  expect(after).not.toContain(counter);
  await expect(page.getByTestId('totp-band')).not.toContainText(`T=${counter};`);

  // changing the acceptance policy retires it too
  await page.getByRole('button', { name: /Copy the phone/ }).click();
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(res).toContainText('Verdict:');
  await page.locator('#totp-tol').selectOption('3');
  await expect(page.getByTestId('totp-retired')).toBeVisible();
});

// ------------------------------------------------------------ 4 · signed URL

test('signed URL: the client clock changes nothing, the server clock resurrects the dead link', async ({ page, errors }) => {
  void errors;
  await open(page);
  const server = page.getByTestId('url-server');

  await page.getByRole('button', { name: /Jump past expiry/ }).click();
  await expect(server).toContainText('Verdict: REJECT');
  const expiredBlock = await server.innerText();
  // the failure names itself
  await expect(server.locator('ul.checks li.fail')).toContainText('not expired (server clock)');

  // (1) roll the CLIENT clock back an hour — the verifier never sees it
  await setRange(page, 'url-client-skew', -3600);
  await expect(page.getByTestId('url-client-view')).toContainText('still fresh');
  expect(await server.innerText(), 'client clock must not reach the verifier').toBe(expiredBlock);

  // (2) roll the SERVER clock back — same bytes, opposite decision
  await setRange(page, 'url-server-skew', -3600);
  await expect(server).toContainText('Verdict: ACCEPT');
  await expect(server.locator('.integrity.is-alarm')).toContainText('Rolling the SERVER clock back resurrected it');
  await expect(server).toContainText('HMAC-SHA-256 over method + path + expires: VALID');

  // the accepting comparison uses the server's rolled-back clock, and the page
  // printed both sides of it: check the arithmetic it displayed.
  const txt = await server.innerText();
  const pass = txt.match(/server clock (.+? UTC) ≤ expires (.+? UTC)/);
  expect(pass, txt).not.toBeNull();
  expect(parseUtc(pass![1])).toBeLessThanOrEqual(parseUtc(pass![2]));
  // and it is genuinely EARLIER than true time, which is still past expiry
  const trueMs = parseUtc(await page.getByTestId('clock-now').innerText());
  expect(parseUtc(pass![1])).toBeLessThan(trueMs);
  expect(trueMs).toBeGreaterThan(parseUtc(pass![2]));
});

// ---------------------------------------------------------------- 5 · replay

test('replay across skewed clocks: three servers, three distinct reasons, status line agreeing with each', async ({ page, errors }) => {
  void errors;
  await open(page);
  await page.getByRole('button', { name: 'Replay slips through' }).click();
  await expect(page.getByTestId('clock-now')).toContainText('T+4m');

  const status = page.getByTestId('replay-status');
  const results: Record<string, string> = {};
  for (const name of ['A', 'B', 'C']) {
    await page.getByRole('button', { name: `Replay to ${name}` }).click();
    await expect(status).toContainText(`Replay to server ${name}:`);
    const card = await page.getByTestId(`replay-server-${name}`).innerText();
    results[name] = card;
    // the status line is composed separately from the card's verdict chip
    const s = await status.innerText();
    expect(s).toContain(verdictOf(card));
  }

  // A: slow clock calls the replay fresh, and A never saw the original
  expect(verdictOf(results.A)).toBe('ACCEPT');
  expect(results.A).toContain('authenticator not seen before by this server');
  expect(results.A).toMatch(/WRONG — this is a replay, \d+ s after the original/);

  // B: cache hit — the reason the whole exhibit exists
  expect(verdictOf(results.B)).toBe('REJECT');
  expect(results.B).toContain('this exact authenticator was already accepted by THIS server');
  expect(results.B).toContain('freshness |age| ≤ 300 s (RFC 4120 §3.2.3): pass');

  // C: fast clock calls it stale
  expect(verdictOf(results.C)).toBe('REJECT');
  expect(results.C).toContain('freshness |age| ≤ 300 s (RFC 4120 §3.2.3): FAIL');

  // every one of them verified the MAC — nothing cryptographic separated them
  for (const name of ['A', 'B', 'C']) {
    expect(results[name]).toContain('HMAC-SHA-256 over timestamp + body: VALID');
  }
});

test('a server never reports an authenticator unseen while showing it in its own cache', async ({ page, errors }) => {
  void errors;
  await open(page);
  const b = page.getByTestId('replay-server-B');
  await expect(b).toContainText('replay cache: 1 entr');

  // far past B's freshness window: the cache lookup is short-circuited, but the
  // reported reason must not claim B has never seen this authenticator while
  // the line directly above it says B is holding exactly one.
  await setClock(page, 20 * 60);
  await page.getByRole('button', { name: 'Replay to B' }).click();
  await expect(b).toContainText('Verdict: REJECT');
  const card = await b.innerText();
  expect(card).toMatch(/replay cache: 1 entr/);
  expect(card).toContain('freshness |age| ≤ 300 s (RFC 4120 §3.2.3): FAIL');
  expect(card, 'B is holding this authenticator; it must not deny that').not.toContain(
    'authenticator not seen before by this server',
  );
  expect(card).toContain('HAS seen this authenticator');
});

// ----------------------------------------------------------------- 6 · nodes

test('nodes: the verification counter matches the rows it summarises', async ({ page, errors }) => {
  void errors;
  await open(page);
  const counter = page.getByTestId('nodes-counter');
  const rows = page.locator('#nodes-panel-body tbody tr');
  await expect(rows).toHaveCount(3);

  const readCount = async (): Promise<number> =>
    Number((await counter.innerText()).match(/Since page load: (\d+) real Ed25519 verifications/)![1]);

  const before = await readCount();
  // one re-render = one truth check plus one per node, so the running total can
  // only ever move in steps of four; anything else means the counter and the
  // table it summarises are counting different things.
  await setRange(page, 'node-skew-node-west', -300);
  const after = await readCount();
  expect(after).toBe(before + 1 + (await rows.count()));
  await setRange(page, 'node-skew-node-east', 300);
  expect(await readCount()).toBe(after + 1 + (await rows.count()));

  // the summary sentence and the per-row math chips must not disagree
  const chips = await page.locator('#nodes-panel-body tbody .chip-math').allInnerTexts();
  expect(chips).toHaveLength(3);
  expect(chips.every((c) => c.includes('VALID') && !c.includes('INVALID'))).toBe(true);
  await expect(counter).toContainText('every single one VALID');
  await expect(counter).not.toContainText('unexpected');
});

test('nodes: each row verdict follows the local clock vs exp the row itself printed', async ({ page, errors }) => {
  void errors;
  await open(page);
  const expMs = parseUtc((await page.locator('#nodes-panel-body p.readout').first().innerText()).split('exp = ')[1]);

  // T+31 m: past exp on true time. node-west 10 min behind is still inside.
  await setClock(page, 31 * 60);
  await setRange(page, 'node-skew-node-west', -600);
  await setRange(page, 'node-skew-node-central', 0);
  await setRange(page, 'node-skew-node-east', 600);

  const rows = page.locator('#nodes-panel-body tbody tr');
  const verdicts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const text = await rows.nth(i).innerText();
    const localMs = allUtc(text)[0]; // this row's own printed local clock
    const expected = localMs < expMs ? 'ACCEPT' : 'REJECT';
    expect(verdictOf(text), `row ${i}`).toBe(expected);
    verdicts.push(expected);
    // the failing rows name the check that failed
    if (expected === 'REJECT') expect(text).toContain('Ed25519 signature over payload: VALID');
  }
  expect(new Set(verdicts).size, 'the nodes must genuinely disagree here').toBeGreaterThan(1);

  // a disagreement is reported to the event rail as well
  await expect(page.locator('.event-rail')).toContainText('token now disagrees across nodes');
  const rail = await page.locator('.event-rail').innerText();
  const m = rail.match(/\((\d+)\/(\d+) accept\)/)!;
  expect(Number(m![2])).toBe(3);
  expect(Number(m![1])).toBe(verdicts.filter((v) => v === 'ACCEPT').length);
});

// ------------------------------------------------------- tour / rail / hidden

test('the guided tour advances and exits without leaving controls dead', async ({ page, errors }) => {
  void errors;
  await open(page);
  const banner = page.locator('.tour-banner');
  await expect(banner).toBeHidden();

  await page.getByRole('button', { name: /Take the 30-second tour/ }).click();
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('TOUR — STEP 1 OF 4');

  await banner.getByRole('button', { name: 'Next →' }).click();
  await expect(banner).toContainText('TOUR — STEP 2 OF 4');
  await banner.getByRole('button', { name: 'Exit' }).click();
  await expect(banner).toBeHidden();

  // the clock is still live after the tour
  await setClock(page, 0);
  await expect(page.getByTestId('clock-now')).toContainText('T+0s');
  await page.getByRole('button', { name: /Take the 30-second tour/ }).click();
  await expect(banner).toContainText('TOUR — STEP 1 OF 4');
});

test('crossing a threshold is announced on the event rail', async ({ page, errors }) => {
  void errors;
  await open(page);
  await setClock(page, 25 * 3600);
  await expect(page.locator('.event-rail')).toContainText('crossed into "expired"');
  await setClock(page, 0);
  await expect(page.locator('.event-rail')).toContainText('crossed into "valid"');
});

test('nothing carrying the hidden attribute is still painted', async ({ page, errors }) => {
  void errors;
  await open(page);
  const leaks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[hidden]'))
      .filter((el) => getComputedStyle(el as HTMLElement).display !== 'none')
      .map((el) => `${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`),
  );
  expect(leaks, '[hidden]{display:none} loses to any author display rule').toEqual([]);
});
