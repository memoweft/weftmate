# WeftMate × DSH 契约测试（M0 ①）

把内嵌可行性探针 B/C 固化为 weftmate 内可重复运行的契约测试，锁定 DSH 公开接口。
升级 DSH 前先跑本套契约，以确认 pin、checkout 与 vendor 形态没有漂移。

> R4 退役（docs/ARCHITECTURE.md §4）：锁 v2 SDK 运行时语义的探针 B/C 契约（SDK client 事件流、
> memoweft 插件挂载）随旧运行时删除；本套契约现在只锁**官方 web 基座**两条事实：
> ① web profile 组合基线（沙箱/审批/权限预设/官方宿主与客户端清单）；② mock LLM 聊天链路。

## 前提

- Node ≥ 24（weftmate 现行测试链即 Node 24 原生 type-stripping；DSH 要求 `^22.19 || >=24`）。
- 一个与 pin 一致的 DSH checkout：`tests/contract/dsh-pin.json` 记录 repo / 版本 / 精确 commit。
  测试启动时校验（版本 + HEAD commit + `node_modules/tsx`），不一致即失败并给出指引。
- checkout 需先 `pnpm install`（契约测试借用其中的 tsx 与 workspace 链接），且**未改动其源码**（红线）。

checkout 定位顺序：环境变量 `WEFTMATE_DSH_CHECKOUT` → `D:/AIProjects/Shared/Dependencies/DeepSeekHarness` → `~/deepseek-harness` → `../deepseek-harness`。

## 运行

```bash
npm run test:contract      # 只跑本套契约（checkout 形态）
npm test                   # 全量测试（含本套契约，tests/**/*.test.ts 会一并匹配）
```

**两种运行时来源**（同一套断言锁两种形态，`docs/VENDOR-PACKAGING.md` §2 D5）：

- **checkout 形态**（默认）：checkout 的官方 CLI（`apps/cli/lib/bin.js`）+ 官方前端 dist；
- **vendor 形态**（发货验证）：先 `npm run vendor:dsh` 生成 `vendor/dsh-runtime`，再：

```powershell
$env:WEFTMATE_DSH_RUNTIME='D:\AIProjects\WeftMate\Repository\vendor\dsh-runtime'
npm run test:contract
```

vendor 形态下组合基线用 vendored 编译产物跑通；**mock LLM 链路契约在 vendor 形态 skip**
（vendor 闭包无 dsh-llm-replay/test-support 包，mock LLM 链路只在 checkout 形态可运行）。

**CI（M5-02）**：GitHub Actions 在干净 runner 上先 `npm run vendor:dsh` + `vendor:verify`，再以
`WEFTMATE_DSH_RUNTIME=$GITHUB_WORKSPACE/vendor/dsh-runtime` 跑 `npm test`——vendor 形态下不需要本机
checkout，pin 一致性由 `resolveRuntimeRoot` 校验 VENDOR-MANIFEST.json 的版本/commit（不符即失败，
先重跑 vendor 管道）。checkout 形态契约用于本地开发与 DSH 升级校验。

## 场景

| 场景 | 文件 | 锁定的公开接口 |
|---|---|---|
| W1 组合基线 | `dsh-web-profile.test.ts` | weftmate profile = dsh-base + dsh-web-app 两层 bundle patch + 补丁层；沙箱基线（workspace-write 默认、workspaceRoot=子进程 cwd）、审批基线、权限预设三档、web 宿主行、官方客户端插件清单（dsh.client 行）、agent-presets 挂载面 |
| W2 聊天链路 | `dsh-web-chat-contract.test.ts` | in-process boot + mock LLM 下 session.create、事件流形状（turn/start→step→user/message→assistant/message→tool/call→tool/result→turn/end）、session.jsonl.zstd 落盘、replay 全量消费、fiber 干净收口 exit 0（checkout 形态） |

## 机制与隔离（红线对齐）

- **不碰运行中的 DSH_HOME**：子进程 `DSH_HOME` 一律指向当次运行目录下的隔离 home（`os.tmpdir` 下，不进仓库）。
- **凭据绝不带进测试**：子进程环境删除 `*_API_KEY` / `*_API_TOKEN` / `*_API_SECRET`。
- **不 vendor 源码、不建 sibling 依赖**：测试只 spawn checkout/vendored 的官方 CLI；weftmate 的 `package.json` 不新增任何 DSH sibling 依赖。
- **不改 DSH 源码**（红线）：只读 checkout 的编译产物与公开接口。

## 已知坑（探针报告记录，测试内已处理）

1. **Windows 绝对路径 specifier**：loader 以 CJS require 加载 TS 时，插件内引外部 TS 必须用
   `D:/…/` 形态的绝对路径（v2 探针 C 的记录；R4 退役后 weftmate 自有插件已全部是 .mjs/.js，不再涉此坑）。
2. **严格 YAML**：cordis.yml 不支持 `//` 注释（v2 探针 B2 曾利用这一点做确定性 boot 失败）。
3. **pin 是 commit 不是 tag**：上游仓库没有 git tag（`ls-remote --tags` 为 0），版本号取自 checkout 根 `package.json`。

## 升级 DSH（owner 触发，见 `docs/VENDOR-PACKAGING.md` §8）

1. 更新 `dsh-pin.json` 的 `packageVersion` / `commit`；
2. `npm run test:contract` 全绿（失败即视为上游破坏性变更，先修 weftmate 适配再继续）；
3. 重跑 `npm run typecheck` 与 `npm test`，再走 vendor 管道与真机 Dogfood。
