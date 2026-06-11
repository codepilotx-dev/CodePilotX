import React, { useMemo } from 'react'
import { marked } from 'marked'
import xssLib from 'xss'
import hljs from 'highlight.js/lib/common'

// 初始化 marked：GFM 表格、删除线、自动识别围栏代码块语言、走 highlight.js。
// 注意 marked.parse 在 v18 默认是异步友好的，这里强制同步返回字符串。
const renderer = new marked.Renderer()
const originalCode = renderer.code.bind(renderer)
renderer.code = function (token: marked.Tokens.Code): string {
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
  return [
    '<div class="md-code-block">',
    `<div class="md-code-header"><span class="md-code-lang">${langLabel}</span></div>`,
    `<pre class="md-code-pre"><code class="hljs language-${escapeAttr(
      detectedLang,
    )}">${highlighted}</code></pre>`,
    '</div>',
  ].join('')
}

marked.setOptions({
  gfm: true,
  breaks: false,
  async: false,
  renderer,
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
}

export function MarkdownMessage({ text, streaming = false }: Props): React.ReactNode {
  const html = useMemo(() => renderMarkdown(text, streaming), [text, streaming])

  if (!html) return null

  return (
    <div
      className="md-body"
      // 已经过 xss 白名单清洗
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function renderMarkdown(rawText: string, streaming: boolean): string {
  const safeText = rawText ?? ''
  // 流式时如果末尾还有未闭合的围栏代码块，截掉那一段，避免渲染半截 fence 触发解析错乱
  const textToRender = streaming ? clipUnclosedFence(safeText) : safeText
  if (!textToRender.trim()) return ''

  try {
    const parsed = marked.parse(textToRender, { async: false }) as string
    // 强制 a 标签 target=_blank rel=noopener
    const withSafeLinks = parsed.replace(
      /<a\s/gi,
      '<a target="_blank" rel="noopener noreferrer" ',
    )
    return xssLib(withSafeLinks, XSS_OPTIONS)
  } catch {
    return xssLib(escapeHtml(textToRender), XSS_OPTIONS)
  }
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
