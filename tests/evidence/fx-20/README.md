# FX-20 · 恢复误报与审批刷新竞态

分支 `wp/fx-20-recovery-race`，[PR #196](https://github.com/memoweft/weftmate/pull/196)。修前基线为 `8df312ccb25215276287fafdbfd8caa9aa7492d1`；最终产品已合主线 `36f44a26`。

## 修复

- 身份状态和首次连接不登记为断线。只有网络不可用、电脑离线或明确传输失败后的成功探测会执行恢复回调。已验证在线的启动不再立即追加一遍 `/status`。
- 桌面会话选择负责首次历史／决定读取；普通后续刷新负责增量更新。任务索引读取可由调用者明确接管决定刷新；审批与提问并行读取，共用正在进行的读取。手机启动只读取一次列表，首页接收已读数据，逻辑主对话已选中时不再重新选择。账户发送偏好与个性化共用首次读取，固定事件详情按账户／设备身份共享读取。
- 审批／提问在 pointerdown（指针按下）到 click（点击）期间保留控件，点击或取消后使用最新数据重画。正在提交时只更新禁用态和状态文案。同内容保留节点，语义相同而字段顺序不同也不会重画。
- 手机审批原来会在读取代次更新后保留旧闭包，使可用按钮的上下文核验失败。现在点击重新取得上下文，并核对账户／身份代次／会话／页面及选中代次；桌面批准同样核对身份。提问保留节点时更新动作配置。共享层既有单次提交锁、原请求编号与终态单调合并继续生效。

## 启动请求次数

`runners/startup.mjs` 用同一隔离宿主、真实 Electron 和手机界面包比较旧资产／当前资产。禁用周期性轮询，只计完整登录入口和首次启动加载；桌面在调用 `enterAssistant` 时开始记录实际 `requestJson`，手机记录原生桥的请求。修后读取次数有明确断言。JSON（结构化数据格式）保存每个接口的原始次数。

桌面历史、审批、提问及任务详情从各 2 次变为各 1 次；手机列表、项目、个性化和记忆状态从各 3 次变为各 1 次，状态从 4 次变为 1 次。手机首页不读取聊天历史／提问／任务详情，因此这些为 0；进入具体对话时另有首次历史读取，原有审批测试覆盖。

最新主线 AND-1 增加了启动前／主题应用中的 `settings.appearance` 原生元数据查询，修前旧主线 1 次、修后当前主线 4 次；这是系统栏主题查询，不触发会话／审批恢复读取。FX-20没有修改这组主线能力，完整原始次数如实列出。

### 桌面真实 Electron（桌面程序框架）

| 接口／桥调用 | 修前次数 | 修后次数 |
|---|---:|---:|
| `/personal/v1/settings/personalization` | 2 | 1 |
| `/personal/v1/status` | 2 | 1 |
| `/personal/v1/models` | 1 | 1 |
| `/personal/v1/settings/models` | 1 | 1 |
| `/personal/v1/sessions` | 1 | 1 |
| `/personal/v1/projects` | 1 | 1 |
| `/personal/v1/sessions/<session>/metadata` | 1 | 1 |
| `/personal/v1/sessions/<session>/approval-mode` | 1 | 1 |
| `/personal/v1/sessions/<session>/events` | 2 | 1 |
| `/personal/v1/settings/usage` | 1 | 1 |
| `/personal/v1/sessions/<session>/message-branches` | 1 | 1 |
| `/personal/v1/sessions/<session>/events/10/detail` | 2 | 1 |
| `/personal/v1/sessions/<session>/approvals` | 2 | 1 |
| `/personal/v1/sessions/<session>/questions` | 2 | 1 |
| `/personal/v1/commands` | 1 | 1 |
| `/personal/v1/tasks/<task>` | 2 | 1 |
| `/personal/v1/usage` | 1 | 1 |
| `/personal/v1/sync/events` | 1 | 1 |

### 手机实际界面包

| 接口／桥调用 | 修前次数 | 修后次数 |
|---|---:|---:|
| `events.subscribe` | 1 | 1 |
| `app.bootstrap` | 1 | 1 |
| `conversations.list` | 2 | 1 |
| `attachments.list` | 1 | 1 |
| `host.business:/personal/v1/settings/personalization` | 3 | 1 |
| `host.status` | 4 | 1 |
| `settings.appearance` | 1 | 4 |
| `app.ready` | 1 | 1 |
| `host.business:/personal/v1/memory/status` | 3 | 1 |
| `models.host` | 1 | 1 |
| `shared.sessions.list` | 3 | 1 |
| `shared.projects.list` | 3 | 1 |
| `cloud.callback` | 1 | 1 |
| `cloud.pending` | 1 | 1 |
| `auth.me` | 1 | 1 |
| `shared.approvals.list` | 1 | 1 |

## 验证

- 原审批交互连续 5 次：3 通过、2 失败，均在原第124行等待决定状态超时；`checks/before-*.txt`。
- `runners/race-before.mjs` 使用旧审批／提问渲染器，在按钮按下后释放可控读取再松开，2000毫秒内没有决定请求，稳定失败；`checks/controlled-race-before.txt`。修后同一时序在原审批测试中通过，且只发一次请求。
- 新增不变数据的节点身份、提交时节点身份／禁用态、已提交决定不被晚到待处理数据覆盖，原断言全部保留。
- 最终原审批交互连续20次全过，含新增可控竞态／旧读取保护，见 `checks/final-approval-20-1.txt` 至 `checks/final-approval-20-20.txt`。
- 指定六文件127通过／0失败；`checks/targeted-delivery.txt`。共享层与连接回归77通过／0失败；`checks/core-final.txt`。
- 真实桌面浅／深色审批、提问、停止及其他语义交互通过；`checks/desktop-interactions.txt`。桌面另以实际审批验证：历史读取代次改变后，相同审批仍保留原按钮节点。启动截图 `after-desktop.png` 与 `after-mobile.png` 已目视检查，手机是浏览器承载的实际界面包截图，没有声称安卓系统栏验收。
- 新增静默登录／设备批准／首次连接和真实网络恢复仅提示一次；90段合成正文含35段已读＋完整重播，最终逐字一致、事件数量90。保留原未确认消息、原请求编号、附件及游标去重断言。M3-1既有真实中继90段证据继承，本轮没有重新调用模型或重跑中继。
- 首轮开发中的整批1374通过／1个文件级失败／14项原有跳过：`session-menu` 测试进程未给出断言栈；单独复跑6/6通过、未改测试，见 `checks/required.txt` 与 `checks/session-menu-rerun.txt`。最终整批单独重新运行，结论如下。
- 完整必过单测：1383通过／0失败，14项CI（持续集成）原有排除，1397项总计；`checks/required-final-main.txt`。
- 类型检查及生成包一致性通过：`checks/typecheck-final-main.txt`、`checks/package-final-main.txt`。合主线后89个脚本文件检查通过。

## 边界

不新增 `/personal/v1` 路由或契约，不需要新壳版本。FX-20未改安卓版本号；合并主线AND-1的版本变更仅随主线继承。未动MuMu、本人桌面或日用宿主数据。全部宿主、账号、浏览器、Electron均来自隔离测试夹具；进程清理见最终结果。

## 20次连续结果

每次都包含原3类决定、可控刷新与按下并发、提交节点保留及旧响应防覆盖。

| 次数 | 结果 | 全文件耗时（毫秒） |
|---:|---|---:|
| 1 | 通过，决定请求恰好1次 | 4626.7839 |
| 2 | 通过，决定请求恰好1次 | 4658.6361 |
| 3 | 通过，决定请求恰好1次 | 4679.2007 |
| 4 | 通过，决定请求恰好1次 | 4870.9611 |
| 5 | 通过，决定请求恰好1次 | 4826.5967 |
| 6 | 通过，决定请求恰好1次 | 5225.2512 |
| 7 | 通过，决定请求恰好1次 | 5556.2826 |
| 8 | 通过，决定请求恰好1次 | 6879.4185 |
| 9 | 通过，决定请求恰好1次 | 5818.5983 |
| 10 | 通过，决定请求恰好1次 | 5058.4227 |
| 11 | 通过，决定请求恰好1次 | 5242.89 |
| 12 | 通过，决定请求恰好1次 | 5422.4372 |
| 13 | 通过，决定请求恰好1次 | 5713.4707 |
| 14 | 通过，决定请求恰好1次 | 5188.3455 |
| 15 | 通过，决定请求恰好1次 | 4856.2646 |
| 16 | 通过，决定请求恰好1次 | 5023.0203 |
| 17 | 通过，决定请求恰好1次 | 4714.5106 |
| 18 | 通过，决定请求恰好1次 | 4657.5586 |
| 19 | 通过，决定请求恰好1次 | 4620.1804 |
| 20 | 通过，决定请求恰好1次 | 4736.2825 |
