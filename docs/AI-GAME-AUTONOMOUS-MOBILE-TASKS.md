# AI-GAME 长期 Android 模拟器任务路线

## 产品关系

```text
用户
  <-> WeftMate
  <-> DeepSeek Harness
        -> phone_execution 工具
        -> AI-GAME 权威 Task
        -> 用户选择的 Android 模拟器
        -> 结构化状态、证据和结果回到原对话
```

WeftMate 是唯一用户界面。DSH 拥有对话、规划、模型、权限和用户问答；AI-GAME 只拥有 Android 任务、设备、观察、动作、验证、等待、恢复和执行经验。AI-GAME 不建立第二段用户聊天，也不复制 MemoWeft 的长期记忆。

## 长期任务应具备的行为

- 接受高层目标，并把当前 revision（修订）冻结到权威 Task；
- 绑定稳定的 `{principal_id, controller_id}` owner pair 和用户选择的模拟器 Profile；
- 在时间或事件到达时恢复，执行 fresh observation（新鲜观察）→ plan（规划）→ primitive action（原子动作）→ fresh observation → verification（验证）；
- 支持用户在原 WeftMate 对话中修改、暂停、继续、插队、接管和停止；
- 用幂等身份处理进程崩溃、网络中断和响应丢失，不盲目重复真实动作；
- 只有可追溯证据满足冻结完成条件时才报告成功。

## 失败与继续

页面变化、点错、App 退出、网络波动、对方未回复或一次模型失败属于普通运行情况。系统应进入等待、恢复或重新规划，并保留用户控制；它们不触发项目层面的无限修 Bug 循环。

以下四类问题立即阻断当前候选：

- 同一真实副作用被不可控地重复；
- owner、Task、Profile 或设备身份串线；
- 凭据或敏感数据暴露；
- 没有证据却报告成功。

不设置任意动作数或迭代数作为产品能力上限。运行循环通过明确终止条件、无进展检测、退避、等待、暂停和停止保持有界、可观察和可接管。

## 当前代码基线

当前活动方向包括：

- `/api/execution/v2` 与稳定 owner pair；
- `task_id == AgentSession.id` 的 canonical Task；
- 模拟器发现、Profile 保存/验证/默认项；
- 常驻调度、事件唤醒、revision/control 边界；
- `android_ui_agent/1` 通用执行器；
- RuntimeKernel 的观察、原子动作、回执、验证和证据；
- 与 owner、Profile、设备、应用版本和完成证明绑定的 scoped experience（有范围经验）。

退出活动方向的内容包括旧真机、Android Companion、无线 ADB、ADB reverse、固定 Settings-only runner（仅设置页执行器）和旧 Stage 4C 路线。历史数据库字段或只读解析可以暂时兼容，但不能重新成为创建新任务的产品路径。

## 当前尚未发布

- WeftMate 还没有管理 AI-GAME 的完整生命周期；
- 4310 仍是开发者诊断服务地址，不是用户应理解或手工维护的开关；
- 因此 WeftMate 的模拟器设置和全局任务中心暂不注册；
- 当前代码与测试是工程基础，不是 owner dogfood `PASS`、打包能力或发布证明。

下一阶段应先补齐 WeftMate 宿主生命周期，再形成一个固定、有限内部验证过的模拟器候选，交给产品所有者实际使用并停止等待反馈。
