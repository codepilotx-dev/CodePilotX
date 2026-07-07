# OpenCodeUI 移动端完整适配逻辑分析

> 项目：`D:\GitHubProject\Agent\OpenCodeUI-main`
> 分析范围：所有移动端相关的检测、布局、交互、键盘遮挡、CSS Safe Area、输入框胶囊模式

---

## 一、检测层：判断"是不是移动端"

### 1.1 视口宽度断点

**文件**：`src/features/chat/chatViewport.tsx`

```typescript
CHAT_SURFACE_MIN_WIDTH = 380       // 绝对最小表面宽度
CHAT_SURFACE_COMPACT_BREAKPOINT = 680  // 紧凑模式
CHAT_VIEWPORT_MOBILE_BREAKPOINT = 768  // ★ 核心断点：切换移动端布局
CHAT_SPLIT_TOUCH_MIN_WIDTH = 900   // 触屏设备分屏最低宽度
SMALL_DESKTOP_BREAKPOINT = 1100    // 小桌面
```

**`computeChatViewport()` 决策函数**（关键逻辑）：

```typescript
function computeChatViewport(params: {
  viewportWidth: number
  viewportHeight: number
  preferTouchUi: boolean
  touchCapable: boolean
}): ChatViewportValue {
  // ★ 最关键的判断：viewport < 768 即进入移动模式
  const overlayPanels = viewportWidth < CHAT_VIEWPORT_MOBILE_BREAKPOINT

  if (overlayPanels) {
    return {
      // 交互模式切换
      interaction: {
        interactionMode: 'touch',                    // 触屏交互
        sidebarBehavior: 'overlay',                  // 侧栏变为浮层
        rightPanelBehavior: 'overlay',              // 右侧面板变为浮层
        bottomPanelBehavior: 'overlay',              // 底部面板变为浮层
        outlineInteraction: 'touch',                 // 大纲触屏交互
        enableCollapsedInputDock: true,              // ★ 启用输入框胶囊收起
      },
      // 布局数据
      layout: {
        sidebar: {
          dockedWidth: 0,                            // 不再 dock
          // overlay 宽度 = viewportWidth - 72，限制在 240~360
          overlayWidth: clamp(viewportWidth - 72, 240, 360),
        },
        rightPanel: { dockedWidth: 0 },              // 不再 dock
        // 底部面板最大高度
        bottomPanelMaxHeight: touchCapable
          ? viewportHeight * 0.62
          : viewportHeight * 0.56,
      },
      presentation: {
        surfaceVariant: 'desktop',                   // 仍为 desktop variant
        isCompact: false,
      },
    }
  }

  // 桌面端：所有面板 docked，sidebarBehavior: 'docked'
  // ...
}
```

**关键设计思想**：所有布局决策集中在一个 `computeChatViewport()` 函数中，下游组件只需消费 `interaction.xxx` 和 `layout.xxx` 字段，无需各自判断断点。

**`useChatViewportController` Hook**：

```typescript
function useChatViewportController({
  sidebarExpanded,
  rightPanelOpen,
  requestedRightPanelWidth,
}) {
  const capabilities = useInputCapabilities()       // 设备能力检测
  const surfaceRef = useRef<HTMLDivElement>(null)   // 聊天表面元素

  // ResizeObserver 监听表面宽度 + window.innerWidth/Height → computeChatViewport
  const value = useMemo(() => computeChatViewport({
    viewportWidth: width ?? window.innerWidth,
    viewportHeight: window.innerHeight,
    preferTouchUi: capabilities.preferTouchUi,
    touchCapable: capabilities.hasCoarsePointer || capabilities.hasTouch,
  }), [width, capabilities])

  return { surfaceRef, value }
}
```

**`canUseSplitPane` 判断**：

```typescript
function canUseSplitPane(v: ChatViewportValue): boolean {
  if (v.presentation.isCompact) return false
  // 触屏设备需要 >= 900px 才能分屏
  if (v.interaction.interactionMode === 'touch') {
    return v.layout.viewportWidth >= CHAT_SPLIT_TOUCH_MIN_WIDTH
  }
  return true
}
```

---

### 1.2 输入设备能力检测

**文件**：`src/hooks/useInputCapabilities.ts`

不使用 User-Agent，只用 CSS Media Query：

```typescript
// 细粒度指针 + 悬浮 = 鼠标/触控板
const CAN_HOVER_QUERY = '((hover: hover) and (pointer: fine)), ((any-hover: hover) and (any-pointer: fine))'

// 粗粒度指针 = 手指触摸
const COARSE_POINTER_QUERY = '(pointer: coarse), (any-pointer: coarse)'

export interface InputCapabilities {
  canHover: boolean        // 可悬浮 (鼠标/触控板)
  hasCoarsePointer: boolean // 有粗指针 (触摸屏)
  hasTouch: boolean         // 支持触摸 (maxTouchPoints > 0)
  preferTouchUi: boolean    // ★ 关键：优先使用触摸 UI
}

export function getInputCapabilities(): InputCapabilities {
  const canHover = matchMedia(CAN_HOVER_QUERY).matches
  const hasCoarsePointer = matchMedia(COARSE_POINTER_QUERY).matches
  const hasTouch = navigator.maxTouchPoints > 0

  // ★ 核心逻辑：粗指针/有触摸 + 不能悬浮 = 真正触摸设备
  // 触摸屏笔记本：hasCoarsePointer=true 但 canHover=true → preferTouchUi=false
  const preferTouchUi = (hasCoarsePointer || hasTouch) && !canHover

  return { canHover, hasCoarsePointer, hasTouch, preferTouchUi }
}

// Hook 版本：监听 Media Query 变化 + pointerdown 事件
export function useInputCapabilities() {
  const [capabilities, setCapabilities] = useState(getInputCapabilities)

  useEffect(() => {
    const canHoverMq = matchMedia(CAN_HOVER_QUERY)
    const coarseMq = matchMedia(COARSE_POINTER_QUERY)

    canHoverMq.addEventListener('change', handleChange)
    coarseMq.addEventListener('change', handleChange)
    window.addEventListener('pointerdown', handleChange, { passive: true })

    return cleanup
  }, [])

  return capabilities
}
```

**设计精妙之处**：
- **`preferTouchUi`** 才是真正区分"触屏手机/平板"和"带触摸屏的笔记本"的关键 —— 触摸屏笔记本有 coarse pointer 也能 hover
- 监听 `pointerdown` 作为兜底：某些设备（如 Surface）的 Media Query 在连接/断开键盘时可能不立即更新

---

### 1.3 Tauri Native 平台检测

**文件**：`src/utils/tauri.ts`

```typescript
// Tauri 运行时检测（window.__TAURI_INTERNALS__ 由 Tauri 注入）
export function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__
}

// Tauri 移动端（Android/iOS）
export function isTauriMobile(): boolean {
  return isTauri() && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

// 桌面平台
export function getDesktopPlatform(): 'windows' | 'macos' | 'linux' | 'other' {
  if (!isTauri() || isTauriMobile()) return 'other'
  // ...
}
```

**移动端初始化跳过逻辑**（`src/main.tsx`）：

```typescript
// Tauri 移动端：跳过桌面特有的初始化
async function initializeNativeDesktopService() {
  if (!isNativeTauri || isNativeTauriMobile || !serviceStore.autoStart) return
  // ... 检测/启动 opencode serve 后台进程
}
```

**App.tsx 中的判断**：

```typescript
useEffect(() => {
  // Tauri 移动端不发送 desktop_window_ready（无标题栏）
  if (!isTauri() || isTauriMobile()) return
  void invoke('desktop_window_ready').catch(() => {})
}, [])
```

---

## 二、CSS 基础层

**文件**：`src/index.css`

