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

## 本机数据

账户、会话、模型配置、凭据和运行日志都在仓库外的 `D:\AIProjects\WeftMate\Runtime`（或启动参数指定的数据目录），不进 Git。测试使用隔离的数据目录和测试账号，不碰日用数据。

## 本地模型

日用主力是本地 Qwen3.8 27B（OpenAI 兼容接口）。统一的启动方式与健康检查由 PLAN M0-6 确定后写在这里。
