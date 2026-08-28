// M5-01 打包暂存：vendor/dsh-runtime → .stage/dsh-runtime（去 tarballs）。
// 为什么需要暂存：electron-builder 的 filter.js 硬编码丢弃 extraResources 根目录下的 node_modules
// （relative === "node_modules" → return false），直接把 vendor/dsh-runtime 当 from 会丢整个运行时闭包。
// 包一层父目录后 node_modules 变成子路径（dsh-runtime/node_modules），按普通文件树复制。
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const runtime = 'vendor/dsh-runtime'
const stage = '.stage/dsh-runtime'

if (!existsSync(`${runtime}/VENDOR-MANIFEST.json`)) {
  console.error('[stage-dsh-runtime] 缺 vendor/dsh-runtime —— 先跑 npm run vendor:dsh')
  process.exit(1)
}

await rm('.stage', { recursive: true, force: true })
await mkdir('.stage', { recursive: true })
// hoisted 布局下全是真实目录（无 junction），fs.cp 递归复制即可；tarballs 是构建产物不进安装包。
await cp(runtime, stage, {
  recursive: true,
  dereference: false,
  filter: (src) => !src.replaceAll('\\', '/').includes('/tarballs'),
})
console.log('[stage-dsh-runtime] 已暂存 → .stage/dsh-runtime')
