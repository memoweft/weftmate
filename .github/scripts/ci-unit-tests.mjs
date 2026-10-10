// CI-only selection: ordinary npm test keeps the complete local/release gates.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';

const mode = process.argv[2];
if (!['required', 'known', 'vendor'].includes(mode)) throw new Error('Use required, known or vendor');
const exceptions = JSON.parse(readFileSync('.github/ci-test-exceptions.json', 'utf8'));
// A separately blocking suite, not an exception: runs in pinned-vendor CI and nightly.
const suite = JSON.parse(readFileSync('.github/vendor-test-suite.json', 'utf8'));
const vendorFiles = new Set([...suite.tests.map(entry => entry.file), ...suite.files]);
const vendorReady = existsSync('vendor/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js');
if (mode === 'vendor') {
  if (!vendorReady) throw new Error('vendor mode requires a prebuilt pinned vendor/dsh-runtime; run npm run vendor:dsh with WEFTMATE_DSH_CHECKOUT set to a compiled pinned checkout.');
  const manifest = JSON.parse(readFileSync('vendor/dsh-runtime/VENDOR-MANIFEST.json', 'utf8'));
  const pin = JSON.parse(readFileSync('tests/contract/dsh-pin.json', 'utf8'));
  if (manifest.dsh.commit !== pin.commit) throw new Error('vendor mode requires the production DSH pin; vendor manifest does not match tests/contract/dsh-pin.json.');
}
if (mode === 'required' && vendorReady) console.log(`还有 ${suite.tests.length} 条 vendor 测试及 ${suite.files.length} 个完整文件，请另跑 vendor 模式：node .github/scripts/ci-unit-tests.mjs vendor`);
const files = readdirSync('tests').filter(file => file.endsWith('.test.ts')).map(file => `tests/${file}`).sort();
const unavailable = new Set(exceptions.unavailableFiles.map(entry => entry.file));
const knownFiles = new Set(exceptions.knownFailures.map(entry => entry.file));
const platformTests = exceptions.platformTests.filter(entry => entry.platforms.includes(process.platform));
const selected = files.filter(file => !unavailable.has(file) && (mode === 'vendor' ? vendorFiles.has(file) : !suite.files.includes(file) && (mode === 'required' || knownFiles.has(file))));
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
  const excluded = [...exceptions.knownFailures, ...suite.tests, ...platformTests];
  if (excluded.length) args.push(`--test-skip-pattern=${pattern(excluded)}`);
} else if (mode === 'known') {
  args.push(`--test-name-pattern=${pattern(exceptions.knownFailures)}`);
}
// Vendor runs complete files: independent sibling tests remain covered too.
args.push('--test-reporter=tap');
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
    '- `vendor:dsh` and `vendor:verify` run in the pinned-vendor job; the full `test:contract` release gate still requires its own compiled DSH checkout.',
    ...exceptions.unavailableFiles.map(entry => `- File \`${entry.file}\`: ${entry.reason}`),
    `- ${suite.tests.length} vendor integration tests and ${suite.files.length} complete files run in the separate blocking vendor job and nightly, using .github/vendor-test-suite.json.`,
    ...platformTests.map(entry => `- \`${entry.file}\` / ${entry.name}: ${entry.reason}`),
    '', `Known main failures: ${exceptions.knownFailures.length} (any entries run separately as a non-blocking step):`,
    ...exceptions.knownFailures.map(entry => `- \`${entry.file}\` / ${entry.name}: ${entry.reason}`));
}
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
const result = spawnSync(process.execPath, [...args, ...selected], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const output = (result.stdout || '') + (result.stderr || '');
process.stdout.write(output);
const count = name => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(output)?.[1] || 0);
const summary = { mode, files: selected.length, exitCode: result.status ?? 1, passed: count('pass'), failed: count('fail'), skipped: count('skipped'), failures: [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(match => match[1]) };
console.log(`Test result: ${JSON.stringify(summary)}`);
const reportIndex = process.argv.indexOf('--report');
if (reportIndex >= 0) writeFileSync(process.argv[reportIndex + 1], JSON.stringify(summary, null, 2) + '\n');
rmSync(temp, { recursive: true, force: true });
if (result.error) throw result.error;
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `\n${mode === 'known' ? 'Non-blocking baseline observation' : 'Required gate'} exit status: **${result.status ?? 'terminated'}**. Passed: ${summary.passed}; failed: ${summary.failed}; skipped: ${summary.skipped}.\n${summary.failures.map(name => `- FAILED: ${name}`).join('\n')}\n`);
}
process.exitCode = result.status ?? 1;
