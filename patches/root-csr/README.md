# Pinned CSR parser fix (#482)

`patch.json` patches `@root/csr@0.8.1` and its locked `@root/asn1@1.0.2`
dependency. `npm ci` / `npm install` runs `scripts/patch-root-csr.mjs` through
the root `postinstall` hook. No new package is added; the lockfile only records
the install hook. Production packages carry the patched dependency files.

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
Update the lockfile, these hashes and the behavioral tests together when
upgrading either dependency. An installation using `--ignore-scripts` must
explicitly run `node scripts/patch-root-csr.mjs` before testing or packaging.

`services/cloud/test/host-csr.test.mjs` exercises real ACME.js with synthetic
responses and scalar 111, verifies every one of 10,000 random P-256 CSRs with
OpenSSL (key, CN/SAN and signature), covers leading-zero coordinates and RSA,
and checks daily recovery from the legacy failure across a manager restart.
The S2b workflow runs this suite alongside the existing Pebble DNS-01 scenarios.
Upstream source is MPL-2.0; the patch preserves its notices and license.
