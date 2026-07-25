import * as Dialog from '@radix-ui/react-dialog'
import { FileCode2, FolderOpen, Play, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DesktopInstalledSkill } from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { readRuntimeSkill } from './skillClientAdapter.js'

type Props = {
  workspacePath: string | null
  skill: DesktopInstalledSkill | null
  open: boolean
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
  onOpenSkill: (skill: DesktopInstalledSkill) => void
  onUseSkill: (skill: DesktopInstalledSkill) => void
  onError: (message: string) => void
}

export function SkillDetailsDialog({
  workspacePath,
  skill,
  open,
  restoreFocusElement,
  onOpenChange,
  onOpenSkill,
  onUseSkill,
  onError,
}: Props): React.ReactNode {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const onErrorRef = useRef(onError)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    if (!open || !skill) return
    let cancelled = false
    setLoading(true)
    setContent('')
    setError(null)
    readRuntimeSkill(workspacePath, skill.path)
      .then(result => {
        if (!cancelled) setContent(result.content)
      })
      .catch(readError => {
        if (cancelled) return
        const message = errorMessageOf(readError, '技能详情读取失败。')
        setError(message)
        onErrorRef.current(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, skill, workspacePath])

  if (!skill) return null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="permission-modal-backdrop">
          <Dialog.Content
            className="permission-modal tw:flex tw:max-h-[min(42rem,calc(100vh-3rem))] tw:w-[min(48rem,calc(100vw-3rem))] tw:flex-col tw:overflow-hidden tw:rounded-xl tw:p-0 tw:text-app-text"
            onCloseAutoFocus={event => {
              if (!restoreFocusElement?.isConnected) return
              event.preventDefault()
              restoreFocusElement.focus()
            }}
            onOpenAutoFocus={event => {
              event.preventDefault()
              closeRef.current?.focus()
            }}
          >
            <header className="tw:flex tw:items-start tw:gap-3 tw:border-b tw:border-app-border tw:px-5 tw:py-4">
              <span
                aria-hidden="true"
                className="tw:flex tw:size-10 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full tw:border tw:border-app-border tw:bg-app-canvas tw:text-app-text-soft"
              >
                <FileCode2
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </span>
              <span className="tw:min-w-0 tw:flex-1">
                <Dialog.Title className="tw:m-0 tw:text-lg tw:font-[var(--font-weight-heading)]">
                  {skill.name}
                </Dialog.Title>
                <Dialog.Description className="tw:mt-1 tw:mb-0 tw:text-sm tw:leading-5 tw:text-app-text-soft">
                  {skill.description || '未提供技能说明。'}
                </Dialog.Description>
              </span>
              <Dialog.Close asChild>
                <IconButton ref={closeRef} title="关闭技能详情" variant="plain">
                  <X
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </IconButton>
              </Dialog.Close>
            </header>

            <div className="tw:min-h-0 tw:flex-1 tw:overflow-auto tw:px-5 tw:py-4">
              <dl className="tw:mb-4 tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:gap-x-4 tw:gap-y-2 tw:text-sm">
                <dt className="tw:text-app-text-soft">来源</dt>
                <dd className="tw:m-0">{skillScopeLabel(skill.scope)}</dd>
                <dt className="tw:text-app-text-soft">状态</dt>
                <dd className="tw:m-0">{skill.enabled ? '已启用' : '已禁用'}</dd>
              </dl>
              {loading ? (
                <p className="tw:m-0 tw:text-sm tw:text-app-text-soft" role="status">
                  正在读取 SKILL.md…
                </p>
              ) : error ? (
                <div
                  className="tw:rounded-lg tw:border tw:border-app-danger tw:bg-app-panel tw:p-3 tw:text-sm tw:text-app-danger"
                  role="alert"
                >
                  {error}
                </div>
              ) : (
                <pre className="tw:m-0 tw:overflow-auto tw:whitespace-pre-wrap tw:break-words tw:rounded-lg tw:border tw:border-app-border tw:bg-app-canvas tw:p-4 tw:font-mono tw:text-sm tw:leading-6 tw:text-app-text">
                  {content}
                </pre>
              )}
            </div>

            <footer className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:border-t tw:border-app-border tw:px-5 tw:py-4">
              <Button onClick={() => onOpenSkill(skill)}>
                <FolderOpen
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
                打开
              </Button>
              <Button
                disabled={!skill.enabled}
                variant="primary"
                onClick={() => onUseSkill(skill)}
              >
                <Play
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
                立即使用
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function skillScopeLabel(
  scope: DesktopInstalledSkill['scope'],
): string {
  switch (scope) {
    case 'repo':
      return '团队'
    case 'user':
      return '个人'
    case 'system':
      return '系统'
    case 'admin':
      return '管理员安装'
  }
}

function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}
