# 按 RFC 9110 比较 HTTP 301、302、303、307、308 的永久性与请求方法转换

依据 RFC 9110（HTTP Semantics，STD 97，2022 年 6 月）§15.4 "Redirection 3xx" 进行比较。说明：本次通过官方 rfc-editor.org 页面取证，所获取的页面内容中包含 §15.4 的目录条目与相邻章节正文，但**未包含 §15.4.2–15.4.9 各小节的正文段落**，因此下表逐项区分"已证"与"未在官方资料中确认"。

## 一、五个状态码的比较

| 状态码 | 小节标题（逐字） | 永久性 | 请求方法转换规则 |
|---|---|---|---|
| 301 | 15.4.2.  301 Moved Permanently [1] | 标题标注 "Moved Permanently"；正文中的逐字永久性定义句**未在官方资料中确认** | 未在官方资料中确认 |
| 302 | 15.4.3.  302 Found [1] | 标题为 "Found"，未标注永久/临时；正文定义句**未在官方资料中确认** | 未在官方资料中确认 |
| 303 | 15.4.4.  303 See Other [1] | 标题为 "See Other"，未标注永久/临时；正文定义句**未在官方资料中确认** | 未在官方资料中确认（另见 §9.3.3 中关于 303 的一条已证规则，下文第三点） |
| 307 | 15.4.8.  307 Temporary Redirect [1] | 标题标注 "Temporary Redirect"；正文中的逐字临时性定义句**未在官方资料中确认** | 未在官方资料中确认 |
| 308 | 15.4.9.  308 Permanent Redirect [1] | 标题标注 "Permanent Redirect"；正文中的逐字永久性定义句**未在官方资料中确认** | 未在官方资料中确认 |

即：从目录标题本身可以确认 301 与 308 标注为永久（Permanently/Permanent）、307 标注为临时（Temporary）、302 与 303 标题不含永久/临时字样；但五个状态码各自的正文定义句与方法转换规则，均**未在官方资料中确认**（本次获取的页面内容中不含这些小节的正文）。

## 二、已确认的相关表述

1. 对 3xx（重定向）响应，Location 字段值指向自动重定向请求时的首选目标资源（"the Location value refers to the preferred target resource for automatically redirecting the request"）[2]。
2. 在 PUT 方法的处理上下文中，有一处表述为：用户代理 MAY 自行决定是否重定向该请求（"the user agent MAY then make its own decision regarding whether or not to redirect the request"）[4]。此句的适用范围限于所述方法上下文，不可推广为对所有重定向的普遍规定。
3. §9.3.3（POST 方法）规定：若处理 POST 的结果与既有资源的表示等价，源站 MAY 以带有该既有资源标识符的 303（See Other）响应将用户代理重定向到该资源（"an origin server MAY redirect the user agent to that resource by sending a 303 (See Other) response with the existing resource's identifier in the Location field"）[3]。该句位于 §9.3.3，不是 §15.4 的规则。

## 三、关于"POST 自动重定向时可以还是必须改成 GET"

**未在官方资料中确认。** 本次获取的官方 RFC 9110 页面内容中，没有捕捉到任何逐字规定"POST 自动重定向时 MAY 改为 GET"或"MUST 改为 GET"的方法转换语句；同样也没有捕捉到 301/302 对 POST 的处理、303 对非 HEAD/GET 方法的转换、以及 307/308 要求方法保持不变的逐字规则。因此，"可以改成 GET"与"必须改成 GET"两种说法均无法在已获取的官方资料中得到确认，本文不作断言。建议直接查阅 RFC 9110 §15.4.2–15.4.9 各小节正文以获取这些规则的原文。

## 出处

[1] [RFC 9110: HTTP Semantics（§15.4 目录条目）](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4)，capturedAt 2026-10-10T03:24:08.468Z —— 目录逐字条目："15.4.2.  301 Moved Permanently"、"15.4.3.  302 Found"、"15.4.4.  303 See Other"、"15.4.8.  307 Temporary Redirect"、"15.4.9.  308 Permanent Redirect"。

[2] [RFC 9110: HTTP Semantics（§15.4 页面，Location 字段语义）](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4)，capturedAt 2026-10-10T03:24:08.468Z —— "For 3xx (Redirection) responses, the Location value refers to the preferred target resource for automatically redirecting the request."

[3] [RFC 9110: HTTP Semantics（§9.3.3 POST）](https://www.rfc-editor.org/rfc/rfc9110.txt)，capturedAt 2026-10-10T03:20:51.504Z —— "If the result of processing a POST would be equivalent to a representation of an existing resource, an origin server MAY redirect the user agent to that resource by sending a 303 (See Other) response with the existing resource's identifier in the Location field."

[4] [RFC 9110: HTTP Semantics（PUT 与重定向上下文）](https://www.rfc-editor.org/rfc/rfc9110.html)，capturedAt 2026-10-10T03:13:28.807Z —— "the user agent MAY then make its own decision regarding whether or not to redirect the request."
