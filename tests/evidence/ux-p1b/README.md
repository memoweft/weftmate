UX-P1b 收尾修复了记忆改版后的旧 DOM（文档对象模型）夹具与旧列表断言，同时补齐两处手机记忆行为：切换类型后可返回「全部」；浏览器成功读取当前宿主登录身份后标记连接已核验，未登录响应仍拒绝。

- `node --test tests/personal-access-ui-interaction.test.ts tests/personal-access-memory-ui.test.ts "tests/mobile-*.test.ts" tests/ui-core.test.ts`：合入 `origin/main` 后 167/167，无跳过、无删除。跨账户迟到响应、草稿、遗忘确认、来源可读性、修订分页、手机模式切换、审批与提问原断言保留。
- `npm run typecheck` 与共享资源生成检查通过；impeccable（界面精修技能）机械检查无问题。
- `node tests/integration/ux-p1-ci-memory.mjs`：使用生产手机网页、隔离合成宿主与合成账号，390×844 / 360×780、浅深主题下「全部 → 理解 → 全部」4/4；跨类型条目、按钮按下状态及无横向溢出均有断言。截图：[390 浅色](memory-390-light.png)、[390 深色](memory-390-dark.png)、[360 浅色](memory-360-light.png)、[360 深色](memory-360-dark.png)，完整记录见 [checks.json](checks.json)。
- 真实 Electron（桌面程序框架）原 UI-1（界面回归）测试复验导航、主题、审批、提问、引导 / 排队、成果 / 来源、附件、停止与保留草稿；定位器仍按名称 / 角色，只把新对话匹配限定为主按钮，避免同时选中新增下拉按钮。
- 逐失败用例的分类、原因与原保护点对应写入指定的 `Runtime/Orchestrator/ux-p1b.result.md`；最终 CI（持续集成）结果见 PR #170。

没有更改客户端接口、权限或安卓版本，没有请求真实模型或读取日用数据。Apple（苹果端）原生接线仍属于原工作包边界。
