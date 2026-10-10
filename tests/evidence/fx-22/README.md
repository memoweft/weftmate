# FX-22 · 发布门与公开证据

[PR #202](https://github.com/memoweft/weftmate/pull/202) 包含 Windows（Windows 平台）合并前完整检查与公开身份卫生检查。

- 清理前基线：`2a075c13`。从执行环境读取身份，135 个文件的真实 Windows 用户目录前缀改为 `C:\Users\<user>`，2 个文件的本机机器名改为 `<host>`；共 137 个身份文件，其中证据 / 文档 136 个。只改文本，已改 JSON（结构化数据格式）全部重新解析；二进制保留。
- 一次性清理：`node scripts/clean-public-identities.mjs`，身份值仅来自 `os.userInfo().username` / `os.hostname()`；重复运行改动 0 文件。
- 公开卫生：`node .github/scripts/public-hygiene.mjs`。扫描 Git（版本控制）管理的文本及待添加文本，包括 BOM（字节顺序标记）标识的 UTF-16（双字节文本编码）；不读忽略目录或二进制。非法用户目录 / 默认机器名会失败，仅列文件与命中类型，不回显身份值。
- 正反验证：`node --test tests/public-hygiene.test.mjs` 覆盖假名字路径、反斜杠 / 正斜杠 / JSON 转义、公共名字、默认机器名、Unicode（国际字符集）用户名、UTF-16、二进制、清理后可解析与重复清理。
- 合成电脑名：`WEFTMATE_TEST_HOST_NAME=synthetic-host` 同时用于 HTTP（网页传输协议）状态与 Electron（桌面程序框架）身份桥；CI（持续集成）与 nightly（每夜回归）、合成验收入口统一注入，清空环境的子进程也重新注入。
- Linux（Linux 平台）密钥环：隔离 D-Bus（桌面消息总线）会话中解锁 GNOME keyring（系统密钥环），Electron 显式选择 `gnome-libsecret`。两条迁移首消息用例实际通过，[202 通过 / 0 失败的完整 vendor（固定运行时集成组）运行](https://github.com/memoweft/weftmate/actions/runs/38070410578)；保留一条无关平台跳过及两条 darwin 例外。
- Windows 私有目录失败是夹具假设：默认临时路径有 8.3（短文件名）组件，`realpathSync`（同步路径解析）的 JavaScript（脚本语言）算法保留短名，产品使用的异步原生解析展开它，路径一致性检查因此拒绝初始化，并非账户 / ACL（访问控制列表）设置失败。`realpathSync.native`（原生同步路径解析）与异步结果一致；夹具统一使用原生解析及专用 `RUNNER_TEMP`（运行器临时根），不放宽 ACL。无身份值的[云端诊断](https://github.com/memoweft/weftmate/actions/runs/38071975521)与[布尔证据](windows-temp-diagnosis.json)保留，临时诊断工作流已移除。
- 临时清理失败揭示真实脚本缺陷：CIM（Windows 管理查询）命令行含调用者的短名，枚举目录是展开名，单一字符串检测漏掉有效的在用目录。脚本同时比较枚举路径和调用者提供的根路径，并规范化删除边界。测试保留原始 TEMP（系统临时目录）写法，等待进程 ready（就绪）信号，另用受控 CIM / 枚举器稳定构造别名差异；两组六项计数断言原样严格验证，联接目标文件仍检查原内容。
- 本机相关验证：最终完整 required（必过组）1417 通过 / 0 失败 / 14 条原有跳过，nightly 12/12、vendor 203/203、更新记录 12/12、宿主云身份 15/15、Web（网页）交互 105/105、类型检查通过。完整 required（必过组）与最终 PR 检查结果记录在交付报告。
- 额外发现：云端撤权同步可能与登录后的后台同步重叠，新的同步调用只等待旧响应，沿用撤权前状态。受控旧响应夹具稳定复现 1 次请求而非 2 次；修复后新调用读取新快照，旧云会话为 401、本地会话仍为 200。另覆盖旧同步因账号删除而失败的重叠场景：新调用不继承旧请求的错误，独立进行权威读取，自己的错误仍正常返回。两种受控场景均通过。

当前树已清理，历史仍在。公开 Git 历史不改写；QA-7 PR #201 的 9 个身份证据文件已在独立临时检出中清理，提交 `23ed2fc2` 已推送；其 87 个文本证据文件扫描 0 命中、JSON 全部可解析。仅提交这些身份替换，没有修改 QA-7 产品代码；临时检出已移除。
