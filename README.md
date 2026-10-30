# WeftMate

跨设备、跨对话的个人 AI 助手：同一个账号下，无论在电脑、手机还是手表，换了对话还是换了模型，面对的都是同一个能自主办事、越用越懂你的 WeftMate。

- 产品规则：[docs/PRODUCT-RULES.md](docs/PRODUCT-RULES.md)
- 愿景：[docs/VISION.md](docs/VISION.md)
- 开发环境与命令：[docs/SETUP.md](docs/SETUP.md)
- 架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

| 端 | 位置 |
|---|---|
| Windows 桌面 + 个人宿主 | `src/` |
| Android | [apps/android](apps/android/README.md) |
| macOS / iOS / watchOS | [apps/apple](apps/apple/README.md) |
| 云服务 | [services/cloud](services/cloud/README.md) |

依赖：DSH（对话与工具运行时，`vendor/dsh-runtime`）、MemoWeft（长期记忆）、WeftMod（设备能力扩展）。

## 许可证

WeftMate 自有代码、二进制、视觉资产和文档遵循本仓库 LICENSE；DSH、MemoWeft、WeftMod 及其他依赖分别遵循其自身许可证。
