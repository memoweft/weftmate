# APPLE-8 · 手机模型附件

只补 iPhone 单独使用的 PhoneStandaloneChat；电脑会话仍用原上传、附件块和文件页。原生截图夹具必须同时使用 `--ui-testing --apple8-fixture`，只生成色块和虚构 Markdown，以独立 namespace、内存凭据运行，不启动任何模型、云或电脑连接。

## 本机验证

- `swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2`。
- `python3 apps/apple/Scripts/run_state_checks.py --artifacts <隔离目录> --check PhoneAttachmentModelChecks --check PhoneStandaloneModelChecks --check PhoneMemoryModelChecks --check DesignTokenChecks`。
- `node --test tests/apple-callback-isolation.test.mjs tests/apple-ui-copy.test.ts tests/design-tokens.test.ts`。
- `node apps/apple/Scripts/check_callback_isolation.mjs`、`node scripts/generate-tokens.mjs --check`、`node apps/apple/Scripts/sync_phone_presets.mjs --check`。
- 通用 iOS / watchOS 与本机 macOS 的 `xcodebuild build -jobs 4 CODE_SIGNING_ALLOWED=NO`；不指定 `-sdk iphoneos`，避免强制 SDK 影响内嵌 Watch 的包依赖。

实际 PhoneStandaloneModel 与 PhoneAttachmentInput 在 macOS 编译执行，以本机 HTTP/SSE 检查传出的 JPEG base64 / image_url、文件文字、跨历史总上限、附件独发、图片拒绝后不重复入历史且恢复草稿、账号隔离/重建、加密无明文、清本机、PDFKit 可读/扫描件/页数、文本截断、Office 拒绝、记忆来源和冻结交接。程序捕获失败、打印原因、exit(1)，不用 precondition / fatalError；合成服务器返回请求体供断言，报告中不保存真实文件或凭据。

## 数量和大小

4 张 JPEG + 3 个文件，每张长边 ≤2048、≤1 MiB，ImageIO 下采样、转向并重新编码 JPEG（质量 0.8 / 0.6 / 0.4 / 0.2），HEIC 同样转换；不保留拍照/图库的未经压缩原图。照片缩略图和原消息使用同一份处理后的 JPEG。

文件每个 ≤10 MiB，保留原始字节供手机查看；纯文本/Markdown/CSV/TSV/JSON/代码/日志由 UTF-8 或 UTF-16 解码，二进制/Office/压缩包明确拒绝。每次已选文件合计 ≤32,000 UTF-16，PDFKit 前30页抽文字；截断标「只读了前一部分」，没有可读文字报错。全屏 PDF 显示本机原 PDF，文本预览最多128 Ki字符；模型读取上限独立于手机保存/查看原文件。

请求近20条消息中，最多带最近4张图片、32,000 UTF-16文件文字；更早附件以占位说明代替。图片上限控制 base64 请求约5.6 MiB；3×10 MiB控制加密状态和手机内存成本；30页/32k文字覆盖日常摘要，避免大文件挤满模型上下文。不存在 OCR、Office解析或原文件上传服务。

## 存储、隐私和电脑

消息、原文件字节、JPEG和待发草稿都在 PhoneChatStore 的同一按云地址+subject隔离 AES-GCM 状态，沿同一 ThisDeviceOnly Keychain 钥匙与排除备份目录。图片块和全屏页直接用内存，不生成明文缩略图/临时预览文件。账号变化关闭查看和选择器、隔离迟到内容，退出保留该账号加密历史，清本机同时删附件/对话/钥匙/模型凭据。

模型设置告知「图片和文件会发送给你选择的模型提供方」，不弹首次确认；实际只发处理后的 JPEG和有界文件文字（PDF抽文字），不上传 PDF / 文本原件。文档选择器、PhotosPicker不请求完整图库权限。相机用途说明沿现有人话；权限拒绝给「去设置」，图库与文件仍可用。

电脑交接仍为原 `/personal/v1/offline/turns` 文字合同：使用者正文照交，每个附件加一行文件名、MIME和「原件在手机上」。不传字节、base64、附件路径或文件提取内容，不改变合同；手机原消息仍可查看附件。冻结和回执/代次语义继承 APPLE-6/7。

## 安卓照做

1. 单独聊天三项入口、现有附件卡/删除和全屏页；无模型隐藏/禁用，不弹空菜单；允许只发附件。
2. 系统照片/文件选择器与相机单独权限；拒绝相机仍可图库/文件；迟到结果核对账号、对话。
3. 同样4张/3文件/2048/1MiB/10MiB/32k/30页；JPEG去原元数据，PDF提取文字；扫描件/Office直说不支持。
4. 兼容 `image_url.url=data:image/jpeg;base64,...` 内容块；文本模型禁用拍照/图库，自定义服务未知则尝试；图片拒绝译人话，草稿/附件加密保留，重试不重复消息。
5. Keystore同账号同钥匙加密，不备份，不落明文缩略图；退出/切号/清本机与聊天一致；设置说明发给所选模型。
6. 电脑只交文字+原件在手机的占位；手机保存附件。记忆不使用图像推断或助手解释；正文照原话规则整理，文件须使用者明说「我写的／我的自述／文件里我说」，仅第一人称原话参与逐字evidence校验，未归属的资料/第三方信息排除。图片独发不产生记忆请求。

## Windows「把原件也交给电脑」清单

1. 先登记新 CLIENT_API 合同：附件元数据/id/name/MIME/大小/摘要、与原消息/回合绑定、能力发现、限额、附件引用与独立上传回执；不能把字节塞现有文字 turns。
2. 定义账号/设备/电脑身份核验、传输加密、电脑持久落盘、内容摘要核对和原件接收后回执，支持中断续传与重复去重。
3. 明确电脑导入文字与原件的先后/失败/重试/撤回；原件接收未确认时手机不得删本机资料；文字 synced不当作原件 received。
4. 把撤权/删除generation、聊天删除、真正遗忘/依赖处理纳入附件生命周期，保留原消息来源；电脑看图/读文件能力不足时如实说明。
5. 确认产品上的「交原件」触发与用户说明、电脑存储/备份规则；iPhone再按双方合同接上传，不自行改变当前合同。

## 真实设备边界

系统相机、拒绝→设置→允许、PhotosPicker/文档选择器取消与iCloud文件、HEIC真照片；真实Keychain/强杀重开/换号退出清本机；大字/VoiceOver/浅深菜单/×/全屏返回与长PDF；真实模型图片格式与拒绝措辞；真实Windows接手及Core整理，均需本人真机确认。没有 MIMO_API_KEY，未寻找密钥或调用真实模型；没有真实账号、云或本人电脑连接。

最终构建、断言数字、截图尺寸/SHA、模拟器与系统报告台账见 validation.json / screenshots.json 和相应检查摘要。完整CI由Claude收取，不等待。

图片消息格式核对官方文档：[OpenAI Chat image_url](https://developers.openai.com/api/docs/guides/images-vision?api-mode=chat)、[Claude OpenAI SDK compatibility](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk)。仅处理图片输入，不增加生成图片功能。
