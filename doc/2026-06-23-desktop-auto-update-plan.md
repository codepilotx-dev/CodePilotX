# 桌面端自动更新 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 CodePilotX Electron 桌面端添加后台自动更新检测 + 用户手动触发下载安装的能力

**Architecture:** 使用 `electron-updater` + generic provider，主进程管理更新生命周期，通过 IPC 事件通知渲染进程，渲染进程在侧边栏设置弹出菜单中展示 UI

**Tech Stack:** TypeScript, Electron, React, electron-updater, electron-builder

## 全局约束

- 保持 `.js` 导入扩展名风格
- 不修改 `packages/core/src/types/generated/` 下的生成文件
- IPC 通道必须通过 `shared/ipcChannels.ts` 和 `shared/types.ts`
- 复用现有组件体系（`PopoverItem`、`SidebarRow` 等）
- 通过 `CODEPILOTX_UPDATE_FEED_URL` 环境变量配置更新源
- `autoDownload: false` — 不自动下载，等用户点击后手动触发
- 下载完成后才显示「重启安装」

---

### Task 1: 添加 electron-updater 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

Run: `bun add electron-updater`
Expected: `electron-updater` 添加到 `dependencies`

- [ ] **Step 2: 验证安装**

Run: `bun run typecheck`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add package.json bun.lock
git commit -m "chore: add electron-updater dependency"
```

---

### Task 2: 定义共享类型和 IPC 通道

**Files:**
- Modify: `apps/desktop/src/shared/types.ts`
- Modify: `apps/desktop/src/shared/ipcChannels.ts`

**Interfaces:**
- Produces: `DesktopUpdateStatus` 类型，4 个新 API 方法签名，`DESKTOP_UPDATE_STATUS_CHANNEL` 常量

- [ ] **Step 1: 在 `types.ts` 末尾追加 `DesktopUpdateStatus` 类型**

在 `apps/desktop/src/shared/types.ts` 文件末尾（`DesktopApi` 定义之后）追加：

```ts
export type DesktopUpdateStatus =
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; percent: number }
  | { phase: 'downloaded' }
  | { phase: 'error'; message: string }
  | { phase: 'no-update' }
```

- [ ] **Step 2: 在 `DesktopApi` 接口中追加 4 个方法**

在 `apps/desktop/src/shared/types.ts` 的 `DesktopApi` 接口末尾（`onUiCommand` 之后，`}` 之前）追加：

```ts
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  quitAndInstall(): Promise<void>
  onUpdateStatusChange(callback: (status: DesktopUpdateStatus) => void): () => void
```

- [ ] **Step 3: 在 `ipcChannels.ts` 中追加新通道和方法**

在 `apps/desktop/src/shared/ipcChannels.ts` 中：

3a. 在 `DesktopApiMethod` 类型的 `Exclude` 中加入 `'onUpdateStatusChange'`：

`onAgentEvent' | 'onWorkflowEvent' | 'onUiCommand'` → `onAgentEvent' | 'onWorkflowEvent' | 'onUiCommand' | 'onUpdateStatusChange'`

3b. 在 `DESKTOP_API_METHODS` 数组 `'exitApp'` 之后追加：

```ts
  'checkForUpdates',
  'downloadUpdate',
  'quitAndInstall',
```

3c. 在文件末尾追加新通道常量：

```ts
export const DESKTOP_UPDATE_STATUS_CHANNEL = 'desktop:update-status'
```

- [ ] **Step 4: 运行类型检查**

Run: `bun run typecheck`
Expected: 通过

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/shared/ipcChannels.ts
git commit -m "feat: add DesktopUpdateStatus type and update IPC channels"
```

---

### Task 3: 创建 `autoUpdater.ts` 模块

**Files:**
- Create: `apps/desktop/src/main/autoUpdater.ts`

**Interfaces:**
- Consumes: `DesktopUpdateStatus` (from Task 2)
- Produces: `desktopAutoUpdater` 全局单例（由 `index.ts` 初始化）

- [ ] **Step 1: 创建 `apps/desktop/src/main/autoUpdater.ts`**

