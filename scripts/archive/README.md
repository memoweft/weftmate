# 历史一次性脚本

`stage14r3-*`（NInfer 维护试验）和 `stage3-*`（Windows 候选验收）及其测试保留在这里，供查阅旧实现。它们不在日常构建入口和默认单测目录中。

相应历史测试在 `tests/` 子目录，可显式运行：

```powershell
node --test --test-concurrency=1 "scripts/archive/tests/*.test.ts"
```

当前 Windows 候选构建入口仍是 `scripts/build-windows-candidate.mjs`，版本格式为 `major.minor.patch-label.N`（如 `0.1.0-candidate.1`）。它只核对并使用已有 vendor（内嵌运行时产物），不依赖这里的脚本。
