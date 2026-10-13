# 手机点发送无响应：复现与验证

MOB-3 的手机呈现有两处可重复的故障。旧 `src/personal-access-ui/phone-unify.js:56` 每次刷新都替换发送图标，按下和抬起之间替换了目标节点后，浏览器不会产生 click（点击事件）。此外，`components/composer.js:183` 在手机包装之前注册了输入监听器；第一次输入只更新了按钮外观，没有运行手机动作同步，按钮的 `type` 仍可能是 `button`，因此点击到了按钮也不会提交。

现在一次点按中的输入区、按钮和动作保持稳定，等点击与默认动作结束后才刷新。首次输入立即同步发送动作与 `submit` 类型。发送检查和按钮状态使用同一个阻挡判断；迟到的点击与键盘入口也会说明原因，保留草稿。以“正在”开头的发送轻提示不再被回复动效误判为进度行，原固定定位保持，实际提示位于手机视口内。

## 可重复的回归

- `node --test tests/fix-32-pointer.test.mjs`：鼠标／触摸点按期间刷新、失焦／收起，以及空输入的语音按钮首次变成发送。旧代码必红，修复后必绿。
- `node --test tests/ui-core-send-feedback.test.ts`：每个共用会话／主对话阻挡条件、同文重复点击、模型设置保存中，均检查禁用和明确反馈。
- `node --test apps/mobile-ui/tests/chat-interactions.test.mjs`：手机阻挡原因、刚解锁立即发送、刷新进行中发送，以及独立使用时无模型／模型测试／回复进行中的表现。
- `node tests/integration/fix-32-phone-send.mjs`：真实手机网页与生产 DSH（助手运行时），随机端口、临时目录、合成模型；十次延迟解锁后发送，每次一个消息请求、一个模型回合。`FIX32_BASELINE=1` 的负向夹具在合成页面加载 `73b72738` 的旧手机呈现脚本，并在脚本初始化前明确禁用本包新增的点按保护（旧版本没有它）；夹具检查该保护确已禁用，在按下期间调用真实同步函数，稳定重现 0 个消息请求。
- `node tests/integration/fix-32-evidence.mjs`：手机网页／手机界面包 360×780、390×844 的浅深色阻挡反馈和点按位置；真实 Electron（桌面程序框架）480／1200 宽浅深色回归。

本机运行重活前按协作规则取得名额；不请求固定端口、本人数据或线上云服务。证据中的电脑名为 `synthetic-host`。

## 发送条件的处理

| 条件 | 现在的表现 |
|---|---|
| `sessionSelecting` / `sideCreating` | 发送禁用；迟到点击说明正在打开对话 |
| `folderMutationPending` | 编辑保留、发送禁用；提示正在准备文件夹 |
| `submitting` / `sharedPending` / `linkedPending` | 发送禁用；提示上一条消息正在处理 |
| `attachmentUpload` | 发送禁用；提示附件上传完成后发送 |
| `unresolvedSubmission` / `sharedOutboxLoading` / `sendUncertain` | 发送禁用；提示原消息的结果还在核对 |
| 聊天能力不可用／仍未知、电脑离线或重启 | 发送禁用；迟到点击说明暂时无法发送，草稿保留 |
| 当前会话或主对话 `sendAvailable` 不为真 | 发送禁用；提示重新打开或新建对话 |
| 无可用模型、主对话发送能力未提供 | 发送禁用；提示选择模型或重新打开对话 |
| 深入思考设置正在保存 | 发送禁用；提示正在保存模型设置 |
| 同文消息已处于“发送中” | 原消息继续显示，重复发送禁用；提示这条消息正在发送 |
| 空消息且无附件 | 发送不可用；支持语音时主按钮为语音，直接调用发送仍提示先输入 |
| 未登录、账户切换或草稿恢复中 | 发送禁用；迟到点击说明先登录或正在恢复 |
| 手机模型正在测试／切换 | 发送禁用；提示测试或切换模型中 |
| 接到电脑的旧手机对话带附件 | 发送禁用；说明该对话暂时不能发送附件，附件保留 |
| 手机独立使用没有模型 | 原模型设置入口和提示可见，发送禁用；直接发送说明先添加模型 |
| 手机独立使用上一条还在回复 | 主按钮显示停止；直接调用发送说明先停止或等待，草稿保留 |
| 手机独立使用内容超过长度限制 | 发送禁用；说明缩短消息 |
| 异步请求后会话／账户已改变 | 已创建的原消息和回执按原身份处理，迟到结果不进入另一个账户；这类返回不发生在接受发送之前 |

## 证据边界

手机图片是 Chromium（浏览器引擎）的完整内容视口与合成触摸事件；不宣称验证了安卓／iPhone 的系统状态栏、手势条或实体键盘。桌面回归运行真实程序，使用隔离配置目录。没有接管本人桌面，没有修改安卓原生代码，也没有新增接口或权限。

原生聊天页不使用网页的图标替换和表单 `type`，这两个网页故障不能当成原生页的根因。原生页仍应核对发送按钮与入口对模型测试、发送中和回复中状态的一致处理。

最终验证：必过单测 342 文件 1980 通过／0 失败／14 既有平台跳过；固定运行时 35 文件 241／0；手机五文件含点按回归 133／0；点按与回复动效 11／0，发送条件 28／0；共享生成 62 资源、类型与公开卫生通过。12 张截图已逐张查看，界面异常 0。

最终产品提交 `bc9dee98` 的 S2 Relay（中继验证）15／15，逐轮索引：

- 第 1 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38364962985)
- 第 2 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38365336583)
- 第 3 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38365775560)
- 第 4 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38366144166)
- 第 5 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38366588621)
- 第 6 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38366972342)
- 第 7 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38367407402)
- 第 8 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38367790082)
- 第 9 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38368293792)
- 第 10 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38368681559)
- 第 11 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38369064547)
- 第 12 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38370118280)
- 第 13 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38371324848)
- 第 14 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38371852027)
- 第 15 轮：[两组均通过](https://github.com/memoweft/weftmate/actions/runs/38372310698)

推送前合入主线 `27025fb4` 的 M3-3：发送产品文件与证明提交完全一致；主线变动的八个相关文件复验 34 通过／0 失败／4 平台跳过，类型检查通过。完整必过组与固定运行时组的最终通过数如上，没有把平台跳过算作通过。

随后同步 S4 主线 `cde97cf0`：更新说明冲突保留双方条目后统一生成；发送／点按产品文件不变。S4 相关单测 104／0、新增固定运行时用例 3／0、手机五文件 133／0，类型检查通过。
