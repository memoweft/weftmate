# React 19 中的 ref、forwardRef 与类组件

根据 React 19 正式发布文章，React 19 让**函数组件可以直接把 `ref` 当作普通 prop 接收**，例如 `function MyInput({placeholder, ref})`，调用时写 `<MyInput ref={ref} />`[1]。这使新写的函数组件**不再需要 `forwardRef`**；发布文章同时明确：forwardRef 并不是在 React 19 中已经删除，而是在**未来版本**才会弃用并移除[1]。React 19 升级指南列出的“移除已弃用 API”也不包含 `forwardRef`，因此“19 已删除 forwardRef”并不准确[2]。

**类组件仍有区别：** 传给类组件的 `ref` **不会作为 prop 传入**，因为类组件的 ref 指向组件实例[1]。因此，“ref 作为 prop”适用于函数组件，而类组件实例仍通过传统 ref 机制获得。

**ref 清理回调：** React 19 支持从 ref 回调中返回清理函数；组件卸载时，React 会调用该清理函数。发布文章说明，这一行为适用于 DOM refs、类组件的 refs 和 `useImperativeHandle`[1]。如果 ref 返回了清理函数，React 不再以旧方式用 `null` 调用 ref；文章也指出，未来版本才会弃用卸载时以 `null` 调用 ref 的方式[1]。TypeScript 因此会拒绝 ref 回调返回非清理函数的内容，通常需要避免隐式返回[2]。

**简要对比：**

- **ref 作为 prop**：React 19 的函数组件新能力；旧的 `forwardRef` 写法不再必需，但尚未在 19 删除[1]。
- **forwardRef**：React 19 仍可用；官方计划是在未来版本弃用并移除[1]。
- **ref 清理回调**：卸载时执行返回的清理逻辑，适用于 DOM、类组件 ref 和 `useImperativeHandle`[1]。
- **类组件**：`ref` 不会作为组件 prop 传入，因为它指向组件实例[1]。

## 出处

1. [React v19](https://react.dev/blog/2024/12/05/react-19)，访问时间：2026-10-10T03:37:49.615Z — “Starting in React 19, you can now access ref as a prop for function components”；“New function components will no longer need forwardRef, and we will be publishing a codemod to automatically update your components to use the new ref prop. In future versions we will deprecate and remove forwardRef.”；“refs passed to classes are not passed as props since they reference the component instance.”；“When the component unmounts, React will call the cleanup function returned from the ref callback. This works for DOM refs, refs to class components, and useImperativeHandle.”；“Previously, React would call ref functions with null when unmounting the component. If your ref returns a cleanup function, React will now skip this step.”；“In future versions, we will deprecate calling refs with null when unmounting components.”
2. [React 19 Upgrade Guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)，访问时间：2026-10-10T03:37:49.876Z — “Removed deprecated React APIs”下列出“Removed: propTypes and defaultProps for functions”“Removed: Legacy Context using contextTypes and getChildContext”“Removed: string refs”“Removed: Module pattern factories”“Removed: React.createFactory”等，未列 `forwardRef`；“Due to the introduction of ref cleanup functions, returning anything else from a ref callback will now be rejected by TypeScript.”
