# sidebar 展开列表字体发糊排查与修复计划

## 背景

截图里上方基础会话行更清晰，展开后的较旧会话行更容易发糊。代码中 `SidebarSessionGroup` 将前 5 条会话渲染在普通 `ul`，第 6 条及以后渲染在 `motion.ul.sidebar-session-list-extra` 中，并使用 `y` 位移动画；CSS 还给该容器声明了 `will-change: height, opacity, transform`。

## 假设

展开列表持续保留 transform 动画属性或 transform 合成层提示，导致 Chromium/Electron 对该容器内文字做合成层重采样。Windows 高 DPI 或非整数缩放下，这会让展开区域文字比普通列表更糊。

## 要做的事

1. 增加回归测试，断言展开出来的会话列表不使用 `y` 位移动画。
2. 增强现有 sidebar CSS 测试，断言 `.sidebar-session-list-extra` 不声明 `will-change: ... transform`。
3. 修改 `SidebarSessionGroup.tsx`，保留 `height` 和 `opacity` 动画，移除 `y` 初始/退出/目标动画。
4. 修改 `sidebar.css`，将 `.sidebar-session-list-extra` 的 `will-change` 改为 `height, opacity`。
5. 如果验证发现同一侧边栏区域存在阻断 typecheck 的明显遗漏，先加回归测试再做最小修复。
6. 运行定向测试：
   - `bun test apps/desktop/src/renderer/components/sidebar/SidebarSessionGroup.test.ts`
   - `bun test apps/desktop/src/renderer/styles/sidebar.test.ts`
   - `bun run desktop:typecheck`
7. 复查 diff，只保留计划、测试和侧边栏相关最小改动。

## 不做的事

- 不改全局字体栈。
- 不改 Electron 窗口缩放菜单。
- 不处理折叠侧边栏 hover overlay 的整体入场动画，除非后续截图证明问题出现在折叠浮层里。
