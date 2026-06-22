import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MenuBar } from './MenuBar.js'

const noop = () => {}

function renderMenuBar(isMaximized: boolean): string {
  return renderToStaticMarkup(
    <MenuBar
      sidebarCollapsed={false}
      isMaximized={isMaximized}
      onToggleSidebar={noop}
      onMinimize={noop}
      onToggleMaximize={noop}
      onClose={noop}
      onFileMenuAction={noop}
      onEditMenuAction={noop}
      onViewMenuAction={noop}
      onWindowMenuAction={noop}
      onHelpMenuAction={noop}
    />,
  )
}

test('restore window control icon is mirrored only when maximized', () => {
  expect(renderMenuBar(true)).toContain('window-restore-icon')
  expect(renderMenuBar(false)).not.toContain('window-restore-icon')
})
