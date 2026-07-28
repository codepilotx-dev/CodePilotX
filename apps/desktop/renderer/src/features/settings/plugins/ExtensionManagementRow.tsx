import type React from 'react'

type Props = {
  title: string
  description: string
  icon: React.ReactNode
  metadata?: React.ReactNode
  actions?: React.ReactNode
  dimmed?: boolean
  onActivate?: (trigger: HTMLElement) => void
}

export function ExtensionManagementRow({
  title,
  description,
  icon,
  metadata,
  actions,
  dimmed = false,
  onActivate,
}: Props): React.ReactNode {
  const rowContent = (
    <>
      <span
        aria-hidden="true"
        className="tw:flex tw:size-12 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full tw:border tw:border-app-border tw:bg-app-canvas tw:text-app-text-soft"
      >
        {icon}
      </span>
      <span className="tw:min-w-0">
        <strong className="tw:block tw:truncate tw:text-base tw:font-[var(--font-weight-label)] tw:text-app-text">
          {title}
        </strong>
        <span className="tw:mt-0.5 tw:block tw:truncate tw:text-sm tw:leading-5 tw:text-app-text-soft">
          {description}
        </span>
      </span>
      {metadata ? (
        <span className="tw:max-w-80 tw:shrink-0 tw:text-right tw:text-sm tw:text-app-text-soft tw:max-[640px]:col-start-2 tw:max-[640px]:row-start-2 tw:max-[640px]:text-left">
          {metadata}
        </span>
      ) : null}
    </>
  )

  return (
    <article
      className={[
        'extensions-settings-row',
        'tw:grid tw:w-full tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:rounded-xl tw:text-app-text',
        dimmed ? 'tw:opacity-60' : '',
      ].filter(Boolean).join(' ')}
    >
      {onActivate ? (
        <button
          className="tw:grid tw:min-h-20 tw:min-w-0 tw:grid-cols-[3rem_minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:rounded-xl tw:border-0 tw:bg-transparent tw:px-3 tw:py-2.5 tw:text-left tw:text-inherit tw:transition-colors tw:duration-[var(--motion-fast)] tw:cursor-pointer tw:hover:bg-app-hover tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent tw:max-[640px]:grid-cols-[3rem_minmax(0,1fr)]"
          onClick={event => onActivate(event.currentTarget)}
          type="button"
        >
          {rowContent}
        </button>
      ) : (
        <div className="tw:grid tw:min-h-20 tw:min-w-0 tw:grid-cols-[3rem_minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:rounded-xl tw:px-3 tw:py-2.5 tw:max-[640px]:grid-cols-[3rem_minmax(0,1fr)]">
          {rowContent}
        </div>
      )}
      {actions ? (
        <span className="tw:flex tw:shrink-0 tw:items-center tw:gap-2 tw:pr-3">
          {actions}
        </span>
      ) : null}
    </article>
  )
}
