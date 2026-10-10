# React 19 中的 ref、forwardRef 与清理回调

依据 React 19 正式发布文章及官方升级指南，简要说明如下。

## 1. ref 作为 prop（ref as a prop）

React 19 中，函数组件可以直接把 `ref` 当作普通 prop 接收，无需再用 `forwardRef` 包裹：

```jsx
function MyInput({ placeholder, ref }) {
  return <input placeholder={placeholder} ref={ref} />;
}
```

官方升级指南同时指出：由于支持了 ref as a prop，`element.ref` 已被弃用，改用 `element.props.ref`（访问 `element.ref` 会产生警告，并将在未来版本中从 JSX Element 类型移除）。该特性依赖新版 JSX transform。

## 2. forwardRef 在 React 19 中是否已被删除？

**没有被删除。** React 19 升级指南的"移除的 API"列表（`ReactDOM.render`、`ReactDOM.hydrate`、`unmountComponentAtNode`、`ReactDOM.findDOMNode`、字符串 ref、`react-dom/test-utils` 等）和"新增弃用"列表（`element.ref`、`react-test-renderer`）中均**没有 `forwardRef`**；TypeScript 变更部分也未涉及它。

准确的说法是：对**函数组件**而言，ref as a prop 使 `forwardRef` 不再必要（官方文档鼓励新代码直接以 prop 接收 ref），但它作为 API 仍然存在、仍可正常工作，React 19 并未删除或正式弃用它。

## 3. ref 清理回调（Cleanup functions for refs）

React 19 允许 ref 回调返回一个清理函数，组件卸载时 React 会调用它：

```jsx
<input
  ref={(ref) => {
    // ref 已创建
    return () => {
      // 此处清理
    };
  }}
/>
```

- 适用于 DOM ref、类组件实例的 ref，以及 `useImperativeHandle`。
- 此前 React 卸载时会以 `null` 调用 ref 回调；如果返回了清理函数，React 就不再用 `null` 调用。官方说明：未来版本将弃用卸载时以 `null` 调用 ref 的方式。
- TypeScript 层面：ref 回调返回非函数值会被拒绝（codemod：`no-implicit-ref-callback-return`），修复方式是避免隐式返回，如 `<div ref={current => {instance = current}} />`。

## 4. 与类组件的区别

- **类组件的 ref**：ref 回调收到的是类组件**实例**（而非 DOM 节点），React 19 的清理回调同样适用于这类 ref；类组件实例本身不走"ref 作为 prop"这条路径——ref as a prop 针对的是函数组件的参数。类组件中也不使用 `forwardRef`，而是通过 `this.props.ref`/回调 ref 的传统方式配合实例引用。
- **字符串 ref** 已在 React 19 中被移除（官方提供 codemod `react/19/replace-string-ref` 迁移到回调 ref 或 `createRef`），无论函数还是类组件都需迁移。
- 因此三者关系是：**ref 清理回调是所有组件类型通用的新机制；ref as a prop 是函数组件的新写法，使 forwardRef 对新代码不再必要；类组件的 ref 仍指向实例，行为与函数组件不同。**

## 结论

React 19 的改变（ref as a prop、ref 清理回调）**并不代表 `forwardRef` 已被删除**：它既不在移除列表也不在弃用列表中，仍然可用；只是对函数组件来说，新写法让它变成了可选项而非必需品。

## 来源

- [React v19 正式发布文章](https://react.dev/blog/2024/12/05/react-19)（"ref as a prop"、"Cleanup functions for refs" 等章节）
- [React 19 Upgrade Guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)（"Breaking changes"、"New deprecations"、"TypeScript changes" 各节）
