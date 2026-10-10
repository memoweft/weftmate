# Python 3.12 中 distutils 移除、venv 默认包变化与 GIL：兼容边界说明

## 结论先行

- Python 3.12 **已于 2023 年 10 月 2 日发布**。[1]
- **标准库不再包含 `distutils`**；官方迁移指南给出替代建议，第三方 **Setuptools 仍可继续提供 `distutils` 兼容层**。[1]
- **用 `venv` 创建的虚拟环境不再预装 setuptools**，因此默认情况下 `distutils`、`setuptools`、`pkg_resources`、`easy_install` 都不可用；需要时在已激活的虚拟环境中运行 `pip install setuptools`。[1]
- GIL 方面，3.12 的变化是 **“每解释器唯一 GIL”（PEP 684）**，用于子解释器（sub-interpreters），**在 3.12 中目前只能通过 C-API 使用**，Python 层面的 API 预计要到 3.13 才会出现。[1]

## 旧项目的兼容边界如何理解

1. **构建/打包脚本**：若 `setup.py`/`setup.cfg` 或构建工具链直接 `import distutils`，在 Python 3.12 上会遇到 `ModuleNotFoundError`。这不是运行时语法不兼容，而是**标准库组件被移除**。应按官方迁移指南改用 Setuptools 或其他替代构建后端，或安装 Setuptools 以获得其 `distutils` 兼容层。[1]
2. **新建虚拟环境的默认包**：即使项目此前依赖“venv 里自带 setuptools”，3.12 的默认环境也不再满足该假设。旧的安装脚本应显式安装所需包，而不是依赖预装。[1]
3. **运行时代码**：若项目代码本身只使用标准库与第三方依赖、并不导入 `distutils` 或 `setuptools`，则**不必因为这两条变化而判定项目整体不兼容**；需排查的是构建、依赖安装和环境创建环节。
4. **GIL 相关预期**：不要把 3.12 的 per-interpreter GIL 解读为“普通线程程序自动获得多核并行”。官方说明的适用对象是子解释器，且 3.12 仅 C-API 可用；常规多线程 CPython 程序的语义并未因这一特性而改变。[1]

## 发布日期

Python 3.12：**2023-10-02**。[1]

## GIL 变化的范围

- PEP 684 引入 **per-interpreter GIL**，使子解释器可各自拥有独立 GIL，从而在多解释器场景下利用多核。[1]
- **范围限制**：3.12 中该能力 **仅能通过 C-API 使用**（`Py_NewInterpreterFromConfig()`）；Python 层面的 API 预计在 3.13 提供。[1]
- 因此，本变化属于**子解释器/C-API 层面的新能力**，不等于全局移除 GIL，也不等于单个解释器内的 Python 线程自动并行化。[1]

## 给旧项目的迁移清单（简版）

- 搜索并替换直接 `import distutils` 的用法，或在 3.12 环境中显式安装 Setuptools。
- 将“venv 自带 setuptools”改为显式安装步骤：`pip install setuptools`。
- 在 CI/发布脚本中固定 Python 版本与依赖，避免因默认包变化导致偶发失败。
- 若项目依赖子解释器相关能力，注意 3.12 仅 C-API 可用，不要按 Python API 编写。

## 出处

[1] [What’s New In Python 3.12 — Python 3.12.15 documentation](https://docs.python.org/3.12/whatsnew/3.12.html)，capturedAt: 2026-10-10T03:44:19.482Z  
原文：“Python 3.12 was released on October 2, 2023.”  
原文：“PEP 632: Remove the distutils package. See the migration guide for advice replacing the APIs it provided. The third-party Setuptools package continues to provide distutils, if you still require it in Python 3.12 and beyond.”  
原文：“gh-95299: Do not pre-install setuptools in virtual environments created with venv. This means that distutils, setuptools, pkg_resources, and easy_install will no longer available by default; to access these run pip install setuptools in the activated virtual environment.”  
原文：“PEP 684 introduces a per-interpreter GIL, so that sub-interpreters may now be created with a unique GIL per interpreter. This allows Python programs to take full advantage of multiple CPU cores. This is currently only available through the C-API, though a Python API is anticipated for 3.13.”
