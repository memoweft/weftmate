# UI-1 桌面界面验收

全部使用隔离临时账户、个人宿主和合成 DSH（执行框架）原生日志。没有模型调用、日用数据或真实账户信息。窗口由实际 Electron（桌面程序框架）进程创建，加载与产品相同的 `src/personal-access-ui/`；本证据不覆盖 `src/main.mjs` 的完整宿主启动或 macOS 原生 App。

复现截图：Windows 先 `node node_modules/electron/install.js`，再以 Electron 运行 `tests/integration/desktop-ui-1.cjs`。跨平台自动验证：`node --test tests/personal-desktop-ui.test.ts`；Linux 使用 Xvfb（虚拟显示器）。自动测试使用 `--verify-only`，不会改写仓库截图。

| 场景 | 浅色 | 深色 |
|---|---|---|
| 运行与停止按钮 | [运行](light-running.png) | [运行](dark-running.png) |
| 就地审批 | [审批](light-approval.png) | [审批](dark-approval.png) |
| 就地回答 | [提问](light-question.png) | [提问](dark-question.png) |
| 两级步骤与原始输出 | [步骤](light-steps.png) | [步骤](dark-steps.png) |
| 完成后收起 | [完成](light-completed.png) | [完成](dark-completed.png) |
| Markdown（格式化文本）成果右侧预览 | [成果面板](light-artifact-panel.png) | [成果面板](dark-artifact-panel.png) |
| 搜索会话 | [搜索](light-search.png) | [搜索](dark-search.png) |
| 外观设置 | [外观](light-appearance.png) | [外观](dark-appearance.png) |
| 1024px 程序窗口 | [窄窗口](light-1024.png) | [窄窗口](dark-1024.png) |

流程中实际提交允许一次、答案、steer（插话）及 queue（排队）参数，并分别用按钮与 Esc 发起停止；快捷键、右侧面板关闭/宽度调整、粘贴/拖拽和外观重载有程序断言。现有后端不产生可取消 `task.queued`，所以本证据只验证实际 queue 参数送达，不展示虚构排队卡。日期分组用真实字段单测，现有列表没有日期，截图显示「会话」。机器结果见 [verification.json](verification.json)。

改前参考：[运行](../m0-3/desktop-running.png)、[原始步骤](../m0-3/desktop-expanded.png)、[成果预览](../m0-3/desktop-artifact-preview.png)。
