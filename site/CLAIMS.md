# 官网说法的依据与边界

本表用于核对中英文共用文案。能力层级以已发布版本的实际表现为准：合并 PR（拉取请求）只能证明代码交付，不能替代候选安装包场景验收或本人日用认可。PR 正文中的旧证据路径不作为当前可打开的证据入口，直接查 PR 结论及地图链接的问题与验收回报。

## 有现行出处的说法

| 官网上的说法／现行口径 | 出处 | 可使用的边界 |
|---|---|---|
| Windows 有安装版程序 | 已发布版本、[首轮安装验收 #441](https://github.com/memoweft/weftmate/pull/441) | 有候选安装结果；默认安装与冷启仍有失败记录，不据此声称已完整验收或已公开发布 |
| 对话聊天问事，工作让电脑动手 | 产品规则、[模式实现 #299](https://github.com/memoweft/weftmate/pull/299)、[WORK_AND_CHAT](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/WORK_AND_CHAT.md) | 取代「一个置顶主对话，也能开旁聊」；工作先选电脑与文件夹，底层旧主聊天仅为兼容保留 |
| 在电脑读写文件、运行命令，按目标执行 | 已发布版本 的 Windows 能力与 W1/W2 结果、[审批修复 #307](https://github.com/memoweft/weftmate/pull/307) | 只在工作模式；复杂任务与真实模型表现仍有限制，不承诺每次成功或控制任意应用 |
| 过程在对话可见，可以停止、排队 | 已发布版本、[回复进展 #303](https://github.com/memoweft/weftmate/pull/303)、[UI_SPEC](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/UI_SPEC.md) | 保留原任务与回执，停止受理不等于所有副作用已经停止；排队默认按 D36 |
| 操作按权限审批，支持一次性答复和规则设置 | 产品规则、[审批修复 #307](https://github.com/memoweft/weftmate/pull/307)、[CLIENT_API 第 3.7 节](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLIENT_API.md) | 连接器等具体操作有自己的限制，不把「以后同类」承诺为每个动作都有；不写绝对安全 |
| 得到成果清单并在成果库查看 | [成果库 #172](https://github.com/memoweft/weftmate/pull/172)、[安卓原生成果库 #280](https://github.com/memoweft/weftmate/pull/280)、已发布版本 | 沿实际成果与来源授权；不保证任意格式都可完美预览或转换 |
| 对话可形成记忆，新对话可用相关记忆并纠正 | 已发布版本、[MEMORY](../docs/MEMORY.md) | 人工接 Core 的场景有通过证据；全新 Windows 安装默认启用尚未通过，不可把「装好即自动记住」算作已实现主路；不承诺全部记住或百分百召回 |
| 查看记忆来源、请求纠正与遗忘 | [CLIENT_API 第 3.9 节](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLIENT_API.md)、[遗忘问题 #334](https://github.com/memoweft/weftmate/issues/334)、已发布版本 | 有操作接口，彻底遗忘仍有失败记录；不得写成已验证彻底删除，聊天原话默认保留（D16、D33） |
| 每周查看「这周我记住了什么」 | [记忆周报 #224](https://github.com/memoweft/weftmate/pull/224)、[CLIENT_API 的记忆周报契约](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLIENT_API.md) | 代码有周报投影及纠正入口；不据此承诺记忆无误或五端安装场景均已通过 |
| 临时对话不形成新记忆 | [临时对话 #155](https://github.com/memoweft/weftmate/pull/155)、[CLIENT_API 第 10 节](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLIENT_API.md) | 已有记忆召回开关独立，不升级为「不留任何痕迹」的承诺 |
| Windows／Mac／安卓／iPhone／Apple Watch 有客户端代码 | 已发布版本、[苹果客户端说明](../apps/apple/README.md) | 界面示意不等于五端可公开安装、真机验收或本人日用认可；苹果签名与推送有明确边界 |
| 手机可查看电脑进度、处理审批与查看成果 | 已发布版本、[安卓工作模式 #311](https://github.com/memoweft/weftmate/pull/311) | 电脑离线不继续执行电脑动作；完整跨端安装主路仍须按地图结果解释 |
| 手表有审批、进度与提醒接口 | 已发布版本、[iPhone 本地提醒与 Watch 转发 #310](https://github.com/memoweft/weftmate/pull/310) | 依赖 iPhone 与可用连接，不声称已有 APNs（苹果推送服务）或已在本人手表安装验收 |
| Windows 通知可处理普通审批，右键可发送文件／文件夹 | [系统集成 #230](https://github.com/memoweft/weftmate/pull/230) | Windows 专属；高风险通知只打开原审批，原生横幅与实际系统动作的验收范围以该 PR 说明为准 |
| 换设备、换对话、换模型仍是同一个助手 | [VISION](../docs/VISION.md)、产品规则、已发布版本 | 是产品目标与身份规则，不承诺平台能力完全相等或完整跨端安装主路已验收 |
| 对话、附件、记忆主要留在个人设备，云提供账号与连接 | [VISION 的数据边界](../docs/VISION.md)、[隐私政策](../docs/legal/privacy-zh.md)、产品规则 | 云有密文暂存与加密备份；模型请求会发给所选提供方，不写「数据永不离设备」或「云不保存任何数据」 |
| 自己选择模型，第三方模型接收消息与选出的相关记忆 | [VISION](../docs/VISION.md)、[隐私政策](../docs/legal/privacy-zh.md)、[使用条款](../docs/legal/terms-zh.md) | 不提供或转售模型，第三方适用其隐私政策；不伪造认证、安全等级或隐私保证 |
| 不出售个人信息、不用内容训练模型 | [隐私政策](../docs/legal/privacy-zh.md) | 政策承诺，不作为安全技术已验收的证据，也不扩大到第三方模型的政策 |
| 本机使用不强制云登录，需要云功能时登录 | 产品规则、已发布版本、[安卓入口修复 #436](https://github.com/memoweft/weftmate/pull/436) | Windows 与安卓分别看安装结果；安卓后续单端补验不改写首轮失败，也不代表云注册与跨端已测 |
| 目前不卖模型、无需会员，第三方费用自行承担 | 产品规则、[使用条款](../docs/legal/terms-zh.md) | 当前产品边界，不许诺永久免费，不与数据政策混写 |
| 动态、目标、定时任务 | [动态 #159](https://github.com/memoweft/weftmate/pull/159)、[目标 #165](https://github.com/memoweft/weftmate/pull/165)、已发布版本 | 有入口与原生调度；保存成功不替代到点通知，不承诺离线电脑继续执行 |
| 搜索对话、记忆、成果、定时任务 | [统一搜索 #186](https://github.com/memoweft/weftmate/pull/186)、产品规则 | 只覆盖既有授权类型，不扩成搜索电脑一切文件；部分索引结果不冒充完整历史 |
| 回复显示代码、表格、公式、图表 | [消息呈现 #182](https://github.com/memoweft/weftmate/pull/182) | 只覆盖支持的渲染类型，不承诺任意文档渲染或格式转换 |
| 下一步建议 | [建议与补全 #185](https://github.com/memoweft/weftmate/pull/185)、产品规则 | 建议填草稿后由用户发送；默认关闭的灰字补全不写成默认开启 |
| 系统状态与单组件修复 | [诊断与修复 #229](https://github.com/memoweft/weftmate/pull/229) | 电脑操作、手机只读；不保证一键修复所有错误 |
| 应用内反馈 | [反馈 #227](https://github.com/memoweft/weftmate/pull/227)、[CLIENT_API 第 7.9a 节](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLIENT_API.md) | 预览与确认后才提交；云部署未核实，不能声称线上提交一定可用；未开通时可复制 |
| 浅深主题与强调色 | [外观设置 #222](https://github.com/memoweft/weftmate/pull/222)、产品规则 | 界面示意不作为各端实机验收；深色遵守中性灰规则 |
| 每日摘要与每周回顾 | [摘要与回顾 #236](https://github.com/memoweft/weftmate/pull/236)、[CLIENT_API 第 15 节](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLIENT_API.md) | 可关闭、调整保留时间或清空；模型失败可退回统计版，不能把估计活动分钟写成精确屏幕时间 |
| 高风险审批前可由另一模型核对 | [独立复核 #238](https://github.com/memoweft/weftmate/pull/238)、[CLIENT_API 第 3.7 节](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLIENT_API.md) | 只是提示，不替代用户批准；超时或不可用沿原审批。PR 有误标及无意见记录，不声称已证明更可靠或免疫注入 |

## 待验证或已取代的说法

- 「一个置顶主对话，也能开旁聊」已被 D92 取代，不作为现行产品卖点。
- 「全新安装即可自动记住」「可以彻底忘掉」不能作为已验收结论：分别受地图的自动接入缺口与 #334 限制。
- 「五端均可安装并无缝接续」「手表后台总能及时收到通知」待验证；地图未给出完整安装验收或本人日用认可。
- 公开下载、代码签名、线上反馈可用性和生产云部署须以实际发布或部署证据确认，不能用源码、旧截图或健康响应代替。
- iPhone／手表健康、邮件／日历连接器、外部聊天历史导入已有部分代码，不能继续统一归为未实现；分别查 已发布版本、[健康接入 #243](https://github.com/memoweft/weftmate/pull/243)、[连接器 #274](https://github.com/memoweft/weftmate/pull/274)、[手机交接 #289](https://github.com/memoweft/weftmate/pull/289) 与 [CLIENT_API](https://github.com/memoweft/weftmate/blob/archive/2026-10-26/docs/CLIENT_API.md)。当前发布范围和设备闭环待验证；精灵陪伴、共同空间与公开发布按 当前路线 暂缓，不承诺日期。

## 演示边界

官网画面是界面示意；213 个文件、38 个移动文件、5 个目录、6 个重复、12 页、3 张图、12 KB／8 KB、20／30 公里，以及人物、报销、来源日期均为虚构合成内容，不是产品统计、真实用户成果或模型成功率。

点开报告、导出 PDF（便携文档格式）、设置每周任务和手机批准覆盖文件是演示情节，不在访客电脑创建任务，不承诺任意文档都可完美转换。三屏由共用演示组件绘制，不能标成实拍；不展示私人资料、程序调试入口或苹果验收夹具。演示页的本次合成状态变化不能证明真实记忆的纠正、遗忘或跨端同步。

不伪造发布日期、用户数、评价、媒体报道、安全认证、奖项或公开联系邮箱。获取区的发布说法须按实际发布清单核对，不能从本表的代码交付推断已对外开放。
