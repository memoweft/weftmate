# React 19 中的 ref 变化：ref as a prop、forwardRef、ref 清理回调与类组件

以下依据 React 官方发布的 React v19 博客文章（2024-12-05 稳定版）说明相关变化 [1]。

## ref 作为 prop

从 React 19 开始，函数组件可以直接把 `ref` 当作普通 prop 接收并使用，无需再用 `forwardRef` 包裹：

```jsx
function MyInput({placeholder, ref}) {
  return <input placeholder={placeholder} ref={ref} />
}

<MyInput ref={ref} />
```

文章原文：“Starting in React 19, you can now access ref as a prop for function components.” [1]

## forwardRef：在 19 并未被删除

对于 `forwardRef`，发布文章的表述是：

> “New function components will no longer need forwardRef, and we will be publishing a codemod to automatically update your components to use the new ref prop. In future versions we will deprecate and remove forwardRef.” [1]

也就是说：

- **新函数组件不再“需要” `forwardRef`**，官方会提供 codemod 把现有组件改为直接使用 `ref` prop；
- **`forwardRef` 在 React 19 中并未被删除**——文章明确说“在未来版本（In future versions）”才会弃用并移除。

因此，“forwardRef 已在 19 被删除”的说法与该发布文章不符：19 只是让 `forwardRef` 变得不再必要，删除是将来版本的计划。

## ref 清理回调（Cleanup functions for refs）

React 19 支持 ref 回调返回一个清理函数：

```jsx
<input
  ref={(ref) => {
    // ref created
    // NEW: return a cleanup function to reset
    // the ref when element is removed from DOM.
    return () => {
      // ref cleanup
    };
  }}
/>
```

文章原文：“When the component unmounts, React will call the cleanup function returned from the ref callback. This works for DOM refs, refs to class components, and useImperativeHandle.” [1]

相关注意事项：

- **与旧的 `null` 调用行为的关系**：原文说明“Previously, React would call ref functions with null when unmounting the component. If your ref returns a cleanup function, React will now skip this step.”，并说未来版本会弃用卸载时以 `null` 调用 ref 的方式 [1]。
- **TypeScript 检查**：由于引入了 ref 清理函数，ref 回调返回其他值（例如隐式返回元素实例）会被 TypeScript 拒绝，通常改为显式大括号、避免隐式返回即可；文章还给出 `no-implicit-ref-callback-return` codemod [1]。

## 类组件的区别

- **类组件不会收到 ref prop**：文章注明“refs passed to classes are not passed as props since they reference the component instance.”——传给类组件的 ref 不作为 prop 传递，因为它引用的是组件实例 [1]。因此“ref as a prop”只适用于函数组件。
- **ref 清理函数同时适用于类组件实例引用**：清理回调机制不仅覆盖 DOM ref 和 `useImperativeHandle`，也包括“refs to class components”——即可以拿到类组件实例的那类 ref 同样支持清理回调 [1]。二者的区别是：类的实例 ref 不以 prop 形式注入组件，但对它的 ref 回调仍可返回清理函数。

## 结论

React 19 的 ref 改动包括：函数组件可直接收 `ref` prop、ref 回调可返回清理函数（含类组件实例 ref）、以及对 `forwardRef` 的“不再需要”。发布文章并未说 `forwardRef` 在 19 被删除，只说未来版本才会弃用并移除。

---

## 出处

[1] [React v19 – React](https://react.dev/blog/2024/12/05/react-19)（capturedAt: 2026-10-10T03:54:03.756Z）

- “Starting in React 19, you can now access ref as a prop for function components”
- “New function components will no longer need forwardRef, and we will be publishing a codemod to automatically update your components to use the new ref prop. In future versions we will deprecate and remove forwardRef.”
- “refs passed to classes are not passed as props since they reference the component instance.”
- “We now support returning a cleanup function from ref callbacks”
- “When the component unmounts, React will call the cleanup function returned from the ref callback. This works for DOM refs, refs to class components, and useImperativeHandle.”
- “Previously, React would call ref functions with null when unmounting the component. If your ref returns a cleanup function, React will now skip this step.”
- “Due to the introduction of ref cleanup functions, returning anything else from a ref callback will now be rejected by TypeScript.”
