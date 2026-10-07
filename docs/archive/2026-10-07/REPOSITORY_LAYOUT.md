# 仓库与本机文件存放规范

> 当前补充：主仓库正式文档在本目录；唯一跨侧入口为相邻 `../../collab/README.md`（本机定位 `D:/AIProjects/WeftMate/collab`）。FrontendDev 是独立 Git 工作树，未提交改动不自动同步；其 `node_modules`、`vendor` Junction 也不提供技术只读隔离，按协作约定不得写共享依赖。

## 当前实际布局

> 当前定位补充：主仓库为 `D:/AIProjects/WeftMate/Repository`，唯一协作目录为 `D:/AIProjects/WeftMate/collab`，前端独立工作树为 `D:/AIProjects/WeftMate/FrontendDev/Repository`，参考包位于 `D:/AIProjects/WeftMate/References/RulesMerge_2026-09-14_164853`。下方“本次清理规则”“目标布局”“清理与真实落库”三节的 2026-09-08 删除、迁移、S00-B 描述仅为历史授权与历史计划；本轮无迁移计划。

工作区是多个独立仓库的容器，本身不是应整体提交的主仓库。保留当前运行目录，避免破坏脚本、虚拟环境和依赖引用。

```text
AIProjects/
├─ README.md
├─ WeftMate/
│  ├─ AGENTS.md                 # 仅定位到仓库规则
│  ├─ Repository/              # 主程序 Git 根，全局 docs 在这里
│  ├─ References/              # 原始输入、11 个研究参考仓库，只留本机
│  └─ Runtime/                 # 现用环境、依赖和私人运行数据
├─ AIGame/Repository/           # WeftMod 手机组件的兼容路径
├─ MemoWeft/Core/               # 独立记忆源码仓库
├─ MemoWeft/Hosts/HermesAgent/  # 独立接入/兼容仓库
├─ MemoWeft/Runtime/            # 私人运行数据
├─ Shared/Dependencies/DeepSeekHarness/
├─ WeftLearn/                  # 独立学习产品，保留现有布局
└─ Tools/                      # 独立本机工具
```

## 主仓库

README、AGENTS、LICENSE、package.json 和锁文件位于根；src 放源码、tests 放测试、scripts 放工程工具、docs 放现行全局文档。docs/tasks 一项任务一张卡；docs/evidence 只放小型脱敏核验。docs/PRODUCT 与 ARCHITECTURE 保留被既有测试和源码注释引用的兼容路径，内容收口到当前方向和代码定位，不维护第二份进度。

源码中的 src/runtime、根 runtime/plugins、构建资源、fixtures（测试夹具）、vendor 声明和第三方许可证都是可能的必要输入，不能按目录名字删除。node_modules、vendor/dsh-runtime 及固定 DSH 工作树为现有开发依赖，本次保留。

## 插件与其他仓库

WeftMod 文档名称统一；本机 AIGame/Repository 暂保留，因为脚本存在硬编码。README、AGENTS、docs/COMPONENT 在插件仓库内自洽；docs/product/VISION 和 PROJECT_MAP 是打包器需要的兼容说明，不再复制全局路线。原 AI_GAME 环境变量、接口、Python 模块和数据库格式保留。

MemoWeft 保持独立；WeftLearn 的产品/教学规范与 Hermes、共享依赖的技术资料保留。此前的定制开发角色限制已清理，不从其他项目继承旧总代理制度。工作区 README 只导航，各项目在自己的仓库开工。

## 哪些提交，哪些只在本机

| 类别 | 存放与处理 |
| --- | --- |
| 源码、测试、锁文件、许可证、脱敏配置模板 | 各自 Git 仓库 |
| 全局方向、当前状态、开发与用户验证规则 | 主仓库 docs |
| 手机组件接口与定位说明 | 手机仓库 docs |
| 真实凭据、数据库、会话、截图、模型 | 现有受忽略 Runtime 或明确的 .local/.private 路径 |
| 构建和临时产物 | 脚本规定的受忽略输出位置；不用时清理 |
| 本机路径映射 | workspace.local.json；不提交 |
| 本轮原始输入 | WeftMate/References；不整包导入源码仓库 |

忽略规则不清除已追踪文件或 Git 历史，也不等于秘密扫描。模型、数据和已安装环境本轮不搬迁。未来更改路径时应同时核对配置、脚本、虚拟环境、链接和实际启动；不创建空的目标目录假装已经迁移。

## 本次清理规则

