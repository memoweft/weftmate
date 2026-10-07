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
- Windows 继续验证进程树清理，Linux/macOS 明确跳过此项；记忆路由夹具现使用隔离临时路径，在三平台验证。外部平台 optional（可选依赖）包夹具只在非 Linux 验证。POSIX 进程树清理仍是后续项。

## 本机数据

账户、会话、模型配置、凭据和运行日志都在仓库外的 `D:\AIProjects\WeftMate\Runtime`（或启动参数指定的数据目录），不进 Git。测试使用隔离的数据目录和测试账号，不碰日用数据。

## 本地模型

日用入口只有 `scripts/local-model.mjs`。把 `scripts/local-model.example.json` 复制到仓库外的 Runtime/LocalModel/config.json，再按实际文件位置修改；模型与 llama.cpp 文件只读使用，进程记录与日志写在配置旁边。脚本排除继承的 `LLAMA_*` 环境变量，避免旧服务的参数或密钥影响本次启动。模型监听 `127.0.0.1:18081`，不向局域网开放。

```powershell
node scripts/local-model.mjs start D:/AIProjects/WeftMate/Runtime/LocalModel/config.json
node scripts/local-model.mjs status D:/AIProjects/WeftMate/Runtime/LocalModel/config.json
node scripts/local-model.mjs restart D:/AIProjects/WeftMate/Runtime/LocalModel/config.json
node scripts/local-model.mjs stop D:/AIProjects/WeftMate/Runtime/LocalModel/config.json
```

当前 24 GiB RTX 3090 的稳妥默认：Qwen3.8 27B Q4_K_M、32,768 上下文、单槽、48 个 GPU（图形处理器）层，Flash Attention（快速注意力计算）开启，K/V 均为 q8_0，batch（批大小）512 / microbatch（微批大小）128，`--fit off`。GPU 权重 13,039 MiB、GPU KV cache（键值缓存）816 MiB、CPU 权重约 5,045 MiB；给桌面、运行时与推理工作区留余量。首次全 GPU 配置占用接近 24 GiB 并持续预热，未选为日用默认；实测峰值和连续运行结果见 STATE。该默认针对本机，不作为其他用户或模型的容量上限；服务真实 `n_ctx` 仍由 `/props` 读取。

`GET /health` 返回就绪状态，`GET /props` 返回实际版本、上下文与槽数，`/v1` 为 OpenAI（模型接口）兼容入口。设置 → 我的电脑模型：地址 `http://127.0.0.1:18081/v1`，模型 ID `qwen3.8-27b`；本机服务无需密钥鉴权，当前模型表单可填非秘密的本地占位值。如需鉴权，应另行扩展配置中的密钥文件，不在仓库中保存密钥。

宿主用 `--local-model-config` 接入状态与重启：

```powershell
node scripts/run-personal-host.mjs --user-data-dir <隔离宿主目录> --access-port 0 --local-model-config D:/AIProjects/WeftMate/Runtime/LocalModel/config.json
# 桌面应用可使用同一配置
npm start -- --local-model-config=D:/AIProjects/WeftMate/Runtime/LocalModel/config.json
```

脚本只停止进程记录中的相同 PID（进程标识）、可执行文件与启动时间的服务；未知监听者不被接管。`18080` 本机已被 SSH（安全远程连接）监听，旧 `8080` NInfer / `8081` 切换代理均不作为本包日用入口。历史脚本见 `scripts/archive/`，禁止据其恢复多套并行模型。

后台模型默认跟随当前对话，可在桌面设置中单独选择；主对话整轮（包括工具执行间隙）优先，标题与记忆推理等待空闲。MemoWeft 配置的 `authRef` 可以引用当前账户可见的 Qwen 配置，`baseUrl` 填该本机地址、`model` 保持 `@current`；实际推理走宿主的共享队列和已授权后台路由。召回只查记忆，不调用模型。Android 0.8.2 / code15 支持手机只读状态与重启请求；发布新 Web UI 时使用最低原生版本 15。
