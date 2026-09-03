# WeftMate 架构与当前代码事实

## 目标结构

```text
用户
  -> WeftMate Electron 壳
       -> 固定 DSH 官方客户端
            -> 会话 / 消息 / 模型 / 工具 / 审批 / 工作区
            -> phone_execution host tool（宿主工具）
                 -> WeftMate 管理的 AI-GAME 生命周期
                 -> /api/execution/v2
                 -> canonical Task + android_ui_agent/1
                 -> 用户选择的 Android 模拟器
                 -> 状态 / 证据 / 结果回原 DSH 对话
```

AI-GAME 生命周期一行是目标边界；当前尚未由 WeftMate 完成，所以依赖它的全局入口保持未注册。

这个目标不是一次性工具调用或自动点击脚本。DSH 负责从一句话继续澄清并维护用户可见任务单；确认后，AI-GAME 的通用 Android agent（智能体）需要自己读取第三方 App 页面和会话上下文、决定下一步、生成获授权的对外消息、通过可见 UI 操作并在后置观察中验证。完整验收见 `D:\AIProjects\AIGame\Repository\docs\product\ACCEPTANCE.md`。

## 当前活动路径

### DSH 产品面

- Electron main 启动一个 shared DSH runtime（共享 DSH 运行时），主窗口直接加载其官方 Web client（网页客户端）。
- WeftMate 客户端插件只增加原生窗口 chrome（窗口外框）、品牌、主题、布局修正，以及 `phone_execution` 的 `tool.call.toolview` 和 `conversation.details.supplement` 两个官方 keyed seat（按键席位）。
- 正式对话路径只由固定 DSH 官方客户端和已注册的 additive seam（增量接缝）组成；仓库中未注册的兼容代码不构成产品入口。

### 凭据与配置

- Electron `safeStorage` 保存模型密钥和 AI-GAME capability（能力）凭据。
- DSH 通过宿主 credential provider（凭据提供器）的窄 IPC 按引用读取，密钥不写入 DSH 普通设置或子进程环境。
- renderer 只获得脱敏状态和公开配置，不获得 token、ADB serial（ADB 序列号）、artifact path（证据路径）或 owner ID。

### AI-GAME 接缝

- `src/plugins/weftmate-aigame-host.mjs` 注册 goal-only（仅目标）`phone_execution` 工具；host 冻结 `android_ui_agent/1`，renderer 不能直接提交 Task。
- `src/runtime/ai-game/transport.mjs` 只接受显式 `http://127.0.0.1:<port>`、固定路径、超时、响应大小限制、schema validation（模式校验）和脱敏错误。
- V2 owner 是稳定的 `{principal_id, controller_id}`，不由 bearer token、DSH session 或请求体临时生成；同一 pair 可跨 DSH 会话读取自己的 Task，其他 pair 得到不泄露存在性的空结果或 not-found（未找到）。
- DSH 的权限裁决是唯一批准来源。Full Access（完全访问）直接允许；其他预设至多经过一次官方 approval（审批）。AI-GAME 不追加第二次“是否继续”。
- 一次 DSH turn/tool abort（轮次/工具中止）只终止本次等待，不自动取消长期 Task；明确的 Task control 才改变任务。

## 4310 与生命周期

`127.0.0.1:4310` 当前是 AI-GAME 开发诊断服务的默认地址。源码开发者可以显式启动它，但这不是最终用户合同。

正式发布模拟器设置或任务中心之前，WeftMate 必须负责：

- 定位或安装兼容 AI-GAME runtime；
- 启动并等待健康；
- 处理端口占用、崩溃和版本不匹配；
- 在应用退出时完成任务状态保存与进程收口；
- 提供可见状态和恢复动作。

在这些条件成立前，客户端不会注册 `settings.section/android-simulators`、`sidebar.footer.action/mobile-task-center` 或对应 `shell.overlay`。这保证用户看不到一个只能由开发者手工开关的半成品。

## AI-GAME 当前工程基础

当前代码已包含 V2 execution contract（执行契约）、canonical Task（权威任务）、owner-pair 隔离、模拟器 Profile、常驻调度、通用 `android_ui_agent/1`、RuntimeKernel 观察/动作/验证和 scoped experience（有范围经验）。这些是下阶段可复用基础。

新正式任务只使用 V2、模拟器 Profile 和通用 `android_ui_agent/1`。兼容数据库字段或只读解析不能创建任务、出现在公开 capability（能力）或决定产品路线。

## 证据边界

- 单元/契约测试通过：证明对应代码合同。
- AI-GAME health 或 HTTP 成功：证明当时服务可达。
- 模拟器动作：必须有设备观察、动作回执和后置验证。
- WeftMate 可见并可控：必须由受管生命周期启动同一后端，不能手工拼接。
- 产品所有者 dogfood `PASS`：只对指定候选和环境有效。
