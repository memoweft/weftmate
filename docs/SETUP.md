# 开发环境与运行

旧版（含历史候选环境说明）见 `archive/2026-10-07/SETUP.md`。

## 依赖

- Node 24；`npm ci` 安装依赖。
- `vendor/dsh-runtime` 是受忽略的生成依赖：独立克隆后运行 `npm run vendor:dsh`（需要 pnpm），再用 `npm run vendor:verify` 核对。DSH 版本固定，不自动升级，见 [DSH_UPGRADE_POLICY](DSH_UPGRADE_POLICY.md)。
- 共享 DSH 源码在工作区 `Shared/Dependencies/DeepSeekHarness`（带本地修改）。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm start` | 启动 Electron 桌面应用 |
| `node scripts/run-personal-host.mjs` | 启动个人宿主（`/personal/v1`）；`--user-data-dir` 复用已有账户数据，`--access-port` 指定端口 |
| `npm run typecheck` | 类型检查 |
| `npm run test:unit` | 单元测试（`tests/*.test.ts`） |
| `npm run test:contract` | 契约测试 |
| `npm run dist:win` | 打 Windows 安装包 |

## 各端

- Android：[apps/android/README](../apps/android/README.md)
- Apple（macOS / iOS / watchOS）：[apps/apple/README](../apps/apple/README.md)
- 设备与验证环境：[DEVELOPMENT_ENVIRONMENT](DEVELOPMENT_ENVIRONMENT.md)

## GitHub CI

三平台使用 Node 24 和锁文件安装；生产发布预检、完整依赖高危审计、依赖兼容冒烟、类型检查与必过单测都阻塞合入。普通 `npm test` 仍保留完整单测与 vendor 契约门。

- `.github/scripts/ci-unit-tests.mjs required` 运行必过用例；`known` 单独观察 13 项主干失败（PR #20 的 11 项，以及 CI-1 在未改动 main 上复现的停止回执重试、图片消息原请求重试两项）。该观察步骤非阻塞，同文件里的其他用例仍必须通过。
- 精确文件/用例、原因与追踪项见 [CI 例外清单](../.github/ci-test-exceptions.json)，每次运行也写入 Actions 摘要；不自动把新失败加入清单。
- Linux/macOS 测试目录使用规范化的 `RUNNER_TEMP`；Windows 在系统盘 C: 创建新的完整路径，避开 `RUNNER~1` 短路径并保留 C: 夹具与 D: 仓库的跨盘断言。macOS runner 为合成 HTTP 夹具配置 `127.0.0.2` 回环别名；Linux 使用 Xvfb，并在 Electron 延迟下载完成后配置 `chrome-sandbox` 的 root 属主与 4755 权限。
- `vendor:dsh`、`vendor:verify`、`test:contract` 明确显示为跳过；103 个依赖 vendor 的单测用例及 3 个文件也不验证，另有 1 个文件顶层读取仓库外 `Design`。固定 DSH 来源可以获取，但无所需 `lib/dist`；vendor 脚本只消费外部已编译 checkout，不负责构建。恢复条件：提供与 pin 一致的可重复编译产物，再恢复 workflow 的三个步骤并移除相应例外；发布前仍须在完整环境运行这些门。
- Windows 继续验证进程树清理及 Windows 绝对路径夹具；Linux/macOS 明确跳过这两项。外部平台 optional 包夹具只在非 Linux 验证。POSIX 进程树清理与可移植夹具路径列为后续项。

## 本机数据

账户、会话、模型配置、凭据和运行日志都在仓库外的 `D:\AIProjects\WeftMate\Runtime`（或启动参数指定的数据目录），不进 Git。测试使用隔离的数据目录和测试账号，不碰日用数据。

## 本地模型

日用主力是本地 Qwen3.8 27B（OpenAI 兼容接口）。统一的启动方式与健康检查由 PLAN M0-6 确定后写在这里。
