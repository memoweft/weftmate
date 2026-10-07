# 当前状态

> 只写现在，整页覆盖更新，不追加日记。≤1 页；路线见 PLAN.md，旧记录见 archive/2026-10-07/。

更新：2026-10-07

## 当前里程碑：M0 重置

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows | M0-3 历史分页 + M1-0a 对话时间线 | [PR（合并请求）#26](https://github.com/memoweft/weftmate/pull/26) 审查修改中；已合入最新 main，修复长会话来源校验；桌面/手机时间线、任务页删除、Android code14 / UI 0.8.1 已实现 |
| Codex · Mac | H2 健康摘要服务端 | [PR #25](https://github.com/memoweft/weftmate/pull/25) 已合入；接收/读取/删除、observed（观测证据）待写队列、模型位置自动判断及 modelTier 手动覆盖已实现；World 写入待 MemoWeft 协议补齐 |

已完成：文档与规则重置；M0-1b 旧路径清理/模块拆分；M0-2 服务容量与动态输出预算（PR #24）；H1 iPhone 健康设置、8 类只读权限、每日摘要/14 天基线与隔离队列（PR #22）；CI（持续集成）依赖审计及按用例分组、减少三平台重复运行（PR #23 与主干修订）。

## 最近一次场景结果

- M0-3 原交付：类型检查通过；完整单测 843/850 通过、5 项原有静态契约失败、2 跳过；相关 81/81、手机界面 89/89、DSH 冷恢复 5/5、Android JVM（Java 虚拟机）22/22，调试包/测试包构建通过。隔离桌面/手机截图及成果预览见 PR 的 tests/evidence/m0-3/；仪器场景未在设备运行。
- H2：相关隔离测试 22/22、类型检查/发布预检/依赖审计通过（0 漏洞）；本机必过组 709 通过/7 跳过，另有 macOS 回环别名夹具问题；详见 PR #25。GitHub Actions（自动化工作流）因付款/额度暂停，以本地结果为准。
- M0-7 场景集已建立；Qwen / MiMo 基线与真实 Qwen 长任务回归尚未跑。

## 契约变更

- M0-3 / M1-0a：CLIENT_API 第 3.4 / 4 节正式：无游标尾页、beforeSeq 上翻、afterSeq 正向、nextBeforeSeq/hasOlder/latestSeq、按 seq 详情；执行/审批/提问/成果共用原生序列，taskId 是回合键。Apple A1 / M1-0d 待接入；排队/插话另包。
- H2：CLIENT_API 第 6 节正式，健康上传/读取/删除及迟到上传水位；200 确认摘要和待写队列落盘，未写 World。第 3.10 节可选 modelTier（auto/local/cloud），缺省按实际地址判断，位置修订生成新 runtime（运行时）修订；桌面表单保留本地/云端覆盖。非健康记忆召回照常。
- A2：Apple 对齐消息/JSON 上限、接管和附件接口；任务能力按 /status 与实时 sendAvailable 判断。M0-5 接口基线已由以上正式契约更新。

## 已知问题

- H2 / MW-2：MemoWeft 缺 observed 写入、按来源过滤与撤回协议，健康仍在可回放队列；见 src/personal-health/README.md。
- M0-6：本地 Qwen 启动方式不统一，曾多次 OOM（内存不足）；真实模型与手机真机验收待跑。M1-3 待在剩余上下文极少时先触发压缩。
- 主干既有失败、固定 DSH 产物/外部 Design 夹具与跨平台测试适配未全部解决；CI 当前计费暂停。模型路由进一步简化仍需协调恢复/队列/引用保护（PR #20）。
