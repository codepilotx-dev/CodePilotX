import { Component, Fragment } from 'react'
import type React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import type { WorkbenchTabId } from '../dock/rightDockState.js'

export type WorkbenchPanelViewState =
  | { status: 'loading'; label: string }
  | { status: 'empty'; title: string; description?: string }
  | { status: 'unavailable'; title: string; description: string }
  | {
      status: 'error'
      code?: string
      message: string
      retryable: boolean
    }
  | { status: 'too-large'; title: string; description: string }
  | { status: 'ready' }

type StateSurfaceProps = {
  title: string
  description?: string
  icon?: React.ReactNode
  role?: 'alert' | 'status'
  children?: React.ReactNode
  tone?: 'default' | 'warning'
}

function WorkbenchPanelStateSurface({
  title,
  description,
  icon,
  role = 'status',
  children,
  tone = 'default',
}: StateSurfaceProps): React.ReactNode {
  return (
    <div
      className="workbench-panel-state"
      data-tone={tone}
      role={role}
    >
      {icon ? (
        <span aria-hidden="true" className="workbench-panel-state__icon">
          {icon}
        </span>
      ) : null}
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
      {children ? (
        <div className="workbench-panel-state__actions">{children}</div>
      ) : null}
    </div>
  )
}

export function WorkbenchPanelLoading({
  label,
}: {
  label: string
}): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface title={label}>
      <span aria-hidden="true" className="workbench-panel-state__spinner" />
    </WorkbenchPanelStateSurface>
  )
}

export function WorkbenchPanelEmpty({
  title,
  description,
  children,
}: Pick<StateSurfaceProps, 'title' | 'description' | 'children'>): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface title={title} description={description}>
      {children}
    </WorkbenchPanelStateSurface>
  )
}

export function WorkbenchPanelUnavailable({
  title,
  description,
}: Pick<StateSurfaceProps, 'title' | 'description'>): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface
      title={title}
      description={description}
      icon={
        <AlertTriangle
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      }
      tone="warning"
    />
  )
}

export function WorkbenchPanelError({
  title = '此标签无法显示',
  code,
  message,
  retryable,
  onRetry,
}: {
  title?: string
  code?: string
  message: string
  retryable: boolean
  onRetry?: () => void
}): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface
      title={title}
      description={code ? `${message}（${code}）` : message}
      icon={
        <AlertTriangle
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      }
      role="alert"
      tone="warning"
    >
      {retryable && onRetry ? (
        <Button color="secondary" size="compact" onClick={onRetry}>
          <RotateCcw
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
          重试
        </Button>
      ) : null}
    </WorkbenchPanelStateSurface>
  )
}

export function WorkbenchPanelTooLarge({
  title,
  description,
}: Pick<StateSurfaceProps, 'title' | 'description'>): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface title={title} description={description} />
  )
}

export function WorkbenchPanelWarning({
  title,
  description,
  children,
}: Pick<StateSurfaceProps, 'title' | 'description' | 'children'>): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface
      title={title}
      description={description}
      icon={
        <AlertTriangle
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      }
      tone="warning"
    >
      {children}
    </WorkbenchPanelStateSurface>
  )
}

export type WorkbenchLauncherAction = {
  disabled?: boolean
  id: string
  icon: React.ReactNode
  label: string
  shortcut?: string
  onSelect: () => void
  reason?: string
}

export function WorkbenchPanelLauncher({
  actions,
}: {
  actions: readonly WorkbenchLauncherAction[]
}): React.ReactNode {
  return (
    <div aria-label="可用面板标签" className="right-panel-tabs-empty-state">
      <div className="right-panel-tabs-empty-state__actions">
        {actions.map(action => (
          <Button
            allowShrink
            className="right-panel-tabs-empty-state__item"
            color="ghost"
            disabled={action.disabled}
            key={action.id}
            size="default"
            title={action.reason}
            onClick={action.onSelect}
          >
            <span className="right-panel-tabs-empty-state__icon">
              {action.icon}
            </span>
            <strong>{action.label}</strong>
            {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
          </Button>
        ))}
      </div>
    </div>
  )
}

type WorkbenchTabErrorBoundaryProps = {
  tabId: WorkbenchTabId
  children: React.ReactNode
}

type WorkbenchTabErrorBoundaryState = {
  error: Error | null
  retryKey: number
}

export class WorkbenchTabErrorBoundary extends Component<
  WorkbenchTabErrorBoundaryProps,
  WorkbenchTabErrorBoundaryState
> {
  state: WorkbenchTabErrorBoundaryState = { error: null, retryKey: 0 }

  static getDerivedStateFromError(
    error: Error,
  ): Partial<WorkbenchTabErrorBoundaryState> {
    return { error }
  }

  componentDidUpdate(previous: WorkbenchTabErrorBoundaryProps): void {
    if (previous.tabId !== this.props.tabId && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): React.ReactNode {
    if (!this.state.error) {
      return (
        <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>
      )
    }
    return (
      <WorkbenchPanelError
        message={this.state.error.message}
        retryable
        onRetry={() =>
          this.setState(state => ({
            error: null,
            retryKey: state.retryKey + 1,
          }))
        }
      />
    )
  }
}
