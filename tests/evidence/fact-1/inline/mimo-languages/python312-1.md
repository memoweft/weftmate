# Python 3.12 的兼容边界：distutils 移除、venv 默认包与 GIL 变化

## 一、发布日期

Python 3.12 于 2023 年 10 月 2 日发布（"Python 3.12 was released on October 2, 2023."）[1]。

## 二、distutils 被移除：兼容边界在哪里

Python 3.12 按 PEP 632 移除了 **标准库中的 `distutils`**。官方 What's New 的原文是："PEP 632: Remove the distutils package. ... The third-party Setuptools package continues to provide distutils, if you still require it in Python 3.12 and beyond." [1]

也就是说，兼容边界应这样理解：

- **被移除的是标准库里的 `distutils`**，不是 `setuptools` 这个第三方包本身。
- 如果旧项目确实还需要 `distutils`，官方给出的迁移路径是使用第三方 `setuptools`，它在 Python 3.12 及以后仍继续提供 `distutils` [1]。
- 旧项目里 `import distutils` 之所以在 3.12 上报错，通常是因为它依赖的是标准库那份；换用/安装 `setuptools` 后即可继续获得该模块 [1]。

## 三、venv 默认不再预装 setuptools

同一份 What's New 还记录了一项与 venv 相关的默认行为变化（gh-95299）："Do not pre-install setuptools in virtual environments created with venv. This means that distutils, setuptools, pkg_resources, and easy_install will no longer available by default; to access these run pip install setuptools in the activated virtual environment." [1]

venv 官方文档也印证了这一点："Changed in version 3.12: setuptools is no longer a core venv dependency." [2]

因此在 3.12 的虚拟环境中，默认情况下 `distutils`、`setuptools`、`pkg_resources`、`easy_install` 这四个都不可用；官方给出的补救办法是在已激活的虚拟环境里执行 `pip install setuptools` [1]。

**对旧项目的实际影响：** 即使代码本身没有直接 `import distutils`，只要构建/安装脚本假设"新建的 venv 里自带 setuptools"，在 3.12 上就会失败。这类项目的兼容处理是：在创建环境后显式安装 `setuptools`，或迁移到不依赖 `distutils` 的构建方式。

## 四、GIL 变化的范围（务必区分两件事）

Python 3.12 在 GIL 上的变化是 **PEP 684：每个子解释器一个独立的 GIL**，而不是取消进程级的全局 GIL。原文："PEP 684 introduces a per-interpreter GIL, so that sub-interpreters may now be created with a unique GIL per interpreter. ... This is currently only available through the C-API, though a Python API is anticipated for 3.13." [1]

范围上的三条边界：

1. **作用对象是子解释器（sub-interpreters）**：每个子解释器可以拥有自己的 GIL，从而让 Python 程序更好地利用多个 CPU 核心；这并不等于主解释器的全局 GIL 被移除 [1]。
2. **3.12 中只能通过 C-API 使用**：目前只能经由 C-API 创建带独立 GIL 的解释器（如 `Py_NewInterpreterFromConfig()`），Python 层面的 API 预计在 3.13 提供 [1]。
3. **"无 GIL / 自由线程"构建不在本次确认范围内**：关于 Python 3.12 是否默认提供自由线程（free-threaded，即无 GIL）构建，未在官方资料中确认；上述 PEP 684 的表述只涉及子解释器的 per-interpreter GIL，不能据此推断全局 GIL 已被取消 [1]。

## 五、小结：读旧项目兼容性时的四条判断

1. 报错是否来自 `import distutils`（标准库已被移除）→ 装 `setuptools` 即可继续提供 `distutils` [1]。
2. 报错是否来自"venv 里没有 setuptools/pkg_resources"→ 这是 3.12 的新默认行为，需 `pip install setuptools` [1][2]。
3. 涉及 GIL 的改造，要先分清是"子解释器独立 GIL（3.12，C-API）"还是"全局 GIL / 自由线程"，二者不是一回事 [1]。
4. 无法从所查官方资料确认的结论（如 3.12 默认无 GIL），不要写成既定事实。

---

## 出处

[1] [What's New In Python 3.12 — Python 3.12.15 documentation](https://docs.python.org/3.12/whatsnew/3.12.html)，URL: https://docs.python.org/3.12/whatsnew/3.12.html ，capturedAt: 2026-10-10T03:38:14.003Z
- 发布日期："Python 3.12 was released on October 2, 2023."
- distutils："PEP 632: Remove the distutils package. ... The third-party Setuptools package continues to provide distutils, if you still require it in Python 3.12 and beyond."
- venv 默认包："Do not pre-install setuptools in virtual environments created with venv. This means that distutils, setuptools, pkg_resources, and easy_install will no longer available by default; to access these run pip install setuptools in the activated virtual environment."
- GIL："PEP 684 introduces a per-interpreter GIL, so that sub-interpreters may now be created with a unique GIL per interpreter. ... This is currently only available through the C-API, though a Python API is anticipated for 3.13."

[2] [venv — Creation of virtual environments — Python 3.15.0 documentation](https://docs.python.org/3/library/venv.html)，URL: https://docs.python.org/3/library/venv.html ，capturedAt: 2026-10-10T03:38:14.013Z
- venv 依赖变化："Changed in version 3.12: setuptools is no longer a core venv dependency."
