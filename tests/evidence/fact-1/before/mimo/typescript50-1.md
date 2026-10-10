# TypeScript 5.0 新装饰器与 experimentalDecorators 的区别

## 1. 两套装饰器的关系

TypeScript 5.0 起，装饰器默认按 **TC39 Stage 3 的 ECMAScript 标准装饰器**实现：不加任何 flag 时，`@decorator` 就是合法语法，编译器会按标准做类型检查与代码 emit。

而 `--experimentalDecorators` 启用的是 TypeScript 早期实现的、**早于 TC39 标准化进程的旧版装饰器**（"a version of decorators that predates the TC39 standardization process"）。官方明确该 flag "will continue to exist for the foreseeable future"。

两套行为的关键差异（release notes "Differences with Experimental Legacy Decorators"）：

- 不加 `--experimentalDecorators` 时，装饰器"会被以不同的方式做类型检查和 emit（they will be type-checked and emitted differently）"。
- 签名不同：新装饰器为 `(target, context)` 二参形式，第二个参数是带 `name`、`#private`、`static` 等属性的 context 对象（如 `ClassMethodDecoratorContext`），还可以返回替换函数；旧实现则是 `(target, key, descriptor)` 及构造函数参数等旧式形态。
- 官方结论：两套的类型检查规则与 emit "差异足够大（sufficiently different）"，虽然可以写出同时支持两者的装饰器，但**既有的装饰器函数大概率做不到**（"any existing decorator functions are not likely to do so"）。
- 位置语法也有变化：新标准允许把装饰器写在 `export` 之前，或 `export` / `export default` 之后（如 `export default @register class`），但禁止在同一处混用两种风格（`@before export @after class` 会报错）。

## 2. emitDecoratorMetadata

- `emitDecoratorMetadata` **只在遗留装饰器路径（`experimentalDecorators: true`）下可用**，用于发出 `design:type` / `design:paramtypes` / `design:returntype` 等元数据（emit 出 `__metadata(...)` 调用，依赖运行时的 `Reflect.metadata`，即常见的 reflect-metadata 方案）。
- release notes 原文："This new decorators proposal is not compatible with --emitDecoratorMetadata"——**新装饰器提案与该选项不兼容**。
- 因此依赖元数据反射的 DI 框架（NestJS、Inversify 等 reflect-metadata 风格代码）无法直接迁到新语法，必须保留 `experimentalDecorators: true`（以及通常同时开启 `emitDecoratorMetadata`）。

## 3. 参数装饰器

- release notes 原文："…and it does not allow decorating parameters"——**新标准不允许装饰参数**。
- 旧实现支持构造函数参数装饰器（手册中有 "More Accurate Type-Checking for Parameter Decorators in Constructors Under --experimentalDecorators" 专节）。
- 官方同时提到："Future ECMAScript proposals may be able to help bridge that gap"，即未来 ECMAScript 提案或可弥合这一差距，目前没有。

## 4. 迁移边界

| 场景 | 结论 |
| --- | --- |
| 只用类/方法/访问器装饰器，不依赖元数据 | 可迁移：去掉 `experimentalDecorators`，按 `(target, context)` 新签名**重写**装饰器函数（既有旧装饰器大概率不能双兼容） |
| 依赖 `emitDecoratorMetadata` / reflect-metadata | 不可迁移：新装饰器不兼容该选项，须留在 `experimentalDecorators: true` |
| 使用参数装饰器 | 不可迁移：新标准不允许装饰参数，须留在旧实现 |
| 新项目默认 | 不加 flag 即用标准装饰器；需要旧能力时显式 opt-in |

`--experimentalDecorators` 在可预见的未来仍会保留（"will continue to exist for the foreseeable future"），两套可以长期共存，迁移是按项目能力逐个评估的工作，而非强制一次性切换。

## 来源

- [TypeScript 5.0 Release Notes — Differences with Experimental Legacy Decorators](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)
- [TSConfig Reference — experimentalDecorators](https://www.typescriptlang.org/tsconfig#experimentalDecorators)
- [TSConfig Reference — emitDecoratorMetadata](https://www.typescriptlang.org/tsconfig#emitDecoratorMetadata)
- [Decorators（Handbook）](https://www.typescriptlang.org/docs/handbook/decorators.html)
