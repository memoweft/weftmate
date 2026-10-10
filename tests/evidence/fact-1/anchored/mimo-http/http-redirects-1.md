# 按 RFC 9110 比较 HTTP 301、302、303、307、308 的永久性与请求方法转换

依据 RFC 9110（HTTP Semantics，2022 年 6 月）§15.4 及各状态码分节，简要比较如下（文中 [n] 对应文末出处）。

## 永久性与语义分类

| 状态码 | 永久性 | RFC 表述要点 |
| --- | --- | --- |
| 301 Moved Permanently | 永久 | 目标资源已被分配新的永久 URI（"assigned a new permanent URI"）[2] |
| 302 Found | 临时 | 目标资源暂时位于另一 URI（"resides temporarily under a different URI"）[3] |
| 303 See Other | 不按永久/临时划分 | 指向另一资源，用于对原请求给出"间接响应"（"indirect response"）[4] |
| 307 Temporary Redirect | 临时 | 目标资源暂时位于另一 URI，且自动重定向时**不得**改变请求方法 [5] |
| 308 Permanent Redirect | 永久 | 目标资源已被分配新的永久 URI [6] |

§15.4 通则把 301、302、307、308 归为"同一资源可能位于另一 URI"的重定向，把 303 归为"指向不同资源、可作为对请求的间接响应"的重定向 [1]。

## POST 自动重定向：可以改成 GET，而非必须

- **301**：RFC 原文注明"Note: For historical reasons, a user agent MAY change the request method from POST to GET for the subsequent request."——即出于历史原因，用户代理**可以（MAY）**把后续请求的方法由 POST 改为 GET；不想出现这种行为，应改用 308 [2]。
- **302**：同样的 MAY 条款，不想要该行为时应改用 307 [3]。
- **303**：定义为把用户代理引导到另一资源，"A user agent can perform a retrieval request targeting that URI (a GET or HEAD request if using HTTP)"；该状态码适用于任意 HTTP 方法，主要用于让 POST 的输出重定向到不同资源 [4]。
- **307**：明确要求自动重定向时"user agent MUST NOT change the request method"，即**必须**保持原方法 [5]。
- **308**：本节只规定永久 URI 与自动重定向，未规定把 POST 改为 GET；§15.4 的历史说明指出 307/308 后来被加入以明确表示"保持方法的重定向"，而 301/302 已被调整为允许 POST 重定向为 GET [1][6]。另注：308 出现较晚（June 2014），"might not be recognized everywhere" [6]。

因此，"POST 自动重定向改成 GET"对 301/302 是**允许但非强制**（MAY），对 307 是**禁止改方法**（MUST NOT），对 303 是引导发起 GET 或 HEAD 检索请求，308 则不作此类改写。

## 通用规则与注意点

- 是否自动重定向对用户代理而言是 MAY："the user agent MAY automatically redirect its request ... even if the specific status code is not understood"；对非安全方法要谨慎，"Automatic redirection needs to be done with care for methods not known to be safe" [1]。
- 自动跟随重定向时按状态码语义改方法："Change the request method according to the redirecting status code's semantics, if applicable." [1]
- 若方法已改为 GET 或 HEAD，须移除内容相关头部字段（如 Content-Encoding、Content-Language、Content-Location、Content-Type、Content-Length、Digest、Last-Modified）[1]。

## 出处

[1] [RFC 9110: HTTP Semantics — §15.4 Redirection 3xx](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4)，capturedAt 2026-10-10T04:06:43.776Z。原文："307 (Temporary Redirect) and 308 (Permanent Redirect) [RFC7538] were later added to unambiguously indicate method-preserving redirects, and status codes 301 and 302 have been adjusted to allow a POST request to be redirected as GET."；"the user agent MAY automatically redirect its request to the URI referenced by the Location field value, even if the specific status code is not understood. Automatic redirection needs to be done with care for methods not known to be safe"；"Change the request method according to the redirecting status code's semantics, if applicable."；"If the request method has been changed to GET or HEAD, remove content-specific header fields, including (but not limited to) Content-Encoding, Content-Language, Content-Location, Content-Type, Content-Length, Digest, Last-Modified."

[2] [RFC 9110: HTTP Semantics — §15.4.2 301 Moved Permanently](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.2)，capturedAt 2026-10-10T04:06:43.687Z。原文："The 301 (Moved Permanently) status code indicates that the target resource has been assigned a new permanent URI"；"Note: For historical reasons, a user agent MAY change the request method from POST to GET for the subsequent request. If this behavior is undesired, the 308 (Permanent Redirect) status code can be used instead."

[3] [RFC 9110: HTTP Semantics — §15.4.3 302 Found](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.3)，capturedAt 2026-10-10T04:05:58.794Z。原文："The 302 (Found) status code indicates that the target resource resides temporarily under a different URI."；"Note: For historical reasons, a user agent MAY change the request method from POST to GET for the subsequent request. If this behavior is undesired, the 307 (Temporary Redirect) status code can be used instead."

[4] [RFC 9110: HTTP Semantics — §15.4.4 303 See Other](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.4)，capturedAt 2026-10-10T04:05:04.817Z。原文："which is intended to provide an indirect response to the original request. A user agent can perform a retrieval request targeting that URI (a GET or HEAD request if using HTTP)"；"This status code is applicable to any HTTP method. It is primarily used to allow the output of a POST action to redirect the user agent to a different resource"

[5] [RFC 9110: HTTP Semantics — §15.4.8 307 Temporary Redirect](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.8)，capturedAt 2026-10-10T04:05:58.617Z。原文："The 307 (Temporary Redirect) status code indicates that the target resource resides temporarily under a different URI and the user agent MUST NOT change the request method if it performs an automatic redirection to that URI."

[6] [RFC 9110: HTTP Semantics — §15.4.9 308 Permanent Redirect](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.9)，capturedAt 2026-10-10T04:05:04.699Z。原文："The 308 (Permanent Redirect) status code indicates that the target resource has been assigned a new permanent URI"；"Note: This status code is much younger (June 2014) than its sibling codes and thus might not be recognized everywhere."
