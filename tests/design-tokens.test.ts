import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
test('design token outputs match the sole source without writing files', () => {
  execFileSync(process.execPath, ['scripts/generate-tokens.mjs', '--check'], { cwd: root });
});
test('every authored desktop/mobile token reference exists in its generated CSS', () => {
  for (const [directory, files] of [
    ['src/personal-access-ui', ['styles.css', 'native-desktop.css']],
    ['apps/mobile-ui/www', ['styles.css']],
  ] as const) {
    const generated = readFileSync(resolve(root, directory, 'tokens.css'), 'utf8');
    const names = new Set([...generated.matchAll(/(--wm-[\w-]+)\s*:/g)].map(m => m[1]));
    for (const file of files) {
      const css = readFileSync(resolve(root, directory, file), 'utf8');
      for (const [, name] of css.matchAll(/var\((--wm-[\w-]+)/g)) assert.ok(names.has(name), `${file}: ${name}`);
      assert.doesNotMatch(css, /var\(--var\(/);
    }
  }
});


test('Apple views consume generated typed tokens compiled by all three native targets', () => {
  const relativeSource = '../../design/tokens/generated/apple/DesignTokens.swift';
  const generated = readFileSync(resolve(root, 'design/tokens/generated/apple/DesignTokens.swift'), 'utf8');
  const groups = new Map([...generated.matchAll(/    public enum (\w+) \{([\s\S]*?)\n    \}/g)]
    .map(([, group, body]) => [group, new Set([...body.matchAll(/public static let (\w+)/g)].map(m => m[1]))]));
  for (const directory of ['UI', 'iOS', 'macOS', 'watchOS']) {
    for (const file of readdirSync(resolve(root, 'apps/apple', directory)).filter(f => f.endsWith('.swift'))) {
      const source = readFileSync(resolve(root, 'apps/apple', directory, file), 'utf8');
      for (const [, group, name] of source.matchAll(/AppleTokens\.(\w+)\.(\w+)/g)) {
        assert.ok(groups.get(group)?.has(name), `${directory}/${file}: missing ${group}.${name}`);
      }
      if (directory !== 'watchOS') {
        assert.doesNotMatch(source, /(?:spacing:|cornerRadius:|duration:)\s*\d/);
        assert.doesNotMatch(source, /\.padding\((?:\.\w+,\s*)?\d|\.lineSpacing\(\d/);
        assert.doesNotMatch(source, /\.font\(\.(?:body|caption|callout|title|headline|footnote|subheadline)/);
      }
    }
  }
  const project = readFileSync(resolve(root, 'apps/apple/WeftMate.xcodeproj/project.pbxproj'), 'utf8');
  assert.ok(project.includes(relativeSource));
  // The same generated file must appear in each application's compile phase.
  const generator = readFileSync(resolve(root, 'apps/apple/Scripts/generate_project.py'), 'utf8');
  for (const target of ['WeftMateMac', 'WeftMatePhone', 'WeftMateWatch']) {
    const declaration = generator.split('\n').find(line => line.startsWith(`target("${target}",`));
    assert.ok(declaration?.includes(relativeSource), `${target} does not compile generated tokens`);
  }
});
