# Time Trust

**Clock-dependent security · RFC 5280 · RFC 7519 · RFC 6238**

Real signature and MAC verification driven by a single movable clock, showing which security decisions silently depend on an input that cryptography cannot authenticate.

🔗 **Live demo:** https://systemslibrarian.github.io/crypto-lab-time-trust/

---

## What It Is

Every verification in this demo is mathematically correct. The certificate signature is valid, the JWT's HMAC checks, the TOTP code is a genuine RFC 6238 code — and the security decision can still be **wrong**, because the clock lied. The one idea this lab exists to teach:

> **Time is an unauthenticated input to authenticated systems.** A signature proves *who* signed a message and that it wasn't altered. It cannot prove what *"now"* is. Every check that compares a signed timestamp to a local clock inherits the trustworthiness of that clock — and the clock is not signed.

The primitives are real, run in your browser, and are validated against RFC known-answer tests:

- **Ed25519** (RFC 8032) via [`@noble/curves`](https://github.com/paulmillr/noble-curves) — certificate and distributed-token signatures.
- **HMAC-SHA-256/-SHA-1** (RFC 2104) via WebCrypto `SubtleCrypto` — JWT, signed URLs, replay authenticators, TOTP.
- **HOTP / TOTP** (RFC 4226 / RFC 6238) — hand-rolled dynamic truncation on top of real HMAC, because the truncation step is part of what the lab shows.
- **X.509 + DER** (RFC 5280 / X.690) — a hand-encoded, really-signed, strictly-parsed certificate so you can see the validity dates living *inside* the signed bytes.

**Security model.** There is no backend. All keys and secrets are generated fresh per page load, live only in memory, and never leave the browser. "Server clocks," "nodes," and "the network" are simulated — they are numbers you set. The cryptography is not simulated.

**Not production crypto — a teaching demo.** The point is deliberately narrow and deliberately uncomfortable: better cryptography does not fix any of the failures shown here, because none of them is a cryptographic failure.

## Exhibits

1. **The master clock.** One slider (plus step buttons and named "jump to" moments) is the entire control surface. A timeline shows the fixed validity windows and a movable NOW cursor; nothing cryptographic reacts to the drag — only *decisions* do.
2. **Certificate validity (RFC 5280 §4.1.2.5).** A real X.509 cert, verified step-by-step. Parsing and the Ed25519 signature check produce identical output at every clock position; only the final date comparison changes. Includes a "flip one signature bit" toggle so you can contrast attacking the math (caught instantly) with attacking the clock (never caught).
3. **JWT split-brain (RFC 7519 §4.1, HS256).** One token, two verifiers 90 seconds apart — simultaneously valid at the auth server and expired at the resource server. A leeway control shows the standard skew band-aid and exactly what it costs.
4. **TOTP acceptance window (RFC 6238).** A real code and a verifier whose ±W tolerance band you widen — watching the replay window open with it. Intercept a code and replay it: with the RFC 6238 §5.2 used-code record on, it's caught; off, a real HMAC match lets the replay through.
5. **Signed URL — whose clock? (HMAC expiry).** Roll the *client* clock back on an expired URL: nothing. Roll the *server* clock back: the dead URL works again, with no forgery. The verifier has no client-clock parameter, and that absence is the lesson.
6. **Replay cache across skewed clocks (RFC 4120 §3.1.3).** "Reject anything older than 5 minutes" on three servers with disagreeing clocks and per-server caches. A replay slips through the server whose slow clock still calls it fresh.
7. **Distributed nodes, one token (Ed25519).** One signed token, three independent node clocks. The accept/reject matrix shifts as you drag skews, while a counter proves the signature was verified valid every single time.
8. **Closing frame.** Which failures does NTP fix, which does Roughtime address, and which are unfixable by better timekeeping (the attacker who owns the clock source)?

## When to Use It

- **Use it** to build intuition for why "the signature is valid" and "accept this request" are different statements, and to explain time-skew incidents (expired-cert outages, replay windows, JWT clock-skew bugs) to newcomers.
- **Do NOT use it** as a cryptographic library, a certificate/JWT validator, or an NTP/Roughtime implementation. The DER and X.509 code implements only the minimal profile the demo needs and is not a general-purpose parser.

## Live Demo

At https://systemslibrarian.github.io/crypto-lab-time-trust/ you can drag one clock and watch six real verifiers change their decisions about bytes that never change; force a JWT split-brain; widen a TOTP band until a replay fits; resurrect an expired signed URL by rolling a server clock back; and replay a captured request through the one server whose clock still trusts it.

## What Can Go Wrong

These are the failures the lab *demonstrates*, each against the real primitive:

- **Rolled-back clock resurrects expired credentials.** An attacker who sets the verifier's clock (NTP spoofing, hypervisor control, a root shell) turns "expired" into "valid" — the MAC/signature never stopped being valid, so nothing flags it.
- **Skew splits a distributed system's mind.** The same token is accepted and rejected simultaneously by machines that disagree about the time; a "revoke in 5 minutes" happens at different real moments on every node.
- **Widening the skew tolerance widens the replay window.** The band that absorbs clock drift is the same band an intercepted code or request can be replayed within.
- **Per-server replay caches don't compose.** A request one server has already seen replays cleanly through another that never saw it and whose clock still calls it fresh.

**Precision note (what is and isn't claimed).** The consequences above are about **bypassing time-based acceptance** — using still-valid authenticators outside their intended window. This lab does **not** show, and time manipulation does not grant: recovery of any signing key, recovery of the HMAC/TOTP secret, or forging a signature over new content. Attacking the *math* (the "flip a bit" toggle) is caught instantly; the clock attacks are dangerous precisely because they require no such forgery.

## Real-World Usage

The clock is load-bearing in TLS certificate validity (RFC 5280), JWT/OAuth `exp`/`nbf` (RFC 7519), TOTP authenticators (RFC 6238), Kerberos authenticator freshness (RFC 4120), AWS S3 presigned URLs and CDN signed URLs, and signed-cookie/session expiry. Documented incidents in this family include mass outages from expired certificates, JWT clock-skew authentication bugs, and replay windows created by generous skew tolerances. NTP (drift between honest peers) and Roughtime (a cryptographically auditable time source over a hostile network) address parts of the problem; neither helps when the adversary owns the clock the verifier reads.

## How to Run Locally

```bash
npm install
npm run dev        # Vite dev server
npm test           # 99 unit tests (RFC KATs + verifiers)
npm run build      # typecheck + production build
npm run test:a11y  # axe-core WCAG 2.1 AA gate, both themes (needs: npx playwright install chromium)
```

## Related Demos

- **[Chain of Trust](https://crypto-lab.systemslibrarian.dev/)** — full X.509 path building, name constraints, and revocation. The certificate panel here checks *only* validity dates and links out to that demo for everything else.
- **[Crypto Lab suite](https://crypto-lab.systemslibrarian.dev/)** — 120+ browser demos of real cryptography.

## Build & Verify

- **99 unit tests** (Vitest), of which **42 are spec known-answer tests**:
  - Ed25519 — RFC 8032 §7.1 TEST 1–3 (`src/crypto/kats.test.ts`) ×3
  - HMAC-SHA-256 — RFC 4231 TC1–4, 6, 7 (`src/crypto/kats.test.ts`) ×6
  - HMAC-SHA-512 — RFC 4231 TC1–2 ×2, HMAC-SHA-1 — RFC 2202 TC1–2 ×2
  - HOTP — RFC 4226 Appendix D, counters 0–9 (`src/otp/otp.test.ts`) ×10
  - TOTP — RFC 6238 Appendix B, 6 times × 3 hashes (`src/otp/otp.test.ts`) ×18
  - JWS HS256 — RFC 7515 Appendix A.1 (`src/jwt/jwt.test.ts`) ×1
- The remaining tests cover DER round-trips and strict fail-closed parsing, the X.509 validity state machine (inclusive bounds), the JWT/URL/replay/token verifiers, the fail-closed decision combinator, and the specific "system fails, primitive holds" outcomes each panel demonstrates.
- **Accessibility gate:** `@axe-core/playwright` scans the production build for zero WCAG 2.1 A/AA violations in **both** themes (`e2e/a11y.spec.ts`); the GitHub Pages deploy is blocked if it fails.

## Performance

Everything runs client-side. Each clock change re-runs a handful of Ed25519/HMAC verifications — well under a millisecond of real work per panel — so dragging the slider updates all six panels smoothly. No idle or decorative animation; the only motion is the step-through verifier, tied to a button.

---

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
