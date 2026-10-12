# UX-3：回复成果与步骤状态

一轮的成果只占一处：文件名直接打开，行尾更多操作；默认显示三行，多余文件可展开。相同名称的格式／`-vN` 版本相邻归组，最终交付文件都保留入口。原始会话、成果保存与核验、执行状态和重试逻辑均未改动。

## 显示归类

| 原始事实 | 对话里的显示 |
|---|---|
| 步骤出错，回合仍在进行 | 中性「第 N 步遇到问题，正在继续」 |
| 回合以 `completed` 结束，中间有非零返回／超时／步骤出错 | 正常完成计数，淡色重试数量；步骤默认收起，展开显示「已换办法继续」 |
| 使用者中断、命令返回中断信号、任务记录明确 `cancelled`／`killed` | 中性「已中断」；明确停止优先于单步 `failed` |
| 回合以 `error`／`failed`／`blocked` 结束 | 最后一段进展给醒目提示，说明遇到问题的操作与重试／补充说明入口；先前步骤保持中性 |
| 原始记录只标出错，缺少停止原因 | 依据回合最终结果判断；不会仅因一个退出码让已完成回合变红 |
| 明确相同路径多次产出 | 仅呈现最新记录；缺路径的同名文件都保留，成果库和存储原样保留 |
| 读取／移动／改名来源、明确被替换／删除的中间成果 | 不加入成果汇总；没有可靠最终／中间标记的文件保守保留 |
| 文件已经不在原位置，或历史交付信息不足 | 保留可查入口，提示「文件已不在原位置」；宁可保守保留，避免漏交付 |
| 核验通过／仍在核验 | 不显示内部核验术语；真正未通过时提示可以打开检查 |

`src/ui-core/timeline-model.js` 的纯显示函数有独立单测，覆盖恢复完成、中断、助手终止重跑、超时换办法、末步出错但完成、整轮失败、进行中、历史重放、账户／会话／回合隔离和成果过滤。时间线通过现有任务记录补全后台命令的真实停止状态，所有修改均为显示投影。

## 合成截图

运行器：`node tests/integration/ux-3-quieter-replies.mjs`。随机端口、独立临时目录、`synthetic-host` 和合成文件。桌面使用真实 `createPersonalDesktop`（桌面程序窗口）且保持隐藏，通过 Electron `capturePage`（页面捕获）取图；手机使用真实手机界面包和无头浏览器。菜单复用现有共用菜单组件。没有请求真实模型、接管桌面或访问日用安装版。

| 场景 | 浅色桌面 | 深色桌面 | 手机示例 |
|---|---|---|---|
| 五文件折叠 | [图](desktop-light-five-collapsed.png) | [图](desktop-dark-five-collapsed.png) | [390px](phone-390-light-five-collapsed.png) |
| 五文件展开 | [图](desktop-light-five-expanded.png) | [图](desktop-dark-five-expanded.png) | [360px](phone-360-dark-five-expanded.png) |
| 行尾菜单打开 | [图](desktop-light-file-menu.png) | [图](desktop-dark-file-menu.png) | [深色](phone-390-dark-file-menu.png) |
| 单文件 | [图](desktop-light-single.png) | [图](desktop-dark-single.png) | [浅色](phone-390-light-single.png) |
| 中途出错后完成 | [图](desktop-light-recovered.png) | [图](desktop-dark-recovered.png) | [深色](phone-390-dark-recovered.png) |
| 展开的恢复步骤 | [图](desktop-light-recovered-details.png) | [图](desktop-dark-recovered-details.png) | [浅色](phone-390-light-recovered-details.png) |
| 中断 | [图](desktop-light-interrupted.png) | [图](desktop-dark-interrupted.png) | [深色](phone-390-dark-interrupted.png) |
| 整轮未完成 | [图](desktop-light-failed.png) | [图](desktop-dark-failed.png) | [浅色](phone-390-light-failed.png) |

另外有 [主对话桌面](desktop-light-main-five-collapsed.png)、[主对话手机菜单](phone-390-light-main-file-menu.png)，主对话同样只有一处成果，下载和成果库入口均验证。还有 [480px 桌面](desktop-480-dark-five-collapsed.png)、[360px 手机折叠](phone-360-dark-five-collapsed.png)。[运行断言](acceptance.json) 记录文件行数、无溢出、折叠、键盘打开菜单／Esc 返回焦点、真实文件预览及页面错误。

## 验收边界

- 仅改显示，不改 `/personal/v1`（客户端接口）、成果保存／核验／成果库逻辑、任务记录、权限、审批和运行时重试；不改原生弹窗与子进程启动。
- 所有交互场景开启 `prefers-reduced-motion`（减少动态效果），折叠与菜单保持可操作；通过／未通过状态只使用项目已有颜色与控件。
- 手机截图是 360×780／390×844 的真实网页视口，没有 Android（安卓）系统栏；未声称已验证原生系统栏。没有修改原生壳，不需要新壳版本；系统栏整屏复验由正在进行的手机工作包配合。
- 历史记录缺少中断原因且详情也未记录时，不臆造原因；已完成回合仍保持正常。
- 现有成果记录不总是携带「最终交付／中间产物」「仅移动／改名」的来源信息。界面可过滤明确标记与直接读取／移动／改名工具的记录；对于未标注的 shell（命令工具）操作和已不存在的文件，保守保留入口并提示，避免误漏最终交付。若要彻底隐藏这类模糊中间文件，需要运行时补充来源信息；本包没有改保存、核验或日志来猜测这些信息。

## 验证结果

- `node .github/scripts/ci-unit-tests.mjs required`：1717 通过、0 失败、14 个既有平台跳过。
- `node .github/scripts/ci-unit-tests.mjs vendor`：230 通过、0 失败、0 跳过。
- 五文件手机交互组：113 通过、0 失败；相关单测 147 通过；旧桌面交互 3 通过。
- `npm run typecheck`、手机资源生成与同字节校验、公开身份扫描（0 命中）通过；设计检查 0 命中。
- Windows（操作系统）的长命令行限制通过本地 `--import`（启动导入）适配将同一测试清单中的仓库内路径缩短，保留一个绝对测试路径以关联清理；没有改测试选择、断言、跳过规则或产品运行器。第二次完整组约 31 分钟，超出单次名额 30 分钟约 1 分钟；已结束并释放，后续各组另取名额。
- 所有程序使用隔离数据与随机端口；没有读取、写入或停止日用安装版。额外结束本包进程 2 个，最终本包程序残留 0。

- Windows CI（持续集成）发现两个既有账户隔离测试与动态后台采样竞态：采样会提交正常的本账户启动观察，慢机器上落在外账户操作断言之间。仅在这两个专用夹具中关闭并等待采样结束，保留修订号、摘要隔离、订阅唤醒等全部原断言；产品账户逻辑未改。定向账户测试 9／0 失败。
