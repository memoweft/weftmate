# TB-3b 成果库界面返工验收

功能沿用 PR #172；本轮以 `parallel-rules.md` 第 8 / 8a 条、UI_SPEC 与已通过的 TB-2 页面为验收标准。参照产品仅在本机查看，未复制私人图片。

前后对比：[退回的浅色列表](before-desktop-light-list.png) → [新版浅色列表](desktop-light-list.png)；[退回的深色预览](before-desktop-dark-markdown.png) → [新版深色预览](desktop-dark-markdown.png)。

## 必改项逐条对照

- [x] 1. 整行可点开预览；常驻日期 +「…」，精确指针悬停 / 键盘聚焦才显示打开图标。共享菜单含打开、定位、来源、复制；缺失文件前两项禁用，并给出可见说明。预览顶部只保留主动作和菜单。
- [x] 2. 独立页面顶栏显示「成果库」，主对话重绘后仍保持；隐藏输出与来源、用量、搜索 / 日期与临时对话提示，离开成果库恢复对话行为。
- [x] 3. 进入与成果事件刷新，页面可见时每 6 秒读取以接收其他对话产出；保留「刷新成果库」小图标。内容未变化不重建行，保留焦点和菜单触发器。
- [x] 4. 列表 / 网格为带提示、读屏名称和选中态的图标分段；筛选行右对齐，窄窗搜索独占上一行，项目 / 时间与视图切换仍在同一行。
- [x] 5. 类型使用统一标签选中背景；项目 / 时间复用共享下拉，当前选择有勾选，浅深打开状态俱全。
- [x] 6. 成果库预览隐藏原生横向滚动条，可横滑 / 键盘切换，并用共享「更多预览标签」菜单直接选择；新增项、放大 / 还原、收起使用图标和提示。480px 预览避开 Windows（视窗系统）原生标题栏。
- [x] 7. 字节 / KB / MB 与当天时分、跨日日期；文件区分文档、表格、图片、代码、压缩包与 PDF（便携文档格式）。
- [x] 8. 空、骨架、错误 + 重试；原位置缺失弱化并说明；390×844 / 360×780 手机行内只保留日期与菜单，点行打开全屏预览。

## 第 8 条前端验收清单

- [x] 1. 无原生下拉 / 默认控件残留；预览标签栏无系统横向滚动条，成果库列表使用主题滚动条。
- [x] 2. 图标、标签、行按钮与菜单具悬停、按下、键盘聚焦、禁用四态；读屏名称与业务动作一致。
- [x] 3. 操作收进既有工具位与共享菜单，无额外动作行。
- [x] 4. 令牌间距、中线对齐；480px / 两种手机尺寸无横向溢出，标签与原生标题栏无重叠。
- [x] 5. 类型 / 视图选中与下拉勾选可见；三态完整。
- [x] 6. 真实 Electron（桌面程序框架）浅深、480px，手机网页夹具 390×844 / 360×780 浅深均截图检查。
- [x] 7. 对照 TB-2 与本机 Claude / Muse 文件入口的层级和密度；保留 WeftMate 设计令牌与字体。
- [x] 8. 每个菜单、下拉与预览状态都有打开截图；全部复用 WeftPopover 的组件和样式。
- [x] 9. 已检查最终截图，先前 480px 标题栏遮挡与手机版选中背景缺失均已修正。

## 打开状态证据

| 状态 | 浅色 | 深色 |
|---|---|---|
| 列表 | [浅色](desktop-light-list.png) | [深色](desktop-dark-list.png) |
| 网格 | [浅色](desktop-light-grid.png) | [深色](desktop-dark-grid.png) |
| 行菜单 | [浅色](desktop-light-row-menu.png) | [深色](desktop-dark-row-menu.png) |
| 项目下拉 | [浅色](desktop-light-project-open.png) | [深色](desktop-dark-project-open.png) |
| 时间下拉 | [浅色](desktop-light-time-open.png) | [深色](desktop-dark-time-open.png) |
| Markdown（标记文本）预览 | [浅色](desktop-light-markdown.png) | [深色](desktop-dark-markdown.png) |
| PDF 预览 | [浅色](desktop-light-pdf.png) | [深色](desktop-dark-pdf.png) |
| 图片预览 | [浅色](desktop-light-png-preview.png) | [深色](desktop-dark-png-preview.png) |
| 表格文本预览 | [浅色](desktop-light-csv-preview.png) | [深色](desktop-dark-csv-preview.png) |
| 代码预览 | [浅色](desktop-light-py-preview.png) | [深色](desktop-dark-py-preview.png) |
| 压缩包不可预览说明 | [浅色](desktop-light-zip-preview.png) | [深色](desktop-dark-zip-preview.png) |
| 预览操作菜单 | [浅色](desktop-light-preview-menu.png) | [深色](desktop-dark-preview-menu.png) |
| 标签溢出菜单 | [浅色](desktop-light-tabs-open.png) | [深色](desktop-dark-tabs-open.png) |
| 再打开一项菜单 | [浅色](desktop-light-add-open.png) | [深色](desktop-dark-add-open.png) |
| 放大预览 | [浅色](desktop-light-preview-expanded.png) | [深色](desktop-dark-preview-expanded.png) |
| 缺失文件菜单 | [浅色](desktop-light-missing-menu.png) | [深色](desktop-dark-missing-menu.png) |
| 缺失文件预览 | [浅色](desktop-light-missing-preview.png) | [深色](desktop-dark-missing-preview.png) |
| 骨架 | [浅色](desktop-light-loading.png) | [深色](desktop-dark-loading.png) |
| 空状态 | [浅色](desktop-light-empty.png) | [深色](desktop-dark-empty.png) |
| 错误与重试 | [浅色](desktop-light-error.png) | [深色](desktop-dark-error.png) |

