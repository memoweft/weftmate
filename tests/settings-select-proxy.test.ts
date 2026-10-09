import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Regression guards for the shared select proxy (UX-1 review, QA2-02).
for (const file of ['src/personal-access-ui/popovers.js', 'apps/mobile-ui/www/popovers.js']) {
  test(`${file}: hidden source selects never get a visible proxy`, async () => {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const bind = source.slice(source.indexOf('function bindSettingsSelect'));
    assert.ok(bind.indexOf('if (select.hidden) return;') > -1, 'hidden selects are skipped');
    assert.ok(bind.indexOf('if (select.hidden) return;') < bind.indexOf("document.createElement('button')"), 'skip happens before any proxy is created');
  });
  test(`${file}: closing a proxy menu tolerates WebViews without :popover-open`, async () => {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const bind = source.slice(source.indexOf('function bindSettingsSelect'));
    const close = bind.slice(bind.indexOf('const close = (focus = false)'));
    assert.match(close.slice(0, 300), /popoverOpen\(\)/);
    assert.match(source, /try \{ return menu\.matches\(':popover-open'\); \} catch \{ return false; \}/);
  });
}
