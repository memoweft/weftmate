# A2 隔离界面证据

这些截图来自 `WeftMateUITests/testA2AttachmentHistoryComposerAndPreview` 在专用 iPhone 17 / iOS 26.3 模拟器上运行的成功 XCTest 场景。账号、图片、文件及回复均由 `AppleContractUIFixture` 生成；双重 Debug 开关、内存凭据和测试 namespace 隔离，未连接真实宿主、未访问日用数据。

- [输入区添加文件并仅发附件](iphone-a2-attachment-only-composer.png)
- [发送后的历史附件](iphone-a2-sent-file-in-history.png)
- [历史图片实际可见](iphone-a2-history-image-preview.png)
- [历史文本实际可见](iphone-a2-history-file-preview.png)

UI 测试检查图片预览控件和文件原文确实出现，关闭后返回输入区；不能只把下载成功或出现保存按钮当作预览验收。场景还验证 shared-chat 不显示任务入口。

macOS 三目标构建中的 Mac 目标通过，但 Mac XCTest Runner 因 `Timed out while enabling automation mode` 未进入测试；AX 备选检查因当前宿主没有辅助功能授权而退出。未申请/修改权限，未记录 Mac 交互或截图已通过。`Scripts/run_mac_ax_test.swift --a2-synthetic` 可在已有授权的宿主复跑同一隔离流程。

API/状态验证另覆盖 UTF-16 与 JSON 字节边界、记忆纠正体、明确接管确认、shared-chat 不请求 /tasks、附件只发送引用、原件大小/hash、显示图及旧图片下载、上传丢回执后同原请求重试，以及丢回执后编辑文字/增加文件保持原件消息绑定。同步历史 8 个附件可读/缓存，发送仍最多 4 个。
