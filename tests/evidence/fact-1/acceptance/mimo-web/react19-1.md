# React 19 中的 ref 作为 prop、forwardRef、ref 清理回调与类组件

React v19 于 **December 05, 2024** 发布（"React v19 is now available on npm!" [1]）。以下依据 React 官方发布文章与升级指南，说明几组相关但不同的变化，并回答“forwardRef 是否在 19 已被删除”。

## 1. ref 作为 prop（针对函数组件）

从 React 19 起，函数组件可以直接把 `ref` 当作 prop 接收：

> "Starting in React 19, you can now access ref as a prop for function components" [1]

需要注意一个例外——**类组件不适用**，官方明确写道：

> "refs passed to classes are not passed as props since they reference the component instance." [1]

即传给类组件的 ref 不会作为 prop 传递，因为它引用的是组件实例本身。

关于它与 JSX transform 的关系：Upgrade Guide 把它与 JSX 速度改进并列，并说明这些改进要求新 transform [2]（原文 "In React 19, we're adding additional improvements like using ref as a prop and JSX speed improvements that require the new transform."）。因此若要单独断言“ref as a prop 单独依赖新 transform”，属于对该句的推断；官方原句是以 "like" 并列两项来陈述的。

## 2. forwardRef：19 中**没有**被删除

**结论：这些改变不代表 forwardRef 在 React 19 已被删除。**

- React 19 发布文章说的是：新函数组件不再需要 `forwardRef`，并且官方**计划**发布 codemod 帮助迁移；弃用与移除发生在**未来版本**：

> "New function components will no longer need forwardRef, and we will be publishing a codemod to automatically update your components to use the new ref prop. In future versions we will deprecate and remove forwardRef." [1]

  注意时态是 "we will be publishing"（将发布）与 "In future versions"（在未来版本），均指未来动作，不是 React 19 中已发生的删除。

- Upgrade Guide 的移除（Removed）清单列出：函数组件的 propTypes/defaultProps、Legacy Context、string refs、Module pattern factories、React.createFactory、react-test-renderer/shallow、react-dom/test-utils、ReactDOM.render/hydrate、unmountComponentAtNode、ReactDOM.findDOMNode 等 [2]——**其中不含 forwardRef**。

因此，“forwardRef 在 React 19 已被删除”与官方资料不符；正确表述是：React 19 中 `forwardRef` 仍可用，官方表示未来版本将弃用并移除它。

## 3. ref 清理回调（ref cleanup functions）

React 19 支持 ref 回调返回一个清理函数：

> "We now support returning a cleanup function from ref callbacks" [1]

组件卸载时，React 会调用该清理函数，官方注明适用范围：

> "When the component unmounts, React will call the cleanup function returned from the ref callback. This works for DOM refs, refs to class components, and useImperativeHandle." [1]

类型层面的限制（限定于 TypeScript）：

> "Due to the introduction of ref cleanup functions, returning anything else from a ref callback will now be rejected by TypeScript." [1] [2]

即：**TypeScript** 会拒绝从 ref 回调返回“其他值”（隐式返回实例等）；官方资料只说明 TypeScript 的这一拒绝，未说 React 运行时本身会报错。官方还提供 codemod：`no-implicit-ref-callback-return` [1]。

## 4. 类组件的对应变化

- **string refs 已在 React 19 移除**，仍在使用时需迁移到 ref callbacks [2]："In React 19, we're removing string refs to make React simpler and easier to understand." / "If you're still using string refs in class components, you'll need to migrate to ref callbacks:"
- **defaultProps 对类组件仍然支持**：官方移除的是**函数组件**的 defaultProps——"We're also removing defaultProps from function components in place of ES6 default parameters. Class components will continue to support defaultProps since there is no ES6 alternative." [2]
- 与 ref 清理回调的关系：上述 [1] 明确 ref 清理函数也适用于 "refs to class components"（见第 3 节）。
- `element.ref` 已弃用、且已不再支持；官方写明访问它会产生警告，并将在未来版本从 JSX Element 类型中移除 [2]："React 19 supports ref as a prop, so we're deprecating the element.ref in place of element.props.ref." / "Accessing element.ref will warn:" / "Accessing element.ref is no longer supported. ref is now a regular prop. It will be removed from the JSX Element type in a future release."

## 5. 三者关系小结

| 主题 | React 19 状态 | 关键条件/例外 |
| --- | --- | --- |
| ref 作为 prop | 新增，函数组件可直接收 `ref` | 类组件例外：传给类的 ref 不作为 prop 传递 [1] |
| forwardRef | **未删除，仍可用**；官方称未来版本将弃用并移除 [1]；Upgrade Guide 移除清单未列它 [2] | 面向“新函数组件”，并计划发布 codemod [1] |
| ref 清理回调 | 新增：ref 回调可返回清理函数，卸载时被调用 [1] | 适用于 DOM refs、类组件 refs、useImperativeHandle；非该返回值被 **TypeScript** 拒绝 [1] |
| 类组件 | string refs 移除、需 ref callbacks；defaultProps 仍支持 [2] | defaultProps 移除仅针对函数组件 [2] |

---

出处

[1] [React v19](https://react.dev/blog/2024/12/05/react-19)（capturedAt: 2026-10-10T03:08:19.935Z）
- "December 05, 2024 by The React Team"
- "React v19 is now available on npm!"
- "Starting in React 19, you can now access ref as a prop for function components:"
- "New function components will no longer need forwardRef, and we will be publishing a codemod to automatically update your components to use the new ref prop. In future versions we will deprecate and remove forwardRef."
- "refs passed to classes are not passed as props since they reference the component instance."
- "We now support returning a cleanup function from ref callbacks:"
- "When the component unmounts, React will call the cleanup function returned from the ref callback. This works for DOM refs, refs to class components, and useImperativeHandle."
- "Due to the introduction of ref cleanup functions, returning anything else from a ref callback will now be rejected by TypeScript."

[2] [React 19 Upgrade Guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)（capturedAt: 2026-10-10T03:08:19.584Z）
- "April 25, 2024 by Ricky Hanlon"
- "In React 19, we're adding additional improvements like using ref as a prop and JSX speed improvements that require the new transform."
- "We're also removing defaultProps from function components in place of ES6 default parameters. Class components will continue to support defaultProps since there is no ES6 alternative."
- "In React 19, we're removing string refs to make React simpler and easier to understand."
- "If you're still using string refs in class components, you'll need to migrate to ref callbacks:"
- "React 19 supports ref as a prop, so we're deprecating the element.ref in place of element.props.ref." / "Accessing element.ref will warn:" / "Accessing element.ref is no longer supported. ref is now a regular prop. It will be removed from the JSX Element type in a future release."
- "Due to the introduction of ref cleanup functions, returning anything else from a ref callback will now be rejected by TypeScript."
