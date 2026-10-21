import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runManagedTestProcess } from './helpers/managed-test-process.mjs';
import { managedMkdtempSync, disposeManagedTemp as disposeOwnedTemp } from './helpers/managed-temp.mjs';

test('new chat leaves fixed pages with empty and existing history using production HTTP assets in Chromium', { timeout: 180000 }, async t => {
  const scope = managedMkdtempSync('weftmate-empty-chat-navigation-', { prune: false });
  const output = process.env.WEFTMATE_EVIDENCE_DIR
    ? join(resolve(process.env.WEFTMATE_EVIDENCE_DIR), `browser-wrapper-${randomUUID()}`) : join(scope, 'evidence');
  const executablePath = chromium.executablePath();
  const script = fileURLToPath(new URL('./integration/empty-chat-navigation.mjs', import.meta.url));
  const env = { ...process.env, WEFTMATE_EVIDENCE_DIR: output, WEFTMATE_CHROMIUM_EXECUTABLE_PATH: executablePath,
    TEMP: scope, TMP: scope, TMPDIR: scope, WEFTMATE_TEST_HOST_NAME: 'synthetic-empty-chat' };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const result = await runManagedTestProcess(process.execPath, [script, '--browser-only', '--owned-scope', scope], {
      env, commandRoots: [scope], executables: [process.execPath, executablePath], timeoutMs: 150000, maxBuffer: 2 * 1024 * 1024,
    });
    const reportFile = join(output, 'report.json');
    const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;
    const detail = [result.stdout, result.stderr, report?.failure, JSON.stringify(report?.observations ?? [])].filter(Boolean).join('\n');
    assert.ifError(result.error);
    assert.equal(result.timedOut, false, detail);
    assert.equal(result.signal, null, detail);
    assert.equal(result.status, 0, detail);
    assert.match(result.stdout, /EMPTY_CHAT_NAVIGATION_PASS/, detail);
    assert.equal(report?.renderer, 'Chromium');
    assert.equal(report?.passed, true, detail);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.operations, [], 'navigation never creates a server session or invokes inference');
    const initial = report.observations.find((row: any) => row.label === 'initial-empty-chat');
    const actual = report.observations.find((row: any) => row.label === 'new-chat-after-library');
    assert.equal(initial.sessions, 0, 'this is the actual zero-session user flow');
    assert.equal(actual.title, '新对话');
    assert.equal(actual.libraryHidden, true);
    assert.equal(actual.conversationHidden, false);
    assert.equal(report.cases.length, 16, 'both history states, themes and four fixed pages execute');
    assert.ok(report.cases.every((row: any) => row.passed));
    assert.deepEqual([...new Set(report.cases.map((row: any) => row.history))].sort(), ['empty', 'existing']);
    assert.deepEqual([...new Set(report.cases.map((row: any) => row.theme))].sort(), ['dark', 'light']);
    assert.equal(report.seedOperations.length, 1, 'only the explicit existing-history fixture creates a session');
    t.diagnostic(`Chromium navigation evidence: ${output}`);
  } finally {
    disposeOwnedTemp(scope);
  }
});
