# FX-17 纠正记忆验证

QA-4首轮模型输出与重写输出的固定回放在Core（记忆核心）PR #99的 `py/tests/test_fx17_correction.py`；改前分别为 `topic_name_not_in_span`、`duplicate_cognition_in_batch`，改后同一新对象取代两个旧对象。原QA-4证据未改写。

- `before-mimo`、`before-mimo-2`：真实MiMo（小米模型）改前探测。实际出现确认命题拒写和未失效的肉桂提议项；没有冒充每次都重现同一个双目标重复错误。
- `full-mimo`：真实Electron（桌面程序框架）／固定DSH（助手运行时）／真实Core，两个肉桂对象失效、一个柠檬对象有效；34轮无关问答、重启、LAN（局域网）`local-quality`新对话回答柠檬且 `memoryUsed` 仅含新对象。
- `rejection-verified`：人为替换形成模型输出为非法解释，实际健康、动态、对应回合警示、展开原话、桌面点击重试通过；390×844远程网页展示通过；旧对象来源页可直接看到纠正原话。
- 较早 `after-mimo-1`、`rejection-final` 及八步／变体探索批次保留失败。`rejection-final` 暴露轮询重绘收起详情，已修为状态未变化时保留展开节点；未将原失败成绩改为成功。

运行器：`node tests/integration/fx17-correction-desktop.mjs --model mimo --core <Core>/py/src --out <evidence-directory> --full`；人为拒绝使用 `--reject`。固定题集见 `tests/fixtures/fx17-corrections.json`。真实核心回归 `tests/personal-memory-fx17.integration.test.ts` 还覆盖失败持续超过32轮、重启、连续失败重试、共享后继及两端来源。

这些开发运行包含未提交改动，运行器开头的Git（版本控制）HEAD（当前提交）不能代表完全固定的产品源码；最后固定提交由CI（持续集成）验证。失败、取消、重写与复跑全部计入用量。没有访问本人日用程序、18186、8081或日用密钥库。