### 2.1 Safe Area 自定义属性链

```css
/* ===== CSS 自定义属性 —— 对 env() 的统一封装 ===== */
:root {
  --safe-area-inset-top: env(safe-area-inset-top, 0px);
  --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-inset-left: env(safe-area-inset-left, 0px);
  --safe-area-inset-right: env(safe-area-inset-right, 0px);

  /* 原生标题栏高度（Tauri 桌面端设置，移动端为 0） */
  --app-safe-top: 0px;

  /* 键盘遮挡高度（JS 动态计算，见第三节） */
  --keyboard-inset-bottom: 0px;
}
```

**为什么需要额外封装一层**？
- `env()` 在 `getComputedStyle` 中无法被解析为像素值，封装为 `var()` 后可通过 JS 读取
- 允许在特定场景下覆盖（如 PWA standalone 兜底、Tauri 覆盖）
- 下游组件统一消费 `var(--safe-area-inset-*)` 而非直接写 `env()`

### 2.2 动态视口高度

```css
/* dvh 优先，不支持则 fallback 到 vh */
html, body, #root {
  height: 100dvh;              /* 动态视口高度（iOS Safari 15.4+） */
  height: var(--app-height);   /* JS 动态覆盖值 */
}
@supports not (height: 100dvh) {
  html, body, #root {
    height: 100vh;
  }
}
```

### 2.3 根元素布局约束

```css
html, body, #root {
  height: var(--app-height);
  overflow: hidden;                    /* ★ 禁止 body 级滚动 */
  overscroll-behavior: none;           /* ★ 禁止橡皮筋效果 */
  -webkit-overflow-scrolling: touch;   /* iOS 平滑滚动 */
  -webkit-text-size-adjust: 100%;      /* ★ 禁止 iOS 自动缩放文字 */
  text-size-adjust: 100%;
}
```

**设计理由**：
- `overflow: hidden`：整页不会滚动，所有滚动在组件内部处理（消息列表、侧栏列表等）
- `overscroll-behavior: none`：防止 iOS 的橡皮筋回弹干扰
- `-webkit-text-size-adjust: 100%`：iOS 在横屏时会自动放大文字，这会导致布局崩溃

### 2.4 Safe Area 应用到 #root

```css
#root {
  /* Safe Area 应用到根元素的内边距 */
  padding-top: var(--safe-area-inset-top);
  padding-left: var(--safe-area-inset-left);
  padding-right: var(--safe-area-inset-right);
  /* bottom padding 由 JS 动态控制 --keyboard-inset-bottom */
}
```

**PWA standalone 兜底**：

```css
/* iOS PWA standalone 下，env(safe-area-inset-bottom) 在某些设备（如 iPhone 8）返回 0，
   但 Safari standalone 模式仍会叠加系统 UI。强制最小 8px 作为兜底 */
@media (display-mode: standalone) {
  :root {
    --safe-area-inset-bottom: max(env(safe-area-inset-bottom, 0px), 8px);
  }
}
```

**Tauri 原生层覆盖**：

```css
/* Tauri 原生层通过 setPadding() 处理 safe area，
   CSS 的 env() 会与原生 padding 叠加，必须清零 */
.tauri-app #root {
  padding: 0;
}
```

### 2.5 键盘遮挡样式

```css
/*
 * 只在浏览器/PWA 下生效。
 * Tauri 原生层通过 setPadding 让 WebView 自动 resize，不需要 CSS 处理。
 */
@media (display-mode: browser), (display-mode: standalone) {
  :root:not(.tauri-app) #root {
    padding-bottom: var(--keyboard-inset-bottom, 0px);
  }
}
```

### 2.6 移动端专用 Utility 类

```css
/* ===== 三页卡片滚动容器 ===== */
.mobile-chat-pager {
  /* 隐藏滚动条，保留滚动功能 */
  scrollbar-width: none;           /* Firefox */
  -ms-overflow-style: none;       /* IE/Edge */
}
.mobile-chat-pager::-webkit-scrollbar {
  display: none;                   /* Chrome/Safari */
}

/* ===== 顶部安全栏高度 ===== */
.mobile-safe-topbar-14 {
  /* 14 = h-14 (56px) */
  height: calc(var(--app-safe-top) + 3.5rem);
}
.mobile-safe-topbar-10 {
  /* 10 = h-10 (40px) */
  height: calc(var(--app-safe-top) + 2.5rem);
}

/* ===== 聊天顶部间隔 ===== */
.mobile-chat-top-spacer {
  margin-top: calc(var(--safe-area-inset-top) + var(--desktop-titlebar-height, 0px));
}

/* ===== 模态框安全区域 ===== */
.modal-shell-safe-content {
  max-height: calc(
    var(--app-height) - var(--safe-area-inset-top) - 40px
  );
  padding-bottom: var(--safe-area-inset-bottom);
}

.dialog-safe-region {
  padding-top: var(--safe-area-inset-top);
  padding-bottom: var(--safe-area-inset-bottom);
}

/* ===== Toast 安全定位 ===== */
.toast-safe-top {
  top: calc(var(--safe-area-inset-top) + 1rem);
}

.command-palette-safe-top {
  top: calc(var(--safe-area-inset-top) + 10vh);
}
```

### 2.7 触屏目标加大

```css
/* 768px 以下：按钮最小高度 32px（符合 Apple HIG 44pt ≈ 32px 最低标准） */
@media (max-width: 768px) {
  button:not(.touch-target-sm):not([role='tab']):not([role='switch']):not([data-compact]) {
    min-height: 32px;
  }
}
```

**排除列表**：
- `.touch-target-sm` — 明确标记为小触控目标
- `[role='tab']` — 标签栏不需要额外高度
- `[role='switch']` — Switch 控件保持原生大小
- `[data-compact]` — 紧凑模式组件

### 2.8 消息列表滚动锚定

```css
/* 消息滚动 margin-top，避免被顶部 safe area 遮挡 */
[data-message-list] > * {
  scroll-margin-top: calc(72px + var(--app-safe-top));
}
```

---

## 三、键盘遮挡处理（核心难点）

**文件**：`src/hooks/useViewportHeight.ts`

### 3.1 整体策略

```
┌─────────────────────────────────────────────┐
│         isTauriApp?                         │
├────────────────────┬────────────────────────┤
│       YES          │         NO             │
│  (Tauri Android)   │   (Browser / PWA)      │
├────────────────────┼────────────────────────┤
│ 原生 setPadding()  │ visualViewport API     │
│ 自动 resize        │ + safe-area probe      │
│ WebView             │ + multi-delay settle   │
│                    │ + edge case 兜底        │
└────────────────────┴────────────────────────┘
```

### 3.2 Tauri 路径

```typescript
if (isTauriApp) {
  // 原生层通过 MainActivity.setPadding() 处理键盘 resize
  // JS 只需跟踪 window.innerHeight 更新 CSS 变量
  const updateAppHeight = () => {
    root.style.setProperty('--app-height', `${window.innerHeight}px`)
  }
  updateAppHeight()
  window.addEventListener('resize', updateAppHeight)
  return () => window.removeEventListener('resize', updateAppHeight)
}
```

### 3.3 浏览器/PWA 路径：完整状态机

#### 第一步：测量真实 Safe Area Bottom

```typescript
/**
 * iOS PWA standalone 下，window.innerHeight 包含 home indicator 区域（~34px），
 * 而 visualViewport.height 不包含。
 * 无键盘时，两者差值 ≈ safe-area-inset-bottom，会被误判为"键盘弹出"。
 *
 * 解决方案：创建临时 DOM probe，通过 padding-bottom 属性获取
 * env(safe-area-inset-bottom) 的实际解析像素值。
 */
let safeAreaBottomPx = 0

const measureSafeAreaBottom = () => {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;left:-9999px;top:0;width:0;height:0;' +
    'padding-bottom:env(safe-area-inset-bottom,0px);' +
    'visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  // ★ getComputedStyle(probe).paddingBottom 返回已解析的 px 值
  safeAreaBottomPx = parseFloat(getComputedStyle(probe).paddingBottom) || 0
  document.body.removeChild(probe)
}
```

