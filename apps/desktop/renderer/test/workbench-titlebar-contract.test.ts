import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rendererRoot = resolve(import.meta.dir, '..')

function readRendererFile(path: string): string {
  return readFileSync(resolve(rendererRoot, path), 'utf8')
}

describe('workbench chrome contract', () => {
  test('keeps the renderer title bar at a deterministic logical height', () => {
    const shell = readRendererFile(
      'src/features/layout/shell/WorkbenchShellView.tsx',
    )
    const tokens = readRendererFile(
      'src/styles/design-system/tokens.scss',
    )

    expect(shell).toContain('className="desktop-menubar tw:shrink-0"')
    expect(shell).not.toContain('updateTitleBarOverlay')
    expect(shell).not.toContain('getBoundingClientRect().height')
    expect(tokens).toContain('--application-menubar-height: 36px')
    expect(tokens).not.toContain('env(titlebar-area-height')
  })

  test('keeps application chrome separate from the workspace toolbar', () => {
    const chrome = readRendererFile('src/styles/features/layout-chrome.scss')
    const workspaceHeader = readRendererFile(
      'src/styles/features/_layout-workspace-header.scss',
    )
    const layout = readRendererFile('src/features/layout/shell/DesktopLayout.tsx')

    expect(chrome).toContain(
      '--desktop-titlebar-height: var(--application-menubar-height)',
    )
    expect(chrome).toContain('--cpx-sys-color-workbench-titlebar-bg')
    expect(workspaceHeader).toContain('height: var(--workspace-header-height)')
    expect(workspaceHeader).toContain('position: absolute')
    expect(workspaceHeader).toContain('background: transparent')
    expect(workspaceHeader).toContain(
      'border-bottom: 1px solid var(--cpx-sys-color-border-subtle)',
    )
    expect(workspaceHeader).not.toContain('--cpx-sys-color-workbench-titlebar-bg')
    expect(layout).toContain('<DesktopWorkspaceHeader')
    expect(layout).toContain('desktop-main-route__header-spacer')
  })

  test('keeps route content out of the application menu bar', () => {
    const menuBar = readRendererFile('src/features/layout/MenuBar.tsx')
    const windowControlsIndex = menuBar.indexOf('<WindowControls')

    expect(menuBar).not.toContain('workspaceHeader')
    expect(menuBar).not.toContain('menubar-workspace-header')
    expect(windowControlsIndex).toBeGreaterThan(menuBar.indexOf('</Menubar.Root>'))
    for (const label of ['文件', '编辑', '查看', '窗口', '帮助']) {
      expect(menuBar).toContain(`label="${label}"`)
    }
  })

  test('keeps high-frequency edit and settings drafts out of the workbench shell', () => {
    const layout = readRendererFile('src/features/layout/shell/DesktopLayout.tsx')
    const menuBar = readRendererFile('src/features/layout/MenuBar.tsx')

    expect(layout).toContain('useDesktopRuntimeSettings()')
    expect(layout).not.toContain('useDesktopSettings()')
    expect(layout).not.toContain('useEditCommands()')
    expect(menuBar).toContain('useEditCommands()')
  })
})

describe('workbench resize commit contract', () => {
  test('commits panel ratios synchronously without layout-state feedback', () => {
    const controller = readRendererFile(
      'src/features/layout/shell/useWorkbenchShellController.ts',
    )
    const responsiveSyncStart = controller.indexOf(
      'if (workspaceSize.width <= 0 || workspaceSize.height <= 0) return',
    )
    const responsiveSyncEnd = controller.indexOf(
      "void import('./workbenchLayoutStorage.js')",
      responsiveSyncStart,
    )
    const responsiveSync = controller.slice(
      responsiveSyncStart,
      responsiveSyncEnd,
    )

    expect(controller).not.toContain('startTransition')
    expect(controller).toContain('setRightDockWidthRatio(nextRatio)')
    expect(controller).toContain('setBottomPanelHeightRatio(nextRatio)')
    expect(responsiveSync).toContain('responsiveRightDockWidth')
    expect(responsiveSync).toContain('responsiveBottomPanelHeight')
    expect(responsiveSync).not.toContain('workbenchLayoutState,')
  })
})
