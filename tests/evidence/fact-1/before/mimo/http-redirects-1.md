# HTTP 301/302/303/307/308：永久性与请求方法转换（RFC 9110）

依据 RFC 9110（HTTP Semantics，STD 97）[§15.4 Redirection 3xx](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4)。

## 对照表

| 状态码 | 永久性 | 自动重定向时的方法转换 | POST 重定向后改成 GET？ |
| --- | --- | --- | --- |
| [301 Moved Permanently](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.2) | 永久 | 不强制改变；规范注明用户代理"可以（MAY）"把 POST 改为 GET | **可以（MAY），不是必须**；不希望改就改用 308 |
| [302 Found](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.3) | 临时 | 同 301 | **可以（MAY），不是必须**；不希望改就改用 307 |
| [303 See Other](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.4) | 临时（指向另一资源的间接响应） | 语义即改为检索请求：GET 或 HEAD（HEAD 不变，其余方法转为 GET） | **按其定义语义转为检索方法**（POST→GET 是该状态码的核心语义，而非历史注记） |
| [307 Temporary Redirect](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.8) | 临时 | 用户代理执行自动重定向时 **MUST NOT** 改变请求方法（及请求体） | **禁止改**（必须仍以 POST 重发） |
| [308 Permanent Redirect](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.9) | 永久 | 同 307，方法保持不变（规范未给出 301/302 那种改 GET 的注记） | **禁止改**（必须仍以 POST 重发） |

## 要点

1. **301/302：只是"可以"改成 GET。** 两者的注记完全相同："For historical reasons, a user agent MAY change the request method from POST to GET for the subsequent request."（出于历史原因，用户代理可以（MAY）在后续请求中把 POST 改为 GET；若不希望如此，分别改用 308、307。）MAY 是许可而非义务，因此没有任何"必须改成 GET"的要求。

2. **历史背景。** §15.4 的注记说明：HTTP/1.0 中 301、302 原本定义为保留方法，303 才是"改为 GET"的重定向；早期用户代理对"POST 重定向按 POST 还是按 GET"实践分裂，最终主流实践收敛为改成 GET，307/308 后来加入以无歧义地表示保留方法，而 301、302 被调整为"允许"把 POST 重定向为 GET——这就是"允许"（可选）而非强制的原因。

3. **303：由语义决定改检索。** §15.4 把 303 归类为"指向另一资源、可代表原请求的间接响应"的重定向；用户代理可对该 URI 发起检索请求（"a GET or HEAD request if using HTTP"）。该节没有出现字面上的 MUST，但它适用于任何 HTTP 方法，主要用途正是让 POST 的输出重定向到可单独标识、可书签、可缓存的资源，即 303 的定义就是"换方法为 GET"（HEAD 保持 HEAD）。

4. **307/308：明确禁止改方法。** 307 规定 "the user agent MUST NOT change the request method if it performs an automatic redirection to that URI"；308 没有 301/302 的改 GET 注记，同属保留方法族。两者均要求连同请求体一起原样重发。

5. **通用重定向规则（§15.4）。** 用户代理 MAY 按 Location 自动重定向，即使不理解具体状态码；但对非安全方法要谨慎（用户可能不希望重定向不安全请求）。自动重定向时 SHOULD 按状态码语义"Change the request method according to the redirecting status code's semantics, if applicable"，且"若方法已改为 GET 或 HEAD"，应去除 Content-Type、Content-Length 等内容相关头部——该条正对应"改成了 GET 才去头"的情形。

## 结论

- **POST 自动重定向：301/302 下是"可以（MAY）改成 GET"，从来不是"必须"**；服务器端若要保证方法不变，应使用 307（临时）或 308（永久）。
- **303 是唯一以"改为 GET（HEAD 仍为 HEAD）"为核心语义的常用转换型重定向**，主要用于 POST 结果跳转。
- **307/308 必须保留原方法与请求体**（MUST NOT 改变方法）。

## 来源

- [RFC 9110 §15.4 Redirection 3xx](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4)（含历史注记与自动重定向修改清单）
- [§15.4.2 301 Moved Permanently](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.2) · [§15.4.3 302 Found](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.3) · [§15.4.4 303 See Other](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.4) · [§15.4.8 307 Temporary Redirect](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.8) · [§15.4.9 308 Permanent Redirect](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.9)
- [RFC 9110 纯文本](https://www.rfc-editor.org/rfc/rfc9110.txt)（以上英文原句均核对自该文本）
