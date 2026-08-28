import type React from 'react'
import { cx } from '../../../utils/cx.js'

export type PrimaryPageLayoutProps = {
  title: React.ReactNode
  description: React.ReactNode
  search?: React.ReactNode
  navigation?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  scrollContainerRef?: React.Ref<HTMLElement>
}

export function PrimaryPageLayout({
  title,
  description,
  search,
  navigation,
  children,
  className,
  bodyClassName,
  scrollContainerRef,
}: PrimaryPageLayoutProps): React.ReactNode {
  return (
    <section
      className={cx('primary-page-layout', className)}
      ref={scrollContainerRef}
    >
      <header className="primary-page-layout__header">
        <h1 className="primary-page-layout__title">{title}</h1>
        <p className="primary-page-layout__description">{description}</p>
        {search ? (
          <div className="primary-page-layout__search">{search}</div>
        ) : null}
        {navigation ? (
          <nav className="primary-page-layout__navigation">{navigation}</nav>
        ) : null}
      </header>
      <div className={cx('primary-page-layout__body', bodyClassName)}>
        {children}
      </div>
    </section>
  )
}
