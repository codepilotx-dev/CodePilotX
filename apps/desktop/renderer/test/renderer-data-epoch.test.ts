import { describe, expect, test } from 'bun:test'
import {
  ensureRendererDataEpoch,
  RENDERER_DATA_EPOCH,
} from '../src/services/desktop-client/data-epoch.js'

class MemoryStorage implements Storage {
  #entries = new Map<string, string>()

  get length(): number {
    return this.#entries.size
  }

  clear(): void {
    this.#entries.clear()
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#entries.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, value)
  }
}

describe('renderer data epoch', () => {
  test('removes transient conversation state but preserves user preferences', () => {
    const local = new MemoryStorage()
    const session = new MemoryStorage()
    local.setItem('codepilotx.dataEpoch', '2')
    local.setItem('codepilotx.desktop.rightDockWidth', '600')
    local.setItem('codepilotx.desktop.bottomPanelHeight', '280')
    local.setItem('codepilotx.desktop.fileTreeView:c:/workspace', '{"visible":true}')
    local.setItem('codepilotx.syntax.wrap-v1', 'true')
    local.setItem('codepilotx.desktop.appearance.v3', '{"mode":"dark"}')
    local.setItem('conversation.ui-state.thread-1', '{}')
    local.setItem('layout.sidebarWidth', '300')
    local.setItem('layout.sidebarCollapsed', 'true')
    local.setItem('claude-code-desktop-settings', '{"provider":"legacy"}')
    local.setItem('other.application.setting', 'keep')
    session.setItem('codepilotx.subagent.scroll.thread-1', '20')
    session.setItem('codepilotx.desktop.rightDockWidth', '500')
    session.setItem('other.session.setting', 'keep')

    expect(ensureRendererDataEpoch(local, session)).toBe(true)
    expect(local.getItem('conversation.ui-state.thread-1')).toBeNull()
    expect(local.getItem('codepilotx.desktop.rightDockWidth')).toBe('600')
    expect(local.getItem('codepilotx.desktop.bottomPanelHeight')).toBe('280')
    expect(
      local.getItem('codepilotx.desktop.fileTreeView:c:/workspace'),
    ).toBe('{"visible":true}')
    expect(local.getItem('codepilotx.syntax.wrap-v1')).toBe('true')
    expect(local.getItem('codepilotx.desktop.appearance.v3')).toBe(
      '{"mode":"dark"}',
    )
    expect(local.getItem('layout.sidebarWidth')).toBe('300')
    expect(local.getItem('layout.sidebarCollapsed')).toBe('true')
    expect(local.getItem('claude-code-desktop-settings')).toBe(
      '{"provider":"legacy"}',
    )
    expect(local.getItem('other.application.setting')).toBe('keep')
    expect(session.getItem('codepilotx.subagent.scroll.thread-1')).toBeNull()
    expect(session.getItem('codepilotx.desktop.rightDockWidth')).toBe('500')
    expect(session.getItem('other.session.setting')).toBe('keep')
    expect(local.getItem('codepilotx.dataEpoch')).toBe(
      String(RENDERER_DATA_EPOCH),
    )
    expect(ensureRendererDataEpoch(local, session)).toBe(false)
  })
})
