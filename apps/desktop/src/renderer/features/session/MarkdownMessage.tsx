import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import xssLib from 'xss'
import hljs from 'highlight.js/lib/common'
import '../../styles/markdown.scss'

const MD_CODE_COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>'
const MD_CODE_COPY_DONE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>'

function createMarkdownRenderer(
  markerPrefix: string,
  trustedCopyControls: Array<{ marker: string; html: string }>,
) {
  const renderer = new marked.Renderer()
  renderer.code = function (token: { lang?: string | null; text: string }): string {
    const rawLang = (token.lang ?? '').trim().split(/\s+/)[0] ?? ''
    let highlighted = token.text
    let detectedLang = rawLang
    try {
      if (rawLang && hljs.getLanguage(rawLang)) {
        highlighted = hljs.highlight(token.text, { language: rawLang }).value
      } else {
        const auto = hljs.highlightAuto(token.text)
        highlighted = auto.value
        detectedLang = auto.language ?? rawLang
      }
    } catch {
      highlighted = escapeHtml(token.text)
    }
    const langLabel = detectedLang ? detectedLang.toUpperCase() : 'TEXT'
    const safeCode = token.text.replace(/<\//g, '<\\/')
    const marker = `${markerPrefix}-${trustedCopyControls.length}__`
    trustedCopyControls.push({
      marker,
      html: [
        `<button type="button" class="md-code-copy" data-md-copy data-md-code-text="${escapeAttr(
          safeCode,
        )}" aria-label="复制代码">`,
        `<span class="md-code-copy-default">${MD_CODE_COPY_ICON}</span>`,
        `<span class="md-code-copy-done">${MD_CODE_COPY_DONE_ICON}</span>`,
        '</button>',
      ].join(''),
    })
    return [
      '<div class="md-code-block" data-md-code>',
      '<div class="md-code-header">',
      `<span class="md-code-lang">${langLabel}</span>`,
      marker,
      '</div>',
      `<pre class="md-code-pre"><code class="hljs language-${escapeAttr(
        detectedLang,
      )}">${highlighted}</code></pre>`,
      '</div>',
    ].join('')
  }
  return renderer
}

marked.setOptions({
  gfm: true,
  breaks: false,
  async: false,
})

const XSS_OPTIONS = {
  whiteList: {
    a: ['href', 'title', 'target', 'rel'],
    b: [],
    strong: [],
    em: [],
    i: [],
    u: [],
    s: [],
    del: [],
    code: ['class'],
    span: ['class'],
    pre: ['class'],
    div: ['class'],
    h1: ['id'],
    h2: ['id'],
    h3: ['id'],
    h4: ['id'],
    h5: ['id'],
    h6: ['id'],
    p: [],
    br: [],
    ul: [],
    ol: ['start'],
    li: [],
    blockquote: [],
    table: [],
    thead: [],
    tbody: [],
    tr: [],
    th: [],
    td: [],
    hr: [],
    img: ['src', 'alt', 'title'],
    svg: [
      'aria-hidden',
      'class',
      'fill',
      'focusable',
      'height',
      'role',
      'stroke',
      'stroke-linecap',
      'stroke-linejoin',
      'stroke-width',
      'viewBox',
      'viewbox',
      'width',
      'xmlns',
    ],
    path: ['d'],
    rect: ['height', 'rx', 'ry', 'width', 'x', 'y'],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
  cssWhiteList: {
    'color': true,
    'background-color': true,
    'font-weight': true,
  },
  safeAttr: (tag: string, name: string, value: string): string => {
    if (tag === 'a' && name === 'href') {
      if (/^javascript:/i.test(value)) return ''
      return value
    }
    return value
  },
}

type Props = {
  text: string
  streaming?: boolean
  streamingChunks?: string[]
}

export function MarkdownMessage({
  text,
  streaming = false,
  streamingChunks,
}: Props): React.ReactNode {
  if (streaming && streamingChunks) {
    return <StreamingText chunks={streamingChunks} />
  }
  return <RenderedMarkdown text={text} streaming={streaming} />
}

function StreamingText({ chunks }: { chunks: string[] }): React.ReactNode {
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const stateRef = useRef({ chunks, processed: 0, node: null as Text | null })
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (stateRef.current.chunks !== chunks) {
      stateRef.current = { chunks, processed: 0, node: null }
      host.textContent = ''
    }
    if (!stateRef.current.node) {
      stateRef.current.node = document.createTextNode('')
      host.appendChild(stateRef.current.node)
    }
    appendStreamingText(stateRef.current.node, chunks, stateRef.current)
  })
  return <span className="markdown-stream-chunks" ref={hostRef} />
}

