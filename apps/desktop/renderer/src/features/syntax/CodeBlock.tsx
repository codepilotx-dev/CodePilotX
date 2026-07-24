import type { CSSProperties, ReactNode } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { cx } from '../../utils/cx.js'
import { useDesktopTheme } from '../theme/themeContext.js'
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
}

export function CodeBlock({
  ariaLabel,
  className,
  code,
  language,
  streaming = false,
}: CodeBlockProps): ReactNode {
  const { activeTheme, codeThemeId } = useDesktopTheme()
  const resolvedTheme = resolveThemeId(codeThemeId, activeTheme.variant)
  const presentation = useHighlightedCode({
    code,
    language,
    streaming,
    theme: resolvedTheme,
  })
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const highlightedLanguage =
    presentation.highlighted?.language ?? normalizeSyntaxLanguage(language)
  const languageLabel = formatSyntaxLanguageLabel(highlightedLanguage)

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

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
  const surfaceStyle: CSSProperties = presentation.highlighted?.background
    ? { backgroundColor: presentation.highlighted.background }
    : {}

  return (
    <figure
      aria-label={ariaLabel ?? `${languageLabel} 代码块`}
      className={cx(
        'md-code-block',
        'tw:mx-0',
        'tw:my-3',
        'tw:w-full',
        'tw:max-w-full',
        'tw:overflow-hidden',
        'tw:rounded-lg',
        className,
      )}
      style={surfaceStyle}
    >
      <figcaption className="md-code-header tw:flex tw:h-8 tw:items-center tw:justify-between tw:px-2 tw:text-base tw:text-app-text-soft">
        <span className="md-code-lang tw:font-mono">
          {languageLabel}
        </span>
        <span className="md-code-actions tw:flex tw:items-center">
          <button
            aria-label={copied ? '已复制代码' : '复制代码'}
            className={cx(
              'md-code-action md-code-copy',
              copied && 'is-copied',
              'tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-app-text-soft tw:transition-colors tw:duration-[120ms] tw:hover:bg-app-raised tw:hover:text-app-text tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent',
            )}
            title={copied ? '已复制' : '复制代码'}
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
          </button>
        </span>
      </figcaption>
      <pre
        className={cx(
          'md-code-pre',
          'tw:m-0',
          'tw:max-w-full',
          'tw:px-3',
          'tw:py-2',
          'tw:font-mono',
          'tw:text-sm',
          'tw:leading-5',
          'tw:overflow-x-auto',
          'tw:whitespace-pre',
        )}
      >
        <code className="md-code-content" style={codeStyle}>
          <HighlightedTokens result={presentation.highlighted} />
          {presentation.plainText}
        </code>
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
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(code)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = code
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Copy is unavailable.')
}
