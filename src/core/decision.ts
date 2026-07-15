/**
 * The lab-wide result shape. DESIGN INVARIANT (embodied, not just described):
 * the cryptographic result and the security verdict are SEPARATE fields that
 * the UI renders as separate indicators. There is deliberately no combined
 * "ok" boolean on this type — collapsing "the math checked" and "the request
 * should be accepted" into one flag is exactly the confusion this lab teaches
 * against.
 */

export interface CryptoCheck {
  /** Raw cryptographic result. NEVER drives verdict styling on its own. */
  ok: boolean;
  /** e.g. "Ed25519 signature over TBSCertificate" */
  label: string;
  /** Real intermediate data (hex prefixes, compared values). */
  detail: string;
}

export interface PolicyCheck {
  name: string;
  pass: boolean;
  /** The actual comparison performed, with real numbers. */
  detail: string;
}

export interface Decision {
  crypto: CryptoCheck[];
  policy: PolicyCheck[];
  /** accept ⇔ every crypto check AND every policy check passed (fail closed). */
  verdict: 'accept' | 'reject';
  reason: string;
}

/** Fail-closed combinator: any failed check anywhere rejects. */
export function decide(crypto: CryptoCheck[], policy: PolicyCheck[]): Decision {
  const badCrypto = crypto.find((c) => !c.ok);
  const badPolicy = policy.find((p) => !p.pass);
  const verdict = badCrypto || badPolicy ? 'reject' : 'accept';
  const reason = badCrypto
    ? `cryptographic check failed: ${badCrypto.label}`
    : badPolicy
      ? `policy check failed: ${badPolicy.name}`
      : 'all checks passed';
  return { crypto, policy, verdict, reason };
}
