# IA-2a 验证与交接

所有运行使用合成账号、系统临时目录、随机端口；未访问日用18186或8081，未修改固定DSH（助手运行时）版本。没有前端布局改动。

- `identity-native.json`：真实Electron（桌面程序框架）宿主、固定DSH、MiMo；原文件/消息/链接/命令回执/分组保留，独立完整目录回滚及三次程序关闭。2.1原PR #140已合并，本包复验。
- `history-native.json`：真实宿主公开历史、中文搜索、日期定位和独立增量。
- `history-performance.json`：3段、1万/10万条合成公开条目，每项30轮；原生读接口夹具按范围切片，记录公开读取条数/字节。不是物理磁盘或界面帧时间。
- `history-native-performance.json`：固定DSH真实持久化日志，1万/10万条各30个新进程，原生冷/热尾页分开计时。冷p95（第95百分位）约102/594ms；10万条未达200ms，原生读取7.1/71.6MB仍线性增长。这是已确认的限制，不以逻辑页测量掩盖。
- `side-native.json`：真实宿主从旧消息开旁聊，无原文复制/首句执行；独立目录真实工具写入并读取文件后，一行结果回主对话；显式/自动回写共用结果和动态身份，无主对话模型会话。
- `usage.json`：本续做全部三次真实模型运行的数值用量，含一次来源接口差异导致的失败运行；不包含凭据或请求/回复正文。

复现：

```powershell
node --test tests/ia-2a-identity.test.ts tests/ia-2a-history.test.ts tests/ia-2a-side-chats.test.ts
npm run typecheck
node scripts/measure-chat-history.mjs
node scripts/measure-native-chat-history.mjs
node tests/integration/ia-2a-identity.mjs --side
node apps/mobile-ui/src/check.mjs
```

最后一项真实宿主脚本从已批准的Machine（机器级）环境读取MiMo密钥，仅在进程内使用；测试根目录打印供清理核对。`--side` 包含真实文件工具目标，所有工作在测试程序独立目录。全量测试只在CI（持续集成）运行。

给IA-2b：先接D33清理再启用接力；宿主新增索引的 `removeEvents/invalidate`、`contentRevision`、`chatResults` 摘要与 `session.sideChat.contextTransfer.sourceRefs` 均须纳入清理。当前没有旁聊摘要正文或接力摘要注入；`references_only` 必须诚实显示。补原生范围读取接缝后重新跑冷进程测量，不能只测已恢复会话。主对话发送、接力、资源聚合及统一逻辑生命周期尚未上线。

给IA-3：按能力读取9.3/9.4。历史边界与增量水位分别保存，稳定事件ID用于虚拟行展开/高度/焦点；`indexState=building`时日期/搜索尚不完整。仅引用建聊提示“相关上下文尚未带入”；保留草稿，等待创建回执后发送。主对话结果没有原生seq，通过sourceRef回原旁聊；同一activityId/notificationRevision供TB-1共用。首屏可输入、60秒滚动帧耗时及1千→1万条渲染内存预算须在真实程序验收，本包不把服务端计时替代界面成绩。
