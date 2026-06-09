import type React from 'react'
const MENUS = ['文件', '编辑', '查看', '窗口', '帮助']

export function MenuBar(): React.ReactNode {
  return (
    <header className="menubar">
      <nav className="menubar-menu" aria-label="应用菜单">
        {MENUS.map(menu => (
          <button className="menu-item" key={menu} type="button">
            {menu}
          </button>
        ))}
      </nav>
    </header>
  )
}
