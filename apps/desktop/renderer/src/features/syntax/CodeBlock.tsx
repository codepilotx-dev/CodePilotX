import type { CSSProperties, ReactNode } from 'react'
import React, { useContext, useEffect, useRef, useState } from 'react'
import { Check, Copy, Pencil } from 'lucide-react'
import { IconButton } from '../../components/ui/IconButton.js'

import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { cx } from '../../utils/cx.js'
import { desktopClipboard } from '../../services/desktop-client/index.js'
import { DesktopThemeContext } from '../theme/themeContext.js'
import type { DesktopThemeVariant } from '../../../shared/types.js'
import {
  formatSyntaxLanguageLabel,
  normalizeSyntaxLanguage,
} from './language.js'
import type { SyntaxHighlightResult, SyntaxToken } from './types.js'
import { resolveThemeId } from './theme.js'
import { useHighlightedCode } from './useHighlightedCode.js'

const COPY_FEEDBACK_DURATION_MS = 2_000

export type CodeBlockProps = {
  ariaLabel?: string
  className?: string
  code: string
  language?: string | null
  streaming?: boolean
  onChangeCode?: (code: string) => void
  onChangeLanguage?: (language: string) => void
}

export function CodeBlock({
  ariaLabel,
  className,
  code,
  language,
  streaming = false,
  onChangeCode,
  onChangeLanguage,
}: CodeBlockProps): ReactNode {
  const themeContext = useContext(DesktopThemeContext)
  const variant: DesktopThemeVariant =
    themeContext?.activeTheme.variant ??
    (typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'light'
      ? 'light'
      : 'dark')
  const codeThemeId =
    themeContext?.codeThemeId ??
    (typeof document !== 'undefined'
      ? (document.documentElement.dataset.codeThemeId ?? 'codex-dark')
      : 'codex-dark')
  const resolvedTheme = resolveThemeId(codeThemeId, variant)
  const presentation = useHighlightedCode({
    code,
    language,
    streaming,
    theme: resolvedTheme,
  })
  const [copied, setCopied] = useState(false)
  const [isEditingLang, setIsEditingLang] = useState(false)
  const [editLangValue, setEditLangValue] = useState(language ?? '')
  const [isEditingCode, setIsEditingCode] = useState(false)
  const [editCodeValue, setEditCodeValue] = useState(code)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const highlightedLanguage =
    presentation.highlighted?.language ?? normalizeSyntaxLanguage(language)
  const languageLabel = formatSyntaxLanguageLabel(highlightedLanguage)

  useEffect(() => {
    setEditCodeValue(code)
  }, [code])

  useEffect(() => {
    if (isEditingCode && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isEditingCode])

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  function commitLanguageChange(): void {
    setIsEditingLang(false)
    const trimmed = editLangValue.trim()
    if (trimmed !== (language ?? '').trim()) {
      onChangeLanguage?.(trimmed)
    }
  }

  async function handleCopy(): Promise<void> {
    try {
      await copyCodeText(code)
      setCopied(true)
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        copyFeedbackTimerRef.current = null
        setCopied(false)
      }, COPY_FEEDBACK_DURATION_MS)
    } catch {
      setCopied(false)
    }
  }

  const codeStyle: CSSProperties = {}
  if (presentation.highlighted?.foreground) {
    codeStyle.color = presentation.highlighted.foreground
  }

  return (
    <figure
      aria-label={ariaLabel ?? `${languageLabel} 代码块`}
      className={cx(
        'md-code-block',
        'tw:mx-0',
        'tw:w-full',
        'tw:max-w-full',
        'tw:overflow-hidden',
        className,
      )}
    >
      <figcaption className="md-code-header tw:flex tw:h-8 tw:items-center tw:justify-between tw:px-2 u-type-caption tw:text-app-text-soft">
        {isEditingLang ? (
          <input
            autoFocus
            aria-label="输入代码语言"
            className="md-code-lang-input tw:h-6 tw:w-28 tw:rounded-xs tw:border tw:border-app-accent tw:bg-app-raised tw:px-1.5 tw:font-mono tw:text-app-text tw:outline-none"
            placeholder="语言 (如 ts, json)"
            value={editLangValue}
            onBlur={commitLanguageChange}
            onChange={e => setEditLangValue(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                commitLanguageChange()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setIsEditingLang(false)
                setEditLangValue(language ?? '')
              }
            }}
            onPointerDown={e => e.stopPropagation()}
          />
        ) : onChangeLanguage ? (
          <button
            aria-label={`修改代码语言：当前为 ${languageLabel}`}
            className="md-code-lang md-code-lang--interactive tw:inline-flex tw:h-6 tw:items-center tw:rounded-xs tw:px-1 tw:font-mono tw:text-app-text-soft tw:transition-colors tw:duration-[var(--cpx-sys-motion-exit)] tw:hover:bg-app-raised tw:hover:text-app-text tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent"
            title="点击直接修改代码语言"
            type="button"
            onClick={e => {
              e.stopPropagation()
              setEditLangValue(language ?? '')
              setIsEditingLang(true)
            }}
            onPointerDown={e => e.stopPropagation()}
          >
            <span>{languageLabel}</span>
          </button>
        ) : (
          <span className="md-code-lang tw:font-mono">
            {languageLabel}
          </span>
        )}
        <span className="md-code-actions tw:flex tw:items-center">
          {onChangeCode && !isEditingCode ? (
            <IconButton
              color="ghostSecondary"
              size="toolbar"
              title="编辑代码"
              type="button"
              onClick={() => {
                setEditCodeValue(code)
                setIsEditingCode(true)
              }}
            >
              <Pencil aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </IconButton>
          ) : null}
          <IconButton
            className={cx(
              'md-code-action md-code-copy',
              copied && 'is-copied',
              'tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-xs tw:text-app-text-soft tw:transition-colors tw:duration-[var(--cpx-sys-motion-exit)] tw:hover:bg-app-raised tw:hover:text-app-text tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent',
            )}
            color="ghostSecondary"
            size="toolbar"
            title={copied ? '已复制代码' : '复制代码'}
            type="button"
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <Check
                aria-hidden="true"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            ) : (
              <Copy
                aria-hidden="true"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            )}
          </IconButton>
        </span>
      </figcaption>
      <pre
        className={cx(
          'md-code-pre',
          'tw:m-0',
          'tw:max-w-full',
          'tw:font-mono',
          'tw:overflow-x-auto',
          'tw:whitespace-pre',
          onChangeCode && !isEditingCode && 'tw:cursor-text',
        )}
      >
        {isEditingCode ? (
          <textarea
            ref={textareaRef}
            aria-label="编辑代码内容"
            className="md-code-editor-textarea tw:m-0 tw:w-full tw:resize-y tw:border-0 tw:bg-transparent tw:p-0 tw:font-mono tw:text-inherit tw:text-app-text tw:outline-none tw:whitespace-pre tw:overflow-x-auto"
            style={{
              ...codeStyle,
              minHeight: `${Math.max(2, editCodeValue.split('\n').length) * 1.5}em`,
              fontFamily: 'inherit',
              fontSize: 'inherit',
              lineHeight: 'inherit',
            }}
            value={editCodeValue}
            onBlur={() => {
              setIsEditingCode(false)
              if (editCodeValue !== code) {
                onChangeCode?.(editCodeValue)
              }
            }}
            onChange={e => {
              setEditCodeValue(e.target.value)
            }}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                e.preventDefault()
                setIsEditingCode(false)
                setEditCodeValue(code)
              } else if (e.key === 'Tab') {
                e.preventDefault()
                const target = e.currentTarget
                const start = target.selectionStart
                const end = target.selectionEnd
                const val = target.value
                const nextVal = `${val.substring(0, start)}  ${val.substring(end)}`
                setEditCodeValue(nextVal)
                queueMicrotask(() => {
                  target.selectionStart = target.selectionEnd = start + 2
                })
              }
            }}
            onPointerDown={e => e.stopPropagation()}
          />
        ) : (
          <code className="md-code-content" style={codeStyle}>
            <HighlightedTokens result={presentation.highlighted} />
            {presentation.plainText}
          </code>
        )}
      </pre>
    </figure>
  )
}

function HighlightedTokens({
  result,
}: {
  result: SyntaxHighlightResult | null
}): ReactNode {
  if (!result) return null

  return result.tokens.map((line, lineIndex) => (
    <React.Fragment key={lineIndex}>
      {line.map((token, tokenIndex) => (
        <span key={`${lineIndex}:${tokenIndex}`} style={syntaxTokenStyle(token)}>
          {token.content}
        </span>
      ))}
      {lineIndex < result.tokens.length - 1 ? '\n' : null}
    </React.Fragment>
  ))
}

export function syntaxTokenStyle(token: SyntaxToken): CSSProperties {
  const style: CSSProperties = {}
  if (token.color) style.color = token.color
  if (token.backgroundColor) style.backgroundColor = token.backgroundColor
  if (token.fontStyle !== undefined && token.fontStyle > 0) {
    if ((token.fontStyle & 1) !== 0) style.fontStyle = 'italic'
    if ((token.fontStyle & 2) !== 0) style.fontWeight = 700
    if ((token.fontStyle & 4) !== 0) style.textDecoration = 'underline'
  }
  return style
}

async function copyCodeText(code: string): Promise<void> {
  await desktopClipboard.writeText(code)
}
