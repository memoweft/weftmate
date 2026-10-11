# 权限与执行记录验收

所有场景使用合成账户、合成电脑名、随机端口与隔离临时目录，真实模型请求 0。私人参考图仅查看，没有复制进仓库。

默认值继续走既有审批机制，不引入首次引导；在审批条上可选「以后这类都允许」。删除、对外发送、花钱只能选择每次问或禁止。设置里的九类选项与项目覆盖使用现有账户、项目存储；执行记录来自现有审批与工具记录，与其一起保留和清理。

界面矩阵由 `tests/integration/st-2-ui.mjs` 驱动真实 Electron（桌面程序）及手机浏览器：

| 窗口 | 浅色／深色 | 内容 |
| --- | --- | --- |
| 电脑 1200／480 | 各一组 | 权限、规则菜单打开、记录、筛选菜单打开、筛选写入、返回准确对话 |
| 手机网页 360×780／390×844 | 各一组 | 同上，权限可修改、没有横向溢出 |

文件模式 `desktop-{宽度}-{主题}-{permissions,rule-menu,restricted-rule-menu,records,record-filter,record-project-filter,record-time-filter}.png` 与 `phone-web-{宽度}-{主题}-{permissions,rule-menu,restricted-rule-menu,records,record-filter,record-project-filter,record-time-filter}.png`。`desktop-{主题}-approval.png` 是审批快捷操作。`ui-checks.json` 有八组断言结果。手机网页截图仅证明网页内容区；系统栏证据另列，不将网页视口声称为整屏原生验收。

真实宿主与固定助手运行时另由 `tests/integration/st-2-native.mjs` 验收实际文件写入、禁止无副作用、项目覆盖及审批快捷操作。合成模型只在测试进程自己的随机回环端口响应，不连接真人模型。四个主场景已通过：实际磁盘写入且零审批；命令禁止且没有副作用，真实工具回复明确告知合成模型；项目允许覆盖全局禁止；原生审批快捷操作保存全局规则，下一次写入零新增审批。`native-checks.json` 记录实际断言与合成请求数。

`native-{主题}-project-menu.png`、`project-settings.png`、`project-rule-menu.png`、`project-overrides.png` 是项目入口／设置／菜单打开／覆盖选项；`native-{主题}-approval-shortcut.png` 是真实审批条，`native-{主题}-records.png` 是真实宿主的执行记录。系统文件夹选择框使用 Electron 原生接口的测试替身返回合成路径，没有接管本人桌面；真实系统选择框待本人试用时确认。

客户端配合：安卓现有壳需允许新增的 `/personal/v1/execution-records` 路由及其查询键，并允许审批回复 `global-category`，需要新壳版本；苹果端需加入相同数据字段、路由和页面。本包按边界未改原生壳。手机网页目前可查看并修改全局规则；项目文件夹设置继续遵循电脑端管理惯例。

恢复：单条设置可重新选择；「恢复默认」清除全局自定义值，项目的「继承通用设置」清除该项覆盖。损坏的可选权限字段在宿主加载时回退并持久化为既有默认行为，账户与聊天继续可用。不会通过修改依赖、跳过断言或弱化审批测试交付。

固定检查：完整必过组 `node .github/scripts/ci-unit-tests.mjs required` 已完成 1,640 通过／0 失败／14 个既有条件跳过，296 个文件，约 28 分 28 秒；手机交互五文件组 111 通过／0 失败；权限判定／摘要／项目／继承固定测试 45 通过／0 失败；资源与运行时装配相关 27 通过／0 失败；类型检查通过。固定运行时集成组 31 文件、219 通过／0 失败／0 跳过，约 9 分 23 秒。最终截图和公开扫描在全部收尾后补齐。
