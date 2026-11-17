/* What "audited" covers for the @noble/curves this lab ships.
 *
 * src/crypto/ed25519.ts introduced it as "a small, audited, pure-JS library",
 * with no version. The library records its latest independent audit as "at
 * version 2.3.0, in Aug 2026, by [Trail of Bits]", scope "everything"; this lab
 * pins ^2.4.0, one release past it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const flat = (text: string) => text.replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ');

const nobleReadme = read('../../node_modules/@noble/curves/README.md');
const source = read('./ed25519.ts');
const pkg = JSON.parse(read('../../package.json'));

describe('the @noble/curves audit claim', () => {
  it('pins a version later than the latest audit the library records', () => {
    expect(pkg.dependencies['@noble/curves']).toBe('^2.4.0');
    expect(nobleReadme).toContain('The library has been audited');
    expect(nobleReadme).toMatch(/at version 2\.3\.0, in Aug 2026, by \[Trail of Bits\]/);
    expect(nobleReadme).not.toMatch(/at version 2\.4\.\d+, in [A-Z]/);
  });

  it('states that version where the library is introduced', () => {
    expect(flat(source)).not.toContain('a small, audited, pure-JS library');
    expect(flat(source)).toContain('at version 2.3.0, in Aug 2026, by [Trail of Bits]');
    expect(flat(source)).toContain('the pin here is ^2.4.0');
  });
});