| 480px 状态 | 浅色 | 深色 |
|---|---|---|
| 列表 | [浅色](desktop-480-light.png) | [深色](desktop-480-dark.png) |
| 行菜单 | [浅色](desktop-480-light-menu.png) | [深色](desktop-480-dark-menu.png) |
| 项目下拉 | [浅色](desktop-480-light-project-open.png) | [深色](desktop-480-dark-project-open.png) |
| 时间下拉 | [浅色](desktop-480-light-time-open.png) | [深色](desktop-480-dark-time-open.png) |
| 预览 | [浅色](desktop-480-light-preview.png) | [深色](desktop-480-dark-preview.png) |

| 手机尺寸 / 主题 | 列表与行菜单 | 下拉 | 预览与菜单 | 三态 |
|---|---|---|---|---|
| 390×844 浅色 | [列表](mobile-390-light-list.png) · [行菜单](mobile-390-light-row-menu.png) | [项目](mobile-390-light-project-open.png) · [时间](mobile-390-light-time-open.png) | [预览](mobile-390-light-preview.png) · [菜单](mobile-390-light-preview-menu.png) | [骨架](mobile-390-light-loading.png) · [空](mobile-390-light-empty.png) · [错误](mobile-390-light-error.png) |
| 390×844 深色 | [列表](mobile-390-dark-list.png) · [行菜单](mobile-390-dark-row-menu.png) | [项目](mobile-390-dark-project-open.png) · [时间](mobile-390-dark-time-open.png) | [预览](mobile-390-dark-preview.png) · [菜单](mobile-390-dark-preview-menu.png) | [骨架](mobile-390-dark-loading.png) · [空](mobile-390-dark-empty.png) · [错误](mobile-390-dark-error.png) |
| 360×780 浅色 | [列表](mobile-360-light-list.png) · [行菜单](mobile-360-light-row-menu.png) | [项目](mobile-360-light-project-open.png) · [时间](mobile-360-light-time-open.png) | [预览](mobile-360-light-preview.png) · [菜单](mobile-360-light-preview-menu.png) | [骨架](mobile-360-light-loading.png) · [空](mobile-360-light-empty.png) · [错误](mobile-360-light-error.png) |
| 360×780 深色 | [列表](mobile-360-dark-list.png) · [行菜单](mobile-360-dark-row-menu.png) | [项目](mobile-360-dark-project-open.png) · [时间](mobile-360-dark-time-open.png) | [预览](mobile-360-dark-preview.png) · [菜单](mobile-360-dark-preview-menu.png) | [骨架](mobile-360-dark-loading.png) · [空](mobile-360-dark-empty.png) · [错误](mobile-360-dark-error.png) |

## 验证与边界

- `node tests/integration/tb-3-library.mjs`：18 项实际桌面 / 手机界面包交互，页面错误 0，见 [verification.json](verification.json)。断言按角色与名称，保留既有功能验证，无删除 / 跳过。
- `node --test tests/personal-library-ui.test.ts tests/personal-library.test.ts tests/personal-push.test.ts tests/icon-system.test.ts`：合主干后 13/13。
- `node --test tests/personal-access-ui-interaction.test.ts`：合主干后 62/62；`npm run typecheck` 与手机资产一致性 / JavaScript（脚本语言）语法检查通过。
- Android（安卓）`BusinessRouteUnitTest` 定向测试与相关 Kotlin（安卓开发语言）编译通过，保留成果库 / 动态两条长游标路由；仅沿主干版本，本包未自行改版本。
- Impeccable（界面打磨）机械检查返回空问题列表；最终截图人工检查。
- 随机端口、临时账号 / 目录；真实 Electron 窗口来自生产桌面构造器，手机使用已发布界面包的浏览器夹具及合成宿主桥。未调用真实模型，未访问本人程序和数据。
- 原生打开 / 定位仍由合成适配器截获；复制验证浏览器剪贴板调用的原位置参数，不声称启动系统应用或验收系统剪贴板。错误 / 慢读通过定向网络故障注入验证。
- 完整 CI（持续集成）交 Claude 查看；本包不合并 PR（拉取请求）。

## Apple 对应改动

本包没有修改 `apps/apple`，当前原生端尚无成果库接线，不能称 Apple 已验收。后续接线应沿 CLIENT_API 第 9.9 节复用账户索引与来源身份，并同步本清单：Mac（苹果电脑）整行预览、日期 + 菜单、主按钮 + 菜单、页面顶栏与自动刷新；iPhone（苹果手机）全屏预览和紧凑行菜单；两端统一类型图标、人话时间 / 大小、三态、缺失文件说明，预览标签使用原生溢出处理。本轮只新增通用 list / grid 图标源，Apple 图标生成与原生接线由对应包完成，避免与 A16 并行改同一批文件。
