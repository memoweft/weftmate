# TEST-1 固定 DSH 测试恢复

初始主干 `e3c95c69b9ed66b2226911c8a90542c5db1311ad`，Windows / Node 24 / 固定 DSH `47f943859bef60e4160492346772ded9b24f765a`。从原 `vendorTests` 获取26个文件，直接 `node --test --test-concurrency=1 --test-reporter=tap <文件列表>`：184条、160通过、24失败、0跳过，耗时116.887秒。逐条分类见 [baseline-failures.json](baseline-failures.json)。

22条是隔离夹具遗漏新增的 `personal-personalization.mjs`；现在共用按语法导入关系递归装配的帮助函数，包含相对静态导入、动态导入、重新导出和副作用导入，所有 DSH（助手运行时）包依赖仍解析到一个固定实例。`personal-plugin-fixture.test.ts` 在无 vendor（固定运行时依赖）的干净 CI（持续集成）检查两个入口及全部传递相对导入；未来新增导入不需修改夹具文件清单。

工具范围测试的旧列表与提示组装上下文落后于 PF-1 和原生计划模式；原生审批服务也没有挂载，产品插件注入依赖一直未满足。修复夹具后精确比较含 `load_tools` / `exit_plan_mode` 的工具列表，测试加载前后提示、原生注册表未被改写、150调用没有个人限次、伪造来源拒绝、共享账号无工具。合成宿主政策 IPC（进程间通信）明确拒绝任何执行认领，仍不允许假的来源运行。

宿主就绪公告早于异步状态快照落盘是产品真问题。最小复现为 `node --test tests/personal-host-restart.test.ts`：收到第二次 ready/degraded 后立即读取状态，原本是 `runtime.state=unavailable`，期望 `listening`。改为等待快照提交再发公告；重启测试本身未改断言，新增单测持有快照提交承诺，验证启动不会先完成。

本机 `node .github/scripts/ci-unit-tests.mjs vendor --report <报告>`：27文件、201通过、0失败、0跳过，132.287秒。原26文件全跑，并恢复 `weftmod-service.test.ts` 17条。独立门和云端最新结果以 PR #197 与仓库外交付报告为准。

`ci-vendor-selection.test.ts` 用独立临时仓库验证：缺 vendor 和错 pin（固定版本）均非零退出；`known` 空清单不自动发现测试；`required` 提醒另跑 vendor；完整 vendor 文件中的新兄弟断言失败仍阻塞并进入失败名单。`nightly-vendor-tests.test.ts` 使用合成工作树和110/0、108/2结果生成实际夜间报告，验证失败报警、红色名单及缺构建的显式错误，不改计划任务。

保留的外部 Design（设计资源）文件缺失与 POSIX（类 Unix 系统）进程树真实缺口／Linux自身 optional package（可选包）被故意省略的夹具，见例外清单。`vendorTests` 110项已从例外迁移到独立必过目录，不新增任何 vendor 跳过。全部合成账号、随机端口、隔离临时数据，无真实模型或本人日用数据。

完整本机独立必过门：266文件、1392通过／0失败／14既有条件跳过，1047.938秒；新增模式选择保护另1/1通过。合主干相关组139/139、既有夜间维护12/12、类型检查通过；实际夜间vendor步骤201/0/0，109.532秒。结构化计数见本目录JSON。云端装配实际发现并补齐固定Linux启动器与node-pty本机编译，保留上游打包／真实启动校验；最终云端状态见PR与交付报告。
