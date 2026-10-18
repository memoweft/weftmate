# Pinned CSR parser fix (#482)

[`csr-patch.json`](../../src/personal-relay/csr-patch.json) patches `@root/csr@0.8.1` and its locked `@root/asn1@1.0.2`
dependency. `npm ci` / `npm install` runs `scripts/patch-root-csr.mjs` through
the root `postinstall` hook. No new package is added; the lockfile only records
the install hook. Production packages carry the patched dependency files.
The shared `beforePack` hook in `scripts/release/installer-assets.cjs` also
explicitly applies and verifies the patch for every platform and builder entry,
including direct electron-builder calls and `npmRebuild: false`. Old installs
and `--ignore-scripts` installs therefore cannot bypass the build step.

The ASN.1 parser guesses whether primitive BIT STRINGs contain nested DER.
Some uncompressed EC points happen to satisfy that guess, so it deletes the
raw value that `CSR._info` needs. The patch lets the caller specify opaque
values by schema position: PKCS#10 `CertificationRequestInfo` (0), SPKI (2),
`subjectPublicKey` (1). Only this value bypasses heuristic recursion. Other
callers retain the existing parser behavior. RSA's inner public-key sequence
is then decoded explicitly. EC coordinates retain their fixed width, including
leading zero octets; the original decoder incorrectly stripped those zeros.
CSR generation, signing, the content key and RFC8555 requests stay the same.

The installer checks package versions, complete upstream/patched SHA256 hashes
and unique replacement sites before writing. It is idempotent and rejects
unknown source, version drift or a nested CSR/parser copy used by ACME.js.
`verifyWindowsPackage()` reads the actual CSR/parser bytes and package versions
from `app.asar` (or its unpacked files) and compares their complete hashes with
the checker's trusted source manifest. Missing, unpatched, altered or nested
copies fail the audit. The archive cannot supply its own expected hashes.

Before the host first generates a CSR, `csr-integrity.mjs` checks the resolved
ACME.js/CSR/parser copies, versions and full hashes once. It throws
`CSR_PATCH_INVALID` on failure, without repairing files or falling back.
The production `services/cloud` process only serves DNS/relay operations; it
does not import ACME.js or the CSR library. Host issuance on Windows or Linux
uses the same guard; cloud integration tests that invoke host issuance do too.

When upgrading either dependency, the build fails on a version or hash mismatch
and asks to re-evaluate the patch. Check whether upstream has absorbed the fix;
then remove the obsolete patch or regenerate it, update the locked versions,
original/patched hashes and behavior tests together. Do not accept a new hash
without that review. `--ignore-scripts` development installs must explicitly
run `node scripts/patch-root-csr.mjs`; packaging always does this itself.

`services/cloud/test/host-csr.test.mjs` exercises real ACME.js with synthetic
responses and scalar 111, verifies every one of 10,000 random P-256 CSRs with
OpenSSL (key, CN/SAN and signature), covers leading-zero coordinates and RSA,
and checks daily recovery from the legacy failure across a manager restart.
The S2b workflow runs this suite alongside the existing Pebble DNS-01 scenarios.
`tests/csr-integrity.test.ts` and `tests/verify-windows-package.test.ts` exercise
build repair/refusal, first-use refusal, and actual packed/unpacked bytes.
The upstream P-384 signature algorithm mismatch is tracked separately in
[#485](https://github.com/memoweft/weftmate/issues/485); the product uses P-256.
Upstream source is MPL-2.0; the patch preserves its notices and license.
