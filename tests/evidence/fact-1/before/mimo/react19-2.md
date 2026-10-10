# React 19 中的 ref 变化：ref as a prop、forwardRef、清理回调与类组件

依据 React 19 正式发布文章（[React v19](https://react.dev/blog/2024/12/05/react-19)，2024-12-05）及官方 reference 文档，简要说明如下。

## 1. ref as a prop（ref 作为 prop）

在 React 19 中，函数组件可以直接把 `ref` 当作普通 prop 接收和传递，不再需要 `forwardRef` 包装。这让 ref 的传递更直接、更符合普通 props 的心智模型。

## 2. forwardRef：在 React 19 中并未被删除

**结论：`forwardRef` 在 React 19 中没有被删除，仍然可用，只是不再必要。**

官方 [`forwardRef` reference 页](https://react.dev/reference/react/forwardRef) 的说法是：

> "In React 19, forwardRef is no longer necessary. Pass ref as a prop instead."
> "forwardRef will be deprecated in a future release."

即：页面标注为 *Deprecated*（弃用状态），但**弃用发生在未来版本**，React 19 本身仍支持它。所以不能说"forwardRef 在 19 已被删除"。

## 3. ref 清理回调（Cleanup functions for refs）

React 19 支持 ref 回调返回一个清理函数，卸载时 React 会调用它：

```jsx
<input
  ref={(ref) => {
    // ref created
    return () => {
      // ref cleanup：元素从 DOM 移除时重置 ref
    };
  }}
/>
```

要点：

- 适用于 DOM refs、类组件实例 refs 和 `useImperativeHandle`。
- 过去 React 卸载时会以 `null` 调用 ref 函数；返回了清理函数后，React 会跳过这一步。
- **未来版本**才会弃用"以 null 调用 ref"这一旧行为。
- 由于清理函数的引入，TypeScript 会拒绝 ref 回调隐式返回非函数值（如 `<div ref={current => (instance = current)} />`），需改为块体写法 `<div ref={current => {instance = current}} />`，可用 codemod `no-implicit-ref-callback-return` 自动修复。

## 4. 与类组件的区别

- 类组件的 ref 挂在组件实例（`this`）上，通过实例字段访问；React 19 的 ref as a prop 与清理回调主要面向函数组件的声明式写法。
- 官方将 `Component` 归入 "LEGACY REACT APIS"，并注明："Class components are still supported by React, but we don't recommend using them in new code."（类组件仍受支持，但不建议在新代码中使用，见 [`Component` reference](https://react.dev/reference/react/Component)）。

## 5. 总结

| 项目 | React 19 状态 |
| --- | --- |
| ref as a prop | 新增，函数组件可直接接收 ref |
| forwardRef | **未删除**，仍可用，仅标记为弃用（未来版本才正式弃用） |
| ref 清理回调 | 新增，卸载时调用返回的清理函数；以 null 调用的旧行为未来才会弃用 |
| 类组件 | 仍支持，但归类为 legacy API，不推荐新代码使用 |

## 来源

- [React v19 官方发布文章](https://react.dev/blog/2024/12/05/react-19)
- [forwardRef reference（标注 Deprecated）](https://react.dev/reference/react/forwardRef)
- [Component reference（LEGACY REACT APIS）](https://react.dev/reference/react/Component)
