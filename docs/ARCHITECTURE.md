# WeftMate 当前架构

## 目标结构

```text
用户
  ↓
WeftMate UI
  ↓
统一管理框架
  ├── DSH adapter
  ├── MemoWeft adapter（试验）
  └── AI-Game adapter（未来）
```

## WeftMate 自己负责

- Electron 桌面应用生命周期；
- WeftMate 产品 UI；
- 外部系统的状态、启动、停止、重启和诊断；
- 会话、模型、工作区和权限的产品化展示；
- 凭据、本地数据、安装、更新和故障提示；
- 各系统之间的用户交互转接。

## 外部系统边界

### DSH

DSH 提供 Agent、会话、模型、工具、权限和代码执行。当前代码已经通过 Gateway 与 runtime adapter 接入。DSH Web 暂时保留为开发和诊断入口，未来普通用户默认进入 WeftMate UI。

### MemoWeft

当前仓库保留 MemoWeft 的试验桥接代码。它必须可选、可关闭、可降级；MemoWeft 未完成时不能阻止 WeftMate 正常启动。正式集成等待 MemoWeft 提供稳定的写入、Recall、来源、纠正、删除、健康和生命周期接口。

### AI-Game

当前仓库没有正式 AI-Game adapter。正式集成等待 AI-Game 提供稳定的状态、事件、用户问题、用户回答和健康接口。AI-Game 的目标与行为逻辑继续留在自己的项目中。

## 统一管理接口

每个外部系统只需向 WeftMate 提供：

- 标识和版本；
- 安装与连接状态；
- 健康状态；
- 能力列表；
- 启动、停止和重启；
- 事件与用户请求；
- 最近错误和诊断信息。

一个外部系统故障时，WeftMate 和其他系统仍应继续工作。

## 当前代码事实

- Electron main 负责启动 DSH 和桌面窗口；
- Gateway v1 已有会话、事件、模型、工作区、权限和诊断基础；
- 当前界面主要借用 DSH Web；
- MemoWeft bridge 是试验接缝；
- 桌宠、感知和设备代码存在，但不属于当前施工重点；
- WeftMate 自有 UI 尚未完成。