**为什么需要 probe？**
- `getComputedStyle(document.documentElement)` 读取 `--safe-area-inset-bottom` 返回的是 `env(safe-area-inset-bottom, 0px)` 字符串，不是解析后的像素值
- 只有实际应用到盒模型属性（如 `padding-bottom`）后，`getComputedStyle` 才会返回计算后的像素值
- probe 元素用完即销毁，开销极小

#### 第二步：计算键盘遮挡高度

```typescript
const updateViewport = () => {
  const viewport = window.visualViewport
  if (!viewport) return

  // 原始差值 = window 高度 - visualViewport 高度 - visualViewport 顶部偏移
  const rawInset = window.innerHeight - viewport.height - viewport.offsetTop

  // 减去 safe-area phantom
  const candidateInset = rawInset - safeAreaBottomPx

  // ★ 100px 阈值：区分真实键盘 vs iOS Safari 底部工具栏
  // 软键盘高度通常 > 200px，工具栏高度 < 50px
  const keyboardInset = candidateInset >= 100 ? candidateInset : 0

  root.style.setProperty('--keyboard-inset-bottom', `${Math.round(keyboardInset)}px`)
}
```

**为什么需要 100px 阈值？**
- iOS Safari 底部工具栏（地址栏+标签栏）折叠/展开会产生 40-50px 的 visualViewport 变化
- 不设阈值会把工具栏变化当作键盘，导致页面底部错误地留出 padding
- 真实软键盘高度（iPhone: 216-346px，iPad: 264-400px）远超过 100px

#### 第三步：多级延迟校准

```typescript
// ★ 键盘动画期间 visualViewport 事件不精确，
// 在键盘弹出/收起的关键事件后，用多级延迟重复检测
const KEYBOARD_SETTLE_DELAYS_MS = [0, 80, 180, 360, 700]

const syncAfterFocusSettles = () => {
  clearKeyboardSettleTimers()
  keyboardSettleTimers = KEYBOARD_SETTLE_DELAYS_MS.map(delay =>
    window.setTimeout(() => {
      if (hasKeyboardFocus()) {
        updateViewport()    // 有焦点 → 更新键盘遮罩
      } else {
        setKeyboardInset(0) // 无焦点 → 清零（iOS PWA 边缘场景兜底）
      }
    }, delay)
  )
}

// ★ 注册所有触发点
if (window.visualViewport) {
  visualViewport.addEventListener('resize', updateViewport)
  visualViewport.addEventListener('scroll', updateViewport)
}
window.addEventListener('resize', handleWindowResize)
window.addEventListener('pageshow', syncAfterFocusSettles)       // 页面从 bfcache 恢复
document.addEventListener('focusin', syncAfterFocusSettles)       // 输入框聚焦
document.addEventListener('focusout', syncAfterFocusSettles)      // 输入框失焦
document.addEventListener('visibilitychange', syncAfterFocusSettles) // App 切换
```

**为什么需要 5 级延迟？**
- 0ms：同步执行，捕获已完成的 resize
- 80ms：键盘开始动画
- 180ms：键盘动画中途
- 360ms：键盘接近完成
- 700ms：键盘完全完成 + 兜底

#### 第四步：iOS PWA 边缘场景兜底

```typescript
// iOS PWA 在键盘收起时不派发 visualViewport.resize 事件
// → syncAfterFocusSettles 中如果 hasKeyboardFocus() 为 false，主动清零
// 防止旧的 --keyboard-inset-bottom 残留导致页面底部空出一大块
if (!hasKeyboardFocus()) {
  setKeyboardInset(0)
}
```

**焦点判断**：

```typescript
function isKeyboardEditableElement(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement)
    return !element.disabled && !element.readOnly
  if (element instanceof HTMLInputElement)
    return !element.disabled && !element.readOnly
      && !NON_TEXT_INPUT_TYPES.has(element.type) // 排除 button/checkbox/file 等
  return element instanceof HTMLElement && element.isContentEditable
}
```

#### 第五步：设备旋转时重新测量

```typescript
const handleWindowResize = () => {
  measureSafeAreaBottom()  // ★ 横竖屏切换 safe-area 可能变化
  updateViewport()
}
```

### 3.4 完整的视觉视口处理链路图

```
focusin / pageshow / visibilitychange
         │
         ▼
  hasKeyboardFocus()?
    ├─ YES → updateViewport()
    │         └─ rawInset = innerHeight - visualViewport.height - visualViewport.offsetTop
    │         └─ keyboardInset = rawInset - safeAreaBottomPx
    │         └─ if keyboardInset >= 100 → set CSS --keyboard-inset-bottom
    │         └─ else → 0
    │
    └─ NO  → setKeyboardInset(0)  // 强制清零，防止残留

         │
         ▼
  [0, 80, 180, 360, 700]ms 多级校准
         │
         ▼
  CSS #root padding-bottom: var(--keyboard-inset-bottom)
```

---

## 四、三页水平滑动卡片布局

**文件**：`src/App.tsx`（约第 839-950 行）

### 4.1 判定条件

```typescript
const isMobilePanelLayout = chatViewport.interaction.sidebarBehavior === 'overlay'
// ↑ 等价于 viewportWidth < 768
```

### 4.2 三页结构

```
┌──────────────────┬────────────────────┬──────────────────┐
│     Page 1       │      Page 2        │     Page 3       │
│   Left Panel     │   Chat Surface     │   Right Panel    │
│   (Sidebar)      │   (3D transform)   │   (Files/Term)   │
│                  │                    │                  │
│  width =         │   width =          │   width =        │
│  overlayWidth    │   viewportWidth    │   viewportWidth  │
│  (240-360px)     │                    │                  │
│                  │                    │                  │
│  ert/inert       │   shadow + radius  │   inert (lazy)   │
└──────────────────┴────────────────────┴──────────────────┘
         ↕ scroll-snap: x mandatory
```

### 4.3 滚动容器属性

```html
<div
  ref={mobilePagerRef}
  class="mobile-chat-pager
         absolute inset-x-0 top-0 -bottom-4
         flex overflow-x-auto overflow-y-hidden
         bg-bg-100 pb-4"
  style={{
    scrollSnapType: 'x mandatory',          // ★ CSS scroll-snap
    overscrollBehaviorX: 'contain',         // ★ 禁止水平橡皮筋
    scrollbarWidth: 'none',                 // 隐藏滚动条
    WebkitOverflowScrolling: 'touch',       // iOS 平滑滚动
    perspective: '1200px',                  // ★ 3D 透视
    perspectiveOrigin: '50% 50%',
  }}
  onScroll={handleMobilePagerScroll}
  onTouchStart={handleMobilePagerInteractionStart}
  onTouchEnd={handleMobilePagerInteractionEnd}
  onTouchCancel={handleMobilePagerInteractionEnd}
>
```

**关键属性解释**：
- `scrollSnapType: 'x mandatory'`：每次滑动必须停在某个页面开头
- `overscrollBehaviorX: 'contain'`：滑动到边界时不触发浏览器的前进/后退
- `perspective: '1200px'`：3D 变换的透视距离（配合 rotateY 产生翻页效果）
- `-bottom-4` + `pb-4`：底部额外 16px，让内容不完全贴底（呼吸空间）

### 4.4 三个页面的 Section 结构

