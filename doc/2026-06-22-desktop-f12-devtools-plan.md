# 桌面端 F12 调试台计划

## 背景
- 桌面端窗口可以打开但白屏，当前缺少键盘快捷方式直接打开 DevTools。
- 现有窗口菜单已经有“调试...”入口，但白屏时用户需要更快看到 renderer 控制台报错。

## 本轮改动
- 在桌面主进程窗口服务中增加 F12 快捷键监听。
- 保留现有菜单调试入口，不改变窗口创建、preload、sandbox 和 renderer 加载流程。
- 新增一个可单测的快捷键判断 helper，覆盖 F12 触发和普通按键不触发。

## 验证
- 先运行新增快捷键测试，确认缺少 helper 时失败。
- 实现后运行新增测试和 `bun run desktop:typecheck`。

## 后续
- 用户按 F12 打开 DevTools 后，优先查看 Console 和 Network 中的首个红色错误。
- 如果仍然白屏，再根据报错定位 renderer 初始化、路由、preload IPC 或 Vite 资源加载问题。
