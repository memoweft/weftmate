# 多端审稿页

DS-2 为本人审稿提供同场景横向比较。场景清单只有一份：[scenes.json](../../scripts/review-gallery/scenes.json)。十个场景为登录、会话列表、对话与执行步骤、审批、提问、输出与来源、记忆、设置 / 外观、设置 → 用量、对话归档 / 删除菜单，每项有浅色与深色。页面自身的外观与截图外观可以分别切换，点击截图放大，Esc（退出键）关闭；窄屏单列，不横向滚动。图像内嵌，单独复制 `index.html` 即可离线打开。

## 生成与验证

仓库根安装依赖后运行：

```powershell
npm ci
node node_modules/electron/install.js
npx playwright install chromium
node scripts/review-gallery/capture.mjs --out .local/review-gallery
node scripts/review-gallery/build.mjs --out .local/review-gallery
node tests/integration/review-capture-gallery.mjs --out .local/review-gallery
```

`build.mjs --out <目录>` 从该目录的截图和仓库中的设备证据生成 `index.html`、`manifest.json`。不指定目录时使用被 Git 忽略的 `.local/review-gallery`。没有截图时生成「待补」占位；生成命令不隐式启动宿主或设备。每个场景的导航单独执行，失败后下一场景重新进入已认证首页，避免前一个面板或菜单影响后续截图。定位失败时，该格显示「截图失败：<一句话原因>」，页面顶部列出场景、平台、外观和原因；同名 `.json` 保存 `status: "failed"`、原因与来源。新一轮删除本次自动截图及生成文件，失败格不会沿用旧成功图，也不把定位失败当成「此端尚无」。确认产品此端确实没有某场景时，在清单该场景添加 `"unavailable": ["watch"]` 等平台标识，页面显示「此端尚无」。

桌面脚本通过 Playwright（界面自动化工具）的 `_electron.launch` 启动生产 `createPersonalDesktop`，保留真实 Electron（桌面程序框架）窗口、原生主题与 preload（预加载桥），内容区域为 1200×800；用原生 `webContents.capturePage` 截图。隔离个人宿主复用 FE-1a 的 `startTimelineCandidate`，包含合成 DSH（智能体运行时）日志与合成模型目录；不用真实模型或完整 `src/main.mjs` 的运行时启动链，因此不需要仓库外 vendor（编译依赖产物）。这验证生产桌面窗口和界面，不宣称完整 DSH 执行或安装版验收。

手机脚本用 Chromium（浏览器引擎）390×844、FE-1b 的真实本机账号认证与合成内容投影，原生桥适配器沿用 FE-1b；提问卡复用 FE-1a 的合成提问日志。导航按名称与角色定位，滚动到命名的步骤 / 卡片，不依赖坐标或组件位置。两端用随机回环端口和系统临时目录；不读取本人数据、环境凭据或真实模型。桌面登录按 LG-1a 的「登录 WeftMate」标题、「邮箱」和「离线使用这台电脑」定位，拍真实新登录组件。该 FE-1a 宿主未配置云服务，因此画面如实包含产品的「云服务尚未配置」提示；本工具不声称完成真实云注册验收，云子进程 / file transport（文件邮件传输）完整流程仍见 [LG-1a 验收](../../tests/evidence/lg-1a/README.md)。随后通过真实 `/auth/login`（本机账号认证接口）登录隔离合成账号，不让登录截图选择器成为其他场景的前置依赖。手机使用同一真实认证接口的桥接入口，认证信息只在闭包内。

手机登录当前仍拍既有「电脑账户与连接」。LG-1b 合并后，只需更新 [review-capture-mobile.mjs](../../tests/integration/review-capture-mobile.mjs) 的 `prepareLogin` 函数中入口按钮与标题的可见名称选择器；认证桥与其他场景无需随登录页重写。若新页尚未匹配，浅 / 深登录格优雅降级，其他十八个手机格继续生成。

工作流按 **Windows 程序 / 手机网页 × 十场景 × 两套外观 = 40 个自动截图格** 计数；原生证据的「待补 / 此端尚无」不计失败。`capture.mjs` 只因宿主 / 程序 / 浏览器 / 认证等基础设施或截图写入错误退出失败；单个场景定位失败正常返回。`review-capture-gallery.mjs` 在整页生成及响应式验证后检查门槛：失败 **>20/40** 才因场景数量失败，恰好 20/40 仍通过；缺少自动场景结果属于基础设施错误。密码输入、凭据 / 私人邮箱 / 机器路径扫描、来源一致性、图片尺寸 / 解码与页面生成检查仍为硬性失败。失败原因不引用原始堆栈或页面文字。

工作流即使在门槛或基础设施失败时也尝试生成并上传安全的部分页面与记录供定位，失败步骤保持失败状态，不用 `continue-on-error`（忽略步骤失败）抹去结果。隐私或来源检查未通过时生成命令不会写出页面。

## 苹果与安卓证据命名

本包不启动苹果设备或安卓模拟器。后续工作包把合成截图提交到以下任意子目录：

