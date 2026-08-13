import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rendererRoot = resolve(import.meta.dir, '..')

function readRendererFile(path: string): string {
  return readFileSync(resolve(rendererRoot, path), 'utf8')
}

describe('workbench chrome contract', () => {
  test('keeps application chrome separate from the workspace toolbar', () => {
    const chrome = readRendererFile('src/styles/features/layout-chrome.scss')
    const workspaceHeader = readRendererFile(
      'src/styles/features/_layout-workspace-header.scss',
    )
    const layout = readRendererFile('src/features/layout/shell/DesktopLayout.tsx')

    expect(chrome).toContain(
      '--desktop-titlebar-height: var(--application-menubar-height)',
    )
    expect(workspaceHeader).toContain('height: var(--workspace-header-height)')
    expect(workspaceHeader).toContain('position: absolute')
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
})
