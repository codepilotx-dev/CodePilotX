import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
} from 'lucide-react'
import type {
  DesktopExternalOpenTarget,
  DesktopWorkspace,
} from '../../../../shared/types.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import {
  PopoverItem,
  PopoverRadioGroup,
  PopoverRadioItem,
  PopoverSeparator,
} from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { OpenTargetIcon } from '../../../components/ui/openTargetIcon.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import {
  loadExternalOpenTargets,
  openPathWithExternalTarget,
} from '../../../services/externalOpenTargetsStore.js'
import { FileTypeIcon } from '../FileTypeIcon.js'
import type { MarkdownFileViewMode } from '../dock/rightDockState.js'

export type FileBreadcrumbToolbarProps = {
  path: string
  readonly?: boolean
  treeAvailable: boolean
  treeVisible: boolean
  markdownViewMode?: MarkdownFileViewMode
  switching?: boolean
  workspace: DesktopWorkspace | null
  workspacePath: string
  onToggleTree: () => void
  onToggleMarkdownViewMode?: () => void
}

export function FileBreadcrumbToolbar({
  path,
  readonly = false,
  treeAvailable,
  treeVisible,
  markdownViewMode,
  switching = false,
  workspace,
  workspacePath,
  onToggleTree,
  onToggleMarkdownViewMode,
}: FileBreadcrumbToolbarProps): React.ReactNode {
  const [openTargetMenu, setOpenTargetMenu] = useState(false)
  const [openTargets, setOpenTargets] = useState<DesktopExternalOpenTarget[]>([])
  const segments = useMemo(
    () => buildBreadcrumbSegments(path, workspace, workspacePath),
    [path, workspace, workspacePath],
  )
  const absolutePath = useMemo(
    () => resolveAbsolutePath(workspacePath, path),
    [path, workspacePath],
  )
  const preferredOpenTarget =
    openTargets.find(target => target.preferred) ?? openTargets[0]

  function rememberPreferredTarget(target: DesktopExternalOpenTarget): void {
    const next = openTargets.map(candidate => ({
      ...candidate,
      preferred: candidate.id === target.id,
    }))
    setOpenTargets(next)
  }

  function openWithTarget(target: DesktopExternalOpenTarget): void {
    if (!absolutePath) return
    rememberPreferredTarget(target)
    void openPathWithExternalTarget(absolutePath, target.id)
  }

  useEffect(() => {
    if (!absolutePath) {
      setOpenTargets([])
      return
    }
    let active = true
    void loadExternalOpenTargets(absolutePath)
      .then(targets => {
        if (active) setOpenTargets(targets)
      })
      .catch(() => {
        if (active) setOpenTargets([])
      })
    return () => {
      active = false
    }
  }, [absolutePath])

  return (
    <header className="file-breadcrumb-toolbar">
      <div
        aria-label={`文件路径：${path}`}
        className="file-breadcrumb-toolbar__path"
      >
        {segments.map((segment, index) => {
          return (
            <span className="file-breadcrumb-toolbar__segment" key={segment.key}>
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  className="file-breadcrumb-toolbar__separator"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              ) : null}
              {segment.file ? (
                <span
                  className="file-breadcrumb-toolbar__filename"
                  title={path}
                >
                  <FileTypeIcon
                    aria-hidden="true"
                    path={path}
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                  <strong>{segment.label}</strong>
                </span>
              ) : (
                <span
                  className="file-breadcrumb-toolbar__directory"
                  title={segment.title}
                >
                  {segment.label}
                </span>
              )}
            </span>
          )
        })}
      </div>
      <div className="file-breadcrumb-toolbar__actions">
        {markdownViewMode && onToggleMarkdownViewMode ? (
          <button
            aria-busy={switching}
            className="file-breadcrumb-toolbar__view-mode"
            disabled={switching}
            type="button"
            onClick={onToggleMarkdownViewMode}
          >
            {markdownViewMode === 'rich' ? '查看源代码' : '查看预览'}
          </button>
        ) : null}
        {readonly ? <small>只读</small> : null}
        <button
          aria-label={treeVisible ? '隐藏文件树' : '显示文件树'}
          aria-pressed={treeVisible}
          className="file-breadcrumb-toolbar__action"
          disabled={!treeAvailable}
          title={
            treeAvailable
              ? treeVisible
                ? '隐藏文件树'
                : '显示文件树'
              : '面板过窄，无法显示文件树'
          }
          type="button"
          onClick={onToggleTree}
        >
          <FolderOpen
            aria-hidden="true"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </button>
        <div className="file-breadcrumb-toolbar__open-group">
          <button
            className="file-breadcrumb-toolbar__open"
            disabled={!absolutePath || !preferredOpenTarget}
            title={
              preferredOpenTarget
                ? `使用 ${preferredOpenTarget.label} 打开`
                : '没有可用的外部应用'
            }
            type="button"
            onClick={() => {
              if (!absolutePath || !preferredOpenTarget) return
              openWithTarget(preferredOpenTarget)
            }}
          >
            {preferredOpenTarget ? (
              <OpenTargetIcon
                className="file-breadcrumb-open-target-icon"
                kind={preferredOpenTarget.kind}
                targetId={preferredOpenTarget.id}
              />
            ) : null}
            <span>打开</span>
          </button>
          <PopoverMenu
            align="end"
            className="file-breadcrumb-open-popover popover-menu--grid"
            open={openTargetMenu}
            side="bottom"
            sideOffset={4}
            width={220}
            trigger={
              <button
                aria-label="选择外部打开方式"
                className="file-breadcrumb-toolbar__open-menu"
                disabled={!absolutePath || openTargets.length === 0}
                title="选择外部打开方式"
                type="button"
              >
                <ChevronDown
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </button>
            }
            onOpenChange={setOpenTargetMenu}
          >
            <PopoverRadioGroup
              value={preferredOpenTarget?.id ?? ''}
              onValueChange={targetId => {
                const target = openTargets.find(item => item.id === targetId)
                if (!target || !absolutePath) return
                openWithTarget(target)
                setOpenTargetMenu(false)
              }}
            >
              {openTargets.map(target => (
                <PopoverRadioItem
                  icon={
                    <OpenTargetIcon
                      className="file-breadcrumb-open-target-icon"
                      kind={target.kind}
                      targetId={target.id}
                    />
                  }
                  key={target.id}
                  value={target.id}
                >
                  {target.label}
                </PopoverRadioItem>
              ))}
            </PopoverRadioGroup>
            <PopoverSeparator className="sidebar-context-menu-separator" />
            <PopoverItem
              icon={
                <FolderOpen
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              }
              onClick={() => {
                if (!absolutePath) return
                void desktopClient.revealPathInFolder(absolutePath)
                setOpenTargetMenu(false)
              }}
            >
              在文件资源管理器中显示
            </PopoverItem>
          </PopoverMenu>
        </div>
      </div>
    </header>
  )
}