2026-09-08 用户明确授权整理和删除旧资料，不创建备份。删除项目旧总控、过期路线、修复归档、旧导出和经核对可重建的暂存物；私人会话与模型保留。保留所有现用仓库的 Git 历史及未提交源码。远端改名或发布未执行。逐项结果在 [任务卡](tasks/S00-A.md)。

各仓库运行 `python scripts/check-project-layout.py` 检查入口、链接和精确忽略规则。此检查不验证运行能力、远端或用户验收。

## 目标布局与当前布局如何衔接

累计包明确给出以下未来目标。它是规范目标，不是当前脚本已经支持的默认目录；当前实际布局见本文开头。此次用户要求不备份，因此不创建包内示意的 backups 目录。

```text
PersonalAssistant-workspace/
├─ repos/
│  ├─ weftmate/       # 主程序独立 Git 根及全局 docs
│  ├─ memoweft/       # 独立记忆仓库
│  └─ weftmod/        # 独立可选能力仓库
├─ dependencies/     # 固定开发依赖源码
├─ local-data/       # 私人数据，日常和测试隔离
└─ artifacts/        # 截图、日志、安装包、交付材料
```

本次先归位仓库内文档，保留 Repository 层、MemoWeft/Core、Shared/Dependencies 和现有 runtime（运行数据目录）。移动前逐项检查配置、脚本、导入、绝对/相对路径、虚拟环境和链接；更改后验证同一源码候选的启动、退出和数据定位。不能只修改说明就宣布源码与数据分离，也不能仅因目录名不整齐直接移动数据。

## 清理与真实落库的完整顺序

1. 核对主程序和手机仓库的真实分支、提交、已修改/未追踪文件、远端默认分支、发布与自动化引用。读取不到的部分明确记为未核实，不能用 ZIP 身份替代。
2. 保留历史和现有源码修改。此次按用户指令不备份；删除的未追踪材料不能承诺恢复。其他未获授权的私人数据库和会话不按缓存处理。
3. 在整理分支形成文档与维护候选。两库当前均使用 chore/repository-layout；未提交，未推送。上一轮分支建立滞后这一点如实记录。
4. 按现行保留、过期删除、可重建产物、私人数据分类审查；删除需有精确路径、原因、引用检查和处置结果。已授权范围内直接执行，不重新要求用户批准同一份清理。
5. 检查提交清单是否只属于本仓库，必要文档是否受追踪、私密目录是否受忽略。AI-GAME 远端更名另核实目标名、权限、工作流、发布和外部引用；不顺手更改 API（应用程序编程接口）、凭据键或数据格式。
6. 文档检查、自测、实际落库范围核验与用户 A01—A04 分开完成；全部满足当前约定后才进入 S00-B。远端没有执行，就保留未完成状态，不把本机删除数量当作整个归位任务完成。

当前真实 Git 与远端事实见 CURRENT_STATE 和 tasks/S00-A；本文件只规定顺序。目录映射在 WORKSPACE_MAP.example.json，迁移归属在 DOCUMENT_MIGRATION.json；前者不是产品已读取的配置。

## 保留目录的实际用途

| 实际目录 | 分类与当前处置 |
| --- | --- |
| WeftMate/References/Research | 研究参考源码，包含 11 个独立 Git 仓库，已从 Runtime 移出且核验历史和文件 |
| WeftMate/Runtime/HarnessStores、HarnessWorktrees | 依赖缓存与已登记的固定 DSH 工作树；保留现有依赖关系 |
| WeftMate/Runtime/MemoWeftVenv、Toolchains | 已安装的环境与工具链 |
| WeftMate/Runtime/OwnerView、Stage3/data、Stage4B、Stage4C | 含会话、凭据或任务数据的本机运行状态；不当作普通缓存删除 |
| WeftMate/Runtime/DeviceBackups | 既有设备 APK（应用安装包）留存，本轮未创建备份，也未改变设备 |
| AIGame/Repository/runtime/console、sessions、backups、trial-archive | 现有任务/会话与数据库数据，保留原路径及关联证据 |
| AIGame/Repository/runtime/models、envs、toolchains、cache | 模型与现用环境、依赖缓存 |
| Hermes 的 skills、optional-skills | 产品功能技能，当前 CLI（命令行界面）会加载；不属于已删除的自定义开发角色限制 |

已删除的安装产物、临时探针、源代码复核副本和测试缓存由原脚本按需重建。源码 build 目录中的图标、runtime/plugins 模板及 src/runtime 网关都有现用用途，继续保留。