```ts
import { autoUpdater } from 'electron-updater'
import type { DesktopUpdateStatus } from '../shared/types.js'

const FEED_URL = process.env.CODEPILOTX_UPDATE_FEED_URL ?? ''

export type DesktopAutoUpdater = {
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  quitAndInstall(): void
}

export let desktopAutoUpdater: DesktopAutoUpdater | null = null

export function createDesktopAutoUpdater(options: {
  onStatusChange: (status: DesktopUpdateStatus) => void
}): void {
  if (!FEED_URL) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: FEED_URL,
  })

  autoUpdater.on('update-available', (info) => {
    options.onStatusChange({ phase: 'available', version: info.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    options.onStatusChange({ phase: 'downloading', percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', () => {
    options.onStatusChange({ phase: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    options.onStatusChange({ phase: 'error', message: err.message })
  })

  autoUpdater.on('update-not-available', () => {
    options.onStatusChange({ phase: 'no-update' })
  })

  autoUpdater.checkForUpdates().catch(() => {
    // 后台检查失败，静默忽略
  })

  desktopAutoUpdater = {
    checkForUpdates: async () => {
      options.onStatusChange({ phase: 'checking' })
      await autoUpdater.checkForUpdates()
    },
    downloadUpdate: async () => {
      await autoUpdater.downloadUpdate()
    },
    quitAndInstall: () => {
      autoUpdater.quitAndInstall()
    },
  }
}
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run typecheck`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/main/autoUpdater.ts
git commit -m "feat: add desktop auto-updater module with electron-updater"
```

---

### Task 4: 注册 IPC Handler 和主进程初始化

**Files:**
- Modify: `apps/desktop/src/shared/desktopApiSchema.ts`
- Modify: `apps/desktop/src/main/desktopApiHandlers.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: `DesktopUpdateStatus` (from Task 2), `desktopAutoUpdater` (from Task 3)
- Produces: Schema entries + handler wiring + main-process init

- [ ] **Step 1: 在 `desktopApiSchema.ts` 末尾追加 schema**

在 `DESKTOP_API_ARG_SCHEMAS` 对象中 `exitApp: emptyArgs` 之后追加：

```ts
  checkForUpdates: emptyArgs,
  downloadUpdate: emptyArgs,
  quitAndInstall: emptyArgs,
```

- [ ] **Step 2: 在 `desktopApiHandlers.ts` 中注册 handler**

2a. 追加导入（在 `import type { DesktopApiHandlers } from './ipc.js'` 之后）：

```ts
import { desktopAutoUpdater } from './autoUpdater.js'
```

2b. 在 `createDesktopApiHandlers({...})` 的返回对象中，`exitApp` 之后追加：

```ts
    checkForUpdates: async () => {
      desktopAutoUpdater?.checkForUpdates()
    },
    downloadUpdate: async () => {
      desktopAutoUpdater?.downloadUpdate()
    },
    quitAndInstall: async () => {
      desktopAutoUpdater?.quitAndInstall()
    },
```

- [ ] **Step 3: 在 `main/index.ts` 中初始化 autoUpdater**

3a. 追加导入：

```ts
import { createDesktopAutoUpdater } from './autoUpdater.js'
import { DESKTOP_UPDATE_STATUS_CHANNEL } from '../shared/ipcChannels.js'
```

3b. 在 `registerIpc()` 调用之前（约 `:906`）追加：

```ts
createDesktopAutoUpdater({
  onStatusChange: (status) => {
    const window = windowService.getWindow()
    window?.webContents.send(DESKTOP_UPDATE_STATUS_CHANNEL, status)
  },
})
```

- [ ] **Step 4: 运行类型检查**

