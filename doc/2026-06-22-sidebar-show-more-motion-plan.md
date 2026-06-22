# sidebar-show-more-button 展开收缩动画计划

## 目标

给桌面侧边栏里的 `sidebar-show-more-button` 增加展开、收缩动画。动画只作用于该按钮控制的额外会话列表，不改主侧边栏宽度动画。

## 当前判断

- 目标组件是 `apps/desktop/src/renderer/components/sidebar/SidebarSessionGroup.tsx`。
- 当前逻辑在收起时显示前 5 条会话，展开时直接显示全部会话。
- 项目已经依赖 `motion`，并且 `SidebarFooter.tsx` 已经使用 `AnimatePresence` 和 `motion.div` 做高度动画。

## 实施步骤

1. 给会话分组显示逻辑补一个最小测试。
   - 新增 `apps/desktop/src/renderer/components/sidebar/SidebarSessionGroup.test.ts`。
   - 测试一个纯 helper：收起时基础列表为前 5 条、展开时额外列表为第 6 条之后。
   - 先运行测试，确认 helper 不存在导致失败。

2. 修改 `SidebarSessionGroup.tsx`。
   - 引入 `AnimatePresence` 和 `motion`。
   - 保留前 5 条会话为静态 `<ul>`。
   - 将第 6 条及之后的会话放进单独的 `motion.ul`。
   - 点击 `sidebar-show-more-button` 时，额外列表用 `height: 0 -> auto`、`opacity: 0 -> 1`、轻微 `y` 位移动画展开；收起时反向执行。
   - 保持按钮文案和原有归档、置顶、选择会话行为不变。

3. 修改 `sidebar.css`。
   - 给额外列表增加 `overflow: hidden` 和 `will-change`，避免动画过程中内容溢出。
   - 保持现有 `sidebar-show-more-button` 样式，仅补必要的动画容器样式。

4. 验证。
   - 运行新增的 `bun test apps/desktop/src/renderer/components/sidebar/SidebarSessionGroup.test.ts`。
   - 运行 `bun run desktop:typecheck`。
   - 如果命令因环境问题失败，记录失败原因和已完成的静态检查范围。

## 不做的事

- 不改 `SidebarFrame.tsx` 的主侧边栏展开、收缩逻辑。
- 不新增依赖。
- 不重构侧边栏数据结构。
