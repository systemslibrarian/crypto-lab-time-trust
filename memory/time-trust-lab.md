---
name: time-trust-lab
description: Time Trust crypto-lab demo — what it teaches and its key design invariant
metadata:
  type: project
---

`crypto-lab-time-trust` is a Crypto Lab demo (Vite + TS, static, Pages) teaching that **time is an unauthenticated input to authenticated systems**. One master clock slider drives six panels of real Ed25519/HMAC verification: X.509 validity (RFC 5280), JWT exp/nbf (RFC 7519), TOTP (RFC 6238), signed-URL expiry, Kerberos-style replay freshness (RFC 4120), distributed multi-node token.

**Load-bearing design invariant:** cryptographic result and security verdict are SEPARATE, independently-rendered indicators (`src/core/decision.ts` has no combined `ok` boolean; `src/ui/verdict.ts` renders math chip + verdict chip + integrity line). A valid-signature-but-wrong-decision renders as ALARM (integrity line is the only strongly-colored element, tracks system integrity vs the true clock — not the raw return value). The break-it path (roll a *server* clock back on an expired signed URL) runs against the real verifier.

**Precision guard:** consequences are strictly "bypass time-based acceptance," never key/secret recovery — stated verbatim in README "Precision note" and TOTP scope note.

99 unit tests, 42 spec KATs. a11y gated both themes. Sibling: Chain of Trust owns full path validation (this cert panel is validity-dates only).
