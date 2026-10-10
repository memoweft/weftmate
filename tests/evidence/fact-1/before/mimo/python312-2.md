# Python 3.12 后旧项目的兼容边界（distutils、venv、发布日期与 GIL）

## 发布日期

Python 3.12 于 **2023 年 10 月 2 日**发布（官方 What's New 首段即写明该日期，并指向 PEP 693 发布计划）。

来源：[What's New In Python 3.12](https://docs.python.org/3.12/whatsnew/3.12.html)

## distutils 移除意味着什么

- 官方 What's New 的“重要弃用/移除”列出 **PEP 632：移除 distutils**，并说明“setuptools 继续提供 distutils，如果你在 Python 3.12 及更高版本仍需要它”。
- PEP 632 的规范：在 3.10/3.11 中 distutils 正式标记为弃用（`import distutils` 触发弃用警告）；**在 Python 3.12 中，`make install` 和任何第一方发行版不再安装 distutils**，第三方再发行版也不应再捆绑它。
- PEP 632 的迁移背景：distutils 长期推荐使用 setuptools；setuptools 已内置完整 distutils 副本，不再依赖标准库。因此旧项目若依赖 `import distutils`，在 3.12 上应改走 setuptools（或其它 PEP 517 构建后端），并把“是否有 distutils”视为版本相关的兼容边界，而不是可移植前提。

来源：[What's New In Python 3.12 — Important deprecations, removals or restrictions](https://docs.python.org/3.12/whatsnew/3.12.html)；[PEP 632 — Deprecate distutils module](https://peps.python.org/pep-0632/)

## venv 默认包变化

官方 What's New 记载 **gh-95299**：`venv` 创建的虚拟环境**不再预装 setuptools**；因此 `distutils`、`setuptools`、`pkg_resources`、`easy_install` **默认不再可用**，需要时应在已激活的虚拟环境中执行 `pip install setuptools`。

兼容边界的实际含义：

- 旧项目若假设“新建 venv 里一定有 setuptools/distutils”，在 3.12 上会遇到 `ModuleNotFoundError` 或构建失败。
- 这不是说 pip 或 venv 本身消失，而是**默认预装集合收窄**；是否安装 setuptools 变为项目依赖/初始化步骤的一部分。
- 官方 venv 文档同时说明：venv 是“轻量、隔离、可随时删除重建”的环境，包安装由激活后的 pip 写入该环境；因此把 setuptools 显式写入项目依赖或创建脚本，比依赖隐式预装更稳妥。

来源：[What's New In Python 3.12 — venv 预装 setuptools 变更](https://docs.python.org/3.12/whatsnew/3.12.html)；[venv — Creation of virtual environments](https://docs.python.org/3.12/library/venv.html)

## GIL 变化的范围（不要扩大解释）

- Python 3.12 的解释器改进列出 **PEP 684：a unique per-interpreter GIL**。
- PEP 684 的高层摘要：在“隔离充分”的前提下，**不再在解释器之间共享 GIL**；并新增若干解释器配置选项、阻止不兼容扩展造成问题。
- PEP 684 还指出：为实现这一目标，受 GIL 保护的运行时状态必须先迁入每个解释器；同时仍有一些进程级资源（内存、文件描述符、环境变量）被共享，官方“没有计划改变”这一点。
- 因此，3.12 的 GIL 变化应理解为：**同一进程内多个子解释器可各自拥有 GIL，从而在隔离条件下为真正的多核并行创造条件**；它不是“移除 GIL”，也不是“所有线程都不再受 GIL 限制”。线程级行为和扩展模块兼容性仍需按 PEP 684 的隔离与扩展约束理解。

来源：[What's New In Python 3.12 — PEP 684](https://docs.python.org/3.12/whatsnew/3.12.html)；[PEP 684 — A Per-Interpreter GIL](https://peps.python.org/pep-0684/)

## 一句话概括兼容边界

对旧项目而言，**“3.12 能不能跑”主要取决于是否还把 `distutils`/`venv` 里隐式预装的 setuptools 当作运行或构建前提**；若把这两项显式依赖化并按 PEP 632 迁移，其余常规代码路径不因这两项变更自动失效。GIL 部分则限于 **per-interpreter GIL（PEP 684）**，不要解读为 3.12 取消了全局解释器锁。