Run: `bun run typecheck`
Expected: 通过

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/shared/desktopApiSchema.ts apps/desktop/src/main/desktopApiHandlers.ts apps/desktop/src/main/index.ts
git commit -m "feat: wire update IPC handlers and auto-updater init in main process"
```

---

### Task 5: 接入 Preload 层

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: 所有之前 Task 产出的 API (from Tasks 2-4)

- [ ] **Step 1: 追加导入**

1a. 在 `ipcChannels.js` 导入中追加 `DESKTOP_UPDATE_STATUS_CHANNEL`

1b. 在 `types.js` 导入中追加 `DesktopUpdateStatus`

- [ ] **Step 2: 在 `api` 对象中追加四个方法**

在 `onUiCommand` 之后追加：

```ts
  checkForUpdates: () =>
    ipcRenderer.invoke(desktopApiChannel('checkForUpdates')),
  downloadUpdate: () =>
    ipcRenderer.invoke(desktopApiChannel('downloadUpdate')),
  quitAndInstall: () =>
    ipcRenderer.invoke(desktopApiChannel('quitAndInstall')),
  onUpdateStatusChange: callback => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: DesktopUpdateStatus,
    ) => {
      callback(status)
    }
    ipcRenderer.on(DESKTOP_UPDATE_STATUS_CHANNEL, listener)
    return () => ipcRenderer.off(DESKTOP_UPDATE_STATUS_CHANNEL, listener)
  },
```

- [ ] **Step 3: 运行类型检查**

Run: `bun run typecheck`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/preload/index.ts
git commit -m "feat: expose desktop auto-update API via preload bridge"
```

---

### Task 6: 渲染进程 UI — 黄色圆点和安装更新入口

**Files:**
- Modify: `apps/desktop/src/renderer/components/sidebar/SidebarFooter.tsx`
- Modify: `apps/desktop/src/renderer/styles/sidebar.css`

**Interfaces:**
- Consumes: `DesktopUpdateStatus` (from Task 2), preload API (from Task 5)

- [ ] **Step 1: 在 `SidebarFooter.tsx` 追加导入**

追加 `Download` 到 lucide-react 导入，追加 `DesktopUpdateStatus` 类型导入

- [ ] **Step 2: 添加更新状态 hook**

在组件内 `const [usage, setUsage]` 之后追加：

```tsx
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null)

  useEffect(() => {
    const unsubscribe = desktopClient.onUpdateStatusChange(setUpdateStatus)
    return unsubscribe
  }, [])
```

- [ ] **Step 3: 修改设置图标添加黄色圆点**

将 `leading={<Settings2 size={APP_ICON_SIZE} />}` 替换为：

```tsx
            leading={
              <span className="sidebar-settings-icon-wrap">
                <Settings2 size={APP_ICON_SIZE} />
                {updateStatus?.phase === 'available' ? (
                  <span className="sidebar-update-dot" />
                ) : null}
              </span>
            }
```

- [ ] **Step 4: 在退出登录上方添加安装更新入口**

在 `<PopoverItem icon={<LogOut size={APP_ICON_SIZE} />}` 之前插入：

```tsx
          {(updateStatus?.phase === 'available' ||
            updateStatus?.phase === 'downloading' ||
            updateStatus?.phase === 'downloaded') ? (
            <PopoverItem
              icon={<Download size={APP_ICON_SIZE} />}
              onClick={() => {
                if (updateStatus.phase === 'downloaded') {
                  desktopClient.quitAndInstall()
                } else if (updateStatus.phase === 'available') {
                  desktopClient.downloadUpdate()
                }
              }}
            >
              {updateStatus.phase === 'downloaded'
                ? '重启安装'
                : updateStatus.phase === 'downloading'
                  ? `下载中 ${Math.round(updateStatus.percent)}%`
                  : '安装更新'}
            </PopoverItem>
          ) : null}
```

- [ ] **Step 5: 追加 CSS 样式**

在 `sidebar.css` 末尾追加：

```css
.sidebar-settings-icon-wrap {
  position: relative;
  display: inline-flex;
}

.sidebar-update-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f0b400;
}
```

- [ ] **Step 6: 运行类型检查**

Run: `bun run typecheck`
Expected: 通过

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/renderer/components/sidebar/SidebarFooter.tsx apps/desktop/src/renderer/styles/sidebar.css
git commit -m "feat: add update indicator dot and install-update item in sidebar settings popover"
```

---

### Task 7: 构建验证

- [ ] **Step 1: 构建桌面端**

Run: `bun run desktop:build`
Expected: 构建成功

- [ ] **Step 2: 提交**

```bash
git commit --allow-empty -m "chore: final build verification for desktop auto-update"
```
