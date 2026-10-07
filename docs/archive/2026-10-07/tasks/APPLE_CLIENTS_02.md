# APPLE_CLIENTS_02：Mac 原生检查更新

当前日期：2026-10-05。状态：实施中；由用户“继续下一阶段”授权，Windows主协调已下发本轮范围。旧A/build4候选仍待本人试用，不回填用户通过。

## 本轮结果与归属

Mac登录前从标准App菜单打开独立更新窗口，登录后设置可进入同一公共更新状态。官网版本检查与私人账户服务器独立；按本机真实Bundle版本/构建和进程架构判定检查中、有新版、已最新、本机较新、暂无对应架构和读取失败。下载按钮打开已校验的官网不可变DMG链接或Mac平台页，由本人手动安装。

Apple拥有apps/apple及本任务卡；Windows主协调拥有全局记录、官网发布和Ubuntu/Windows服务。Windows本轮主仓基线408c2a1；本机独立Apple历史基线8e45e1928f69b427b329cdaa8869d4da34e0c1cf，不覆盖其服务或全局文档。只做Mac更新，不展开B续聊、模型、iPhone/Watch构建或签名迁移。

## 实际环境与现有码位置

- 工作根：/Users/yun/Desktop/WeftMate/AppleWork-844429c/WeftMate，apple/milestone-a，开工工作区干净。
- macOS26.6.2/25G83，Intel x86_64；Xcode26.3/17C529，Swift6.2.4。实际主任务元数据model=gpt-6.1-sol、effort=xhigh；子Agent继承，执行后按真实记录。
- Mac场景/菜单：apps/apple/macOS/WeftMateMacApp.swift；设置：apps/apple/UI/SettingsView.swift；窗口和账户分别由WeftMateRootView/AppleAppModel承载。
- 独立公共解析与版本边界放WeftMateCore包新文件；Mac更新状态/界面放macOS目录，由现有项目生成器加入Mac target。既有PersonalClient、凭据和个人Transport语义保持。
- 旧保护实例PID39901/旧Keychain许可与失败轨迹独立保留；本轮使用全新无账号Debug namespace，不读旧登录项，不清凭据绕过许可。

## 方案及正式依据

唯一正式公开清单：https://www.weftmate.com/downloads/releases.json，schemaVersion1、siteUrl固定https://www.weftmate.com/downloads/。未来字段以已发布清单及Windows确定契约为准，不维护第二套发布schema。只挑唯一macos条目，匹配可靠process ABI；available才接受版本/构建/架构/bytes/SHA与合法不可变DMG地址。downloadUrl/qrUrl相对siteUrl解析，其他设备只进入官网平台页，不在Mac更新页列全平台包。

新增独立公共URLSession：正常TLS，ephemeral且无个人cookie/password/modelKey，拒绝不合来源跳转，有界响应与超时；解析/数值版本比较与显示状态可测试。App级公共ObservableObject共享菜单窗口与设置入口，重复点击合并/禁止重入，过期回包不覆盖新状态；公开检查失败显示真实失败。合理原生窗口、滚动和焦点，沿用Weave视觉，无长诊断文案。

## 执行分工、验证及预算

由实际子Agent分别编码公共更新Core与边界测试、Mac GUI/共享状态、实际构建与本机界面/安装包验证；主助手定范围、独立审查和截图验收、固定候选并交接。文件归属分开，不并发写同文件，不reset/clean/stash或全量格式化。

先一次正常URLSession官网GET作为本机入口基线，确有不同原因最多一次针对性网络重验；不启用开发CONNECT、改全局代理/DNS/TUN或放宽证书。功能验收中实际App版本4读取官网4、发布后实际4读取5及实际5读取5分别是版本状态用例，不伪造installedVersion或反复做诊断。

Core新增测试覆盖营销版本优先、build4与10的数值比较、等值/本机较新、缺坏版本、架构不匹配、schema/唯一平台/非法地址和有界网络/状态边界；复用原21项依据，不重复全平台。界面一批实现后同批验桌面与较窄更新窗口，必要只一次修复及一次确认；保留原失败，不无限重试。测试账户/模型请求均为0。

