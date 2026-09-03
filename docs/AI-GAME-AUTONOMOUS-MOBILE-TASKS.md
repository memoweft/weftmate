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

## 首个代表性验收场景

产品所有者只说：“帮我在 Soul 上匹配，然后找到合适我的女朋友。”DSH 应在原对话中自适应追问到信息充分，整理并确认任务单与授权范围；确认后，AI-GAME 的通用 Android agent（智能体）必须自己看屏幕、理解不同候选人与聊天上下文、判断下一步、生成有上下文的消息、通过普通 UI 输入和发送、等待真实回复并继续处理，直到用户确认结果、修改、暂停、接管或停止。

“大约问 10 个问题”是对充分澄清的示例，不是固定问卷或上限。“像真人一样操作”表示能在可见 App 界面中自主推理、自然处理未预录回复并从变化中恢复，不表示可以编造用户事实、伪造现实结果或绕过平台规则。Soul 只是首个第三方 Android 环境，不得为它增加专用工作台、owner 或固定 runner。

第一次跑通后必须保存经过验证、范围兼容的执行经验；第二次相似任务要证明经验被实际检索并改变了提问、计划、动作或恢复路径，而且至少有一项可量化改善。个人偏好与用户反馈属于 MemoWeft，手机操作经验属于 AI-GAME。完整验收以 `D:\AIProjects\AIGame\Repository\docs\product\ACCEPTANCE.md` 为准。

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

新任务只通过 V2、权威 Task 和通用 `android_ui_agent/1` 进入模拟器。兼容字段或只读解析不能创建任务、注册产品入口或决定当前路线。

## 当前尚未发布

- WeftMate 还没有管理 AI-GAME 的完整生命周期；
- 4310 仍是开发者诊断服务地址，不是用户应理解或手工维护的开关；
- 因此 WeftMate 的模拟器设置和全局任务中心暂不注册；
- 当前代码与测试是工程基础，不是 owner dogfood `PASS`、打包能力或发布证明。

下一阶段应先补齐 WeftMate 宿主生命周期，再形成一个固定、有限内部验证过的模拟器候选，交给产品所有者实际使用并停止等待反馈。
