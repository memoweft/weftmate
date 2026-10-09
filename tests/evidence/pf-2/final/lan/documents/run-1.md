# Node.js 24 相比 22 值得留意的变化

本文基于官方发布说明整理，简要对比 Node.js 22.0.0（2024-04-24）与 Node.js 24.0.0（2025-05-06）的核心变化，方便评估升级影响。

## 版本定位
- Node.js 22.0.0：2024-04-24 发布，Current 六个月后进入 LTS，代号 Jod。
- Node.js 24.0.0：2025-05-06 发布，Current 六个月后进入 LTS，代号 Krypton。

来源：[Node.js 22.0.0 Release](https://nodejs.org/en/blog/release/v22.0.0/)；[Node.js 24.0.0 Release](https://nodejs.org/en/blog/release/v24.0.0/)

## 关键变化

### 1. V8 引擎升级
- 22 → V8 12.4.254.14
- 24 → V8 13.6

V8 13.6 带来新 JS 特性：
- Float16Array
- Explicit resource management
- RegExp.escape
- WebAssembly Memory64
- Error.isError

来源：[Node.js 24.0.0 Release - V8 13.6](https://nodejs.org/en/blog/release/v24.0.0/)

### 2. npm 版本
- 24 捆绑 npm 11，性能、安全性及对现代包的兼容性提升。
来源：[Node.js 24.0.0 Release - npm 11](https://nodejs.org/en/blog/release/v24.0.0/)

### 3. AsyncLocalStorage 默认实现
Node.js 24 将 AsyncLocalStorage 默认切换为 AsyncContextFrame，实现更高效的异步上下文追踪，API 更稳健。
来源：[Node.js 24.0.0 Release - AsyncLocalStorage defaults to AsyncContextFrame](https://nodejs.org/en/blog/release/v24.0.0/)

### 4. URLPattern 成全局可用
URLPattern API 现直接暴露在全局，无需额外导入，提供类似正则的 URL 模式匹配能力。
来源：[Node.js 24.0.0 Release - URLPattern as a global](https://nodejs.org/en/blog/release/v24.0.0/)

### 5. Permission Model 稳定化
实验性 Permission Model 从 `--experimental-permission` 改为 `--permission`，标志着更接近稳定。
来源：[Node.js 24.0.0 Release - Permission Model Improvements](https://nodejs.org/en/blog/release/v24.0.0/)

### 6. Test Runner 增强
Test Runner 现在自动等待子测试完成，无需手动 await，减少未处理 Promise 的常见错误。
来源：[Node.js 24.0.0 Release - Test Runner Enhancements](https://nodejs.org/en/blog/release/v24.0.0/)

### 7. Undici 升级
内置 HTTP 客户端升级到 Undici 7，性能提升并支持更多现代 HTTP 特性。
来源：[Node.js 24.0.0 Release - Undici 7](https://nodejs.org/en/blog/release/v24.0.0/)

### 8. 构建与平台变化
- Windows 编译：不再支持 MSVC，需使用 ClangCL 编译 Node.js。
来源：[Node.js 24.0.0 Release](https://nodejs.org/en/blog/release/v24.0.0/)

### 9. Node.js 22 的代表性新特性，供对比参考
- 支持 require() 同步 ESM 图
- 默认启用 WebSocket 客户端
- `node --run <script-in-package-json>` CLI
- `fs.glob` / `fs.globSync` 暴露
- V8 12.4 及 Maglev 启用
来源：[Node.js 22.0.0 Release](https://nodejs.org/en/blog/release/v22.0.0/)

## 升级建议
- 检查依赖对 V8 13.6 新语法的兼容性
- 若使用 AsyncLocalStorage，注意上下文行为变化
- Windows 编译环境需切换至 ClangCL
- 评估 Permission Model `--permission` 的使用场景
- 测试用例可利用 Test Runner 自动等待简化代码

如需完整废弃/移除列表，请查阅官方发布说明的 Deprecations and Removals 章节。