保留修改后Debug代码、真实Bundle0.1.0/build4的新独立开发App（明确不是官网原发布build4），用全新namespace/无账号核已最新；最终Release候选升0.1.0/build5，同bundle/Intel。唯一打包、SHA/bytes/签名/DMG/实际入口核实后以原单文件受限通道交Windows；其原子发布5且保留4文件。随后既有真实Debug4核有新版和实际打开下载，最终真实5核已最新；不为了演示重复构建，不自动安装。

## 数据范围、恢复与交付停止点

更新不自动覆盖/卸载/清数据，不变更私有会话源或默认模型。旧临时签名凭据保留、持久草稿和公网私人服务仍未验/未实现，官网读取成功不倒填这些边界。旧build4包和源码/失败证据保留，关闭新更新窗口或新实例可停止本轮；恢复用已保留候选，不改旧钥匙串。

完成后提供确切新包/版本/来源/公开截图与3—5项本人操作，标待本人试用并冻结；下一阶段须主协调新授权。最新实际结果以下方实施记录为准，不提前宣布完成。

## 本机官网基线与实际分工（2026-10-05）

主助手一次普通原生URLSession GET已exit0/HTTP200，2202字节，schemaVersion1/siteUrl与正式值一致；macos实际available/0.1.0/build4/x86_64，937054字节与既有DMG SHA一致。ephemeral无Cookie/cache或个人认证、正常系统TLS、无开发proxy；有界64KiB及15/20秒超时、拒绝redirect。公开原清单与日志在源码外AppleValidation-Updates-20261005/public-manifest-original.json、public-manifest-baseline-01.log。此为官网入口证明，不是私人服务器公网/旧签名覆盖通过。

实际活跃子Agent为mac_update_core（新增公共Core/边界测试）、apple_mac_sidebar（Mac共享状态/菜单/设置/窗口）、apple_lan_ui（Debug4/实际AX与后续包验证准备）；均继承实际主任务gpt-6.1-sol设置，未使用模型override。因旧install槽位不可用，验证复用现有lan_ui，其角色以本段为准。主助手独立审查/截图/候选与文档提交，Core和UI互相约定API，验证等待代码冻结后唯一Debug构建。

## 首批实现与Core实际检查

新增PublicUpdates.swift和PublicUpdatesTests.swift，既有私有PersonalClient/Transport/Credentials及原21项未改。公共清单严格校验schema/siteUrl/唯一macos、完整Mac元数据、SHA绑定的安全相对DMG地址；64KiB/20秒有界独立URLSession，无Cookie/credentialStorage/cache，TLS正常、拒绝跳转。数值版本比较先营销版本，再构建号，不受字典序或Int溢出影响；取消后再检查状态，不返回迟到成功。

Core子Agent首次swift test --filter PublicUpdatesTests：13个Swift Testing测试定义通过，0失败、0.077秒；参数化版本8/坏版本7/危险链接13个用例，另含架构、元数据/schema、SHA与路径、公共会话、声明及流式超限、302/503/超时/TLS/错来源和取消迟到边界。原21项只编译未执行，测试网络由独立URLProtocol截获，实际官网GET0。摘要core-update-tests-summary.json在源码外；原始stdout未另存，不将摘要冒充原始日志。主助手已独立读代码与核SHA，未重复该测试组。

Mac一批新增MacUpdateModel/MacUpdateView，App唯一StateObject与独立updates Window，标准菜单和仅macOS设置入口共享状态；真Bundle版本/ABI、防重入/代数与取消、Core已校验下载链接和官网其他设备入口已接线。默认520×620/最小400×420、ScrollView/Return检查与焦点；生成PBX仅新增两Mac源，不改变其他target结构。UI子Agent仅语法/diff检查通过，尚未宣运行。验证已获主助手放行，开始一次独立Debug4编译和无账号菜单/两尺寸真实检查；未登录设置入口本轮不重做认证。

## 首批Debug4真实官网与窗口验收通过

唯一Debug构建exit0/49.999秒，实际Bundle0.1.0/4、x86_64、签名strict/deep核0。该App是新增更新功能后的独立开发build4，不是官网旧build4；源Hash和构建输入独立保存在Debug4-Batch1/build-input.json，dylib SHA3290b08ae78eb245e322792a9a30ba8e31c3a9faf207d7f82493edf385fd4ef6。没有installedVersion替换参数。

