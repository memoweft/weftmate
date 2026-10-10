# React 19 中的 ref：ref as a prop、forwardRef、ref 清理回调与类组件

## 背景

React 19 正式版已发布：官方博客写明 “React v19 is now available on npm!”，页面标注日期为 December 05, 2024，并注明该文原发布于 04/25/2024、于 12/05/2024 更新为稳定版 [1]。破坏性变更清单官方指向 Upgrade Guide：“For a list of breaking changes, see the Upgrade Guide.” [1]

## 1. ref 作为 prop

从 React 19 起，函数组件可以直接把 `ref` 当普通 prop 接收 [1]：

```jsx
function MyInput({ placeholder, ref }) {
  return <input placeholder={placeholder} ref={ref} />;
}

<MyInput ref={ref} />;
```

原文：“Starting in React 19, you can now access ref as a prop for function components”，并称 “New function components will no longer need forwardRef, and we will be publishing a codemod to automatically update your components to use the new ref prop.” [1]

## 2. forwardRef：19 中没有被删除

结论先说：**forwardRef 在 React 19 中并未被删除，只是不再必需。**

- 官方参考页仍保留 forwardRef API，页首标记为 “Deprecated”，并写明 “In React 19, forwardRef is no longer necessary. Pass ref as a prop instead.” 以及 “forwardRef will be deprecated in a future release.” [2]
- 发布文章的措辞是未来时：“In future versions we will deprecate and remove forwardRef.” [1]

也就是说，“19 已删除 forwardRef” 的说法不成立；deprecate 与 remove 都指向未来版本，19 中旧代码仍可照常使用。

## 3. ref 清理回调（cleanup functions）

React 19 起，ref 回调可以返回一个清理函数；组件卸载时 React 会调用它 [1]：

```jsx
<input
  ref={(ref) => {
    // ref created
    return () => {
      // ref cleanup
    };
  }}
/>
```

适用范围（原文）：“When the component unmounts, React will call the cleanup function returned from the ref callback. This works for DOM refs, refs to class components, and useImperativeHandle.” [1]

与旧行为的区别：以前卸载时 React 总会以 `null` 调用 ref 回调；现在 “If your ref returns a cleanup function, React will now skip this step.”，并且 “In future versions, we will deprecate calling refs with null when unmounting components.” [1]

类型层面的变化：由于清理函数的引入，“returning anything else from a ref callback will now be rejected by TypeScript”（注意：是 TypeScript 拒绝，不是 React 运行时报错）；官方提供 codemod `no-implicit-ref-callback-return` 修复隐式返回写法 [1]。

## 4. 类组件的区别

两点要分开看：

1. **ref-as-prop 不覆盖类**：官方明确 “refs passed to classes are not passed as props since they reference the component instance.” [1] —— 类组件的 ref 引用的是组件实例，因此不走 “作为 prop 传入” 的路径；ref as a prop 面向函数组件。
2. **ref 清理回调覆盖类**：如上文，清理回调 “works for DOM refs, refs to class components, and useImperativeHandle” [1] —— 即针对**类组件实例的 ref**（通过其他方式获得的 ref）同样适用清理回调机制。

## 5. 是否代表 forwardRef 已被删除？

否。19 的实际变化是：新的函数组件不再需要 forwardRef（可直接传 `ref` prop，官方还会发布 codemod 帮助迁移）[1]；forwardRef 本身在 19 中仍可用，官方状态是 Deprecated，并明说 “will be deprecated in a future release”[2]、“In future versions we will deprecate and remove forwardRef”[1]。删除发生在计划中的未来版本，而不是 React 19。

---

## 出处

[1] [React v19 – React](https://react.dev/blog/2024/12/05/react-19)，capturedAt 2026-10-10T03:28:28.940Z
- “React v19 is now available on npm!”
- “Note: this post was originally published 04/25/2024 and has been updated to 12/05/2024 with the stable release.”
- “For a list of breaking changes, see the Upgrade Guide.”
- “Starting in React 19, you can now access ref as a prop for function components:”
- “New function components will no longer need forwardRef, and we will be publishing a codemod to automatically update your components to use the new ref prop. In future versions we will deprecate and remove forwardRef.”
- “refs passed to classes are not passed as props since they reference the component instance.”
- “When the component unmounts, React will call the cleanup function returned from the ref callback. This works for DOM refs, refs to class components, and useImperativeHandle.”
- “Previously, React would call ref functions with null when unmounting the component. If your ref returns a cleanup function, React will now skip this step.”
- “In future versions, we will deprecate calling refs with null when unmounting components.”
- “Due to the introduction of ref cleanup functions, returning anything else from a ref callback will now be rejected by TypeScript.”
- “You can codemod this pattern with no-implicit-ref-callback-return.”

[2] [forwardRef – React](https://react.dev/reference/react/forwardRef)，capturedAt 2026-10-10T03:28:29.290Z
- “Deprecated”
- “In React 19, forwardRef is no longer necessary. Pass ref as a prop instead.”
- “forwardRef will be deprecated in a future release. Learn more here.”
