# PF-2 · 原题成文人工核对

2026-10-10，Codex · Windows-5。核对最终 MiMo 三份与 LAN（局域网模型服务）一份原件；原件保留，不用校对稿替换模型产出，也不增加模型核验轮。原场景的文件、官方链接、回复及 completed（已完成）检查全部通过，并不意味着下列事实项全对。

| 项目 | MiMo 1 | MiMo 2 | MiMo 3 | LAN | 核对结论 |
|---|---|---|---|---|---|
| 中文文件保存到原题路径、附官方来源 | 通过 | 通过 | 通过 | 通过 | 原场景检查与原文件均保留 |
| 说明比较初始大版本 22.0.0 / 24.0.0 | 明确 | 明确 | 明确 | 明确 | 没把完整小版本追踪作为新增验收要求 |
| V8、npm、异步上下文实现、URLPattern、测试运行器、Undici 等主变化 | 支持 | 支持 | 支持 | 支持 | 主变化可由两篇官方发布说明支持 |
| child_process 弃用保留 shell:true 条件 | 未展开 | 正确限定 | 缺条件 | 未展开 | 第三份“传参方式弃用”仍过宽，应限定为 shell:true 与 args 数组组合 |
| Windows 编译要求只适用于编译 Node 自身 | addon 建议仍需限定 | 明确过宽 | 主要段落限定为自建 Node | 主要段落限定为编译 Node | 第二份将全部原生扩展也写成必须 ClangCL，不能由发布摘要推出 |
| ABI（应用二进制接口）精确数字 | 未写 | 错误：134 | 错误：134 | 未写 | 24.0.0 源码实际为 137，不能依赖记忆补一个精确数字 |
| 原生扩展重编译的 Node-API 例外 | 未展开 | 未保留 | 有例外 | 未展开 | 第二份不能笼统要求所有原生扩展重编译 |
| 时间与支持窗口 | 版本状态有来源 | 日期有官方计划来源 | 截至月份写成2026-09；“窗口更长”需区分绝对结束日与时长 | 初始发布日期正确 | 第三份日期和支持窗口表述需校对，不能把后发布等同于支持时长更长 |
| 模型单独读取最终文档 | 有 read | 无独立 read | 无独立 read | 有 read | 宿主/场景读文件检查仍执行；不声称四份均有模型独立读回 |

主变化来源：[Node.js 24.0.0 发布说明](https://nodejs.org/en/blog/release/v24.0.0)、[Node.js 22.0.0 发布说明](https://nodejs.org/en/blog/release/v22.0.0)。弃用限定见官方 [PR #57199](https://github.com/nodejs/node/pull/57199)。ABI 数字见官方 [v24.0.0 node_version.h](https://github.com/nodejs/node/blob/v24.0.0/src/node_version.h)。稳定 ABI 的适用范围见 [Node-API 文档](https://nodejs.org/download/release/v22.23.0/docs/api/n-api.html)。时间线参照 [官方 schedule.json](https://github.com/nodejs/release/blob/main/schedule.json)。

提示已要求保留条件/例外、不要从记忆补精确数字，遇到外围不确定细节应省略或标注不确定；第二份实际保留了 shell:true 条件，第三份仍未可靠执行，精确 ABI 数字仍出错。这是提示改进的实际边界，不能宣布全文事实质量已解决。没有加额外模型核验轮来掩盖问题。

原件：[MiMo 1](final/mimo/documents/run-1.md)、[MiMo 2](final/mimo/documents/run-2.md)、[MiMo 3](final/mimo/documents/run-3.md)、[LAN](final/lan/documents/run-1.md)。pilot（首轮试验）也保留于 [原件](pilot/mimo/documents/run-1.md)，其中有更明显的过宽弃用、全部扩展重编译与错误 ABI 数字，未当成最终质量通过证据。
