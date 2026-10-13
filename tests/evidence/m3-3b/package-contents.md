# M3-3b 包内容和本机配置

最终交付 `~/Desktop/WeftMate/trial/WeftMate.app`，旁边 `先读我.txt`。Intel x64，固定 bundle ID `com.memoweft.weftmate`、产品名 WeftMate，临时 ad-hoc 签名；`codesign --verify --deep --strict` 通过，无 Developer ID、无公证、无下载隔离属性。只生成目录包，没有 DMG/ZIP、更新源或对外发布。`package.json` 的旧 Mac dmg/zip 雏形未直接用作本机交付；新构建入口显式只打 `dir/x64`。

| 内容 | 大小/身份 | 本机状态 |
|---|---|---|
| 整个 WeftMate.app | 747,272 KiB，约 729.76 MiB | 最终包保留；中间包、暂存、DSH 构建缓存已删除 |
| Electron Framework 与 helpers | 291,820 KiB，约 284.98 MiB；Electron 43.7.8，x86_64 | Node 随 Electron；本人双击不用 Node/npm/Git；本机试用默认禁 GPU |
| DSH runtime | 370,648 KiB，约 361.96 MiB | pin `47f943859bef60e4160492346772ded9b24f765a`，rc.5＋四补丁；清单197包，Mac实装195包，两项Linux-only optional不安装 |
| app.asar | 53,172 KiB，约 51.93 MiB | WeftMate桌面、宿主、共享客户端、生产依赖；无repo tests/dogfood/config/凭据 |
| app.asar.unpacked | 256 KiB | 上游 get-windows Mac executable等；本机Windows addon编译Makefile、build-tmp和binding残留仅在Mac打包中排除 |
| 其余资源 | 图标、locale、签名封装等 | 固定品牌；无用户数据与测试替身 |
| 记忆 Core / Python | **不在包内** | `~/Library/Application Support/WeftMate Trial/memory-config.json`只存绝对路径引用，0600；引用已有 `~/Desktop/WeftMate/memoweft/py/.venv/bin/python`（3.11.17）与 `py/src`，Core `ddd919d88ade73f26ce98e213a8768102287cda9`；不装系统包、不改外仓/分支，Mac trial禁止写Python bytecode |
| 约135 MB按意思找模型 | 不携带、不下载 | 当前只读Core版本未提供该实现/依赖；正式命名记忆形成及召回不依赖它 |
| macOS frpc / 内容TLS / 更新 | 不携带、不启用 | 公网/跨网手机、中继与证书未配置；不套Windows NSIS更新监护链 |

资料与配置使用 `~/Library/Application Support/WeftMate Trial/`。只有不含身份/密钥的 `memory-config.json` 已准备；`Data/` 与 `desktop-config.json` **仍不存在**，本人首次双击才创建干净资料、宿主标记和首次引导。测试明确传 `--user-data-dir`，Mac安装入口此时不会碰正式配置；每轮创建并清理合成临时目录。默认18186；保留正式账号登录公开配置，但没有账号/令牌；中继、ACME、更新、自启关闭。测试只连接本地合成云，不连接线上云或本人Windows。

Windows事实核对：`docs/WINDOWS_RELEASE.md`、`docs/VENDOR-PACKAGING.md`、`package.json.build.extraResources`、`scripts/release/windows.mjs`与`stage-dsh-runtime.mjs`一致——现有Windows包带Electron/Node、固定补丁DSH、frpc.exe与公开根CA，**没有**记忆Core和Python随包闭包；记忆沿外部`personalMemoryConfig`引用已有部署，数据按账号留宿主资料目录。不能把外部运行记忆说成Windows安装器已经随包。Mac本次实现同样的本机引用方式。

`package.json`中每次构建审计的机器可读结果在`package.json`（本证据目录）中：app.asar 6,438项、5,411文本文件及46二进制文件；松散资源32,749文本文件及162二进制文件。沿用Windows的相同凭据/资料/开发身份检查，同时显式传入Mac的`Contents/Resources`，不是用符号链接适配器跳过资源扫描。各项违规命中0，运行闭包启动/入口/哈希校验通过。旧适配器曾让松散扫描为0，已发现并修正，最终结果为完整扫描。

复建：按第一步证据先构建同pin/补丁的`vendor/dsh-runtime`，然后 `CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/build-mac-trial.mjs`；现有trial不覆盖，应先保留旧包再重建。未对外发更新说明。
