# Windows 升级验收

仅使用 `inst2qa` 测试身份、独立程序文件名、合成配置与随机端口。程序和安装器运行于独立后台桌面；原始 PNG（位图图片）由窗口句柄或实际程序渲染器采集，未接管本人桌面，未访问日用数据或18186，真实模型请求0。

| 验证 | 证据 | 结果 |
|---|---|---|
| 原生 `/S` 默认安装、沿用默认位置覆盖、卸载 | `native-silent-defaults.json` | 退出0、可见窗口0；测试默认目录带独立身份 |
| 中文空格自定义位置、运行中静默升级 | `custom-silent-and-quit.json` | 沿用位置与当前用户范围；安装器新增窗口0 |
| `--quit` 正常保存退出、再启动 | `normal-exit-check.json`、`after-normal-upgrade.png` | 退出记录正常且清理完整；上次非正常退出记录0 |
| 启动自检修复失效自启路径 | `custom-silent-and-quit.json`、`interactive-upgrade.json` | 改为当前执行路径，原配置参数保留 |
| 交互重装改变位置、自动打开 | `interactive-upgrade.json` | 自启、两个右键入口、开始菜单与桌面快捷方式、安装与卸载登记全部跟随；旧程序文件移除 |
| 位置省略与悬停完整显示 | `location-hover-light.png`、`location-hover-dark.png`、`raw/` | 真实144 DPI（像素密度）窗口；中间省略，完整路径在已有说明区域换行显示 |
| 无管理员令牌的所有用户静默尝试 | `interactive-upgrade.json` | 退出740、新增窗口0、`ADMIN_REQUIRED` 日志；原安装保留 |
| `--silent` 等价参数 | `interactive-upgrade.json` | 覆盖沿用自定义位置，退出0、新增窗口0 |
| 首次自定义位置应用内更新监护 | `monitor-upgrade.json`、`monitor-first-upgrade.png` | 以报告最终结果为准 |
| 所有用户下载后明确运行安装包 | `all-users-update.json`、`all-users-update-light.png`、`all-users-update-dark.png` | 真实下载与核验；范围元数据为合成替身，不冒充实际 HKLM（所有用户注册表）安装 |

窗口探针沿既有 Win32（Windows 原生接口）枚举与私有桌面捕获助手，每1毫秒采样。原生默认安装的基线和原始可见计数均为0；运行中升级时，Windows 已有的两个75×75输入指示器被记录为基线，`visibleWindows` 只计本轮新增窗口，同时保留 `baselineVisibleWindows` 与 `rawVisibleWindows`。`tray-window-details.json` 保存其实际窗口类，不隐藏安装器或新子进程窗口。

`argument-probe.json` 实证本机 Git Bash（Git 命令解释器）会把原生参数 `/S` 改成 `S:/`；`--silent` 不变，设置 `MSYS_NO_PATHCONV=1` 后 `/S` 不变。preview.4 的构建记录确认包含品牌脚本，源码已保护自绘初始化和位置页；没有找到它们绕过真正静默状态的代码。现场原始命令行未保留，因此不能把环境转换断言为那次窗口的唯一原因。安装器同时保护了上游无条件窗口前置入口。

`watchdog-arguments.json` 是实际 Windows 进程的原始命令行：默认 Node（运行环境）会把带空格的整个 `/D=…` 加引号；监护修改后，只给执行路径加引号，目标位置原样位于末尾。退出时的系统查询固定回归会重现“枚举到进程后，它在读取路径前退出”；确认已退出的进程跳过，仍存活且路径不可读保持失败。监护还等待确切辅助进程退出，并在查询失败、原安装未动时尝试重新打开旧程序。

验收先后修正了探针参数命名、卸载异步完成等待、旧窗口基线；也实际抓到交互重装跳过位置页和安装 DLL（动态链接库）重复解包触发占用的问题，均已修复。`location-page-before-fix.json` 保留位置页修复前的失败，成功结果独立记录，不覆盖成通过。

实际所有用户安装、所有用户覆盖升级及两种范围转换仍需管理员运行环境；当前会话令牌不具备该权限，且本包没有触发本人桌面的提权确认。无权限静默失败与所有用户应用内更新分支分别实际验证，不把合成范围数据称作真实全用户安装。Windows 10、跨屏、真实鼠标悬停、人工读屏及磁盘满／安全软件阻止仍未验。
