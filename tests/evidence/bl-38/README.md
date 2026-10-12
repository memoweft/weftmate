# BL-38：共享缓存写入边界

已定位并复现一条可清空缓存 node_modules 的路径：`scripts/vendor-dsh.mjs` 的安装命令继承父进程 `npm_config_modules_dir`，pnpm（包管理器）把独立装配目录里的安装重定向到缓存联接，随后 `validateModules → purgeModulesDirsOfImporters → removeContentsOfDir2 → rimraf` 删除 node_modules 的子项。当前源码中的调用点为 `vendor-dsh.mjs` 的 `runtime pnpm install` 与 `DSH frozen install`；修复前的基线 `e70f1427318db8aca66dc09777b65c743ffbc8d4` 对应第 341、466 行。事故当时的环境与首份日志缺失，**不能证明 2026-10-11 21:47 实际携带了这一配置，历史命令的精确归因仍未复现**。

所有试验使用自己的沙盒缓存和假仓库输出；真实好缓存与损坏现场只读。完整运行时从好缓存复制到沙盒，没有重新编译或修改主 DSH 检出。当前损坏目录实测为总计 201 个文件、node_modules 内 0 个文件；这与任务中「node_modules 剩 201」的记录有差异，保留两项观察，不改现场。

## 原版状态矩阵

[baseline-matrix.json](baseline-matrix.json) 记录 225 格：5 种指针状态 × 3 种同身份缓存状态 × 5 种结果 × Node（运行环境）／Windows PowerShell 5.1／PowerShell 7。结果包括正常、编译失败、装配失败、校验失败、安装阶段中断。各格都核对被联接指向的另一份缓存，以及已经存在的同身份缓存的文件数和 SHA-256（内容哈希）。没有继承安装目录覆盖配置时，225 格均未改动缓存。

文件系统、Windows junction（目录联接）和原版脚本的读写、删除、改名均真实执行；Git／编译／pack／install（打包／安装）的外部工作用固定夹具替代。此矩阵排除了控制流与清理分支，不能替代真实包管理器内部行为的验证。

| 工作树输出起始状态 | 同身份缓存完好 | 同身份缓存损坏 | 同身份缓存不存在 |
|---|---|---|---|
| 无身份的旧缓存联接 | 复用；旧目标不变 | 拒绝发布；两份缓存不变 | 成功或四种中途失败；旧目标不变 |
| 身份匹配的缓存联接 | 同上 | 同上 | 同上 |
| 身份匹配但不完整的缓存联接 | 同上 | 同上 | 同上 |
| 普通目录 | 复用 | 拒绝发布 | 成功或四种中途失败 |
| 不存在 | 复用 | 拒绝发布 | 成功或四种中途失败 |

Windows PowerShell 5.1 默认执行策略会先拒绝 `npm.ps1`，此时没有启动 vendor 脚本；包装矩阵用仅对子进程有效的 `-ExecutionPolicy Bypass` 执行原样 `npm run vendor:dsh > vendor.log 2>&1`。没有改变系统执行策略。

## 真实 pnpm 破坏机制与回归

[cache-proof.json](cache-proof.json) 保存实际计数和哈希。完整复制样本最初 33,185 文件；直接在联接路径安装、切换到隔离 store（依赖存储目录）、离线依赖缺失后剩 6,322 文件。清单、package.json、workspace／lockfile（工作区／锁文件）、bin 的内容均不变。

更关键的是：在新建的独立 `scratch/runtime` 中运行同样的安装，设置 `npm_config_modules_dir=../../repo/vendor/dsh-runtime/node_modules`，仍会清空联接目标的 node_modules，33,185 → 3,168 文件。日志首行是：

```text
Recreating <sandbox>/cache/other/node_modules
Lockfile is up to date, resolution step is skipped
Packages: +533 -66
ERR_PNPM_NO_OFFLINE_TARBALL
```

