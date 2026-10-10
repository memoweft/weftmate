# Python 3.12 兼容边界简短说明（distutils 移除、venv 默认包、发布日期与 GIL 范围）

本文基于 Python 官方文档与 PEP，回答四个问题：distutils 被移除后旧项目如何理解兼容边界、venv 默认包有何变化、3.12 何时发布，以及 3.12 中 GIL 变化的范围。

## 1. 发布日期

Python 3.12 于 2023 年 10 月 2 日发布[1]；发布计划 PEP 693 中"3.12.0 final"的日期同样为 2023-10-02（周一）[4]。

## 2. distutils 移除：兼容边界在哪里

- **标准库中的 distutils 已移除**。3.12 What's New 概述明确："Of note, the distutils package has been removed from the standard library."[1] PEP 632 给出更具体的边界："In Python 3.12, distutils will no longer be installed by make install or any of the first-party distribution."[3]
- **官方给出两条出路**。其一，按迁移指南替换其 API（What's New："See the migration guide for advice replacing the APIs it provided."[1]）。其二，继续使用第三方 Setuptools 提供的 distutils："The third-party Setuptools package continues to provide distutils, if you still require it in Python 3.12 and beyond."[1] PEP 632 也说明 "Setuptools has recently integrated a complete copy of distutils and is no longer dependent on the standard library"[3]。
- **边界小结**：项目若 `import distutils`，在 3.12 上依赖的已不再是标准库，而是第三方 Setuptools 的 distutils 兼容实现或自行迁移；是否"还能用"取决于项目环境里是否装有提供该兼容层的 Setuptools，而非 Python 标准库。

## 3. venv 默认包变化

- 3.12 起，`venv` 创建的虚拟环境**不再预装 setuptools**（gh-95299）："Do not pre-install setuptools in virtual environments created with venv. This means that distutils, setuptools, pkg_resources, and easy_install will no longer available by default; to access these run pip install setuptools in the activated virtual environment."[1]
- 由此，**未安装 setuptools 时**，在该虚拟环境中导入 `distutils`/`setuptools`/`pkg_resources` 会失败；需要它们时执行 `pip install setuptools` 即可恢复[1]。
- 该变化**不影响通常的 `pip install` 构建 setuptools/distutils 类项目**，因为 pip 会在其构建环境里提供 setuptools："pip (>= 22.1) does not require setuptools to be installed in the environment. setuptools-based (and distutils-based) packages can still be used with pip install, since pip will provide setuptools in the build environment it uses for building a package."[1]
- 注意边界：gh-95299 的范围是 "virtual environments created with venv"[1]；对其他发行版或 venv 实现是否有同样行为，未在本文所引官方资料中确认。

## 4. GIL 变化的范围（3.12 是"每解释器一个 GIL"，不是免 GIL/自由线程）

- 3.12 的变化是**每解释器 GIL（per-interpreter GIL）**："PEP 684 introduces a per-interpreter GIL, so that sub-interpreters may now be created with a unique GIL per interpreter. This allows Python programs to take full advantage of multiple CPU cores. This is currently only available through the C-API, though a Python API is anticipated for 3.13."[1]
- **可用性范围**：目前仅能通过 C-API（`Py_NewInterpreterFromConfig()`）创建带独立 GIL 的解释器，面向 Python 层的 API 预计 3.13 才有[1]。
- **隔离是有条件的**：PEP 684 说明子解释器 "stops sharing the GIL between interpreters, given sufficient isolation"，并"adds several new interpreter config options for isolation settings"、"keeps incompatible extensions from causing problems"[2]。
- **并非所有资源都独立**：PEP 684 明确 "some process-global resources (e.g. memory, file descriptors, environment variables) are shared. There are no plans to change this."[2]

## 5. 旧项目迁移建议（简要）

1. `import distutils` 的代码：按 PEP 632 迁移指南替换 API，或显式安装第三方 Setuptools 使用其 distutils 兼容层[1][3]。
2. 依赖"venv 创建后自带 setuptools"的脚本：在 3.12 的 venv 中显式 `pip install setuptools`，或改用 pip 构建环境（pip ≥ 22.1 自动提供）[1]。
3. 关于 GIL/并发：3.12 中多解释器并行仅限 C-API 路径且要求充分隔离，常规 Python 程序的 GIL 行为不因此改变[1][2]。

---

## 出处

[1] [What's New In Python 3.12 — Python 3.12.15 documentation](https://docs.python.org/3.12/whatsnew/3.12.html)，capturedAt: 2026-10-10T03:09:50.935Z。相关原文："Python 3.12 was released on October 2, 2023."；"Of note, the distutils package has been removed from the standard library."；"PEP 632: Remove the distutils package. See the migration guide for advice replacing the APIs it provided. The third-party Setuptools package continues to provide distutils, if you still require it in Python 3.12 and beyond."；"gh-95299: Do not pre-install setuptools in virtual environments created with venv. This means that distutils, setuptools, pkg_resources, and easy_install will no longer available by default; to access these run pip install setuptools in the activated virtual environment."；"pip (>= 22.1) does not require setuptools to be installed in the environment. setuptools-based (and distutils-based) packages can still be used with pip install, since pip will provide setuptools in the build environment it uses for building a package."；"PEP 684 introduces a per-interpreter GIL, so that sub-interpreters may now be created with a unique GIL per interpreter. This allows Python programs to take full advantage of multiple CPU cores. This is currently only available through the C-API, though a Python API is anticipated for 3.13."

[2] [PEP 684 – A Per-Interpreter GIL](https://peps.python.org/pep-0684/)，capturedAt: 2026-10-10T03:10:19.183Z。相关原文："stops sharing the GIL between interpreters, given sufficient isolation"；"adds several new interpreter config options for isolation settings"；"keeps incompatible extensions from causing problems"；"some process-global resources (e.g. memory, file descriptors, environment variables) are shared. There are no plans to change this."

[3] [PEP 632 – Deprecate distutils module](https://peps.python.org/pep-0632/)，capturedAt: 2026-10-10T03:09:50.424Z。相关原文："In Python 3.12, distutils will no longer be installed by make install or any of the first-party distribution."；"Setuptools has recently integrated a complete copy of distutils and is no longer dependent on the standard library"

[4] [PEP 693 – Python 3.12 Release Schedule](https://peps.python.org/pep-0693/)，capturedAt: 2026-10-10T03:10:19.103Z。相关原文："3.12.0 final: Monday, 2023-10-02"
