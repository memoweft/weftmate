# UX-7 · 下一步建议（D51）

宿主、Windows Electron（桌面程序框架）、手机网页与安卓界面包共用实现。所有截图与对话均为合成账号、临时目录和随机端口；不访问日用程序、日用数据或8081。参考产品图片只读，没有复制到仓库。

## 行为与边界

- 正常回复完全结束后，后台产生0–3条与当前对话相关的短句。点选或键盘Enter（回车）只填草稿，光标在末尾，绝不自动发送。收起后本条回复不再出现。
- 输入350ms防抖补全；Tab、手机点灰字或右滑接受。输入法组合期间不生成，Esc取消当前非空草稿的补全，清空后恢复。灰字不进选择 / 复制 / 历史，读屏使用单次建议播报。
- 助手设置的`nextSuggestionsEnabled`默认开，按账户同步；关闭真正中止正在生成的两类请求。旧宿主只有`personalCapabilities.nextSuggestions === 1`时启用。
- 单槽机会式租约不排队、不重试。活动 / 等待任务、原生非空闲或换模型时零推理请求；前台到来立即关闭租约并中止真实上游。正文只存在于请求与界面内存，数值用量单列`next-suggestions`。
- 上方条位仅显示审批 > 提问 > 连接提示（兼容M3-1的`.presence-bar`）> 子任务 > 建议。无模型、回复运行中、有草稿时不显示回复建议。补全可与子任务胶囊共存，但让位给审批、提问、连接与无模型提示。

## 前端验收（并行规则第8条 / 8a）

- [x] 无系统默认按钮、缩放把手、滚动条或焦点框残留；新增chip（胶囊）使用应用现有令牌与自绘控件。
- [x] 建议胶囊、收起图标具备悬停 / 按下 / 键盘聚焦 / 禁用四态；胶囊是可点控件，灰字有明确接受方式。
- [x] 位置统一：一个上方条位，助手开关进原设置分类；没有散落的新入口。
- [x] 同行对齐、设计令牌间距、8px输入间距、单行截断全文提示、无换行横滑、溢出右缘渐隐；页面无横向溢出。手机chip高度40px。
- [x] 选中开关可见；生成失败 / 没把握 / 忙时安静为空，正常对话与连接状态不受影响。
- [x] 真实Electron 1200 / 480px、手机网页390×844 / 360×780、安卓界面包同尺寸，浅 / 深各验；真实安卓独立原生壳另验业务路由与点击填入。
- [x] 对比ChatGPT `mobile-4.jpg`、Muse `mobile-2.jpg`及Claude / Codex的参照：保持输入区域安静和圆角层级，建议比正文弱一级，单行胶囊不增加大块卡片；沿用WeftMate自己的字体、色彩和令牌。参考集合未提供连续动画记录，动效按D51规格实施与减少动态效果验证。
- [x] 新功能没有弹层；助手设置与开关打开状态浅深截图另列，使用既有统一设置控件。建议接受、补全接受后的草稿状态均截图。
- [x] 首轮发现的×图标、条边缘、手机主题别名、收起后误禁补全均已修正，最终矩阵与真实安卓回执重新验收。原生兜底透出 / 通知权限覆盖来自人工登录夹具，补真实`app.ready`（页面就绪回执）并在独立合成包授予既有通知权限后重新截图。
- [x] 8a：设置沿现有列表行与单开关，进入助手分类保留原顶栏 / 分类结构；没有新增独立列表页或常驻刷新按钮。建议生成不显示原始时间、秒数、内部模型路径或错误信息。

[完整截图矩阵与几何记录](ui-checks.json)包含12种平台 / 尺寸 / 主题组合，每组18个场景，共216张。每组记录输入框出现前后Y坐标和高度，**位移0px、高度变化0px**；页面错误0、横向溢出0。[真实安卓](android-native-checks.json)另含浅深1 / 2 / 3条共6张，触控高40px、原生POST / DELETE真实通过。

| 界面 | 浅色 | 深色 |
|---|---|---|
| 真实Electron 1200 | [3条](electron-1200-light-replies-3.png) | [3条](electron-1200-dark-replies-3.png) |
| 真实Electron 480 | [3条](electron-480-light-replies-3.png) | [3条](electron-480-dark-replies-3.png) |
| 手机网页390 | [3条](mobile-web-390-light-replies-3.png) | [3条](mobile-web-390-dark-replies-3.png) |
| 手机网页360 | [3条](mobile-web-360-light-replies-3.png) | [3条](mobile-web-360-dark-replies-3.png) |
| 安卓界面包390 | [3条](android-bundle-390-light-replies-3.png) | [3条](android-bundle-390-dark-replies-3.png) |
| 安卓界面包360 | [3条](android-bundle-360-light-replies-3.png) | [3条](android-bundle-360-dark-replies-3.png) |
| 真实安卓原生壳 | [3条](android-native-light-replies-3.png) | [3条](android-native-dark-replies-3.png) |

