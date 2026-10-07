# 历史一次性脚本

本机模型运行以仓库外 D:\AI 的 ModelSwitcher（模型切换代理）和 Config 为准，动态入口为 8081。WeftMate 只读状态并经代理调用现有控制脚本重启当前模型。这里的一次性恢复脚本只保留旧实验的查阅用途，不替代 D:\AI 的正式入口。

`stage14r3-*`（NInfer 维护试验）和 `stage3-*`（Windows 候选验收）及其测试保留在这里，供查阅旧实现。它们不在日常构建入口和默认单测目录中。

相应历史测试在 `tests/` 子目录，可显式运行：

```powershell
node --test --test-concurrency=1 "scripts/archive/tests/*.test.ts"
```

当前 Windows 候选构建入口仍是 `scripts/build-windows-candidate.mjs`，版本格式为 `major.minor.patch-label.N`（如 `0.1.0-candidate.1`）。它只核对并使用已有 vendor（内嵌运行时产物），不依赖这里的脚本。
