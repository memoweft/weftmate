# 干净固定 DSH 缺少本机 hero 输入接缝：交 Claude

真实云端复现：[运行38054885748](https://github.com/memoweft/weftmate/actions/runs/38054885748/job/114221238983)。固定源码是 `tests/contract/dsh-pin.json` 的提交；Relay（中继）库／前端缓存命中，原生Linux启动器与node-pty（终端伪设备库）编译成功，装配196包并合法省略1个外平台包；版本、哈希、入口、单实例和真实web（网页运行时）启动验证全部通过。201项测试实际执行，198通过／2失败／1既有条件跳过，84.297秒；job（任务）4分47秒。

其中账号能力失败属于平台夹具过时，已改精确验证Windows有记事本、其他平台明确无此能力、空appIds及CAPABILITY_UNAVAILABLE。另一条布局保护是产品发货可复现性真问题：

- 文件：`tests/weftmate-conversation-surface.test.ts`。
- 用例：`groups the official hero controls and official input in one vendor-owned layout seam`。
- 最小复现：从公开固定源码按新workflow（云端流程）构建／装配vendor（运行时依赖），执行 `node --test --test-name-pattern="groups the official hero controls" tests/weftmate-conversation-surface.test.ts`。该测试仅检查编译产物，不需要账号、模型或窗口。
- 干净编译的 `@deepseek-ai/dsh-client-ui-conversation/lib/client.js` 中 `composerBar` 没有 `"data-weftmate-hero-composer": ""`，同时仍有 `hero && ...HeroShell...`。
- 本机预构建vendor同一位置有该属性，而且composerBar已去掉HeroShell；本机测试通过，manifest（清单）仍标相同pin（固定提交）。
- 仓库 `src/plugins/weftmate-client/client.js` 的首屏布局样式依赖该属性；仅匹配pin元数据无法证明重建出同一界面。

布局断言原样保留，没有改宽、删除或跳过；独立vendor门继续阻塞。Claude需要决定正式采用的DSH布局接缝及可重复构建方式，再做真实Electron（桌面程序框架）浅深／窄窗验收。当前固定源码构建配方无法产生本机已有改动；把该本机改动未经记录地带进新产物会继续掩盖发货问题。TEST-1提供复现与阻塞检查，不另选布局方案。