本包最终共258张截图：主矩阵216、触摸16、真实安卓6、补充16、审稿4。审稿浅深见 [Windows浅色](gallery/review-windows-next-suggestions-light.png)、[Windows深色](gallery/review-windows-next-suggestions-dark.png)、[手机浅色](gallery/review-mobile-web-next-suggestions-light.png)、[手机深色](gallery/review-mobile-web-next-suggestions-dark.png)。

同前缀场景包括`replies-1/2/3`、`hover`、`focus`、`pressed`、`disabled`、`filled`、`long-overflow`、`dismissed`、`completion`、`completion-accepted`、`setting-off`、四类`priority-*`及`no-model`。审稿页增加`next-suggestions`场景；建议响应为确定性合成模型输出，呈现与交互代码为产品代码。

[触屏补全16项](mobile-gestures-checks.json)验证灰字点击 / 右滑，两种手机尺寸、浅深、网页 / 安卓界面包全部接受成功；手机不显示Tab提示。

[设置与补充检查](ui-extra-checks.json)验证草稿 / 运行中隐藏、关闭开关后两类请求新增POST为0、减少动态效果无动画。chip文字对比度为6.375 / 6.888（桌面浅深）、5.641 / 7.087（手机浅深）；灰字为5.686 / 5.851、5.189 / 6.509，均≥4.5。输入内容左右对齐误差桌面0.333px（DPI小数）、手机0px，间距均8px。

| 助手设置打开状态 | 浅色 | 深色 |
|---|---|---|
| 桌面 | [开启](electron-light-assistant-setting.png) · [关闭](electron-light-assistant-setting-off.png) | [开启](electron-dark-assistant-setting.png) · [关闭](electron-dark-assistant-setting-off.png) |
| 安卓界面包 | [开启](android-bundle-light-assistant-setting.png) · [关闭](android-bundle-light-assistant-setting-off.png) | [开启](android-bundle-dark-assistant-setting.png) · [关闭](android-bundle-dark-assistant-setting-off.png) |

## MiMo五轮真实对话

[最终内容、响应时长与用量](mimo-quality.json)，[全部三批用量（含失败 / 超时）](mimo-attempts.json)，[第二批完整结果](mimo-quality-attempt2.json)。真实Electron + 固定DSH（助手运行时） + MiMo，密钥只在进程内，测试保管库仅保存合成占位符。

| 轮次 | 当前任务 | 建议样例 | 生成耗时 | 输入 / 缓存输入 / 输出词元 |
|---|---|---|---:|---:|
| 1 | 周报三点提纲 | 请为每点补充具体数据和例子；请给出开场白和结束语 | 1884ms | 254 / 128 / 36 |
| 2 | 展开上线检查 | 把这三点提纲整理成一页PPT文案 | 1373ms | 401 / 192 / 38 |
| 3 | 整理待办清单 | 把这三点提纲整理成可直接讲的口播稿 | 1340ms | 541 / 320 / 38 |
| 4 | 明早提醒短句 | 帮我设置明天上午九点的提醒 | 1737ms | 473 / 0 / 24 |
| 5 | 同事汇报消息 | 把汇报消息再改得更口语化一些；检查清单里再补充一条回滚预案 | 4517ms | 407 / 0 / 38 |

最终5/5有有效建议，14条均不超过24码点，无泛泛问候；模型有时跟进前几轮提纲而非只围绕最后一句，短上下文允许这种关联。补全“请把刚才的安排”得到“整理成一段简洁的总结，方便我直接发给团队。”，约1853ms。建议仍须用户主动选择和发送。

第一批发现缺明确末尾生成任务导致模型少给 / 空给及解析失败覆写requestId，均已修；第二批3/5有效，其余两次5秒超时即静默放弃，没有重试。最终批6次建议请求输入2461（缓存640）、输出193，按宿主价格目录计算费用¥0.00221980。全部三批共36次模型请求，输入59308（缓存39424）、输出1649，按宿主价格目录计算费用¥0.02397048，3次超时用量未知；其中建议18次，输入6228（缓存896）、输出393，按宿主价格目录计算费用¥0.00613592。未知费用未计入金额，不把0词元表示为免费。

