# 来源格式核实与范围（2026-10-13）

全部样例是虚构人物与内容，由 `generate.mjs` 生成；没有读取本机真实 Codex / Claude Code 会话。

- ChatGPT 官方说明确认导出 ZIP（压缩包）内有 `conversations.json`：[官方跨账户导出说明](https://help.openai.com/en/articles/9106926-transfer-exported-conversations-between-chatgpt-accounts)。适配已知 `mapping/current_node` 消息树，沿当前分支取可见 user / assistant 文本；公开帮助未承诺机器格式稳定。没有当前节点或树损坏时拒绝。
- Claude 官方说明提供导出：[Export your Claude data](https://support.claude.com/en/articles/9450526-export-your-claude-data)。适配已知 `uuid/chat_messages/sender/content` 或 `text` 列表；仅文字与附件名，不读提取后的附件正文。
- Codex 格式依据官方源代码：[rollout protocol](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)、[message phase](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs)。取 `session_meta` 与显示事件 `user_message`、`agent_message.phase=final_answer`／`task_complete.last_agent_message`。不取 response_item 中注入的用户上下文或工具返回。没有可辨识的最终标记时拒绝。
- Claude Code 依据官方 [Hooks reference](https://code.claude.com/docs/en/hooks) 的 transcript（会话记录）入口和官方仓库 [#27361](https://github.com/anthropics/claude-code/issues/27361) 的 JSONL（逐行 JSON）样例。取非侧链的 user 和 `stop_reason=end_turn` 的 assistant 文字；跳过 thinking / tool_use / tool_result / isMeta / 系统注入。公开问题确认部分旧版本没有 end_turn，只有 null；不能确认最终答复的文件明确报「这个文件的格式认不出」，不推测最后一条文字就是最终答复。这类旧记录以后需官方明确完成标记才能接入。

合成覆盖：30段跨2024与2026的对话、当前分支与废弃分支、空对话、约五万字对话、附件名、重叠导出、工具输出／推理／系统提示剔除、未知格式。ZIP样例只用于此解析器，无图片／附件本体。

国内应用调研仅依据公开官方材料：

- 豆包：[隐私政策](https://www.doubao.com/legal/privacy) 可查阅对话与删除相关权利，但本次未找到公开的官方全量聊天机器导出入口或格式说明。不等同于断言没有导出。
- Kimi：[用户隐私政策](https://www.kimi.com/user/agreement/userprivacy?version=v2) 与 [帮助中心](https://www.kimi.com/help/others) 有内容管理、删除与支持入口；未核实到官方全量聊天导出文件格式。网页／应用产物的导出不等于聊天历史导出。另有官方 [Kimi Code CLI 变更记录](https://www.kimi.com/help/kimi-code/cli-changelog) 明确支持 /export-md 导出当前会话为 Markdown（轻量文本格式），kimi export 还带 manifest（清单）；这与 Kimi 网页的全量历史导出是两个范围，本包不实现。
- DeepSeek：[官方中文版隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html) 明确列出头像账号区域 → 设置 → 数据管理 → 导出所有历史对话，因此官方导出入口已核实。官方政策没有给出文件格式；独立归档工具源码报告 ZIP 内 conversations.json、消息带 fragments，这只是后续核实格式的线索，本包没有据此猜着接入。

这三家均不实现抓取、扩展、登录或推测格式；获得正式格式说明与合成文件后另包适配。
