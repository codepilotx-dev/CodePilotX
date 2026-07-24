# Environment Dock 无限更新

- 日期：2026-07-17
- 状态：DONE

## 症状

进入有工作区的会话后，React Router 错误页显示 `Maximum update depth exceeded`。调用栈落在 `ConversationPage` 的环境 Dock 注册 layout effect 与 `DesktopLayout` 的父级 setter 之间。

## 根因

环境信息通过子组件向父组件注册 ReactNode。`ConversationPage` 在渲染期间直接执行 `messages.filter(...)`，每次都会产生新的 `conversationMessages` 数组，继而使 timeline、source links 和环境 Dock 的注册版本全部失效。父级接收新注册后更新状态，再次触发子级渲染，形成同步循环。

工作区无分支数据时使用的 `currentWorkspace?.branches ?? []` 以及注册回调的内联函数也会产生不稳定引用，放大同一问题。

## 修复

- 将 `conversationMessages` 改为以 `messages` 为依赖的 memoized 派生值。
- 复用模块级空分支数组，并稳定 Git 工作流与环境注册回调。
- 环境 Dock 注册携带 revision；父级 reducer 对相同 revision 幂等返回，避免仅因 ReactNode 身份变化而更新。
- 增加环境 Dock 注册 reducer 的定向回归测试。

## 验证

- 真实 Agent 数据下重新打开原会话 `3868460e-a4fb-4560-bd4e-f3eae5d655a9`，等待异步加载和多轮 subagent 轮询后仍正常。
- 页面无 React Router 错误，`ConversationPage`、`ThreadScrollLayout`、Composer frame 与唯一 Composer surface 均存在。
- renderer typecheck、相关测试、CSS 契约与 renderer build 通过。
