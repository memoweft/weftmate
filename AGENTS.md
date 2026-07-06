# AGENTS.md · WeftMate

极简开工说明。接手先读三份:**本文件、`docs/PRODUCT.md`、`CURRENT.md`**。可视化蓝图 `docs/blueprint.html`(浏览器打开)。

## 这是什么

WeftMate 是一个**越用越懂你的 AI 桌面伴侣**(Electron 桌面常驻 App),开源、面向大众、主打展示 MemoWeft 的记忆能力。`import memoweft@^0.5.0` 当依赖(**库仓库在 `../DLA_rebuild`**)。**星瑶**是内置的一个可切换人格(非产品名)。完整产品定义见 `docs/PRODUCT.md`。

一句话:**一套成熟桌面 App 的产品骨架 + 三样竞品都没有的独有肌肉(记忆画像 / 人格能力包 / 桌面形象+感知)**,终点是**越用越懂你**。

## 红线(就这几条)

- **不碰 MemoWeft 库** —— 当依赖 `import 'memoweft'`,**不改它的源码**(库仓库 `../DLA_rebuild` 的 main 保持"库+生态"纯粹)。
- **守 MemoWeft 的 `docs/naming.md`** —— 别吹"真正理解你"、记≠信、慢活诚实说"要一会儿"、用户侧不露 0–1000 原始把握度、MemoWeft(能力层)文案不出现"她"、第一人称只属星瑶。
- **三条纪律**(见 PRODUCT.md):工具定义**延迟加载**(否则上下文爆)、主动打断**只报 P0/P1**(别唠叨)、**隐私**(observed 默认不上云、apiKey 不明文落盘走 safeStorage)。
- **改完能跑** —— `npm start` 起得来 Electron、typecheck 过。

## 跑

```bash
npm install
npm start        # 起 Electron(主进程 import server.ts 起 loopback + core → 窗口加载)
```

## 现在做什么

见 `CURRENT.md`(当前 = 阶段 1)。**PRODUCT.md 是活文档,中途要改随时改。**
