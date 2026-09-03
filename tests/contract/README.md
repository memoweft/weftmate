# WeftMate × DSH 契约测试

本目录验证 WeftMate 依赖的当前 DeepSeek Harness（DSH，执行智能体运行时）公开接口。它是升级与打包的回归门，不定义产品路线、阶段或完成状态。

## 运行

```powershell
npm run test:contract
npm test
```

测试读取 `dsh-pin.json` 和当前 checkout/runtime resolver（检出目录/运行时解析器），并核对版本、commit 与必要运行依赖。发布形态先生成并验证 `vendor/dsh-runtime`，再通过 `WEFTMATE_DSH_RUNTIME` 指向该运行时执行同一组适用断言。

## 当前覆盖

- 官方 Web client（网页客户端）的 profile（配置组合）、沙箱、审批、权限预设、宿主与插件清单；
- 隔离 mock LLM（模拟语言模型）下的会话创建、事件流、工具结果、持久化回放与干净退出；
- DSH checkout/worktree 指针校验；
- MemoWeft pin 与当前窄适配、诊断输出契约。

测试文件名只是定位入口，不是路线编号或项目状态。具体断言以当前测试源码为准。

## 隔离边界

- 测试使用临时 `DSH_HOME`，不读写正在运行的用户会话；
- 子进程不继承 API key、token 或 secret；
- 测试只使用固定 DSH 的公开接口，不修改共享依赖源码；
- fake/mock 结果只证明契约，不证明正式模型、安装包、Android 模拟器动作或产品所有者 dogfood（亲自试用）。

## 升级 DSH

只有产品所有者明确升级时才修改 `dsh-pin.json`。修改后依次验证契约测试、类型检查、仓库测试和 vendor（内嵌依赖）构建；任何候选结果与已知问题写在当次交付中，不追加到本文件。
