# 官网下载发布候选

此目录的 `index.html`、`styles.css`、`app.js` 是下载页资源。发布器只复制这三个文件；安装包、二维码和 `releases.json` 由 `scripts/prepare-public-downloads.mjs` 生成到新的静态候选目录。现有官网首页由原站点维护，本发布器不会复制或改写它。

## 输入与输出

发布配置是 Git 外的 JSON 文件。`siteUrl` 必须是最终公开的 HTTPS（加密网页连接）下载页基址，如 `https://www.weftmate.com/downloads/`。`platforms` 必须恰好包含 `android`、`macos`、`windows`、`ios`、`watchos` 各一项：

- `android`、`macos` 的 `status` 为 `available`，必须提供 `source` 绝对路径、`expectedBytes`、`expectedSha256`、`version`、`build`、`architecture`、`notes`。Android 架构记为 `universal`，本轮 Mac 包为 `x86_64`。发布器核对源文件及复制后的 SHA-256（文件摘要）与字节数，失败即不产生候选。
- `windows` 的 `status` 为 `web`，只提供 `webUrl` 与 `notes`。当前 `webUrl` 固定为 `https://home.weftmate.com:8443/personal/v1/ui`，运行命令也必须通过 `--allow-web-url` 显式传入同一地址。它是网页版入口，不是安装包。
- `ios`、`watchos` 的 `status` 为 `unavailable`，只提供 `notes`；不编造版本或下载链接。

配置示例中的两组摘要与大小来自已核对的试用包。发布前仍须以本机真实文件重新核对，并把 `source` 换为实际绝对路径：

```json
{
  "schemaVersion": 1,
  "siteUrl": "https://www.weftmate.com/downloads/",
  "platforms": [
    {"id":"android","status":"available","source":"/absolute/path/android-candidate.apk","expectedBytes":1975295,"expectedSha256":"cafa44d486e2578a83084b96aedd475cb9c92ffdcb44b3aafeae7f3f1797661e","version":"0.7.0","build":"12","architecture":"universal","notes":"Android 试用版"},
    {"id":"macos","status":"available","source":"/absolute/path/WeftMate-Mac-build4.dmg","expectedBytes":937054,"expectedSha256":"eb50a8af748d831a9f61d17f73d886805b77453992fe506c6f8f6ac2822754d4","version":"0.1.0","build":"4","architecture":"x86_64","notes":"Mac Intel 试用版"},
    {"id":"windows","status":"web","webUrl":"https://home.weftmate.com:8443/personal/v1/ui","notes":"目前使用网页版"},
    {"id":"ios","status":"unavailable","notes":"iPhone 安装包尚未发布"},
    {"id":"watchos","status":"unavailable","notes":"Apple Watch 安装包尚未发布"}
  ]
}
```

运行例子（输出目录必须尚不存在，父目录已存在）：

```sh
node scripts/prepare-public-downloads.mjs --config /absolute/path/publish.json --output /absolute/path/candidate/downloads --allow-web-url https://home.weftmate.com:8443/personal/v1/ui
```

需要保留已经发布的安装包 URL 时，可附加 `--previous-release-dir /absolute/path/old-downloads`。旧目录必须是既有下载候选；发布器只检查其中直接的 `files/`，只保留符合 `<sha256>-<安全文件名>.apk` 或 `.dmg` 的普通文件，并重新核对文件名摘要与字节摘要。其它旧页面、清单、二维码和目录不会复制，`files/` 之外的文件（包括账号资料）会忽略。`files/` 内出现未知文件/子目录/符号链接、摘要不符、同一摘要多个文件名或超出限制时，会在创建新候选前失败：最多 32 个文件、单件不超过 1 GiB、总量不超过 2 GiB。若旧包与当前包摘要和扩展名相同，当前 manifest（清单）复用旧文件名与 URL，只保留一份字节；manifest 仍只列当前有效版本。未传此选项时，原有输出不变。

示例：

```sh
node scripts/prepare-public-downloads.mjs --config /absolute/path/publish.json --output /absolute/path/candidate/downloads --allow-web-url https://home.weftmate.com:8443/personal/v1/ui --previous-release-dir /absolute/path/old-downloads
```

输出包含三个下载页资源、`releases.json`、五个 `qr/<id>.svg` 和安装文件：不传 `--previous-release-dir` 时有两份当前安装包；传入时还会保留已核验的旧安装文件。同一摘要和扩展名的当前包会复用旧文件。旧安装文件只用于保留原下载 URL，不会加入 `releases.json`；清单仍只列当前有效版本。`landingUrl` 指向 `siteUrl?platform=<id>`；二维码也只编码该公开页面，不含账户、会话或令牌。`downloadUrl`、`qrUrl` 均相对 `siteUrl`。只有 `available` 项包含版本、构建号、架构、字节数、摘要和 `downloadUrl`；`web` 项只有明确允许的 `webUrl`，不可用项没有下载字段。

二维码使用 [Project Nayuki 的 QR Code Generator](https://github.com/nayuki/QR-Code-generator/tree/3c6d0b3cefb4e049dc337e82237c9644399716a8/typescript-javascript) MIT（宽松开源许可）实现。原始 `scripts/vendor/qrcodegen.ts` 的 SHA-256 为 `1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c`；仓内 TypeScript 编译为 `scripts/vendor/qrcodegen.mjs`，保留原许可文字。发布时无需外部二维码服务或新全局依赖。
两份 vendor 文件保留上游尾随空格；`.gitattributes` 只对它们关闭 Git 的 `blank-at-eol` 检查，其他文件仍按原有规则检查。

## 放入既有官网

Ubuntu 上已有的网站根由现行 virtual host（虚拟站点）配置决定。将完整候选 `downloads/` 放到**该根目录下**，先备份原 `downloads/`，在同一文件系统完成目录切换。`deploy-nginx-location.conf.example` 是只供审阅并插入现有 HTTPS server（加密站点配置）的片段，不含监听端口、证书或反向代理变更。修改现有配置后先运行 `nginx -t`，通过后再 reload（平滑加载）。不要运行旧的 `site/deploy-remote.sh`，它会处理整个 virtual host。

若现有站点使用 Caddy（网页服务器），让其已有站点根包含 `downloads/` 并继续使用原 `file_server`；对 `releases.json` 关闭缓存，对 `files/` 可启用长期不可变缓存和附件下载。这里不新建站点或占用 80/443。网站页面更新与 APK/DMG 原生安装包更新分别发布；此候选不会把网页文件当作原生升级包。