type BreadcrumbSegment = {
  directoryPath: string | null
  file: boolean
  key: string
  label: string
  title: string
}

function buildBreadcrumbSegments(
  path: string,
  workspace: DesktopWorkspace | null,
  workspacePath: string,
): BreadcrumbSegment[] {
  const relativeSegments = path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  const workspaceLabel =
    workspace?.name?.trim() ||
    workspacePath.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ||
    '工作区'
  const segments: BreadcrumbSegment[] = [
    {
      directoryPath: null,
      file: false,
      key: 'workspace-root',
      label: workspaceLabel,
      title: workspacePath,
    },
  ]
  for (let index = 0; index < relativeSegments.length; index += 1) {
    const label = relativeSegments[index] ?? ''
    const directoryPath = relativeSegments.slice(0, index + 1).join('/')
    const file = index === relativeSegments.length - 1
    segments.push({
      directoryPath: file ? null : directoryPath,
      file,
      key: file ? `file:${directoryPath}` : `directory:${directoryPath}`,
      label,
      title: file ? path : directoryPath,
    })
  }
  return segments
}

function resolveAbsolutePath(
  workspacePath: string | null,
  relativePath: string,
): string | null {
  const value = relativePath.trim()
  if (!value) return null
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u.test(value)) return value
  if (!workspacePath?.trim()) return null
  const separator = workspacePath.includes('\\') ? '\\' : '/'
  return `${workspacePath.replace(/[\\/]+$/u, '')}${separator}${value.replace(/^[\\/]+/u, '')}`
}
