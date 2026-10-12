# WeftMate 官网

官网保持纯静态，没有后端、统计、访客信息收集或运行时外部资源请求。系统字体、品牌与产品令牌来自仓库。中文和英文共用 `src/templates.mjs`；文案在 `src/copy/`。法律内容从 `docs/legal/` 原样转换，更新内容从 `docs/changelog/*.json` 生成。构建不新增依赖。

```powershell
npm run site:build
npm run site:build -- --preview
npm run site:preview
npm run site:check
node --test tests/site.test.ts tests/site-deploy.test.ts tests/licensing-contract.test.ts tests/public-downloads.test.ts
```

`site:preview` 构建带 `noindex` 的页面并监听自己申请的随机回环端口。控制台打印地址，按 Ctrl+C 退出。所有资源与内部链接都相对当前页面，预览放在 `/preview-web-1/` 之类子路径时不用改源码。正式构建的 canonical（规范地址）和分享图地址使用 `https://weftmate.com/`。`site/dist/` 是被忽略的产物，不提交。

旧 `memoweft.html` 保留，正式输出逐字节相同；仅预览构建把原有 robots（搜索抓取规则）改为 `noindex,nofollow`。它原有内联代码保持兼容。新建的全部页面使用严格 CSP（内容安全策略），没有内联脚本或样式。`404.html` 的资源使用 `./assets/`，从根 `/404.html` 或预览目录 `/preview-web-1/404.html` 打开都正确；如服务器把任意深层错误地址内部转交此文件，应由已有错误页配置将公开地址规范到对应的 `404.html`，本包不修改站点配置。

## 以后怎么更新（改哪里、怎么看、怎么上线）

官网的内容几乎都在两份文案里，改完重新构建即可，不用动模板。

| 想改什么 | 改哪个文件 |
|---|---|
| 页面上的任何一句话（中文 / 英文） | `site/src/copy/zh.json`、`site/src/copy/en.json`，两份的键必须一一对应 |
| 「已经能做到」的细节卡片 | 两份文案里的 `details`：每项是 `[标题, 一句话, 图标名]` |
| 「即将推出」清单 | 两份文案里的 `future`，格式同上；功能做成后把那一项从 `future` 挪到 `details` |
| 演示里的对话、数字、成果内容 | 同样在两份文案里（`work*`、`memory*`、`quarter*`、`watch*` 等键）；三段演示每一步出什么的顺序在 `site/src/app.js` |
| 版式与样式 | `site/src/templates.mjs`（页面结构）、`site/src/site.css` |
| 图标 | 直接用 `design/icons/ui/` 里的图标名，和程序共用同一套 |
| 条款、隐私、更新记录页 | 不在这里改：构建时从 `docs/legal/` 与 `docs/changelog/` 生成 |

每次把一句话从「即将推出」改成「已有」，或新增一条「已经能做到」的说法，同时在 `site/CLAIMS.md` 补上依据（STATE 的哪一行、哪条更新记录）。

改完之后：

1. `npm run site:preview`：本机看效果（控制台给出地址）。
2. 改了演示或三屏画面时运行 `node scripts/capture-site.mjs --assets`，重新生成禁用脚本时显示的静态图与分享图。
3. `npm run site:check` 和 `node --test tests/site.test.ts tests/site-deploy.test.ts tests/licensing-contract.test.ts`。
4. 先放到预览地址给负责人看：`node scripts/deploy-site.mjs --host <ssh 别名> --root <服务器站点根目录> --mode preview --path preview-<随便起个名>`；确认后把 `--mode preview --path …` 换成 `--mode production`。脚本会先备份、永远不碰 `downloads/` 与 `updates/`，结束时打印回退命令。在 Git Bash 里运行时先执行 `export MSYS_NO_PATHCONV=1`，否则服务器路径会被改写。

## 演示与图像

三段合成场景：整理文件并等访客批准、跨周记忆及来源的更正/遗忘、手机批准电脑上的操作。没有模型请求，拒绝不会生成成果。播放暂停、下一步、重来、键盘分段切换和电脑/手机外观都可操作。离开视口或切到后台暂停；减少动态效果时不做位移动画；禁用脚本时显示关键帧。主题跟随系统，手动选择只存在浏览器本机。

官网不使用程序验收夹具图。五端段落改为同一时刻的电脑／手机／手表界面示意，直接复用演示组件；其它两端在下方用设备与形态说明。虚构内容均为自然对话，没有调试标签或未渲染的标记。静态关键帧与 1200×630 分享图用无头 Chromium（浏览器引擎）截本站演示：`node scripts/capture-site.mjs --assets`；验收证据：`node scripts/capture-site.mjs`。`node scripts/site-assets.mjs` 也是同一资产生成入口。

`ASSETS.json` 保存每张发布位图生成时的可见 DOM（页面内容结构）文字与 SHA-256（内容哈希）；`site:check` 检查文字禁词与图片哈希，未重新生成来源记录的换图会失败。它不是 OCR（图片文字识别）：发布前仍逐张目视检查位图，哈希绑定保证检查后的图没有被静默替换。

## 部署交接：只在负责人确认时执行

本包没有连接服务器。下面的 `synthetic-alias` 是占位 SSH（安全远程连接）别名，不是实际机器。

```powershell
node scripts/deploy-site.mjs --host synthetic-alias --root /srv/site --mode preview --path preview-web-1 --dry-run
node scripts/deploy-site.mjs --host synthetic-alias --root /srv/site --mode production --dry-run
```

去掉 `--dry-run` 才实际执行。预览目录必须为单层 `preview-*`，这样后续正式更新始终保留它。脚本在本机构建，用 `tar` 通过 `ssh` 传入同级临时目录，再在服务器端用已有 `rsync`（文件同步工具）落位。服务器需要已有 tar、rsync、curl；脚本不修改 nginx（网页服务器）或重启服务，不读取密钥文件。

正式部署先生成 `<root>.backup-<UTC时间戳>`，备份排除 `downloads/files/` 和整个 `updates/`。发布与回退始终排除 `downloads/`、`updates/`、`.well-known/`、`preview-*/`，不会覆盖或删除。原下载页、发布清单、二维码、安装包和自动更新文件都由原发布器负责。

完成后逐个检查首页、英文页、条款、隐私、`404.html`、下载页、发布清单为 200；不存在的检查地址为 404。脚本打印包含实际备份目录的回退命令，例如：

```sh
ssh synthetic-alias 'rsync -a --delete --exclude=/downloads/*** --exclude=/updates/*** --exclude=/.well-known/*** --exclude=/preview-*/*** -- /srv/site.backup-TIMESTAMP/ /srv/site/'
```

实际运行应复制脚本打印的完整命令，包含它的安全引号。回退只恢复官网，保留仍在发布的安装包和更新。备份保留供负责人检查，不自动清除。失败时会打印临时目录及已生成备份的回退提示；远程失败或状态码检查失败需要负责人处理。

本地部署测试读取实际 `rsync` 参数来模拟同步与回退，核对所有保护内容逐字节不变、备份排除大文件、旧网页可恢复；没有把离线模拟称作真实服务器验收。CI（持续集成）的必过选择器自动包含新 `*.test.ts` 文件。
