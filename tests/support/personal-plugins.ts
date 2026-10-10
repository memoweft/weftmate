import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const vendorRequire = createRequire(join(repository, 'vendor/dsh-runtime/package.json'))

/** Actual module syntax: static imports, re-exports and literal dynamic imports. */
export function moduleSpecifiers(source: string) {
  const parsed = ts.createSourceFile('fixture.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const literals: ts.StringLiteralLike[] = []
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) literals.push(node.moduleSpecifier)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) literals.push(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return literals.map(node => ({ name: node.text, start: node.getStart(parsed), end: node.end }))
}

/** Stage the complete relative-import graph against one installed DSH instance. */
export function stagePersonalPlugins(root: string, packageResolver = (name: string, source: string) =>
  name.startsWith('@deepseek-ai/') ? vendorRequire.resolve(name) : createRequire(source).resolve(name)) {
  const files = new Map<string, string>()
  function stage(sourcePath: string): string {
    sourcePath = resolve(sourcePath)
    const existing = files.get(sourcePath)
    if (existing) return existing
    const target = join(root, relative(repository, sourcePath))
    files.set(sourcePath, target) // Cycles share the same staged module.
    let source = readFileSync(sourcePath, 'utf8')
    for (const specifier of moduleSpecifiers(source).reverse()) {
      let destination: string | undefined
      if (specifier.name.startsWith('.')) destination = stage(resolve(dirname(sourcePath), specifier.name))
      else if (!specifier.name.startsWith('node:') && !specifier.name.includes(':')) destination = packageResolver(specifier.name, sourcePath)
      if (destination) source = source.slice(0, specifier.start) + JSON.stringify(pathToFileURL(destination).href) + source.slice(specifier.end)
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, source)
    return target
  }
  const plugin = stage(join(repository, 'src/plugins/weftmate-personal-desktop.mjs'))
  const preset = stage(join(repository, 'src/plugins/weftmate-personal-desktop-preset.mjs'))
  return { plugin: pathToFileURL(plugin).href, preset: pathToFileURL(preset).href, files }
}
