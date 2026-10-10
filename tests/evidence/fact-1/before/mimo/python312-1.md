# Python 3.12：distutils 移除、venv 默认包变化与 GIL 相关变化的兼容边界

## 一、发布日期

- **Python 3.12 于 2023 年 10 月 2 日发布**（官方 What's New 原文："Python 3.12 was released on October 2, 2023"）。
- 对照：Python 3.13 于 2024 年 10 月 7 日发布。

来源：[What's New In Python 3.12](https://docs.python.org/3.12/whatsnew/3.12.html)

## 二、distutils 移除与 venv 默认包变化：旧项目如何理解兼容边界

Python 3.12 有两项相互叠加的变化：

1. **PEP 632：distutils 从标准库中移除。** 官方说明同时指出："The third-party Setuptools package continues to provide distutils, if you still require it in Python 3.12 and beyond."（第三方 Setuptools 包在 Python 3.12 及以后仍提供 distutils）。
2. **gh-95299：venv 创建的虚拟环境不再预装 setuptools。** 官方原文："Do not pre-install setuptools in virtual environments created with venv. This means that distutils, setuptools, pkg_resources, and easy_install will no longer available by default; to access these run `pip install setuptools` in the activated virtual environment."

### 兼容边界（实际含义）

- **默认情况下，3.12 的 venv 里既没有 distutils，也没有 setuptools / pkg_resources / easy_install。** 旧项目若构建脚本或 setup.py 依赖它们，会直接遇到 `ModuleNotFoundError`。
- **这不是"永久不可用"，而是"不再默认提供"：** 在激活的虚拟环境中执行 `pip install setuptools` 即可重新获得 setuptools（及其提供的 distutils 兼容层）。注意这是**第三方包提供的兼容**，不是标准库回归。
- **仅依赖 `import distutils` 的代码在 3.12 中：** 若环境中已安装 setuptools，通常可继续工作（setuptools 会提供 distutils）；若未安装则失败。更稳妥的做法是按官方迁移指南改用其替代 API（PEP 632 附有 migration guide）。
- **推荐的长期迁移方向：** 把旧的 setup.py / distutils 构建迁移到基于 `pyproject.toml` 的现代构建流程（PEP 517/518 前端，如 pip 直接构建），从根本上摆脱对 distutils 的依赖。
- **边界总结：** 兼容问题主要落在**构建/安装环节**（依赖 distutils 或 setuptools 的构建脚本），而不是 Python 语言或常规运行时代码。运行期代码若只是 `import distutils` 也会受影响，但可通过安装 setuptools 缓解。

来源：

- [What's New In Python 3.12 — Important deprecations, removals or restrictions](https://docs.python.org/3.12/whatsnew/3.12.html)
- [PEP 632 — Remove the distutils package](https://peps.python.org/pep-0632/)

## 三、GIL 变化的范围：3.12 与 3.13 要分清

### Python 3.12：PEP 684（per-interpreter GIL）

- 3.12 的解释器改进项是 **"PEP 684, a unique per-interpreter GIL"**，即**每个子解释器拥有独立的 GIL**。
- PEP 684 的目标是让不同解释器之间"stops sharing the GIL between interpreters, given sufficient isolation"（在充分隔离的前提下不再共享 GIL）。
- **要点：3.12 并没有移除 GIL，也没有提供免 GIL 运行模式。** 变化范围限于**子解释器**之间不再共享同一个 GIL；默认的单解释器程序行为不变（GIL 依旧存在）。

来源：[PEP 684 — A Per-Interpreter Global Interpreter Lock](https://peps.python.org/pep-0684/)、[What's New In Python 3.12](https://docs.python.org/3.12/whatsnew/3.12.html)

### Python 3.13：PEP 703（免 GIL，实验性）

- 免 GIL（free-threaded / `--disable-gil` 构建）来自 **PEP 703**，其 Python-Version 为 3.13，于 2023-10-24 通过决议（Resolution: 24-Oct-2023），**不是 3.12 的特性**。
- 官方 3.13 What's New 将其列为："**experimental support** for running with the global interpreter lock disabled (PEP 703)"——**实验性支持**。
- 免 GIL 是**一种专门的构建/安装选项**，不是默认：源码构建需 `--disable-gil`，macOS/Windows 安装程序中为可选组件；运行时可用 `PYTHON_GIL` / `-X gil` 重新启用 GIL，`sys._is_gil_enabled()` 可检查当前进程是否真正禁用了 GIL。
- 扩展兼容性：3.13 引入 `Py_mod_gil` 槽，用于指示扩展模块是否支持无 GIL 运行；导入不支持免 GIL 的 C-API 扩展时可能自动重新启用 GIL 并给出警告。

来源：

- [PEP 703 — Making the Global Interpreter Lock Optional in CPython](https://peps.python.org/pep-0703/)
- [What's New In Python 3.13](https://docs.python.org/3.13/whatsnew/3.13.html)
- [Python experimental support for free threading](https://docs.python.org/3.13/howto/free-threading-python.html)

### 一句话结论

> **3.12 = 移除 distutils + venv 默认不再带 setuptools + 每解释器独立 GIL（PEP 684），默认 GIL 不变；免 GIL（PEP 703）是 3.13 的实验性特性，需专门构建，默认构建仍带 GIL。**

## 主要来源

1. [What's New In Python 3.12（官方）](https://docs.python.org/3.12/whatsnew/3.12.html)
2. [PEP 632 — Remove the distutils package](https://peps.python.org/pep-0632/)
3. [PEP 684 — A Per-Interpreter Global Interpreter Lock](https://peps.python.org/pep-0684/)
4. [PEP 703 — Making the Global Interpreter Lock Optional in CPython](https://peps.python.org/pep-0703/)
5. [What's New In Python 3.13（官方）](https://docs.python.org/3.13/whatsnew/3.13.html)
6. [Python experimental support for free threading（官方 HOWTO）](https://docs.python.org/3.13/howto/free-threading-python.html)
