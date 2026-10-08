// CI-only selection: ordinary npm test keeps the complete local/release gates.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';

const mode = process.argv[2];
if (!['required', 'known'].includes(mode)) throw new Error('Use required or known');
const exceptions = JSON.parse(readFileSync('.github/ci-test-exceptions.json', 'utf8'));
const files = readdirSync('tests').filter(file => file.endsWith('.test.ts')).map(file => `tests/${file}`).sort();
const unavailable = new Set(exceptions.unavailableFiles.map(entry => entry.file));
const knownFiles = new Set(exceptions.knownFailures.map(entry => entry.file));
const platformTests = exceptions.platformTests.filter(entry => entry.platforms.includes(process.platform));
const selected = files.filter(file => !unavailable.has(file) && (mode === 'required' || knownFiles.has(file)));
if (mode === 'known' && selected.length === 0) {
  // Without explicit files, node --test discovers the entire repository.
  const message = '### Unit tests (known)\nNo known failures remain; no baseline tests to run.\n';
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
  process.exit(0);
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Node matches both leaf names and suite-qualified names. Only exact recorded
// leaf names are exempt; another failing test in the same file still blocks CI.
const pattern = entries => `(?:^| )(?:(?:${entries.map(entry => escape(entry.name)).join(')|(?:')}))$`;
const args = ['--test', '--test-concurrency=1'];
if (mode === 'required') {
  args.push(`--test-skip-pattern=${pattern([...exceptions.knownFailures, ...exceptions.vendorTests, ...platformTests])}`);
} else {
  args.push(`--test-name-pattern=${pattern(exceptions.knownFailures)}`);
}
// macOS /var and /tmp are symlinks. Private storage and Node's permission
// model require canonical paths, including for isolated child fixtures.
// Windows' default TEMP uses RUNNER~1; RUNNER_TEMP is on the checkout's D:
// drive. Use a fresh full path on the system drive so the C: versus D:
// isolation fixture is actually exercised as well as the realpath contract.
const tempBase = process.platform === 'win32'
  ? parse(process.env.SystemRoot || 'C:\\Windows').root
  : realpathSync(process.env.RUNNER_TEMP || tmpdir());
const temp = mkdtempSync(join(tempBase, 'weftmate-ci-'));
const env = { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp };
const lines = [
  `### Unit tests (${mode})`,
  `${selected.length} test files; isolated canonical temp: ${temp}.`,
];
if (mode === 'required') {
  lines.push('', 'The following checks are explicitly **not verified** on clean CI runners:',
    '- `vendor:dsh`, `vendor:verify`, and `test:contract`: vendor requires a separately prebuilt DSH checkout; fetching source alone does not provide it.',
    ...exceptions.unavailableFiles.map(entry => `- File \`${entry.file}\`: ${entry.reason}`),
    ...exceptions.vendorTests.map(entry => `- \`${entry.file}\` / ${entry.name}: ${entry.reason}`),
    ...platformTests.map(entry => `- \`${entry.file}\` / ${entry.name}: ${entry.reason}`),
    '', `Known main failures: ${exceptions.knownFailures.length} (any entries run separately as a non-blocking step):`,
    ...exceptions.knownFailures.map(entry => `- \`${entry.file}\` / ${entry.name}: ${entry.reason}`));
}
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
const result = spawnSync(process.execPath, [...args, ...selected], { env, stdio: 'inherit' });
if (result.error) throw result.error;
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `\n${mode === 'required' ? 'Required gate' : 'Non-blocking baseline observation'} exit status: **${result.status ?? 'terminated'}**. See this step's test log for pass/fail counts and assertions.\n`);
}
process.exitCode = result.status ?? 1;
