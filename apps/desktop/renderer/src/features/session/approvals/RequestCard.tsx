import React from 'react'

export type RequestCardProps = {
  title: React.ReactNode
  identity?: string
  disabledReason?: string
  navigation?: React.ReactNode
  children: React.ReactNode
  error?: string | null
  variant: 'question' | 'plan' | 'permission' | 'permission-grant'
}

export function RequestCard({ title, identity, disabledReason, navigation, children, error, variant }: RequestCardProps): React.ReactNode {
  return <section className={`inline-approval-card workflow-composer-card workflow-composer-card-${variant === 'permission-grant' ? 'permission' : variant} request-card`} data-variant={variant}>
    <header className="request-card-header">
      <div className="request-card-heading">
        {identity ? <p className="request-card-identity">{identity}</p> : null}
        <h3>{title}</h3>
      </div>
      {navigation}
    </header>
    {disabledReason ? <p className="request-card-disabled-reason" role="status">{disabledReason}</p> : null}
    <fieldset className="request-card-content" disabled={Boolean(disabledReason)}>{children}</fieldset>
    {error ? <p className="ask-user-question-error" role="alert">{error}</p> : null}
  </section>
}

export function RequestMarker({ children }: { children: React.ReactNode }): React.ReactNode {
  return <span className="request-card-marker" aria-hidden="true">{children}</span>
}
