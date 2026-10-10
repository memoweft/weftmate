# TypeScript 5.0 新装饰器与 `experimentalDecorators` 的区别

## 1. 两套装饰器的定位

- **TypeScript 5.0 的新装饰器**实现了 **Stage 3（ECMAScript 标准）**提案，**不需要任何编译选项**，对新代码而言装饰器默认就是合法语法。
- **`experimentalDecorators: true`** 启用的是 TypeScript 过去支持的**旧的 Stage 2 实验性（legacy）装饰器**，它建模的是一个更早期的提案版本，必须显式 opt-in（tsconfig.json 或命令行均可）。
- 官方明确：`--experimentalDecorators` 在"可预见的未来"仍会保留；但**不加该标志时，装饰器的类型检查和代码 emit 都与加该标志时不同**。类型检查规则和 emit 差异之大，使得"一份装饰器代码同时兼容新旧行为"虽然理论上可写，但**现有的装饰器函数基本都不可能直接兼容**。

## 2. 签名与语义差异

**新装饰器（Stage 3）**：装饰器函数接收 `(originalValue, context)`，第二个参数是**上下文对象**（如 `ClassMethodDecoratorContext`），上面有 `name`、`static`、`private` 等信息，还有 `addInitializer`（在构造函数开头或静态初始化时挂钩）。装饰器工厂模式照常可用：

```ts
function loggedMethod(headMessage = "LOG:") {
  return function actualDecorator(originalMethod, context: ClassMethodDecoratorContext) {
    // ...
  };
}
```

**旧装饰器（legacy）**：签名是 `(target, propertyKey, descriptor: PropertyDescriptor)`——实例成员传原型、静态成员传构造函数。求值顺序也有明确规定：多个装饰器的工厂表达式自上而下求值，返回的函数自下而上被调用；类内部按"参数装饰器 → 方法/访问器/属性装饰器（先实例成员、后静态成员）→ 构造函数参数装饰器 → 类装饰器"的顺序应用。

## 3. `emitDecoratorMetadata`、参数装饰器

官方在 5.0 发布说明的 "Differences with Experimental Legacy Decorators" 一节中的原话：

> **This new decorators proposal is not compatible with `--emitDecoratorMetadata`, and it does not allow decorating parameters.** Future ECMAScript proposals may be able to help bridge that gap.

也就是说：

- **`emitDecoratorMetadata`**（生成 `design:type` / `design:paramtypes` / `design:returntype` 元数据，配合 `reflect-metadata` 使用）**只在 `experimentalDecorators` 的 legacy 实现下工作**；新装饰器与它不兼容。Handbook 的 Metadata 一节也写明：该功能须同时开启 `experimentalDecorators` 和 `emitDecoratorMetadata`，且标注为 experimental。
- **参数装饰器**（`parameter decorator`，旧签名 `(target, propertyKey, index)`）**在新实现中不存在**——新提案不允许装饰参数。TS 5.0 甚至还有一个专门改进 legacy 行为的条目："More Accurate Type-Checking for Parameter Decorators in Constructors Under `--experimentalDecorators`"，可见参数装饰器只属于旧实现。

## 4. 迁移边界（哪些代码能迁、哪些不能）

| 现有代码依赖 | 能否去掉 `experimentalDecorators` |
|---|---|
| 仅类/方法/访问器/属性装饰器（签名可改为 `(value, context)` 形式） | ✅ 可迁到新装饰器；需按新签名和新求值语义重写，旧装饰器函数一般不能原样复用 |
| 参数装饰器 | ❌ 必须保留 `experimentalDecorators: true`（新实现无此概念） |
| `emitDecoratorMetadata` + `reflect-metadata` 的设计时类型反射（常见于 NestJS、TypeORM、Inversify 等基于 `design:paramtypes` 的依赖注入/ORM 映射） | ❌ 必须保留 `experimentalDecorators: true`（新提案与 `--emitDecoratorMetadata` 不兼容） |

另外注意：新提案允许把装饰器放在 `export`/`export default` 之前**或之后**（但不能混用两种位置），这也是旧实现没有的语法差异。

**一句话总结**：TypeScript 5.0 起，标准（Stage 3）装饰器默认可用；`experimentalDecorators` 是通往旧 Stage 2 实现的开关。**依赖参数装饰器或 `emitDecoratorMetadata` 的项目是硬边界，必须继续开启该选项**；其余纯装饰器代码可以迁移，但要按新签名重写，不能假设原样兼容。

## 来源

- [TypeScript 5.0 Release Notes — Decorators / Differences with Experimental Legacy Decorators](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)
- [TypeScript Handbook — Decorators（legacy / experimental stage 2 实现）](https://www.typescriptlang.org/docs/handbook/decorators.html)