```html
<!-- ===== Page 1: Sidebar ===== -->
<section
  aria-hidden={mobileActivePage !== 'left'}
  inert={mobileActivePage !== 'left'}
  style={{
    width: `${overlayWidth}px`,
    flexBasis: `${overlayWidth}px`,
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  }}
>
  <Sidebar mobileInline={true} ... />
</section>

<!-- ===== Page 2: Chat Surface (with 3D transform) ===== -->
<section
  ref={surfaceRef}
  style={{
    width: `${viewportWidth}px`,
    flexBasis: `${viewportWidth}px`,
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  }}
>
  <!-- ★ 3D 变换包裹层 -->
  <div
    aria-hidden={mobileActivePage !== 'chat'}
    inert={mobileActivePage !== 'chat'}
    class="absolute inset-y-0 -left-4 -right-4 z-10
           flex flex-col overflow-hidden bg-bg-100 rounded-xl
           shadow-[0_0_24px_hsl(var(--always-black)/0.15)]"
    style={{
      transform: `
        translate3d(var(--mobile-chat-offset-x, 0px), 0, 0)
        rotateY(var(--mobile-chat-rotate-y, 0deg))
        scale(var(--mobile-chat-scale, 1))
      `,
      transformOrigin: 'var(--mobile-chat-transform-origin, 50% 50%)',
      transformStyle: 'preserve-3d',
      backfaceVisibility: 'hidden',
      willChange: 'transform',
    }}
  >
    <SplitContainer ... />
  </div>

  <!-- ★ 侧栏展开时的关闭遮罩 -->
  {sidebarExpanded && (
    <button
      aria-label="Collapse sidebar"
      class="absolute inset-0 z-[70] cursor-default bg-transparent
             [touch-action:pan-x]"
      onClick={handleCloseSidebar}
    />
  )}
</section>

<!-- ===== Page 3: Right Panel ===== -->
<section
  aria-hidden={mobileActivePage !== 'right'}
  inert={mobileActivePage !== 'right'}
  style={{
    width: `${viewportWidth}px`,
    flexBasis: `${viewportWidth}px`,
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
  }}
>
  <RightPanel
    inline={true}
    renderPanelContent={rightPanelOpen || shouldRenderMobileRightPanel}
    ...
  />
</section>
```

### 4.5 3D 翻页效果（实时计算 → CSS 自定义属性）

```typescript
const handleMobilePagerScroll = useCallback(() => {
  const pager = mobilePagerRef.current
  const scrollLeft = pager.scrollLeft

  // ===== 计算进度 =====
  // 左区 (0 → mobileLeftPanelWidth)：左栏渐显
  // 右区 (mobileChatScrollLeft → mobileRightScrollLeft)：右栏渐显

  // 标准化到 -1 (左栏) 到 0 (聊天) 到 1 (右栏)
  const rawProgress = scrollLeft < mobileChatScrollLeft
    ? (scrollLeft - mobileChatScrollLeft) / mobileLeftPanelWidth
    : (scrollLeft - mobileChatScrollLeft) / mobilePageWidth
  const progress = Math.max(-1, Math.min(1, rawProgress))

  const absProgress = Math.abs(progress)

  // ===== 右滑进度（只用于 translateX offset）=====
  const rightProgress = Math.max(0, progress)
  const easedRightProgress = rightProgress * rightProgress // 二次缓出

  // ===== 变换原点：左滑→右边，右滑→左边 =====
  const originX = 50 - progress * 50
  // progress=-1 (左栏): originX=100% (右边缘翻转)
  // progress=0  (聊天): originX=50%
  // progress=1  (右栏): originX=0% (左边缘翻转)

  // ===== 设置 CSS 变量 =====
  pager.style.setProperty('--mobile-chat-rotate-y', `${progress * 10}deg`)
  pager.style.setProperty('--mobile-chat-scale', `${1 - absProgress * 0.06}`)
  pager.style.setProperty('--mobile-chat-offset-x', `${easedRightProgress * -48}px`)
  pager.style.setProperty('--mobile-chat-transform-origin', `${originX}% 50%`)
  // ...
})
```

**变换效果表**：

| 页面 | progress | rotateY | scale | offsetX | originX |
|------|----------|---------|-------|---------|---------|
| 左栏全显 | -1 | -10deg | 0.94 | 0 | 100% |
| 聊天页 | 0 | 0deg | 1.0 | 0 | 50% |
| 右栏全显 | +1 | +10deg | 0.94 | -48px | 0% |

**视觉效果**：
- 滑到左栏时：聊天页向右翻转 10° + 缩小到 94% + 带投影 → 像卡片被翻到一边
- 滑到右栏时：聊天页向左翻转 10° + 缩小到 94% + 向右偏移 48px + 带投影 → 像卡片被推开

**性能优化**：
- 使用 `willChange: 'transform'` 提示 GPU 加速
- `backfaceVisibility: 'hidden'` 减少不必要的背面渲染
- 所有变换通过 CSS 变量驱动，避免 inline style 重绘
- `[contain:layout_paint]` 限制重绘范围

### 4.6 滚动结束 → 状态同步

```typescript
const MOBILE_PAGER_SCROLL_END_MS = 120

// scroll 事件中进行 120ms 防抖
if (mobileScrollEndTimerRef.current !== null) {
  window.clearTimeout(mobileScrollEndTimerRef.current)
}
mobileScrollEndTimerRef.current = window.setTimeout(() => {
  // 如果用户仍在交互中，等待交互结束
  if (mobilePagerInteractingRef.current) return

  // 如果程序化滚动目标是当前页，清除目标
  if (mobileProgrammaticTargetRef.current) {
    if (Math.abs(pager.scrollLeft - targetLeft) < 2) {
      mobileProgrammaticTargetRef.current = null
    } else return
  }

  // ★ 根据 scrollLeft 同步 sidebarExpanded / rightPanelOpen
  syncMobilePagerState()
}, MOBILE_PAGER_SCROLL_END_MS)
```

**`syncMobilePagerState()` 逻辑**：

```typescript
const syncMobilePagerState = useCallback(() => {
  const page = getNearestMobilePage(pager.scrollLeft)

  if (page === 'left') {
    // 滑到左栏 → 展开侧栏，关闭右面板
    if (!sidebarExpanded) setSidebarExpanded(true)
    if (rightPanelOpen) layoutStore.closeRightPanel()
    return
  }

  if (page === 'right') {
    // 滑到右栏 → 确保右面板已挂载，关闭侧栏，打开右面板
    ensureMobileRightPanelRendered()
    if (sidebarExpanded) setSidebarExpanded(false)
    if (!rightPanelOpen) layoutStore.openRightPanel()
    return
  }

  // 滑到聊天页 → 关闭侧栏，关闭右面板
  if (sidebarExpanded) setSidebarExpanded(false)
  if (rightPanelOpen) layoutStore.closeRightPanel()
}, [])
```

**`getNearestMobilePage()`**：

```typescript
const getNearestMobilePage = (scrollLeft) => {
  const leftDist = Math.abs(scrollLeft)
  const chatDist = Math.abs(scrollLeft - mobileChatScrollLeft)
  const rightDist = Math.abs(scrollLeft - mobileRightScrollLeft)

  if (leftDist <= chatDist && leftDist <= rightDist) return 'left'
  if (rightDist <= chatDist) return 'right'
  return 'chat'
}
```

### 4.7 程序化滚动 vs 用户滚动

```typescript
// ★ 区分程序化滚动和用户滚动
// 用户滚动 → 不应被误判为程序完成
// 程序滚动 → 完成后才同步状态

// 程序化滚动的标记（仅在 smooth 时设置）
mobileProgrammaticTargetRef.current = behavior === 'smooth' ? page : null

// 用户交互开始 → 清除程序化目标
const handleMobilePagerInteractionStart = () => {
  mobilePagerInteractingRef.current = true
  mobileProgrammaticTargetRef.current = null
}
```