新无账号namespace mac-updates-20261005、私人服务器https://127.0.0.1:1；实际PID78962、更新CG743。标准App菜单“检查更新…”只打开一次并自动检查官网，实际显示本机0.1.0/4和官网4相同/已最新。首次按钮disabled、完成enabled，Progress节点未观测不补记已观测。Focus设置返回0且实际焦点为checkUpdatesButton。helper无直接HTTP/重复检查/账号动作或模型/工具。

同PID/CG依几何绑定，桌面实际520×620；较窄请求400×420被系统最小内容约束为外框400×452、内容400×420。实际滚动0→1后下载页、其他设备与手动安装说明可达。主助手独立查看desktop-latest.png/narrow-latest.png/narrow-scrolled.png及事件，未发现本轮必须修的可见问题，一次产品修复预算未使用。

该真实Debug4应用及实例保留等待官网5，旧39901未操作。源码外acceptance-debug4.json及VisibleBatch事件/PNG/AX记录保留；这只证明本轮未登录菜单/官网4/窗口，官网5“有新版”和最终真实5“已最新”尚待发布后验证。登录后设置入口仅接线/编译核对，本轮未重复登录认证；iPhone/Watch仍未新构建。

## Release5固定与发布后验证安排

更新代码与首批Debug4证据已提交dd756380bbcb1d714d24e2e03fb6f1dc2338da38。主助手仅把Base.xcconfig构建号升5，营销版本仍0.1.0；Core/GUI/Bundle身份/架构无其他变更。真实Debug4原App/签名/实例保留，不因Config修改重建或重签它。

接续一次既有Release打包脚本到独立AppleDelivery-Updates-20261005目录，核真实Info0.1.0/5、x86_64、strict/deep签名、DMG/挂载/副本hash与SHA/bytes，不自动安装。验证Release菜单入口之前对production service仅属性/无data/禁交互核空；若已有本人凭据或新系统许可则停止该入口动作，不读/删旧项。Windows正式发布5后才执行保留的真实4读5/下载与最终真实5读5，分别保留截图、路径和哈希；本段是执行安排，尚非结果。

## Release5真实候选与官网发布前结果

唯一打包exit0，干净来源ae72c50ec287329419a23897359a377613c610a3。实际包AppleDelivery-Updates-20261005/MacTrial-20261005T061912Z-500679f5/WeftMate-Mac-0.1.0-5-x86_64-local.dmg，1048583字节，SHA-256 e2c7f92d1bf1c7cdf84382f547a16bb16eced16fecdfa7f9659ba72253ed5729。真实Bundle0.1.0/5、x86_64、最低macOS14.0、同bundleID；Release CDHash de1ba8989e6be08ee7d20a559ab43c5a645f9419。主助手独立核Info、SHA及Core/GUI源Hash一致。

既有ad-hoc签名、DMG verify、只读挂载及Trial副本签名/可执行Hash均通过；Gatekeeper assess退出3/rejected、未公证边界保持。没有自动安装/覆盖。生产service在入口前仅属性-only/禁交互查询status-25300/count0，未取data/输出item属性/写删；唯一TrialInstall启动真实Release5，PID80246，空登录CG751，标准菜单独立更新CG752一次正常检查官网4，实际显示本机0.1.0/5较官网0.1.0/4新。

主助手独立查看release5-empty-login.png与release5-read-official4-local-newer.png。新实例保留等待官网5，真实Debug4 App/dylib/hash/78962也原样保留；旧39901未操作。账户/私人请求/模型/工具/自动安装0，未改权限/代理/TLS。public更新清单成功不证明私人服务公网认证或旧Keychain覆盖保留；草稿仍不持久。

本阶段当前完成实现、Core边界、真实4读4/两尺寸窗口、真实5读4本机较新和新DMG；Windows正式发布5前，真实4读5有新版/按钮浏览器下载与真实5读5已最新仍未执行。本轮代码候选固定后交接官网写者，等待其确定发布回执再补这两个既有实例用例，不重建演示App。
