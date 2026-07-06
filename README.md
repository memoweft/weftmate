# WeftMate

一个**记得住你**的桌面 AI 伴侣 —— 基于 [MemoWeft](https://github.com/memoweft/memoweft) 的长期记忆能力。
换个模型、关掉重开,她依然记得你说过什么;而且分得清哪些是事实、哪些只是它的猜测。

> **三层别搞混**:**WeftMate** = 这个桌面产品;**星瑶** = 它内置的一个可切换人格(不是产品名);**MemoWeft** = 底层的记忆能力库(当依赖 `import`)。

## 状态

MVP 施工中。第一步:趟平 Electron + sqlite 头号风险。详见 [docs/MVP.md](docs/MVP.md)。

## 开发

```bash
npm install
npm run smoke   # 第一步:验 node:sqlite 在 Electron 主进程能不能用(定架构)
```