### 4.8 右面板懒挂载

```typescript
const MOBILE_RIGHT_PANEL_UNMOUNT_MS = 420

// 用户滑向右侧 → 立即挂载
if (scrollLeft > mobileChatScrollLeft + 24) {
  ensureMobileRightPanelRendered()
}

// 右面板关闭后 → 延迟 420ms 卸载（留时间给滑回动画）
useEffect(() => {
  if (rightPanelOpen) {
    clearMobileRightUnmountTimer()
    setMobileRightPanelRendered(true)
    return
  }

  // 不是立即卸载！等 420ms
  clearMobileRightUnmountTimer()
  mobileRightUnmountTimerRef.current = setTimeout(() => {
    setMobileRightPanelRendered(false)
  }, MOBILE_RIGHT_PANEL_UNMOUNT_MS)
}, [rightPanelOpen])
```

**为什么 420ms？**
- 从右栏滑回聊天页需要滚动动画 + settle
- 过早卸载会导致滑动过程中右栏突然消失（视觉闪烁）
- 420ms = 120ms settle + 300ms 安全余量

### 4.9 inert 隔离机制

```typescript
aria-hidden={mobileActivePage !== 'left'}
inert={mobileActivePage !== 'left'}
```

- `aria-hidden`：屏幕阅读器跳过不可见页面
- `inert`：键盘焦点不会进入不可见页面（防止 Tab 键跳到看不见的元素）
- 两个属性需要同时设置：`inert` 解决键盘访问，`aria-hidden` 解决屏幕阅读器

### 4.10 布局切换时的初始化

```typescript
useLayoutEffect(() => {
  if (!isMobilePanelLayout) {
    // 回到桌面布局 → 重置移动端状态
    mobilePagerInitializedRef.current = false
    return
  }

  const page = rightPanelOpen ? 'right' : sidebarExpanded ? 'left' : 'chat'

  if (!mobilePagerInitializedRef.current) {
    // ★ 首次进入移动布局：直接跳转（无动画）
    pager.scrollLeft = getMobilePageScrollLeft(page)
    mobilePagerInitializedRef.current = true
    return
  }

  // ★ 后续切换：平滑动画
  requestAnimationFrame(() => {
    scrollMobilePagerTo(page, 'smooth')
  })
}, [isMobilePanelLayout, rightPanelOpen, sidebarExpanded])
```

### 4.11 状态冲突处理

```typescript
// 侧栏和右面板不能同时打开（移动端空间有限）
useEffect(() => {
  if (!isMobilePanelLayout || !rightPanelOpen || !sidebarExpanded) return
  // ★ 如果两个面板都声称打开，关闭侧栏
  requestAnimationFrame(() => setSidebarExpanded(false))
}, [isMobilePanelLayout, rightPanelOpen, sidebarExpanded])
```

### 4.12 Cleanup

```typescript
useEffect(() => {
  return () => {
    if (mobileScrollEndTimerRef.current !== null)
      window.clearTimeout(mobileScrollEndTimerRef.current)
    if (mobileRightUnmountTimerRef.current !== null)
      window.clearTimeout(mobileRightUnmountTimerRef.current)
    mobileProgrammaticTargetRef.current = null
  }
}, [])
```

---

## 五、输入框胶囊模式

### 5.1 状态机

**文件**：`src/features/chat/input/useMobileCollapse.ts`

#### 收起条件（五个条件必须全部满足）

```typescript
/**
 * 当以下条件全部满足时，输入框进入胶囊（收起）模式：
 *
 * 1. enabled              viewport < 768 (来自 chatViewport)
 * 2. !isAtBottom          用户向上滚动了（不在消息底部）
 * 3. !hasContent          textarea 为空 且 没有附件
 * 4. !isFocused           textarea 没有聚焦
 * 5. !hasPendingDialogs   没有待处理的 permission/question 弹窗
 */
const isCollapsed =
  enabled && !isAtBottom && !hasContent && !isFocused && !hasPendingDialogs
```

**设计意图**：
- 条件 1：只在移动端生效（桌面端不折叠）
- 条件 2：用户在看历史消息时，输入框自动收起来，给消息列表更多空间
- 条件 3：用户正在输入或添加了附件时，不折叠（保留输入上下文）
- 条件 4：键盘打开时，不折叠（避免键盘收起）
- 条件 5：有弹窗时，输入框保留在可见位置（用户需要看到对话框）

#### 五个条件的状态依赖

```
enabled        ← chatViewport.interaction.enableCollapsedInputDock
isAtBottom     ← ChatArea 的滚动状态（prop 传入）
hasContent     ← textarea.value !== '' || attachments.length > 0
isFocused      ← textarea focus/blur 事件 + 容器交互
hasPendingDialogs ← pendingPermission || pendingQuestion
```

### 5.2 聚焦/失焦追踪：三层防线

```typescript
// ===== 第一层：relatedTarget 同步检查 =====
const handleBlur = useCallback((e: React.FocusEvent) => {
  // 焦点移到输入区域内部的元素（如附件删除按钮、模型选择器），不收起
  if (isInsideInputArea(e.relatedTarget as Node | null)) return
  // ↑ 同步判断，不需要延迟

  // ===== 第二层：150ms 延迟 + activeElement 检查 =====
  blurTimerRef.current = setTimeout(() => {
    // 处理异步焦点转移（如点击附件触发 Portal 弹出的搜索框）
    // 150ms 后 activeElement 可能已经移到 Portal 内的 input
    if (isInsideInputArea(document.activeElement)) return

    // ===== 第三层：容器交互标记兜底 =====
    // 移动端触摸按钮时，relatedTarget 和 activeElement 都不可靠
    if (containerInteractingRef.current) return

    setIsFocused(false)
  }, 150)
}, [isInsideInputArea])

// focus 时清理待处理的 blur timer（防止 Race Condition）
useEffect(() => {
  if (isFocused && blurTimerRef.current) {
    clearTimeout(blurTimerRef.current)
    blurTimerRef.current = null
  }
}, [isFocused])
```

### 5.3 容器交互标记（第三层防线细节）

```typescript
/**
 * 场景：移动端点击容器内按钮（如 agent selector），
 * textarea 失去焦点 → handleBlur 触发 → relatedTarget 为空（移动端触摸不设置）→
 * activeElement 变为 body → 第一层和第二层都失败。
 *
 * 解决方案：pointerdown 在容器内（textarea 外）时标记为"容器交互中"，
 * 300ms 后自动清除。
 */
const containerInteractingRef = useRef(false)
const containerInteractingTimerRef = useRef(null)

const handleContainerPointerDown = useCallback((e: React.PointerEvent) => {
  // 排除 textarea 自身的触摸（用户可能只是滑动 textarea 内容）
  if (e.target === textareaRef.current) return

  containerInteractingRef.current = true

  // 300ms 后自动清除，防止永久阻止收起
  if (containerInteractingTimerRef.current)
    clearTimeout(containerInteractingTimerRef.current)
  containerInteractingTimerRef.current = setTimeout(() => {
    containerInteractingRef.current = false
  }, 300)
}, [textareaRef])
```

### 5.4 isFocused 逃逸阀

