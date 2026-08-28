#!/usr/bin/env node
/**
 * electron-builder-feed.mjs — R5 内部更新 feed 构建（Windows NSIS + generic provider latest.yml）。
 *
 * 为什么不用 package.json 里直接配 publish：publish 配置会改变 dist:win 的默认行为
 * （打包进 app-update.yml、默认 onTagOrDraft 上传）；正式渠道 URL 未定（§7.11 公开时机后定），
 * 内部 feed 的 URL 只在构建时以 WEFTMATE_UPDATE_URL 注入。本脚本在构建期合成完整配置
 * （package.json build 字段 + publish 覆写），跑 electron-builder --win --publish never：
 *   - --publish never：只生成 latest.yml + blockmap，绝不上传；
 *   - 产物 staging：dist/feed/{latest.yml, <installer>.exe, <installer>.exe.blockmap}。
 *
 * 用法（先 vendor:dsh + stage-dsh-runtime）：
 *   $env:WEFTMATE_UPDATE_URL='http://127.0.0.1:9000/feed'  # 缺省同此值
 *   node scripts/electron-builder-feed.mjs
 *
 * 内部验证：起一个静态服务把 dist/feed 供出去（如 `npx http-server dist/feed -p 9000`），
 * 已装包以 WEFTMATE_UPDATE_FEED=<url> 或打包内 app-update.yml 指向该 feed（src/update.ts 接缝）。
 * 签名与 dist:win 同管线（CSC_LINK/CSC_KEY_PASSWORD）。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const feedUrl = process.env.WEFTMATE_UPDATE_URL || 'http://127.0.0.1:9000/feed'

const config = { ...pkg.build, publish: { provider: 'generic', url: feedUrl } }
const configPath = join(repoRoot, '.stage', 'electron-builder.feed.json')
mkdirSync(dirname(configPath), { recursive: true })
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

const builderCli = join(repoRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
if (!existsSync(builderCli)) {
  console.error('[feed-build] 缺 electron-builder 编译产物 —— 先 npm install')
  process.exit(1)
}

console.log(`[feed-build] publish: generic @ ${feedUrl}（--publish never，只生成 latest.yml 不上传）`)
const result = spawnSync(process.execPath, [builderCli, '--win', '--publish', 'never', '--config', configPath], {
  cwd: repoRoot,
  stdio: 'inherit',
})
if (result.status !== 0) {
  console.error(`[feed-build] electron-builder 失败（exit ${result.status}）`)
  process.exit(result.status ?? 1)
}

const artifactName = pkg.build?.nsis?.artifactName ?? 'WeftMate-Setup-${version}.${ext}'
const exeName = artifactName.replaceAll('${version}', pkg.version).replaceAll('${ext}', 'exe')
const installer = join(repoRoot, 'dist', exeName)
const latestYml = join(repoRoot, 'dist', 'latest.yml')
if (!existsSync(latestYml) || !existsSync(installer)) {
  console.error('[feed-build] 缺 latest.yml 或安装包 —— publish 覆写未生效？')
  process.exit(1)
}

// staging：dist/feed/ = 静态 feed 根（latest.yml + 安装包 + blockmap）。
const feedDir = join(repoRoot, 'dist', 'feed')
rmSync(feedDir, { recursive: true, force: true })
mkdirSync(feedDir, { recursive: true })
for (const file of ['latest.yml', exeName, `${exeName}.blockmap`]) {
  const src = join(repoRoot, 'dist', file)
  if (existsSync(src)) cpSync(src, join(feedDir, file))
}
const latest = readFileSync(latestYml, 'utf8')
console.log(`[feed-build] feed 已暂存 → dist/feed/（${exeName} + latest.yml + blockmap）`)
console.log(`[feed-build] latest.yml:\n${latest.trimEnd()}`)
