# 网页产物事实核对

原模型文件保持在各批次documents/，没有为通过原题而修改原件或检查。文件存在、官方链接及回合完成不等于全文事实正确。

最终两份文档的主要版本事实（V8 13.6、npm 11、AsyncContextFrame、URLPattern、ABI 137及相应官方来源）与 [Node.js 24初始公告](https://nodejs.org/en/blog/release/v24.0.0) 相符。对照应明确是初始公告还是维护小版本；较新22.x已回移部分能力，不能把初始24公告里提到的每项都当成最新22缺失。

实际检查发现的过宽表述：

- `spawn`/`execFile` 的参数数组没有全面弃用。DEP0190针对结合 `shell:true` 的参数数组，不能建议不存在的“options里的args”替代。见 [24分支官方弃用文档](https://github.com/nodejs/node/blob/v24.x/doc/api/deprecations.md#dep0190-passing-args-to-nodechild_process-execfilespawn-with-shell-option-true)。
- 编译Node本体的ClangCL要求不能推广为所有第三方扩展都必须换工具链；node-gyp的Windows指引仍有Visual Studio工具链。见 [官方Node公告](https://nodejs.org/en/blog/release/v24.0.0) 和 [node-gyp指引](https://github.com/nodejs/node-gyp#on-windows)。
- ABI 127→137要求关注依赖V8/Node内部ABI的二进制扩展，不能说所有Node-API扩展都必然重编译；Node-API提供跨版本ABI稳定性。见 [官方Node-API说明](https://github.com/nodejs/node/blob/v24.x/doc/api/n-api.md)。
- `SlowBuffer`运行时弃用与已经移除要区分；import assertions在22初始公告已移除，不能归为24独占的新变化。见 [弃用文档](https://github.com/nodejs/node/blob/v24.x/doc/api/deprecations.md) 和 [22初始公告](https://nodejs.org/en/blog/release/v22.0.0)。

这些是实际模型产物问题。工具说明已要求核实具体建议、区分初始版本/维护版本，并匹配简短成文范围；软说明不能保证模型不会过度研究或推断。不能把本包称为“文档事实全自动2/2正确”。以下短稿是本包依据上述来源人工校对的补充，不计为模型原题验收产物，不隐藏原件错误。

## 校对后的简短说明

比较Node.js 24.0.0与22.0.0的初始官方发布公告，24值得关注的变化包括V8 13.6、npm 11、Undici 7、AsyncLocalStorage默认使用AsyncContextFrame，以及全局URLPattern。语言层面包括Float16Array、显式资源管理、RegExp.escape等。维护小版本可能回移能力，因此升级项目应以实际使用的版本化API文档核对。来源：[24公告](https://nodejs.org/en/blog/release/v24.0.0)、[22公告](https://nodejs.org/en/blog/release/v22.0.0)。

兼容性上应关注url.parse的运行时弃用、tls.createSecurePair移除等变化。child_process的DEP0190有shell:true这个具体条件；不要将普通参数数组调用一起改掉。二进制扩展要区分使用Node内部/V8 ABI的扩展与具备ABI稳定性的Node-API扩展。来源：[官方弃用文档](https://github.com/nodejs/node/blob/v24.x/doc/api/deprecations.md)、[Node-API说明](https://github.com/nodejs/node/blob/v24.x/doc/api/n-api.md)。

Windows上的ClangCL要求指向自行编译Node本体；第三方扩展按其构建系统的具体要求处理。22本来已有WebSocket客户端、同步require(ESM)、稳定watch等能力，应区分已有能力和真正的新变化。来源：[24公告](https://nodejs.org/en/blog/release/v24.0.0)、[node-gyp](https://github.com/nodejs/node-gyp#on-windows)、[22公告](https://nodejs.org/en/blog/release/v22.0.0)。