```typescript
/**
 * 场景：用户点击了容器内的 agent selector 按钮，
 * handleBlur 中 containerInteractingRef 正确阻止了收起，
 * 但此后 textarea 不再聚焦，isFocused 卡在 true → 输入框永远不收起来。
 *
 * 解决方案：监听 document pointerdown (capture 阶段)。
 * 如果点击发生在输入区域外部 → 清除 isFocused。
 * 同样适用于滚动（用户在聊天区滑动 = 离开输入区）。
 */
useEffect(() => {
  if (!isFocused || !enabled) return

  const handleOutsidePointerDown = (e: PointerEvent) => {
    // 点在输入区内部 → 忽略
    if (isInsideInputArea(e.target as Node)) return

    // 光标仍在 textarea 内 → 不清除（移动端滚动不一定触发 blur）
    if (document.activeElement === textareaRef.current) return
    if (isInsideInputArea(document.activeElement)) return

    setIsFocused(false)
  }

  // ★ 使用 capture 确保在任何 stopPropagation 之前捕获
  document.addEventListener('pointerdown', handleOutsidePointerDown, { capture: true })

  return () => {
    document.removeEventListener('pointerdown', handleOutsidePointerDown, { capture: true })
  }
}, [isFocused, enabled, isInsideInputArea, textareaRef])
```

**为什么需要 capture 阶段？**
- React 的事件委托在 document 上（bubble 阶段）
- 第三方组件可能有 `stopPropagation()`
- capture 确保在任何 stopPropagation 之前被调用

### 5.5 展开态高度追踪

```typescript
/**
 * 目的：收起时用展开态的高度撑占位，防止消息列表布局跳动。
 *
 * 如果不追踪高度：
 * 输入框收起 → 消息列表突然多出空间 → isAtBottom 变为 true →
 * 输入框立刻展开 → layout shift → 用户体验极差
 */
const [expandedHeight, setExpandedHeight] = useState(0)

useEffect(() => {
  const el = contentWrapRef.current
  if (!el) return

  const ro = new ResizeObserver(entries => {
    for (const entry of entries) {
      // ★ 只在展开态采样，收起时的高度不更新
      if (!isCollapsed) {
        setExpandedHeight(entry.contentRect.height)
      }
    }
  })

  ro.observe(el)
  return () => ro.disconnect()
}, [isCollapsed, contentWrapRef])
```

### 5.6 输入框容器注册（动画用）

```typescript
// 将输入框容器注册/取消注册到动画系统
// 收起时传 null（停止动画），展开时传实际元素
useEffect(() => {
  if (registerInputBox) {
    registerInputBox(isCollapsed ? null : inputContainerRef.current)
    return () => registerInputBox(null)
  }
}, [registerInputBox, isCollapsed, inputContainerRef])
```

### 5.7 UI 表现

**文件**：`src/features/chat/InputBox.tsx`

#### 展开态

```tsx
<div
  className={cn(
    'flex flex-col',
    isCompact ? 'px-2' : 'px-4',   // 紧凑/桌面 padding
  )}
>
  {/* ... 输入框内容 ... */}
</div>
```

底部安全区域 padding：
```css
/* 展开态：Footer (h-8 = 32px) 已提供大部分 padding，
   只补充 safe-area-inset-bottom 超过 32px 的部分 */
padding-bottom: max(0px, calc(var(--safe-area-inset-bottom) - 2rem));
```

#### 收起态（胶囊模式）

```tsx
{/* ★ 输入框容器不可见但保留在 DOM 中 */}
<div
  className={cn(
    'transition-all duration-300',
    isCollapsed
      ? 'opacity-0 scale-95 pointer-events-none absolute'  // 隐藏
      : 'opacity-100 scale-100'                              // 显示
  )}
  style={isCollapsed ? { height: `${expandedHeight}px` } : undefined}
>
  {/* textarea 等（保留在 DOM 中，避免 iOS 键盘 dismiss） */}
</div>

{/* ★ 胶囊按钮（仅在收起时显示） */}
{isCollapsed && <CollapsedCapsule ... />}
```

收起态底部 padding：
```css
/* 收起态：至少 12px 呼吸空间 */
padding-bottom: max(12px, var(--safe-area-inset-bottom));
```

### 5.8 CollapsedCapsule 组件

**文件**：`src/features/chat/input/InputActions.tsx`

```tsx
function CollapsedCapsule({
  onExpand,
  isAtBottom,
  onScrollToBottom,
}) {
  return (
    <div className="...">
      {/* 展开按钮：圆角胶囊 + 向上箭头 */}
      <button
        onClick={onExpand}
        className="rounded-full bg-bg-200 ..."
      >
        <ArrowUpIcon />
        <span>Reply</span>
      </button>

      {/* ★ 滚动到底部按钮（条件显示） */}
      {!isAtBottom && <FloatingScrollToBottom onClick={onScrollToBottom} />}
    </div>
  )
}
```

### 5.9 紧凑模式差异（680-768px 区间）

```typescript
// inputUtils.ts
const COMPOSER_DESKTOP_MAX_HEIGHT = 420
const COMPOSER_COMPACT_MAX_HEIGHT = 320

// InputBox.tsx
const maxComposerHeight = isCompact
  ? COMPOSER_COMPACT_MAX_HEIGHT
  : COMPOSER_DESKTOP_MAX_HEIGHT

// 紧凑模式下的其他差异
placeholder: isCompact
  ? 'Reply to Agent'          // 短占位符
  : 'Reply to Agent (mobile)' // 全占位符

horizontalPadding: isCompact ? 'px-2' : 'px-4'
textareaPadding: isCompact ? 'px-3' : 'px-4'
composerHeightRatio: isCompact ? 0.44 : 0.40
```

---

## 六、侧栏移动适配

**文件**：`src/features/chat/Sidebar.tsx`, `src/features/chat/sidebar/SidePanel.tsx`

### 6.1 三模式渲染

```typescript
// chatViewport 驱动
const sidebarBehavior = chatViewport.interaction.sidebarBehavior
// 'docked' → 桌面模式
// 'overlay' + mobileInline=false → 浮层模式
// 'overlay' + mobileInline=true → 三页卡片内联模式
```

### 6.2 桌面 Docked 模式（≥768px）

```tsx
{if (sidebarBehavior === 'docked') {
  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div style={{ width: layout.sidebar.dockedWidth }}>
        <SidePanel isMobile={false} ... />
      </div>

      {/* Resize Handle */}
      <div
        className={cn(
          'shrink-0 cursor-col-resize',
          touchCapable ? 'w-4' : 'w-1'        // ★ 触摸设备加宽
        )}
        onMouseDown={handleResizeStart}       // 桌面端鼠标拖拽
        onTouchStart={handleTouchResizeStart} // 触摸设备手指拖拽
      />
    </div>
  )
}}
```

### 6.3 移动浮层模式（<768px, `mobileInline=false`）

```tsx
<>
  {/* ★ 遮罩层 */}
  {isOpen && (
    <div
      className="fixed inset-0 z-40 bg-black/50"
      onClick={onClose}
    />
  )}

  {/* ★ 浮层侧栏：水平滑动关闭手势 */}
  <div
    className="fixed z-50 h-full"
    style={{
      top: 'var(--safe-area-inset-top)',
      transform: `translateX(${swipeOffset}px)`,
      transition: swipeOffset === 0 ? 'transform 300ms' : undefined,
    }}
    onTouchStart={handleTouchStart}
    onTouchMove={handleTouchMove}
    onTouchEnd={handleTouchEnd}
  >
    <SidePanel
      isMobile={true}
      onCloseMobile={onClose}
      ...
    />
  </div>
</>
```

**滑动手势状态机**：

