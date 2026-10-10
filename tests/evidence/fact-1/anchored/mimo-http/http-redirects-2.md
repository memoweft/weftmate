# HTTP 301、302、303、307、308：永久性与请求方法转换（按 RFC 9110）

依据 RFC 9110 §15.4（Redirection 3xx）官方 HTML 原文。核心问题：POST 自动重定向时改成 GET 是「可以」还是「必须」？——**可以（MAY），不是必须**；想强制保留方法请用 307/308。[1][2][3]

## 对比表

| 状态码 | 名称 | 永久性 | 自动重定向时的方法处理 |
|---|---|---|---|
| 301 | Moved Permanently | 永久 | POST **可（MAY）**改为 GET；出于历史原因。不想要该行为可改用 308 [2] |
| 302 | Found | 临时 | POST **可（MAY）**改为 GET；出于历史原因。不想要该行为可改用 307 [3] |
| 303 | See Other | 不表示永久或临时，指向提供「间接响应」的另一资源 | 转为检索请求：HTTP 下为 GET 或 HEAD；适用于任何方法，主要用于把 POST 的输出重定向到另一资源 [4] |
| 307 | Temporary Redirect | 临时 | **不得（MUST NOT）**改变请求方法 [1] |
| 308 | Permanent Redirect | 永久 | 保留方法（method-preserving），不改方法；307/308 后来加入即为「明确表示方法保留的重定向」[1] |

## 要点

- **永久 vs 临时**：301、308 表示资源已分配新的永久 URI，未来引用应使用新 URI；302、307 表示资源只是暂时位于另一 URI。303 只说明服务器在引导用户代理去往另一资源以给出「间接响应」，不声称永久或临时，且新 URI 不视为与原目标 URI 等价。[1][2][4]
- **POST → GET 是可以，不是必须**：RFC 9110 对 301 和 302 的注释均写「For historical reasons, a user agent **MAY** change the request method from POST to GET」——MAY 是许可而非强制；§15.4 的历史注释也说明 301/302「have been adjusted to allow a POST request to be redirected as GET」。[1][2][3]
- **方法保留用 307/308**：307 条文明文「the user agent MUST NOT change the request method」；308 条文本身描述永久 URI，其方法保留语义由 §15.4 注释确立（「307 ... and 308 ... were later added to unambiguously indicate method-preserving redirects」）。[1]
- **安全提示**：自动重定向「needs to be done with care for methods not known to be safe」，因为用户可能不希望不安全请求被自动转发；若方法已改为 GET 或 HEAD，应移除 Content-Type、Content-Length 等内容相关首部。[1]
- **缓存**：301 与 308 均为 heuristically cacheable（除非方法定义或显式缓存控制另有规定）。[1]
- **303 的定位**：「applicable to any HTTP method. It is primarily used to allow the output of a POST action to redirect the user agent to a different resource」——这是把 POST 结果变成可单独标识、书签和缓存资源的规范做法。[4]

## 结论

- 想保留原方法（含 POST）：用 **307**（临时）或 **308**（永久）。
- 想把 POST 变成 GET：用 **301/302 是允许的，但非强制**；客户端是否转换由其自行决定，RFC 只是「允许」。
- 想明确让客户端发检索请求看结果：用 **303**。

## 出处

[1] [RFC 9110 §15.4 Redirection 3xx](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4)，capturedAt: 2026-10-10T04:10:29.655Z — "Prevailing practice eventually converged on changing the method to GET. 307 (Temporary Redirect) and 308 (Permanent Redirect) [RFC7538] were later added to unambiguously indicate method-preserving redirects, and status codes 301 and 302 have been adjusted to allow a POST request to be redirected as GET."；"Automatic redirection needs to be done with care for methods not known to be safe"；"Change the request method according to the redirecting status code's semantics, if applicable."；"the user agent MUST NOT change the request method if it performs an automatic redirection to that URI."（§15.4.8）；"A 301 response is heuristically cacheable"；"A 308 response is heuristically cacheable"。

[2] [RFC 9110 §15.4.2 301 Moved Permanently](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.2)，capturedAt: 2026-10-10T04:10:29.655Z — "The 301 (Moved Permanently) status code indicates that the target resource has been assigned a new permanent URI and any future references to this resource ought to use one of the enclosed URIs."；"Note: For historical reasons, a user agent MAY change the request method from POST to GET for the subsequent request. If this behavior is undesired, the 308 (Permanent Redirect) status code can be used instead."

[3] [RFC 9110 §15.4.3 302 Found](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.3)，capturedAt: 2026-10-10T04:10:29.655Z — "The 302 (Found) status code indicates that the target resource resides temporarily under a different URI."；"Note: For historical reasons, a user agent MAY change the request method from POST to GET for the subsequent request. If this behavior is undesired, the 307 (Temporary Redirect) status code can be used instead."

[4] [RFC 9110 §15.4.4 303 See Other](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.4)，capturedAt: 2026-10-10T04:10:29.537Z — "The 303 (See Other) status code indicates that the server is redirecting the user agent to a different resource ... intended to provide an indirect response to the original request. A user agent can perform a retrieval request targeting that URI (a GET or HEAD request if using HTTP)"；"This status code is applicable to any HTTP method. It is primarily used to allow the output of a POST action to redirect the user agent to a different resource"。