export function appendStreamingText(
  node: Pick<CharacterData, 'appendData'>,
  chunks: string[],
  state: { processed: number },
): void {
  if (state.processed >= chunks.length) return
  node.appendData(chunks.slice(state.processed).join(''))
  state.processed = chunks.length
}

function RenderedMarkdown({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}): React.ReactNode {
  const html = useMemo(() => renderMarkdown(text, streaming), [text, streaming])
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    function handleClick(event: MouseEvent): void {
      const target = event.target
      if (!(target instanceof Element)) return
      const button = target.closest<HTMLButtonElement>('[data-md-copy]')
      if (!button) return
      const code = button.getAttribute('data-md-code-text') ?? ''
      void navigator.clipboard
        ?.writeText(code)
        .then(() => {
          button.classList.add('is-copied')
          window.setTimeout(() => {
            button.classList.remove('is-copied')
          }, 1500)
        })
        .catch(() => undefined)
    }
    root.addEventListener('click', handleClick)
    return () => {
      root.removeEventListener('click', handleClick)
    }
  }, [html])

  if (!html) return null

  return (
    <div
      className="md-body"
      // 已经过 xss 白名单清洗
      dangerouslySetInnerHTML={{ __html: html }}
      ref={bodyRef}
    />
  )
}

export function renderMarkdown(rawText: string, streaming: boolean): string {
  const safeText = rawText ?? ''
  // 流式时如果末尾还有未闭合的围栏代码块，截掉那一段，避免渲染半截 fence 触发解析错乱
  const textToRender = streaming ? clipUnclosedFence(safeText) : safeText
  if (!textToRender.trim()) return ''

  try {
    const trustedCopyControls: Array<{ marker: string; html: string }> = []
    const markerPrefix = createTrustedMarkerPrefix(textToRender)
    const renderer = createMarkdownRenderer(markerPrefix, trustedCopyControls)
    const parsed = marked.parse(textToRender, { async: false, renderer }) as string
    // 强制 a 标签 target=_blank rel=noopener
    const withSafeLinks = parsed.replace(
      /<a\s/gi,
      '<a target="_blank" rel="noopener noreferrer" ',
    )
    let sanitized = xssLib(withSafeLinks, XSS_OPTIONS)
    for (const control of trustedCopyControls) {
      sanitized = sanitized.replace(control.marker, () => control.html)
    }
    return sanitized
  } catch {
    return xssLib(escapeHtml(textToRender), XSS_OPTIONS)
  }
}

function createTrustedMarkerPrefix(rawText: string): string {
  let marker = ''
  do {
    const entropy = new Uint32Array(4)
    globalThis.crypto.getRandomValues(entropy)
    marker = `__CPX_TRUSTED_COPY_${Array.from(entropy, value =>
      value.toString(36),
    ).join('_')}`
  } while (rawText.includes(marker))
  return marker
}

// 统计 ``` 出现次数；奇数次表示当前在代码块内
function clipUnclosedFence(text: string): string {
  const matches = text.match(/```/g)
  if (!matches || matches.length % 2 === 0) return text
  const lastIndex = text.lastIndexOf('```')
  return text.slice(0, lastIndex)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text)
}