```typescript
const SIDEBAR_SWIPE_LOCK_PX = 10        // 最小 10px 移动才锁定轴向
const SIDEBAR_SWIPE_HORIZONTAL_BIAS = 1.25  // 水平移动 > 垂直×1.25 才锁定
const SIDEBAR_SWIPE_CLOSE_PX = 80        // 滑动超过 80px → 关闭

let swipeState: 'idle' | 'locked' | 'tracking' = 'idle'
let startX = 0, startY = 0, currentX = 0

const handleTouchStart = (e: TouchEvent) => {
  swipeState = 'idle'
  startX = e.touches[0].clientX
  startY = e.touches[0].clientY
}

const handleTouchMove = (e: TouchEvent) => {
  const dx = e.touches[0].clientX - startX
  const dy = e.touches[0].clientY - startY

  if (swipeState === 'idle') {
    // 还没锁定轴向
    if (Math.abs(dx) < SIDEBAR_SWIPE_LOCK_PX && Math.abs(dy) < SIDEBAR_SWIPE_LOCK_PX)
      return  // 还没到锁定阈值

    // ★ 水平移动必须 > 垂直×1.25 才锁定为水平滑动手势
    if (Math.abs(dx) > Math.abs(dy) * SIDEBAR_SWIPE_HORIZONTAL_BIAS) {
      swipeState = 'tracking'
    } else {
      swipeState = 'locked' // 垂直滑动 → 不再处理
      return
    }
  }

  if (swipeState !== 'tracking') return

  currentX = Math.min(0, dx) // 只允许向左滑动（关闭方向）
  setSwipeOffset(currentX)
}

const handleTouchEnd = () => {
  if (swipeState !== 'tracking') return

  // 滑动超过阈值 → 关闭侧栏
  if (Math.abs(currentX) >= SIDEBAR_SWIPE_CLOSE_PX) {
    onClose()
  }

  // 动画回到原位
  setSwipeOffset(0)
  swipeState = 'idle'
}
```

### 6.4 三页卡片内联模式（`mobileInline=true`）

```tsx
<Sidebar
  mobileInline={true}  // ★ 标记为内联模式
  isOpen={true}        // 始终展开
  ...
/>
```

内联模式下 Sidebar 渲染为全宽全高，无遮罩层，无 resize 手柄：

```tsx
// 项目对话框用 mobile- prefix key 区分：
<ProjectDialog key={isMobile ? 'mobile-project' : 'project'} ... />
```

### 6.5 SidePanel 的 isMobile 行为

```tsx
// ★ 移动端始终显示标签（桌面端在折叠时不显示）
const showLabels = isExpanded || isMobile

// ★ 折叠/展开按钮在移动端隐藏（不需要，始终展开）
{!isMobile && (
  <button onClick={onToggleSidebar}>
    <CollapseIcon />
  </button>
)}

// ★ 选中会话后自动关闭侧栏（节省一步操作）
const handleSelect = (session) => {
  onSelectSession(session)
  if (window.innerWidth < 768 && onCloseMobile) {
    onCloseMobile()
  }
}

// Footer 的底部 Safe Area
<div className="shrink-0 pb-[var(--safe-area-inset-bottom)]">
  <SidebarFooter ... />
</div>
```

### 6.6 SidebarFooter Safe Area

**文件**：`src/features/chat/sidebar/SidebarFooter.tsx`

```tsx
<div className="pb-[var(--safe-area-inset-bottom)]">
  {/* 用户信息、服务器状态等 */}
</div>
```

---

## 七、其他组件移动适配

### 7.1 RightPanel (`ResizablePanel.tsx`)

**Overlay 模式**：

```tsx
{isOpen && overlay && (
  <>
    {/* 遮罩 */}
    <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

    {/* 面板浮层 */}
    <div
      className="fixed z-50"
      style={{
        top: 'calc(var(--safe-area-inset-top) + var(--desktop-titlebar-height, 0px))',
        /* ... */
      }}
    >
      <div className="pb-[var(--safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  </>
)}
```

**Bottom Panel 触摸 resize**：

```typescript
// bottom panel 滑动手势
const handleTouchResizeStart = (e: TouchEvent) => {
  startY = e.touches[0].clientY
  startHeight = currentHeight
  document.addEventListener('touchmove', handleTouchResizeMove)
  document.addEventListener('touchend', handleTouchResizeEnd)
}

const handleTouchResizeMove = (e: TouchEvent) => {
  const dy = startY - e.touches[0].clientY  // 向上拖 = 扩大
  const newHeight = clamp(startHeight + dy, minH, maxH)
  setCurrentHeight(newHeight)
}
```

**Resize Handle 加宽**：

```tsx
{/* 右侧面板拖拽手柄 */}
<div className={cn(
  'cursor-col-resize',
  touchCapable ? 'w-4' : 'w-1'     // ★ 触摸设备 4 倍宽
)} />

{/* 底部面板拖拽手柄 */}
<div className={cn(
  'cursor-row-resize',
  touchCapable ? 'h-4' : 'h-1'     // ★ 触摸设备 4 倍高
)} />
```

### 7.2 ChatArea

**文件**：`src/features/chat/ChatArea.tsx`

```typescript
// 紧凑模式下放宽"是否在底部"的判定阈值
const atBottomThreshold = presentation.isCompact ? 150 : AT_BOTTOM_THRESHOLD_PX

// 紧凑模式下的消息水平 padding
const messagePaddingClass = presentation.isCompact ? 'px-3' : 'px-5'

// 移动端 top spacer
<div className="mobile-chat-top-spacer" />
```

### 7.3 InputToolbar

**文件**：`src/features/chat/input/InputToolbar.tsx`

```typescript
// Tauri 移动端：用浏览器 <input type=file> 而非原生文件对话框
const useBrowserFileInput = !isTauri() || isTauriMobile()

// 模型选择器在移动端工具栏显示
{isCompact && <ModelSelectorButton />}
```

### 7.4 按钮/控件扩触区域

在 `index.css` 的 768px 媒体查询内：

```css
@media (max-width: 768px) {
  button:not(.touch-target-sm):not([role='tab']):not([role='switch']):not([data-compact]) {
    min-height: 32px;  /* 至少 32px 最小触控区域 */
  }
}
```

### 7.5 Tauri Native Shell 初始化

**文件**：`src/main.tsx`

```typescript
function configureNativeShell() {
  if (!isNativeTauri) return

  // ★ 添加 CSS class 标记（用于 safe-area 覆盖 + 键盘路径选择）
  document.documentElement.classList.add('tauri-app')

  // ★ 确保 viewport meta 包含 viewport-fit=cover（沉浸式状态栏）
  const viewportMeta = document.querySelector('meta[name="viewport"]')
  if (viewportMeta) {
    const content = viewportMeta.getAttribute('content') || ''
    if (!content.includes('viewport-fit=cover')) {
      viewportMeta.setAttribute('content', content + ', viewport-fit=cover')
    }
  }
}
```

**移动端跳过桌面初始化**：

```typescript
async function initializeNativeDesktopService() {
  // ★ Tauri 移动端：不启动 opencode serve 后台进程（不需要）
  if (!isNativeTauri || isNativeTauriMobile || !serviceStore.autoStart) return
  // ...
}
```

---

## 八、完整文件清单

