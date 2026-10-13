# macOS 单测与验证结果

| 验证 | 通过 | 失败 | 跳过 | 证据和含义 |
|---|---:|---:|---:|---|
| 最近手动 CI 的 macOS 组 | 1917 | 0 | 56 | [run 38349796851](https://github.com/memoweft/weftmate/actions/runs/38349796851)，`49ecbf56c909060a9624fdff66b4343441842fac`，342 文件；属于 CI-3 分支的基线，不是本包最终 head |
| 本机完整 `ci-unit-tests.mjs required` | 1924 | 5 | 41 | 342 文件、约 749 秒；原始结果 `unit-required.json`，保留失败，不改成全绿 |
| 上述五个失败所在文件定向复验 | 39 | 0 | 0 | `unit-followup.json`；修完后五项全部通过，未重复跑完整组 |
| 本包产品与凭据定向回归（最终） | 21 | 0 | 1 | `dsh-web-runtime-lifecycle`、`m3-3-mac-project-reader`、`personal-memory-config`、`credential-vault-document`；跳过的是 Windows native drain 断言 |
| 固定 DSH 构建和 `vendor:verify` | 通过 | 0 | 两个外平台 optional 包 | 同 pin＋四个补丁，197 清单包／195 实装包，身份／tarball／单实例／入口／真实 web boot 验证通过；这不是完整 vendor／contract 测试组 |
| `npm run typecheck` | 通过 | 0 | 0 | 产品和相关 TS 夹具修改后执行，最终交付记录见 `verification.json` |
| Core 形成／新对话回答／重启召回 | 通过 | 0 | 0 | `memory.json`；真实只读 Core、Python 3.11.17、合成解释 HTTP 1 次＋回答 HTTP 1 次、正式记忆 1 条、World revision 1 |
| MiMo 真实请求 | — | — | 未执行 | 当前环境 `MIMO_API_KEY` 不存在；请求数 **0**，没有搜索密钥或读取其他账号 |

完整组通过一次 Node preload 为所有捕获到的测试 Electron 启动加 `--disable-gpu`／`--disable-gpu-compositing`／mock-keychain，并只在测试进程中注入随机 AES-GCM 凭据保管实现。文件 worker 并发为 1；没有运行 iOS 模拟器、Xcode UI 测试或修改系统回环别名。测试替身的结果不是 OS Keychain 验收，详见 `platform-gaps.md`。

本机使用的 preload 已固化为 `tests/helpers/m3-3-required-preload.cjs`，只供这条 Mac 本机验证命令显式采用，默认 CI 不注入它：

```sh
export PATH=$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH
WEFTMATE_TEST_MEMOWEFT_PYTHON="$PWD/../memoweft/py/.venv/bin/python" \
  NODE_OPTIONS="--require=$PWD/tests/helpers/m3-3-required-preload.cjs" \
  node .github/scripts/ci-unit-tests.mjs required --report .local/m3-3/required-report.json
```

## 五个失败的分类与修正

| 失败 | 分类 | 原因及处理 | Windows 表现 |
|---|---|---|---|
| UX-9 new-folder API | 过时的平台断言 | 原断言期待所有非 Windows 都返回 `PROJECT_WINDOWS_REQUIRED`，并给 Mac 传入 `C:\Synthetic\NativeOnly`。现在 Mac 用真实 canonical 临时目录，保留成功登记、修订及浏览器不泄露路径的原断言 | win32 继续同一真实 Windows 目录和同一断言；Linux 仍验证未支持的错误 |
| isolated synthetic memory HTTP contract | 本机环境／夹具 | fixture 硬绑定 `127.0.0.2`；CI 会先配置 lo0 alias，本机规矩禁止改系统。Mac 改用 `127.0.0.1` 的另一个随机端口，origin 仍与 API 不同 | Windows／Linux 仍绑定原 `127.0.0.2`；没有删除任何 owner／cursor／receipt 断言 |
| real HTTP health contract | 夹具隐含时区 | 固定 Shanghai 健康序列和 UTC clock，却沿 Mac 的 US/Pacific 默认账号时区，导致测试的健康日被判断为未来。经既有 `/settings/usage` 明确设置 `Asia/Shanghai` | 同一组健康／90 日／提醒断言；未改健康产品或数据算法 |
| memory shutdown acknowledgement | 夹具导入优先级 | 仅创建 namespace package 的替身，被现有 venv 里真实 regular-package Core 覆盖；所以没有生成替身的 drain 文件。给三层临时包写空 `__init__.py` 后按原断言验 ack 和进程退出 | 同一替身、同一 ack／退出断言；未改 Memory RPC 关闭逻辑 |
| mail safe error classification | 合成证书夹具 | 多个同时存在的 self-signed CA 使用同一个 subject；本机较旧 OpenSSL／LibreSSL 的链选择会取错同名 CA。每个 fixture 改用随机唯一 CN，IP SAN 与证书验证保留 | 只改测试证书身份；邮箱产品、TLS 校验、认证失败的原断言都保持 |

本包开始时的 **产品** 平台缺口是项目读取器、项目持久存储、目录警示、POSIX DSH 后代收口和 Mac venv interpreter 校验；已分别修正并在真实服务／主路或定向测试中验证。没有把测试断言放宽来掩盖产品失败。

## 仍然独立的门

`.github/ci-test-exceptions.json` 的 `knownFailures` 为 0。原 POSIX descendant 例外已删除；两个 macOS OS-keychain vendor 集成例外仍保留，未用 AES 测试替身冒充系统验收。`v2-shell-client.test.ts` 仍依赖外部 Design 文件；112 条 vendor leaf 和七个完整文件由独立 vendor 组负责。完整 required 的 41 个实际条件跳过名称保存在 JSON 中。

旧本机 Core `ddd919d8` 没有主仓较新 MF-1 的即时原话召回行为：直接尝试该最新集成测试会在未形成时得到空 context，而非“近期原话”。没有修改外仓、升级或弱化那条断言。`m3-3-memory.mjs` 等待实际正式形成，验证精确来源跨度、现有召回、新对话模型输入／回答以及重启保存；不等同于新版即时召回或约 135 MB 向量模型验收。

最终 PR 的 Windows／Linux 检查由 Claude 接收；按本包指令，写完 done 后不等待云端 CI。没有把其他分支的 CI 或本机定向复验写成本包最终 head 的全量通过。
