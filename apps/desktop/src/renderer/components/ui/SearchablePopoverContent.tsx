import React from 'react'

type Props = {
  children: React.ReactNode
  footer?: React.ReactNode
  listClassName?: string
  search: React.ReactNode
}

export function SearchablePopoverContent({
  children,
  footer,
  listClassName = 'searchable-popover-list-scroll',
  search,
}: Props): React.ReactNode {
  return (
    <>
      {search}
      <div className={listClassName}>{children}</div>
      {footer ? (
        <>
          <div className="popover-divider" />
          {footer}
        </>
      ) : null}
    </>
  )
}