| 文件 | 职责 | 移动端关键逻辑 |
|------|------|--------------|
| `src/hooks/useInputCapabilities.ts` | 触屏/鼠标检测 | `preferTouchUi` 判断 |
| `src/hooks/useViewportHeight.ts` | 键盘遮挡 + safe-area | visualViewport + 5 级校准 + PWA 兜底 |
| `src/hooks/useIsMobile.ts` | 简单 768px 断点 | `window.innerWidth < 768` |
| `src/hooks/useInputCapabilities.ts` | 设备输入能力 | CSS Media Query 监控 |
| `src/features/chat/chatViewport.tsx` | ★ 中央视口系统 | `computeChatViewport()` 集中决策 |
| `src/features/chat/chatAreaVisibility.ts` | 聊天区可见性 | 配合 chatViewport |
| `src/features/chat/input/useMobileCollapse.ts` | ★ 输入框胶囊模式 | 五条件状态机 + 三层焦点防线 |
| `src/features/chat/InputBox.tsx` | 输入框 UI | 胶囊渲染 + 紧凑模式 + safe-area |
| `src/features/chat/input/InputActions.tsx` | 胶囊按钮 + 浮动操作 | `CollapsedCapsule` + `FloatingActions` |
| `src/features/chat/input/InputToolbar.tsx` | 工具栏 | 移动端文件选择器 + 模型选择器 |
| `src/features/chat/input/InputFooter.tsx` | 底部信息栏 | 收起时隐藏 |
| `src/features/chat/input/useInputHistory.ts` | 输入历史 | 移动端适配 |
| `src/features/chat/input/useAttachmentRail.ts` | 附件栏 | 移动端布局 |
| `src/features/chat/Sidebar.tsx` | 侧栏 | docked/overlay/inline 三模式 + 滑动手势 |
| `src/features/chat/sidebar/SidePanel.tsx` | 侧栏内容 | `isMobile`/`onCloseMobile` + auto-close |
| `src/features/chat/sidebar/SidebarFooter.tsx` | 侧栏底部 | `pb-[var(--safe-area-inset-bottom)]` |
| `src/features/chat/ChatArea.tsx` | 聊天区 | 紧凑 padding + 滚动阈值 + top spacer |
| `src/features/chat/ChatPane.tsx` | 聊天面板 | 紧凑常量 |
| `src/features/chat/PaneHeader.tsx` | 面板标题 | 移动端按钮布局 |
| `src/components/RightPanel.tsx` | 右侧面板 | inline 渲染 + 延迟挂载 |
| `src/components/BottomPanel.tsx` | 底部终端 | overlay 模式 |
| `src/components/ui/ResizablePanel.tsx` | 可缩放面板 | overlay 模式 + 触屏 resize + safe-area |
| `src/components/DesktopTitlebar.tsx` | 桌面标题栏 | `isTauriMobile()` 隐藏 |
| `src/App.tsx` | ★ 根组件 | 三页水平滑动卡片 + 3D 变换 + 状态同步 |
| `src/index.css` | 全局样式 | Safe Area 变量 + 768px 断点 + utility 类 |
| `src/main.tsx` | 入口 | Tauri shell 配置 + 移动端初始化跳过 |
| `src/utils/tauri.ts` | 平台检测 | `isTauriMobile()` |
| `src/store/layoutStore.ts` | 布局状态 | sidebar/panel open 状态（被 pager 同步） |
| `src/store/paneLayoutStore.ts` | 分屏状态 | `canUseSplitPane` 禁用 |
| `src/hooks/useDragEdgeAutoScroll.ts` | 拖拽边缘自动滚动 | 移动端触摸适配 |

---

## 九、架构亮点总结

### 9.1 中央决策 + 逐层消费

```
computeChatViewport(viewportWidth, capabilities) → ChatViewportValue
                                                      │
                    ┌─────────────────────────────────┼─────────────────────────────────┐
                    │                                 │                                 │
             interaction.*                      layout.*                       presentation.*
         (behavior/mode)                    (width/height)                   (variant/flags)
                    │                                 │                                 │
      ┌─────────────┼─────────────┐       ┌─────────┼─────────┐              ┌────────┼────────┐
      │             │             │       │         │         │              │        │        │
   App.tsx     InputBox.tsx   Sidebar  App.tsx  ResizablePanel         ChatArea  InputBox  PaneHeader
  (pager)     (collapse)   (overlay)  (width)  (overlay+size)        (padding) (compact) (compact)
```

单个函数做全部决策，下游组件零断点判断。新增屏幕尺寸只需修改一处。

### 9.2 键盘遮挡的多级校准

```
visualViewport event
      │
      ├── 实时：rawInset - safeAreaProbe → keyboardInset
      │
      └── focusin/focusout/pageshow/visibilitychange
            │
            └── [0, 80, 180, 360, 700]ms
                  ├── hasKeyboardFocus()? YES → updateViewport()
                  └── hasKeyboardFocus()? NO  → setKeyboardInset(0)
```

**为什么不能只用 visualViewport？**
- iOS 键盘动画期间 visualViewport 事件不精确
- iOS PWA 键盘收起后不派发 visualViewport.resize
- 需要额外的 safe-area probe 消除 phantom 差值

### 9.3 输入框胶囊模式的设计哲学

```
展开态 ──────────────────────────→ 收起态（胶囊）
   │                                     │
   │ 条件：enabled && !atBottom           │
   │       && !content && !focused        │
   │       && !pendingDialogs             │
   │                                     │
   ├─ DOM 保留（不卸载）                  ├─ DOM 不可见（opacity-0）
   │  避免 iOS 键盘 dismiss               │  pointer-events-none
   │                                     │  position: absolute
   ├─ Footer 可见                         ├─ Footer 隐藏
   │                                     │
   └─ pb: safe-area - 2rem               └─ pb: max(12px, safe-area)
```

**核心原则**：
1. 输入框永远不卸载（保留键盘连接）
2. 收起高度 = 展开高度（防止布局跳动）
3. 五条件全部满足才收起（缺一不可）
4. 三层焦点防线确保不误收

### 9.4 三页卡片翻页的视觉创新

```
传统的 Drawer/Navigation 方案：
  侧栏从左侧滑入 → 聊天页被推开 → 大部分内容不可见

OpenCodeUI 的卡片方案：
  聊天页保持在屏幕中央 → 3D 翻转 + 缩小 → 始终可见
  → 用户始终知道自己"在哪"，随时可以滑回来
```

**技术实现**：
- CSS `scroll-snap` 做原生级滚动体验
- CSS 自定义属性驱动的 `rotateY` + `scale` + `translateX` 做卡片翻转
- `willChange: 'transform'` GPU 加速
- `perspective: 1200px` 3D 空间

### 9.5 Safe Area 全链路覆盖

```
env(safe-area-inset-*)     ←── CSS 环境变量
        │
        ▼
var(--safe-area-inset-*)   ←── CSS 自定义属性（封装层）
        │
        ├── #root padding   ←── 全局 safe area
        ├── 各组件内联 style ←── 局部 safe area
        ├── 模态框/Toast    ←── 弹出层 safe area
        └── useViewportHeight → --keyboard-inset-bottom → #root padding-bottom
```

每一层都使用统一的 CSS 变量，没有散落的 `env()` 调用。

### 9.6 移动端特有的"不做"清单

| 不做的事项 | 原因 |
|----------|------|
| 不运行 `desktop_window_ready` | 无标题栏 |
| 不启动 opencode serve | 移动端不需要后台进程管理 |
| 不使用原生文件对话框 | 移动端用浏览器 input |
| 不分屏（<900px 触屏）| 空间不够 |
| 不显示折叠/展开侧栏按钮 | 始终展开 |
| 不显示 resize 手柄（docked 模式）| overlay 模式不需要 |
| 不给 Tauri 应用 CSS safe-area | 原生层已处理 |

---

## 十、断点速查表

| 断点 | 含义 | 影响 |
|------|------|------|
| **380px** | `CHAT_SURFACE_MIN_WIDTH` | 聊天表面绝对最小宽度 |
| **680px** | `CHAT_SURFACE_COMPACT_BREAKPOINT` | 紧凑模式：padding、composer、placeholder |
| **768px** | `CHAT_VIEWPORT_MOBILE_BREAKPOINT` | ★ 移动端模式：overlay 面板、触屏交互、胶囊输入框、三页卡片 |
| **900px** | `CHAT_SPLIT_TOUCH_MIN_WIDTH` | 触屏设备分屏最低宽度 |
| **1100px** | `SMALL_DESKTOP_BREAKPOINT` | 小桌面：影响侧栏/右面板最大宽度 |

---

*文档由自动分析生成，基于 `D:\GitHubProject\Agent\OpenCodeUI-main` 源码。*
