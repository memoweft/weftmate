# TypeScript 5.0 的新装饰器与 `experimentalDecorators`

TypeScript 5.0 的默认装饰器已对应标准 ECMAScript 装饰器提案；`--experimentalDecorators` 则继续启用旧式“实验性传统装饰器”实现。两者不是同一套规则：官方说明，关闭该标志后装饰器会成为新代码的有效语法，而在该标志之外，装饰器的**类型检查和生成结果不同**[1]。因此，迁移时不能只切换编译选项，还要同时检查类型错误、运行时代码及依赖库。

- `experimentalDecorators`：开启后沿用旧实现；官方明确它“在可预见的未来仍会继续存在”，并非在 5.0 中被移除[1]。
- 默认新实现：不开启该标志时使用新提案；代码通过语法检查，不代表旧装饰器库可原样工作[1]。
- 两者边界：官方强调两套类型检查和 emit 规则差异很大；虽然可以编写同时支持两种行为的装饰器，但**现有装饰器函数不太可能自然兼容**[1]。迁移时应逐个验证装饰器的参数签名、返回值、类字段初始化时机和生成代码，而不是直接复用。

## `emitDecoratorMetadata`

`emitDecoratorMetadata` 用于输出 `design:type`、`design:paramtypes`、`design:returntype` 等反射元数据；TSConfig Reference 将它列在“Language and Environment”中[2]。但 TypeScript 5.0 官方同时限定：**新装饰器提案不兼容 `--emitDecoratorMetadata`**[1]。

因此，依赖 NestJS、TypeORM 或类似反射方案的项目若需要这些元数据，应继续评估旧实现；若要采用新装饰器，就需要改用显式类型信息、独立反射机制或等效方案。不能把“配置仍存在”理解为“新装饰器下可正常使用”。

## 参数装饰器

新装饰器提案**不允许装饰参数**[1]。所以构造函数参数、方法参数上的 `@...` 装饰器必须继续由 `--experimentalDecorators` 提供；不能只开启 `emitDecoratorMetadata` 来补救，因为新提案本身已经同时排除了元数据和参数装饰[1]。TypeScript 5.0 另外改进了旧模式下构造函数参数装饰器的类型检查，这也说明参数装饰仍属于旧实现的讨论范围[1]。

## 迁移边界

1. **保持旧实现**：项目依赖参数装饰器、`emitDecoratorMetadata`，或依赖现有装饰器函数的具体运行时语义时，继续设置 `"experimentalDecorators": true`。这仍是官方支持的路径，而非已废弃开关[1]。
2. **迁移到新实现**：只有在代码不依赖上述能力、并能逐项验证类型检查和 emit 差异时，才移除该标志。不要把“语法能编译”当成“行为兼容”[1]。
3. **逐库确认**：现有装饰器库不能仅凭 API 外观判断兼容；官方只承诺可以另行编写同时支持两套行为的装饰器，并明确现有函数多半做不到[1]。
4. **装饰位置同时检查**：新提案既允许装饰器写在 `export` 之前，也允许写在 `export`/`export default` 之后，但**不能混用两种位置**；旧代码若迁移，需要一并调整位置[1]。

简言之：新旧模式的边界由 `experimentalDecorators` 控制；新模式放弃了参数装饰和 `emitDecoratorMetadata`，而旧实现仍承担这些功能。迁移应以实际依赖和生成结果为准，不能按单一语法兼容性作判断。

## 出处

1. [TypeScript: Documentation - TypeScript 5.0](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)（capturedAt：2026-10-10T03:41:00.495Z）：“--experimentalDecorators will continue to exist for the foreseeable future; however, without the flag, decorators will now be valid syntax for all new code.”；“Outside of --experimentalDecorators, they will be type-checked and emitted differently.”；“The type-checking rules and emit are sufficiently different that while decorators can be written to support both the old and new decorators behavior, any existing decorator functions are not likely to do so.”；“This new decorators proposal is not compatible with --emitDecoratorMetadata, and it does not allow decorating parameters.”；“the proposal for decorators now provides the option of placing decorators after export or export default. The only exception is that mixing the two styles is not allowed.”；“More Accurate Type-Checking for Parameter Decorators in Constructors Under --experimentalDecorators”。
2. [TypeScript: TSConfig Reference - Docs on every TSConfig option](https://www.typescriptlang.org/tsconfig/)（capturedAt：2026-10-10T03:41:14.162Z）：“Language and Environment”列出“emitDecoratorMetadata,experimentalDecorators”；输出示例包含“`__metadata("design:type", Function)`”、“`__metadata("design:paramtypes", [Number])`”和“`__metadata("design:returntype", void 0)`”。
