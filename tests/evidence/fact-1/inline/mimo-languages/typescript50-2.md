# TypeScript 5.0 的新装饰器与 experimentalDecorators 的区别

## 两套实现的分工

TypeScript 5.0 引入了基于 ECMAScript Stage 3 提案的新装饰器实现；**不开启 `--experimentalDecorators` 时，装饰器即按这套新规则处理**，官方明确说："decorators will now be valid syntax for all new code"，并且 "Outside of `--experimentalDecorators`, they will be type-checked and emitted differently." [1]

`--experimentalDecorators` 打开的则是 TypeScript 多年来支持的旧实验性实现，它 "modeled a much older version of the decorators proposal, and always required an opt-in compiler flag"。TS 5.0 之后该选项并未废弃："--experimentalDecorators will continue to exist for the foreseeable future" [1]。也就是说，**两套实现并存，由编译选项二选一**；开启选项即回到旧规则，不开启即用新规则。

## 核心差异一览

| 维度 | 新装饰器（默认） | `experimentalDecorators`（旧实现） |
| --- | --- | --- |
| 依据 | ECMAScript Stage 3 提案 [1] | 更早版本的装饰器提案 [1] |
| 是否需要选项 | 不需要；新代码默认有效语法 [1] | 必须显式开启 [1][2] |
| `emitDecoratorMetadata` | **不支持** [1] | 支持（实验性功能）[2] |
| 参数装饰器 | **不允许装饰参数** [1] | 允许，parameter 是合法装饰目标 [2] |
| 类型检查与产物 | 与旧实现 "sufficiently different" [1] | 沿用旧规则 |

关于 `emitDecoratorMetadata`：这是传统实现下的实验性功能，编译器 "will inject design-time type information using the `@Reflect.metadata` decorator"，官方同时标注 "Decorator metadata is an experimental feature and may introduce breaking changes in future releases" [2]。新提案 **"does not support emitDecoratorMetadata, and it does not allow decorating parameters"**，官方补注未来 ECMAScript 提案或许能弥合这一差距 [1]。

关于参数装饰器：旧实现允许装饰器附着到 "a class declaration, method, accessor, property, or parameter"，参数装饰器由此而来 [2]；而新实现下参数不是合法装饰目标 [1]。

## 迁移边界

1. **不能只换语法就完事。** 官方指出："The type-checking rules and emit are sufficiently different that while decorators can be written to support both the old and new decorators behavior, any existing decorator functions are not likely to do so." [1] 装饰器*可以*写成同时兼容两套行为，但既有装饰器函数大概率做不到直接沿用。
2. **依赖元数据的代码是硬边界。** 只要用到 `emitDecoratorMetadata`（典型场景：依赖注入框架读取设计时类型信息）或参数装饰器，就**必须留在 `--experimentalDecorators`**，因为新实现没有这两项能力 [1][2]。
3. **同一声明不能混用新旧书写风格。** 新装饰器与 `export` / `export default` 的位置组合有专门规则，"mixing the two styles is not allowed" [1]。
4. **现状判断。** `experimentalDecorators` 在可预见未来仍会保留 [1]，因此"继续使用旧实现"是官方认可的长期状态，不是必须立刻清除的临时开关；真正的迁移边界取决于项目是否依赖上述旧实现专属能力。

## 出处

1. [TypeScript 5.0 Release Notes — Decorators](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)（capturedAt: 2026-10-10T03:45:11.525Z）："decorators will now be valid syntax for all new code"；"Outside of --experimentalDecorators, they will be type-checked and emitted differently."；"always required an opt-in compiler flag called --experimentalDecorators"；"--experimentalDecorators will continue to exist for the foreseeable future"；"The type-checking rules and emit are sufficiently different that while decorators can be written to support both the old and new decorators behavior, any existing decorator functions are not likely to do so."；"does not support emitDecoratorMetadata, and it does not allow decorating parameters"；"mixing the two styles is not allowed."
2. [TypeScript Handbook — Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html)（capturedAt: 2026-10-10T03:45:09.637Z）："NOTE This document refers to an experimental stage 2 decorators implementation. Stage 3 decorator support is available since Typescript 5.0."；"To enable experimental support for decorators, you must enable the experimentalDecorators compiler option"；"can be attached to a class declaration, method, accessor, property, or parameter."；"The TypeScript compiler will inject design-time type information using the @Reflect.metadata decorator"；"NOTE Decorator metadata is an experimental feature and may introduce breaking changes in future releases."