pnpm 11.7.0 的已安装分发文件 `dist/pnpm.mjs` 第 187960 行开始 `purgeModulesDirsOfImporters`，第 187996 行开始 `removeContentsOfDir2`；后者 `readdir` 目标 node_modules 后对每个子项调用 `rimraf`，保留 node_modules 根与运行时其它顶层文件，符合现场特征。此配置是试验显式设置的，未声称已恢复事故环境。

当前会话只读查询 `pnpm config get modules-dir` 与 `lockfile-dir` 均为 `undefined`，相关继承环境变量均未设置。它们不能证明事故时存在这一配置；如果当时同身份缓存已经完整有效，原版也会直接复用而不进入安装。缓存根／pin（固定版本）覆盖配置、当时实际加载的身份及原命令输出都没有留下快照，历史归因保留未知。

添加显式安装目录选项后，再用相同继承配置与离线失败点执行，旧缓存仍为 3,168 文件、整体哈希完全相同。原版脚本配合忠实模拟这条 pnpm 清理分支的夹具，专门回归断言先变红；修复后固定矩阵通过。固定测试同时保留源码安装与装配安装两处的覆盖，避免只保护其中一个调用。

## 写入边界

- 删除原先的装配前递归 `rm(RUNTIME_DIR)`；只在本次新建的空临时目录装配。
- 两处 install 显式设置 `--global=false`、`--modules-dir=node_modules`、本次目录内的 `--virtual-store-dir` 与 `--lockfile-dir`，覆盖环境变量和用户 `.npmrc`。
- 替换输出联接只解除自身；已有普通目录整体改名保留，绝不递归清空。
- 输出父级和缓存根的联接、输出与缓存根的重叠均拒绝写入。有效的既有指针可通过联接父级只读复用。
- 完整装配校验后整体改名发布；已有缓存包括损坏、空目录和失效联接均保留并报错。
- 只有创建临时目录的对象可清理它：核对目录身份、真实路径和临时根范围，内部联接逐个解除；构建中断不回收其他运行留下的目录。
- 打包暂存同样先在独立临时目录复制，失败保留原暂存指针；成功后替换。缓存身份校验增加完整清单的包版本、入口与 tarball 哈希，存活的 CLI（命令行入口）不再掩盖其它包缺失。

## 验证

固定矩阵与边界测试见 [vendor-cache-safety.test.ts](../../vendor-cache-safety.test.ts)，既有缓存竞态、锁、主检出只读测试保留。最终测试计数与 CI（持续集成）结果见工作包交付报告。

完整门还发现并修复了两类既有测试环境／收尾问题：Windows PowerShell 5.1 的默认策略拒绝合成 `.ps1`，测试子进程显式设置仅本进程的 `-ExecutionPolicy Bypass`，2 秒预算与进程树断言不变，每轮先清除旧 PID（进程标识）文件；BL-29 延迟探针的业务指标全部完成后，`app.close()`／`app.quit()` 仍可能被托盘行为留住，测量结果落盘后明确退出合成 Electron（桌面程序框架）壳，未验收或修改产品退出行为。探针超时前的输出也进入断言诊断，嵌套目录被限定在探针专属目录，退出前按创建时间、可执行路径与目录清理其进程。全量中的一次原生 `0xC0000409` 与一次无新汇总的进程提前退出如实留在交付报告，未添加跳过、自动重试或延长阈值。

修复后正常 `npm run vendor:dsh` 直接复用当前有效指针。两个真实共享好缓存和当前指向的独立好缓存，前后各 33,185 文件；联接 inode（文件系统身份）与修改时间均不变。当前工作树的 `vendor` 本身还联接到主检出的 vendor，所以只读复用分支必须在任何写入检查与更新前返回；否则报错，不能借父级联接修改主检出。

未重新编译完整 DSH；没有原事故环境快照，历史那一次调用的精确配置仍无法确认。外部手工命令仍能写入缓存，本修复保证受管 vendor 与打包暂存路径不会按继承配置或联接进入已发布缓存。
