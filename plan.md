# Plan: 对话页耗时任务显示「正在运行命令，已持续 X s」

## Context
当前 `TimelineToolGroupView` 在命令组折叠时显示 "已运行命令" / "已运行 {commandLabel}"，命令运行中时仅在 shell footer 显示 "运行中"，没有耗时计时。需要在命令仍在执行时，将折叠行文字改为实时显示「正在运行命令，已持续 X s」。

## 修改文件
`apps/desktop/src/renderer/components/ConversationPage.tsx`

## 步骤

### 1. 给 `TimelineToolRun` 添加 `startedAtMs` 字段
```ts
type TimelineToolRun = {
  // ...existing fields
  startedAtMs?: number;  // 命令开始时间 (epoch ms)
};
```

### 2. 在 `buildToolGroup` 中传递 `createdAt`
当处理 `tool_call` 事件时，解析 `event.createdAt` 并存入 `startedAtMs`:
```ts
if (event.type === "tool_call") {
  runs.push({
    // ...existing fields
    startedAtMs: Date.parse(event.createdAt) || undefined,
  });
}
```

### 3. 更新 `CommandRunView` 类型和 `commandRunView` 函数
```ts
type CommandRunView = {
  // ...existing fields
  startedAtMs?: number;
};
```
在 `commandRunView` 中传递 `startedAtMs`。

### 4. 添加一个简单的 `useElapsedSeconds` hook
在 `ConversationPage.tsx` 文件顶部添加一个本地 hook，使用 `useSyncExternalStore` + `setInterval` 驱动 1s tick:
```ts
function useElapsedSeconds(startTimeMs: number | undefined, isRunning: boolean): number {
  const get = () =>
    startTimeMs && isRunning ? Math.floor((Date.now() - startTimeMs) / 1000) : 0;
  const subscribe = (cb: () => void) => {
    if (!isRunning) return () => {};
    const id = setInterval(cb, 1000);
    return () => clearInterval(id);
  };
  return useSyncExternalStore(subscribe, get, get);
}
```

### 5. 修改 `TimelineToolGroupView` 渲染逻辑
- 找出组内是否有正在运行的 run
- 如果有，group summary 按钮文字改为 "正在运行命令，已持续 {X} s"
- 每个 individual run 行在运行中时也显示 "正在运行命令，已持续 {X} s"

关键改动在 line 1598-1599 (group summary) 和 line 1642 (individual run row):
- **Group summary**: 如果组内有 running 的 run，显示「正在运行命令，已持续 X s」
- **Individual run row**: 如果该 run 正在运行，显示「正在运行命令，已持续 X s」，而不是「已运行 {command}」

## 涉及的精确位置
- `ConversationPage.tsx:1267-1276` — `TimelineToolRun` 类型
- `ConversationPage.tsx:1697-1704` — `CommandRunView` 类型
- `ConversationPage.tsx:1706-1729` — `commandRunView` 函数
- `ConversationPage.tsx:1574-1693` — `TimelineToolGroupView` 组件
- `ConversationPage.tsx:2928-2998` — `buildToolGroup` 函数

## 验证
- 检查 TypeScript 编译无报错
- 代码风格与文件内现有模式一致（无新增注释，保持现有缩进）
