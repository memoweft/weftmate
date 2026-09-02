# 项目修复报告

日期：2026-09-03

## 为什么进入项目修复阶段

问题不是某一个 Bug，而是执行方式失去了阶段边界：工程验证中发现一个问题后继续扩查、扩修，再把新的现场结论追加进总控和路线文档；文档又把这些临时结论变成下一次必须继续的指令。最终，尚未具备生命周期的后端被提前暴露为 WeftMate 设置页，产品所有者看到的是一个依赖手工启动 4310、自己又没有开关的半成品。

形成循环的主要机制是：

1. **阶段没有停止条件**：内部验证结束后没有固定 candidate（候选）并交付，而是继续寻找下一缺口。
2. **证据层级被混用**：测试通过、HTTP 可达、一次模拟器动作和产品可用性互相外推。
3. **历史文档成为控制面**：线程编号、事故现场、测试计数和“下一包”不断进入权威规则。
4. **完整性门被无限泛化**：本应只阻断四类严重问题的审查，扩展成所有普通失败都要先修完。
5. **临时约束产品化**：为单次验证增加固定 Settings runner、effect budget 或动作数，开始替代真正的用户目标和控制能力。
6. **宿主职责缺位**：WeftMate 暴露了 AI-GAME 设置/任务入口，却没有负责后端安装、启动、健康、停止和退出。

## 复核结果

### 保留并提交

- WeftMate 的固定 DSH 官方客户端组合、Windows 外壳、安全凭据、模型与安装基础；
- 原对话内 `phone_execution` 的工具结果与详情接缝；
- AI-GAME `/api/execution/v2`、稳定 `{principal_id, controller_id}`、canonical Task、revision/control 和 owner 隔离；
- 模拟器发现与 Profile、常驻调度、`android_ui_agent/1`、RuntimeKernel 观察/动作/验证；
- 与完成证明和运行身份绑定的 scoped experience（有范围经验）；
- 只作为开发诊断的 AI-GAME Console。

### 移出活动树

- Android 真机 Companion 应用、服务、配对、事件、UI、脚本和测试；
- 无线 ADB、ADB reverse 与旧 Stage 4C 路线；
- 固定 `emulator_settings_v1` operator（执行器）及以它为正式产品能力的测试/文档；
- 为单次验证增加的 validation effect budget（验证副作用预算）和一次性 K3 修复开关；
- 旧 Stage 4B/4C 交接、长任务契约、控制中心规格和开发 E2E 脚本；
- 9 万字总控流水、12 万字跨仓流水、旧路线和旧 Windows 候选交接。

这些内容没有永久删除，位于：

```text
D:\AIProjects\_ProjectRepairArchive\2026-09-03-project-repair
```

归档不是当前权威，不能整体复制回来。

### 收口后保留边界

- AI-GAME 后端保留 V2 Task、Profile、发现、调度和执行基础，但不把开发服务可达外推成 WeftMate 产品可用；
- WeftMate 活动树只保留官方 DSH 对话内的 `phone_execution` 结果与详情读取接缝；
- WeftMate 全局任务中心、模拟器设置、同源控制 facade（门面）及其测试已经移入可恢复归档，不是以不可达代码或隐藏入口继续留在产品中；
- `/api/execution/v1` 只允许历史读取，公开创建与控制返回 read-only（只读）错误；
- 旧数据库字段和事件名可以暂时解析，不能成为新 Task 的 transport、runner 或产品入口。

## 新的阶段控制

今后每个阶段按以下序列结束：

```text
明确一个用户结果
  -> 实现
  -> 有限内部验证
  -> 固定候选与已知问题
  -> 产品所有者 dogfood
  -> 停止等待 PASS / FAIL / 新目标
```

普通失败进入 `KNOWN ISSUE`（已知问题）或 `DEFER`（延后）。只有重复真实副作用、身份/设备串线、凭据暴露和伪造成功是 `BLOCKING_NOW`（当前阻断）。不再设置任意“最多 2 步”或固定迭代次数；可控性由暂停、停止、退避、等待、无进展检测、幂等和真实完成条件提供。

## 修复阶段不宣称的内容

- 不宣称 AI-GAME 已可供产品所有者使用；
- 不宣称 4310 已随 WeftMate 自动管理；
- 不宣称全局任务中心、模拟器设置或 verified frame（已验证画面）已交付；
- 不宣称一次真实动作、测试绿灯或历史 `PASS` 能覆盖当前候选；
- 不自动开始下一阶段。
