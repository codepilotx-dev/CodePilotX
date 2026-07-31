import { useEffect, useRef, useState } from 'react'

import {
  highlightCode,
  peekHighlightedCode,
  presentHighlightedCode,
} from './highlighter.js'
import { normalizeSyntaxLanguage } from './language.js'
import type {
  SyntaxHighlightPresentation,
  SyntaxHighlightResult,
} from './types.js'

export const STREAMING_HIGHLIGHT_INTERVAL_MS = 120

type UseHighlightedCodeOptions = {
  code: string
  language?: string | null
  streaming?: boolean
  theme: string
}

export function useHighlightedCode({
  code,
  language,
  streaming = false,
  theme,
}: UseHighlightedCodeOptions): SyntaxHighlightPresentation {
  const requestedLanguage = normalizeSyntaxLanguage(language)
  const requestedTheme = theme.trim()
  const [result, setResult] = useState<SyntaxHighlightResult | null>(() => {
    return (
      peekHighlightedCode({
        code,
        language: requestedLanguage,
        theme: requestedTheme,
      }) ?? null
    )
  })
  const requestGenerationRef = useRef(0)
  const lastStreamingRequestAtRef = useRef(0)

  useEffect(() => {
    const requestGeneration = ++requestGenerationRef.current
    const cached = peekHighlightedCode({
      code,
      language: requestedLanguage,
      theme: requestedTheme,
    })
    if (cached) {
      setResult(cached)
      return
    }

    const now = Date.now()
    const delay = streaming
      ? Math.max(
          0,
          STREAMING_HIGHLIGHT_INTERVAL_MS -
            (now - lastStreamingRequestAtRef.current),
        )
      : 0

    const timeout = window.setTimeout(() => {
      if (streaming) lastStreamingRequestAtRef.current = Date.now()
      void highlightCode({
        code,
        language: requestedLanguage,
        streaming,
        theme: requestedTheme,
      }).then(nextResult => {
        if (requestGenerationRef.current === requestGeneration) {
          setResult(nextResult)
        }
      })
    }, delay)

    return () => window.clearTimeout(timeout)
  }, [code, requestedLanguage, requestedTheme, streaming])

  return presentHighlightedCode(
    result,
    code,
    requestedLanguage,
    requestedTheme,
  )
}