## 单测与交付

`tests/next-suggestions.test.ts`覆盖结束 / 放弃 / 实际取消 / 账户开关同步与隔离 / 临时对话 / 暂态边界 / 用量分类；`tests/next-suggestions-ui.test.ts`覆盖32种优先级组合、防抖、取消、迟到响应、输入法、收起不再出现；`tests/model-scheduler-suggestions.test.ts`以真实随机端口单槽HTTP（超文本传输协议）替身证明忙时零推理、前台抢占、无重试、完整body（响应内容）期间持有租约。

交付前按CI（持续集成）同一命令`node .github/scripts/ci-unit-tests.mjs required`完整复验：**1317项、1305通过、0失败、12项沿用条件跳过**，耗时1214.173秒。第一遍35个失败已定位修复：手机独立脚本拼接边界、发布夹具漏新资产、生命周期预期拒绝过晚处理、数值账本新增固定类别；Apple生成文件按既有LF规则重新生成，未修改生成比较断言。没有删除用例、增加skip（跳过）或放宽保护断言；账本键集合加入固定类别并补类别值断言。最新外部忙观测与宿主相关39/39、最新取消 / 路由25/25、实际导出5/5、手机夹具37/37、账本 / 生命周期 / Apple26/26定向通过（有重叠，不相加）。`npm run typecheck`与`node --check src/main.mjs`通过，Android路由14/14、独立原生探针1/1。详见[验证数字](validation.json)。

4c清理：**已清理进程10**（首轮观察器两次挂起各5个），最终三重条件核对需额外强制终止0、残留0；本包安卓应用 / 调试映射已移除，MuMu关闭，原三个孤儿测试APK保留。见[进程清理](cleanup.json)、[安卓清理](android-cleanup.json)。公开凭据与参照图扫描见[扫描](public-scan.json)。GitHub检查结果随PR更新。

OpenAI推理请求沿原生精确effort（推理等级）声明使用最轻模式，省略不兼容温度、使用`max_completion_tokens`包含隐藏推理的1,024词元预算；只允许强思考的模型直接放弃。协议映射已单测，真实质量仅实测MiMo，不承诺所有推理模型都能在5秒内生成可见JSON。[OpenAI Chat Completions（聊天补全）官方字段参考](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[推理预算官方说明](https://developers.openai.com/api/docs/guides/reasoning)。

本机外部忙状态另覆盖ModelSwitcher的真实`activeLeases/queuedLeases/maintenanceQueued`以及直接llama的`is_processing`；已观测忙 / 503 / 未知槽结构均零推理，旧代理计数缺失用同址槽接口兜底。新增观测后调度＋建议＋宿主相关39/39通过。

**外部并发边界**：WeftMate内部原子预留、即时取消、不排队与不重试已验证；独立程序仍可能在状态读取之后抢先向模型代理提交请求。现有ModelSwitcher没有原子的机会式入口，本包遵守隔离要求没有修改本人代理，因此这类跨独立客户端的竞争不能承诺绝不进入上游队列。要消除该窗口，需要模型代理提供原子try-acquire（尝试取得租约）接口；该服务端能力不在本包实际部署。[llama.cpp槽状态官方接口](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#rest-api)。

## Apple改动清单与壳版本

1. macOS / iOS读取`personalCapabilities.nextSuggestions === 1`，在助手设置接`nextSuggestionsEnabled`并沿ST-1逐字段账户同步；关闭立即中止在途请求。Watch不新增建议输入区，设置跟随账户。
2. 接POST `/sessions/{id}/suggestions`与DELETE相同路径的`requestId`取消；请求身份、会话与草稿快照必须匹配，切账户 / 对话忽略迟到结果；失败不要改变正常连接状态，禁止重试。
3. 回复完成后后台请求0–3条；输入350ms防抖补全。点击 / Enter只填草稿，Tab接受补全；手机点击灰字 / 右滑。输入法组合时取消；Esc及本次收起不再显示。
4. 原生输入区复用设计令牌和上方条位优先级；预留高度避免位移，横滑渐隐、全文提示、四态、浅深、40px触控、减少动态效果、VoiceOver（系统读屏）单次播报。
5. `/usage.categories`读取`next-suggestions`并单列输入 / 输出 / 请求 / 费用 / 未知用量；接受前不进入历史、记忆、导出或离线缓存。
6. 安卓业务白名单新增精确建议路由，**需要新壳版本**；本包保持原versionCode / versionName及默认界面包版本不变，由编排统一递增。Apple源码除必要生成资产如有差异外没有实现原生建议界面，按此清单接入。
