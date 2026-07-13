/**
 * memoweft 门面收拢层（运行时无关接缝）。
 *
 * WeftMate（产品层）与 memoweft（能力层）是分层关系：库当依赖 import，绝不碰其源码（AGENTS.md 红线）。
 * 全项目对 memoweft 的依赖【只经这一个文件】——其它模块一律 `import from './memoweft.ts'`（或 '../memoweft.ts'），
 * 不再直接 `import 'memoweft'`。这么做换来三件事：
 *   ① 升级内核时爆炸半径 = 这一个文件：内核改了 API 只需在这里适配一处；
 *   ② 这份 re-export 清单就是「WeftMate 到底依赖内核哪些 API」的活文档；
 *   ③ 运行时无关接缝：未来若换记忆引擎 / memoweft 支持另一运行时（手机端），引擎绑定只在这层，
 *      上层逻辑不动（守 owner 拍板的「手机端预留架构接缝」）。
 *
 * 升级安全的第一道防线是 tsconfig 的 typecheck：内核 API 签名一变，这里（及调用方）当场编译期红。
 * 未来 M1 会在这层挂 schema 迁移检查（getSchemaVersion + runMigrations），作为自动更新的硬前置。
 */

export { createMemoWeftCore, config, OpenAICompatClient, loadLLMConfig } from 'memoweft';
export type { MemoryBundle, Observation, ChatMessage, MemoWeftPlugin } from 'memoweft';
