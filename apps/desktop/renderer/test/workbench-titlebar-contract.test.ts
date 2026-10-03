import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expectSourceContains, expectSourceNotContains } from './source-contract.js'

const rendererRoot = resolve(import.meta.dir, '..')

function readRendererFile(path: string): string {
  return readFileSync(resolve(rendererRoot, path), 'utf8')
}

describe('workbench chrome contract', () => {
  test('keeps the renderer title bar at a deterministic logical height', () => {
    const shell = readRendererFile('src/features/layout/shell/WorkbenchShellView.tsx')
    const tokens = readRendererFile('src/styles/design-system/tokens.scss')

    expectSourceContains(shell, 'className="desktop-menubar tw:shrink-0"')
    expectSourceNotContains(shell, 'updateTitleBarOverlay')
    expectSourceNotContains(shell, 'getBoundingClientRect().height')
    expectSourceContains(tokens, '--application-menubar-height: 36px')
    expectSourceNotContains(tokens, 'env(titlebar-area-height')
  })

  test('keeps application chrome separate from the workspace toolbar', () => {
    const chrome = readRendererFile('src/styles/features/layout-chrome.scss')
    const workspaceHeader = readRendererFile('src/styles/features/_layout-workspace-header.scss')
    const layout = readRendererFile('src/features/layout/shell/DesktopLayout.tsx')

    expectSourceContains(chrome, '--desktop-titlebar-height: var(--application-menubar-height)')
    expectSourceContains(chrome, '--cpx-sys-color-workbench-titlebar-bg')
    expectSourceContains(workspaceHeader, 'height: var(--workspace-header-height)')
    expectSourceContains(workspaceHeader, 'position: absolute')
    expectSourceContains(workspaceHeader, 'background: transparent')
    expectSourceContains(
      workspaceHeader,
      'border-bottom: 1px solid var(--cpx-sys-color-border-subtle)',
    )
    expectSourceNotContains(workspaceHeader, '--cpx-sys-color-workbench-titlebar-bg')
    expectSourceContains(layout, '<DesktopWorkspaceHeader')
    expectSourceContains(layout, 'desktop-main-route__header-spacer')
  })

  test('keeps route content out of the application menu bar', () => {
    const menuBar = readRendererFile('src/features/layout/MenuBar.tsx')
    const windowControlsIndex = menuBar.indexOf('<WindowControls')

    expectSourceNotContains(menuBar, 'workspaceHeader')
    expectSourceNotContains(menuBar, 'menubar-workspace-header')
    expect(windowControlsIndex).toBeGreaterThan(menuBar.indexOf('</Menubar.Root>'))
    for (const label of ['文件', '编辑', '查看', '窗口', '帮助']) {
      expectSourceContains(menuBar, `label="${label}"`)
    }
  })

  test('keeps high-frequency edit and settings drafts out of the workbench shell', () => {
    const layout = readRendererFile('src/features/layout/shell/DesktopLayout.tsx')
    const menuBar = readRendererFile('src/features/layout/MenuBar.tsx')

    expectSourceContains(layout, 'useDesktopRuntimeSettings()')
    expectSourceNotContains(layout, 'useDesktopSettings()')
    expectSourceNotContains(layout, 'useEditCommands()')
    expectSourceContains(menuBar, 'useEditCommands()')
  })
})

describe('workbench resize commit contract', () => {
  test('commits panel ratios synchronously without layout-state feedback', () => {
    const controller = readRendererFile('src/features/layout/shell/useWorkbenchShellController.ts')
    const desktopLayout = readRendererFile('src/features/layout/useDesktopLayout.ts')

    expectSourceNotContains(controller, 'startTransition')
    expectSourceContains(controller, 'setRightDockWidthRatio(nextRatio)')
    expectSourceContains(controller, 'setBottomPanelHeightRatio(nextRatio)')
    expectSourceContains(controller, 'rightPanelLiveResizeRef.current.previewSize(')
    expectSourceContains(controller, 'bottomPanelLiveResizeRef.current.previewSize(')
    expectSourceContains(controller, 'settleTimerRef.current = setTimeout(')
    // 原生缩放状态由 resizeActivityCoordinator 统一维护（按窗口 + revision +
    // 看门狗），不再是易失布尔 ref；旧版 Electron 的布尔信号在入口处合成事件。
    expectSourceNotContains(controller, 'nativeResizeActiveRef')
    expectSourceContains(controller, 'resizeActivityCoordinator.applyNativeActivity(activity)')
    expectSourceContains(controller, 'handleResizePhase(activity.phase)')
    expectSourceContains(controller, 'onWindowResizeStateChanged?.(resizing =>')
    expectSourceContains(controller, 'resizeActivityFromLegacy(resizing, legacyRevision)')
    expectSourceContains(
      controller,
      'if (!resizeActivityCoordinator.isResizing()) scheduleFallbackSettlement()',
    )
    expectSourceContains(controller, 'resizeActivityCoordinator.reset()')
    expectSourceContains(controller, 'NON_NATIVE_RESIZE_SETTLE_MS = 500')
    expectSourceContains(controller, 'rightPanelLiveResizeRef.current.previewSize(null)')
    expectSourceContains(controller, 'bottomPanelLiveResizeRef.current.previewSize(null)')
    expectSourceNotContains(desktopLayout, 'viewportWidth')
  })
})