- Apple：`apps/apple/Tests/Evidence/<工作包>/`
- Android：`tests/evidence/<工作包>/`

文件名：`review-<平台>-<场景>-<外观>-<UTC时间>.png`。例：`review-mac-approval-dark-20261008T060000Z.png`。平台为 `windows`、`mobile-web`、`android`、`iphone`、`mac`、`watch`；场景标识取 `scenes.json`；外观为 `light` 或 `dark`。不要凭系统背景推测主题，也不要把同一张图冒充两套外观。

每张图同名 `.json` 保存来源，内容示例（把提交替换为实际拍摄源码的完整 40 位提交）：

```json
{
  "platform": "mac",
  "scene": "approval",
  "theme": "dark",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "generatedAt": "2026-10-08T06:00:00.000Z",
  "synthetic": true,
  "source": "隔离原生合成账号验收"
}
```

必须使用合成账号 / 合成文字，截图与元数据不得有凭据、私人邮箱、电脑绝对路径或个人信息。选择 `generatedAt` 最新的一张，时间相同按来源路径稳定排序；不使用 checkout（检出）文件修改时间。所有外部图片都保留其源码提交与时间，不改标为页面提交。文件名与元数据不一致、缺少合成声明或无效来源信息会让生成失败。

既有证据只通过 `evidence.mjs` 的显式兼容表收集：DS-1b / IC-2 的 iPhone 浅深列表、对话、审批、输出与来源，以及 FE-1b 的 MuMu（安卓模拟器）浅色登录 / 列表 / 步骤 / 审批 / 输出 / 记忆和深色列表 / 外观。只收已知合成画面，排除 `before-*`、`initial/`、图标、浏览器替代设备证据及包含临时绝对路径的 UI-3 命令截图。历史图未记录准确拍摄时刻时，标明「证据提交时间」，用该文件最后一次 Git 提交排序。旧图中不明确的主题不猜测；缺图显示「待补」。新包按上述命名放图后无需改兼容表。

Watch 当前只提供同步的进度 / 最近回复摘要和审批，以及健康入口，没有独立登录、会话列表、完整执行步骤、提问、输出来源、记忆、外观、用量或对话归档 / 删除菜单，因此这九个场景明确显示「此端尚无」。审批支持但缺少按主题命名与来源元数据的图，显示「待补」。

## 新增场景与自动更新

1. 在 `scenes.json` 新增稳定英文标识和中文标题；确实不支持的端填 `unavailable`。
2. 在两个 `review-capture-*.mjs` 中按可见名称与角色导航，等待对应内容再调用 `capture`。桌面 / 手机当前必须为十场景各提供截图或明确失败结果，验证会检查每个格子。用量页展示合成账号真实空账本（零模型请求）；归档 / 删除场景只打开「对话操作」菜单，不执行任何破坏性操作。新增苹果图按 `review-iphone-usage-light-<UTC时间>.png`、`review-mac-session-menu-dark-<UTC时间>.png` 等命名和同名元数据直接收集，当前缺图显示「待补」。
3. 原生端按约定提交截图与元数据。重新生成和验证，检查截图名与实际内容一致。

颜色由项目生成的 `src/personal-access-ui/tokens.css` 内嵌提供；页面 CSS（层叠样式表）只引用设计令牌变量，不维护第二份调色板。系统字体沿用 `body` 字体令牌，审稿控件用文字标签与原生语义，不新增装饰图标；截图保留产品自身的统一图标。只调整本审稿工具，不修改产品界面代码。

[review-gallery.yml](../../.github/workflows/review-gallery.yml) 在 main 的前端、设计或证据路径变化后截图并生成，PR（拉取请求）上的本工具改动也执行同一验证；可手动 `workflow_dispatch`（手动触发工作流）。使用 Windows runner（执行机器），只授予仓库读取权限，上传 14 天的 Actions artifact（工作流产物），不部署外网。下载后打开 `index.html`。

工作流给测试设置新的 C: 完整临时路径，避开 GitHub Windows 默认 `RUNNER~1` 短路径与宿主私有目录的真实路径校验冲突，不降低权限校验。`ci-display.ps1` 只在可丢弃的 GitHub 执行机器上选择足以容纳 1200×800 窗口的驱动支持显示模式，避免默认 1024×768 桌面缩小窗口；本地生成不调整开发者显示设置，图片尺寸断言不放宽。

定向回归 `node --test tests/integration/review-capture-evidence.mjs` 覆盖最新来源选择、隐私拒绝、半数门槛、单场景超时后继续、旧图清除和失败清单在桌面 / 窄屏的展示。

自动扫描覆盖截图时的 DOM（页面内容结构）文字、密码输入值、元数据与内嵌 HTML（网页文件），检查凭据样式、私人邮箱与电脑路径；图片解码、1600 / 390 两种宽度和两套外观、放大与 Esc 均验证。历史原生图片需人工视觉检查；没有把文字扫描宣称为 OCR（图片文字识别）。
