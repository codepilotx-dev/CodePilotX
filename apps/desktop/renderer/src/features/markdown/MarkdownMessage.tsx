import React, { useMemo } from 'react'
import type { Token, Tokens } from 'marked'
import { Check, Code2, Copy, FileText, FolderOpen } from 'lucide-react'
import type { DesktopExternalOpenTarget } from '../../../shared/types.js'
import {
  AppContextMenu,
  type AppContextMenuAction,
} from '../../components/ui/AppContextMenu.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import {
  loadExternalOpenTargets,
  openPathWithExternalTarget,
  openPathWithPreferredExternalTarget,
  prefetchExternalOpenTargets,
} from '../../services/externalOpenTargetsStore.js'
import { cx } from '../../utils/cx.js'
import { FileTypeIcon } from '../layout/FileTypeIcon.js'
import { CodeBlock } from '../syntax/index.js'
import {
  DEFAULT_MARKDOWN_DIRECTIVES,
  normalizeDirectiveName,
} from './directives.js'
import { MathRenderer } from './MathRenderer.js'
import { MermaidRenderer } from './MermaidRenderer.js'
import { LazyRender } from './LazyRender.js'
import { parseMarkdown } from './parser.js'
import { renderSafeHtml } from './safeHtml.js'
import {
  classifyMarkdownTarget,
  isLikelyFileReference,
  isSafeHttpsMediaSource,
  mediaKindForUrl,
  parseMarkdownFileReference,
} from './safeTargets.js'
import type {
  MarkdownDirectiveRegistry,
  MarkdownExternalResourcePolicy,
  MarkdownFileOpenOptions,
  MarkdownFileReference,
  MarkdownDirectiveToken,
  MarkdownMathToken,
  MarkdownStreamingCodeToken,
  MarkdownToken,
} from './types.js'

export type MarkdownMessageProps = {
  allowBasicHtml?: boolean
  allowWideBlocks?: boolean
  cwd?: string | null
  directives?: MarkdownDirectiveRegistry
  directiveRegistry?: MarkdownDirectiveRegistry
  externalResourcePolicy?: MarkdownExternalResourcePolicy
  onOpenFileReference?: (
    reference: MarkdownFileReference,
    options: MarkdownFileOpenOptions,
  ) => void
  canCopyFileReferenceContents?: (
    reference: MarkdownFileReference,
  ) => boolean
  onCopyFileReferenceContents?: (
    reference: MarkdownFileReference,
  ) => void | Promise<void>
  streaming?: boolean
  streamingChunks?: readonly string[]
  text: string
}

type RenderContext = {
  allowBasicHtml: boolean
  allowWideBlocks: boolean
  cwd: string | null
  directives: MarkdownDirectiveRegistry
  externalResourcePolicy: Required<MarkdownExternalResourcePolicy>
  onOpenFileReference:
    | ((
        reference: MarkdownFileReference,
        options: MarkdownFileOpenOptions,
      ) => void)
    | undefined
  canCopyFileReferenceContents:
    | ((reference: MarkdownFileReference) => boolean)
    | undefined
  onCopyFileReferenceContents:
    | ((reference: MarkdownFileReference) => void | Promise<void>)
    | undefined
  streaming: boolean
}

export function MarkdownMessage({
  allowBasicHtml = false,
  allowWideBlocks = true,
  cwd = null,
  directives,
  directiveRegistry,
  externalResourcePolicy,
  canCopyFileReferenceContents,
  onCopyFileReferenceContents,
  onOpenFileReference,
  streaming = false,
  streamingChunks,
  text,
}: MarkdownMessageProps): React.ReactNode {
  const sourceText = streamingChunks?.join('') ?? text
  const parsed = useMemo(
    () => parseMarkdown(sourceText, streaming),
    [sourceText, streaming],
  )
  const context = useMemo<RenderContext>(
    () => ({
      allowBasicHtml,
      allowWideBlocks,
      cwd,
      directives:
        directives ?? directiveRegistry ?? DEFAULT_MARKDOWN_DIRECTIVES,
      externalResourcePolicy: {
        allowExternalLinks:
          externalResourcePolicy?.allowExternalLinks ?? true,
        allowRemoteMedia:
          externalResourcePolicy?.allowRemoteMedia ?? true,
      },
      canCopyFileReferenceContents,
      onCopyFileReferenceContents,
      onOpenFileReference,
      streaming,
    }),
    [
      allowWideBlocks,
      allowBasicHtml,
      cwd,
      directiveRegistry,
      directives,
      externalResourcePolicy?.allowExternalLinks,
      externalResourcePolicy?.allowRemoteMedia,
      canCopyFileReferenceContents,
      onCopyFileReferenceContents,
      onOpenFileReference,
      streaming,
    ],
  )
  if (parsed.tokens.length === 0) return null
  const stableTokenCount =
    streaming && parsed.pendingText
      ? parseMarkdown(parsed.stableText, false).tokens.length
      : parsed.tokens.length
  return (
    <div className={streaming ? 'md-body is-streaming' : 'md-body'}>
      {renderTokens(parsed.tokens, context, 'md', stableTokenCount)}
    </div>
  )
}

function renderTokens(
  tokens: MarkdownToken[],
  context: RenderContext,
  keyPrefix: string,
  animateFromIndex = Number.POSITIVE_INFINITY,
): React.ReactNode[] {
  const rendered: React.ReactNode[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const inlineHtml = findInlineHtmlGroup(tokens, index)
    const key = `${keyPrefix}-${stableTokenKey(tokens[index], index)}`
    if (inlineHtml) {
      const node = (
        <React.Fragment key={key}>
          {context.allowBasicHtml
            ? renderSafeHtml(inlineHtml.html, key, {
                openExternal: url => openExternal(context, url),
                openFile: path => openFile(context, path),
              })
            : inlineHtml.html}
        </React.Fragment>
      )
      rendered.push(markStreamingNode(node, index >= animateFromIndex))
      index = inlineHtml.end
      continue
    }
    rendered.push(
      markStreamingNode(
        renderToken(tokens[index], context, key),
        index >= animateFromIndex,
      ),
    )
  }
  return rendered
}

function markStreamingNode(
  node: React.ReactNode,
  streaming: boolean,
): React.ReactNode {
  if (
    !streaming ||
    !React.isValidElement<{ className?: string }>(node) ||
    node.type === React.Fragment
  ) {
    return node
  }
  const className = [node.props.className, 'md-streaming-token']
    .filter(Boolean)
    .join(' ')
  return React.cloneElement(node, { className })
}

function renderToken(
  token: MarkdownToken,
  context: RenderContext,
  key: string,
): React.ReactNode {
  if (token.type === 'math') {
    const math = token as MarkdownMathToken
    return (
      <MathRenderer
        display={math.display}
        expression={math.text}
        key={key}
      />
    )
  }
  if (token.type === 'directive') {
    return renderDirective(token as MarkdownDirectiveToken, context, key)
  }
  if (token.type === 'streaming_code') {
    const code = token as MarkdownStreamingCodeToken
    return renderCode(code.text, code.lang, true, context, key)
  }

  switch (token.type) {
    case 'space':
    case 'def':
      return null
    case 'hr':
      return <hr key={key} />
    case 'br':
      return <br key={key} />
    case 'code':
      return renderCode(token.text, token.lang, false, context, key)
    case 'blockquote':
      return (
        <blockquote key={key}>
          {renderTokens(token.tokens, context, `${key}-quote`)}
        </blockquote>
      )
    case 'heading': {
      const level = Math.max(1, Math.min(6, token.depth))
      return React.createElement(
        `h${level}`,
        { key },
        renderTokens(token.tokens, context, `${key}-heading`),
      )
    }
    case 'paragraph': {
      const media = renderMediaGrid(token.tokens, context, key)
      if (media) return media
      return (
        <p key={key}>
          {renderTokens(token.tokens, context, `${key}-paragraph`)}
        </p>
      )
    }
    case 'list': {
      const Tag = token.ordered ? 'ol' : 'ul'
      const start =
        token.ordered && typeof token.start === 'number'
          ? token.start
          : undefined
      return (
        <Tag key={key} start={start}>
          {token.items.map((item, index) =>
            renderListItem(item, context, `${key}-item-${index}`),
          )}
        </Tag>
      )
    }
    case 'table':
      return renderTable(token as Tokens.Table, context, key)
    case 'strong':
      return (
        <strong key={key}>
          {renderTokens(token.tokens, context, `${key}-strong`)}
        </strong>
      )
    case 'em':
      return (
        <em key={key}>
          {renderTokens(token.tokens, context, `${key}-em`)}
        </em>
      )
    case 'del':
      return (
        <del key={key}>
          {renderTokens(token.tokens, context, `${key}-del`)}
        </del>
      )
    case 'codespan':
      return renderCodeSpan(token.text, context, key)
    case 'link':
      return renderLink(token as Tokens.Link, context, key)
    case 'image':
      return renderImage(token as Tokens.Image, context, key)
    case 'html':
      return (
        <React.Fragment key={key}>
          {context.allowBasicHtml
            ? renderSafeHtml(token.text, key, {
                openExternal: url => openExternal(context, url),
                openFile: path => openFile(context, path),
              })
            : token.text}
        </React.Fragment>
      )
    case 'text':
    case 'escape':
      if ('tokens' in token && Array.isArray(token.tokens)) {
        return (
          <React.Fragment key={key}>
            {renderTokens(token.tokens, context, `${key}-text`)}
          </React.Fragment>
        )
      }
      return (
        <React.Fragment key={key}>
          {renderTextWithFileReferences(token.text, context, key)}
        </React.Fragment>
      )
    case 'checkbox':
      return (
        <input
          aria-label={token.checked ? '已完成' : '未完成'}
          checked={token.checked}
          key={key}
          readOnly
          type="checkbox"
        />
      )
    default:
      return renderGenericToken(token, context, key)
  }
}

function renderCode(
  code: string,
  language: string | null | undefined,
  streaming: boolean,
  context: RenderContext,
  key: string,
): React.ReactNode {
  const normalizedLanguage = language?.trim().split(/\s+/u)[0].toLowerCase()
  if (normalizedLanguage === 'mermaid') {
    return (
      <div
        className={context.allowWideBlocks ? 'md-wide-block' : undefined}
        key={key}
      >
        <MermaidRenderer definition={code} />
      </div>
    )
  }
  return (
    <LazyRender
      fallback={
        <pre className="md-code-placeholder">
          <code>{code}</code>
        </pre>
      }
      key={key}
    >
      <CodeBlock
        code={code}
        language={normalizedLanguage}
        streaming={streaming}
      />
    </LazyRender>
  )
}

function renderDirective(
  token: MarkdownDirectiveToken,
  context: RenderContext,
  key: string,
): React.ReactNode {
  const name = normalizeDirectiveName(token.name)
  if (name === 'code-comment') {
    return renderCodeCommentDirective(token, context, key)
  }
  const renderer = context.directives.get(name)
  const children = renderTokens(token.tokens, context, `${key}-body`)
  if (!renderer) {
    return (
      <pre
        className="md-directive md-directive-unknown"
        data-md-directive={name}
        key={key}
      >
        <code>{token.raw}</code>
      </pre>
    )
  }
  return (
    <React.Fragment key={key}>
      {renderer({
        argument: token.argument,
        attributes: token.attributes,
        children,
        name,
        rawText: token.text,
      })}
    </React.Fragment>
  )
}

function renderCodeCommentDirective(
  token: MarkdownDirectiveToken,
  context: RenderContext,
  key: string,
): React.ReactNode {
  const { attributes } = token
  const file = attributes.file?.trim()
  const start = positiveInteger(attributes.start)
  const end = positiveInteger(attributes.end)
  const title = attributes.title?.trim() || '代码审查发现'
  const body = attributes.body?.trim() || token.argument || token.text
  const priority = positiveInteger(attributes.priority)
  const open = (): void => {
    if (!file || !context.onOpenFileReference) return
    context.onOpenFileReference(
      {
        path: file,
        ...(start ? { line: start } : {}),
        ...(end ? { endLine: end } : {}),
      },
      { preview: false },
    )
  }
  return (
    <aside
      className="md-directive md-code-comment"
      data-md-directive="code-comment"
      data-priority={priority ?? undefined}
      key={key}
    >
      <button
        className="md-code-comment__target"
        disabled={!file || !context.onOpenFileReference}
        type="button"
        onClick={open}
      >
        <strong>{title}</strong>
        {file ? (
          <code>
            {file}
            {start ? `:${start}` : ''}
          </code>
        ) : null}
      </button>
      {body ? <p>{body}</p> : null}
    </aside>
  )
}

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function renderListItem(
  item: Tokens.ListItem,
  context: RenderContext,
  key: string,
): React.ReactNode {
  return (
    <li key={key}>
      {item.task ? (
        <input
          aria-label={item.checked ? '已完成' : '未完成'}
          checked={Boolean(item.checked)}
          readOnly
          type="checkbox"
        />
      ) : null}
      {renderTokens(item.tokens, context, `${key}-content`)}
    </li>
  )
}

function renderTable(
  table: Tokens.Table,
  context: RenderContext,
  key: string,
): React.ReactNode {
  return (
    <MarkdownTable
      context={context}
      key={key}
      source={table.raw}
      table={table}
    />
  )
}

function MarkdownTable({
  context,
  source,
  table,
}: {
  context: RenderContext
  source: string
  table: Tokens.Table
}): React.ReactNode {
  const [copied, setCopied] = React.useState(false)
  const html = tableToHtml(table)

  async function copyTable(): Promise<void> {
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([source], { type: 'text/plain' }),
          }),
        ])
      } else {
        await navigator.clipboard?.writeText(source)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <figure
      className={cx(
        'md-table-block',
        'md-code-block',
        'tw:mx-0',
        'tw:my-3',
        'tw:w-full',
        'tw:max-w-full',
        'tw:overflow-hidden',
        'tw:rounded-lg',
      )}
    >
      <figcaption className="md-table-toolbar md-code-header tw:flex tw:h-8 tw:items-center tw:justify-between tw:px-2 tw:text-base tw:text-app-text-soft">
        <span className="md-code-lang tw:font-mono">table</span>
        <span className="md-code-actions tw:flex tw:items-center">
          <button
            aria-label={copied ? '已复制' : '复制表格'}
            className={cx(
              'md-code-action md-code-copy',
              copied && 'is-copied',
              'tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-app-text-soft tw:transition-colors tw:duration-[120ms] tw:hover:bg-app-raised tw:hover:text-app-text tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent',
            )}
            title={copied ? '已复制' : '复制表格'}
            type="button"
            onClick={() => void copyTable()}
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
      <div className="md-table-scroll">
        <table>
          <thead>
            <tr>
              {table.header.map((cell, index) =>
                renderTableCell(cell, context, `table-head-${index}`, true),
              )}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={`table-row-${rowIndex}`}>
                {row.map((cell, cellIndex) =>
                  renderTableCell(
                    cell,
                    context,
                    `table-cell-${rowIndex}-${cellIndex}`,
                    false,
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

function renderTableCell(
  cell: Tokens.TableCell,
  context: RenderContext,
  key: string,
  heading: boolean,
): React.ReactNode {
  const Tag = heading ? 'th' : 'td'
  return (
    <Tag key={key} style={cell.align ? { textAlign: cell.align } : undefined}>
      {renderTokens(cell.tokens, context, `${key}-content`)}
    </Tag>
  )
}

function renderLink(
  link: Tokens.Link,
  context: RenderContext,
  key: string,
): React.ReactNode {
  const children = renderTokens(link.tokens, context, `${key}-label`)
  const target = classifyMarkdownTarget(link.href)
  if (target.kind === 'external') {
    if (!context.externalResourcePolicy.allowExternalLinks) {
      return <React.Fragment key={key}>{children}</React.Fragment>
    }
    return (
      <a
        href={target.url}
        key={key}
        onClick={event => {
          event.preventDefault()
          openExternal(context, target.url)
        }}
        rel="noopener noreferrer"
        title={link.title ?? undefined}
      >
        {children}
      </a>
    )
  }
  if (target.kind === 'file') {
    return (
      <FileReferenceButton
        className="md-file-reference"
        context={context}
        key={key}
        reference={target}
        title={link.title ?? target.path}
      >
        {children}
      </FileReferenceButton>
    )
  }
  if (target.kind === 'anchor') {
    return (
      <a href={target.href} key={key} title={link.title ?? undefined}>
        {children}
      </a>
    )
  }
  return <React.Fragment key={key}>{children}</React.Fragment>
}

function renderImage(
  image: Tokens.Image,
  context: RenderContext,
  key: string,
): React.ReactNode {
  if (
    !context.externalResourcePolicy.allowRemoteMedia ||
    !isSafeHttpsMediaSource(image.href)
  ) {
    return <React.Fragment key={key}>{image.text}</React.Fragment>
  }
  return (
    <RemoteMedia
      alt={image.text}
      key={key}
      kind="image"
      src={image.href}
      title={image.title ?? undefined}
    />
  )
}

function renderCodeSpan(
  text: string,
  context: RenderContext,
  key: string,
): React.ReactNode {
  if (!isLikelyFileReference(text)) return <code key={key}>{text}</code>
  const target = classifyMarkdownTarget(text)
  if (target.kind !== 'file') return <code key={key}>{text}</code>
  return (
    <FileReferenceButton
      className="md-file-reference md-file-reference-inline"
      context={context}
      key={key}
      reference={target}
      title={target.path}
    >
      {text}
    </FileReferenceButton>
  )
}

function renderMediaGrid(
  tokens: Token[],
  context: RenderContext,
  key: string,
): React.ReactNode | null {
  const meaningful = tokens.filter(token => !isMediaSeparator(token))
  if (
    !context.externalResourcePolicy.allowRemoteMedia ||
    meaningful.length === 0 ||
    !meaningful.every(token => mediaSourceForToken(token) !== null)
  ) {
    return null
  }
  return (
    <div
      className={`md-media-grid${context.allowWideBlocks ? ' md-wide-block' : ''}`}
      key={key}
    >
      {meaningful.map((token, index) =>
        renderMediaToken(token, context, `${key}-media-${index}`),
      )}
    </div>
  )
}

function renderMediaToken(
  token: Token,
  context: RenderContext,
  key: string,
): React.ReactNode {
  const media = mediaSourceForToken(token)
  if (!media) return renderToken(token, context, key)
  if (media.kind === 'image') {
    const alt = token.type === 'image' ? token.text : ''
    return (
      <RemoteMedia
        alt={alt}
        key={key}
        kind="image"
        src={media.source}
      />
    )
  }
  if (media.kind === 'audio') {
    return <RemoteMedia key={key} kind="audio" src={media.source} />
  }
  return <RemoteMedia key={key} kind="video" src={media.source} />
}

function mediaSourceForToken(
  token: Token,
): { kind: 'audio' | 'image' | 'video'; source: string } | null {
  if (token.type === 'image') {
    if (!isSafeHttpsMediaSource(token.href)) return null
    return { kind: 'image', source: token.href }
  }
  if (token.type !== 'link') return null
  const kind = mediaKindForUrl(token.href)
  return kind ? { kind, source: token.href } : null
}

function isMediaSeparator(token: Token): boolean {
  return (
    token.type === 'br' ||
    (token.type === 'text' && token.text.trim().length === 0)
  )
}

function renderGenericToken(
  token: MarkdownToken,
  context: RenderContext,
  key: string,
): React.ReactNode {
  if ('tokens' in token && Array.isArray(token.tokens)) {
    return (
      <React.Fragment key={key}>
        {renderTokens(token.tokens, context, `${key}-generic`)}
      </React.Fragment>
    )
  }
  if ('text' in token && typeof token.text === 'string') {
    return <React.Fragment key={key}>{token.text}</React.Fragment>
  }
  return null
}

function findInlineHtmlGroup(
  tokens: MarkdownToken[],
  start: number,
): { end: number; html: string } | null {
  const first = tokens[start]
  if (first?.type !== 'html' || first.block) return null
  const opening = /^<\s*([a-zA-Z][\w-]*)(?:\s[^>]*)?>$/u.exec(first.raw)
  if (!opening || first.raw.endsWith('/>')) return null
  const tag = opening[1].toLowerCase()
  let depth = 1
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type === 'html' && !token.block) {
      if (new RegExp(`^<\\s*${escapeRegExp(tag)}(?:\\s[^>]*)?>$`, 'iu').test(token.raw)) {
        depth += 1
      } else if (
        new RegExp(`^<\\s*\\/\\s*${escapeRegExp(tag)}\\s*>$`, 'iu').test(
          token.raw,
        )
      ) {
        depth -= 1
      }
    }
    if (depth === 0) {
      return {
        end: index,
        html: tokens
          .slice(start, index + 1)
          .map(part => part.raw)
          .join(''),
      }
    }
  }
  return null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function stableTokenKey(token: MarkdownToken | undefined, index: number): string {
  if (!token) return String(index)
  const source =
    typeof token.raw === 'string'
      ? token.raw
      : 'text' in token && typeof token.text === 'string'
        ? token.text
        : ''
  let hash = 2_166_136_261
  for (let offset = 0; offset < source.length; offset += 1) {
    hash ^= source.charCodeAt(offset)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${token.type}-${index}-${(hash >>> 0).toString(36)}`
}

function renderTextWithFileReferences(
  text: string,
  context: RenderContext,
  key: string,
): React.ReactNode {
  const pattern = /【([^†】]+)†(L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)】/gu
  const parts: React.ReactNode[] = []
  let cursor = 0
  let matchIndex = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index))
    }
    const label = match[0]
    const reference = parseMarkdownFileReference(
      `${match[1]}#${match[2]}`,
    )
    parts.push(
      <FileReferenceButton
        className="md-file-reference md-file-reference-inline"
        context={context}
        key={`${key}-file-${matchIndex}`}
        reference={reference}
        title={reference.path}
      >
        {label}
      </FileReferenceButton>,
    )
    cursor = match.index + label.length
    matchIndex += 1
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts.length > 0 ? parts : text
}

function tableToHtml(table: Tokens.Table): string {
  const header = table.header
    .map(cell => `<th>${escapeHtml(tableCellText(cell))}</th>`)
    .join('')
  const rows = table.rows
    .map(
      row =>
        `<tr>${row
          .map(cell => `<td>${escapeHtml(tableCellText(cell))}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
}

function tableCellText(cell: Tokens.TableCell): string {
  return cell.tokens.map(tokenText).join('')
}

function tokenText(token: Token): string {
  if ('tokens' in token && Array.isArray(token.tokens)) {
    return token.tokens.map(tokenText).join('')
  }
  return 'text' in token && typeof token.text === 'string' ? token.text : ''
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function RemoteMedia({
  alt = '',
  kind,
  src,
  title,
}: {
  alt?: string
  kind: 'audio' | 'image' | 'video'
  src: string
  title?: string
}): React.ReactNode {
  const [failed, setFailed] = React.useState(false)
  const fallback = (
    <span className="md-media-placeholder" role="status">
      {failed ? `无法加载媒体：${alt || src}` : alt || '正在加载媒体'}
    </span>
  )
  if (failed) return fallback
  return (
    <LazyRender fallback={fallback}>
      {kind === 'image' ? (
        <img
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          src={src}
          title={title}
        />
      ) : kind === 'audio' ? (
        <audio
          controls
          onError={() => setFailed(true)}
          preload="metadata"
          src={src}
        />
      ) : (
        <video
          controls
          onError={() => setFailed(true)}
          preload="metadata"
          src={src}
        />
      )}
    </LazyRender>
  )
}

function resolveWorkspacePath(cwd: string | null, path: string): string | null {
  const value = path.trim()
  if (!value) return null
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u.test(value)) return value
  if (!cwd?.trim()) return null
  const separator = cwd.includes('\\') ? '\\' : '/'
  return `${cwd.replace(/[\\/]+$/u, '')}${separator}${value.replace(/^[.][\\/]/u, '')}`
}

function openExternal(context: RenderContext, url: string): void {
  if (!context.externalResourcePolicy.allowExternalLinks) return
  void desktopClient.openExternalURL(url).catch(() => undefined)
}

function openFile(context: RenderContext, path: string): void {
  const target = resolveWorkspacePath(context.cwd, path)
  if (!target) return
  void openPathWithPreferredExternalTarget(target).catch(() => undefined)
}

function FileReferenceButton({
  children,
  className,
  context,
  reference,
  title,
}: {
  children: React.ReactNode
  className: string
  context: RenderContext
  reference: MarkdownFileReference
  title: string
}): React.ReactNode {
  const absolutePath = resolveWorkspacePath(context.cwd, reference.path)
  const [openTargets, setOpenTargets] = React.useState<
    DesktopExternalOpenTarget[]
  >([])
  const [loadingTargets, setLoadingTargets] = React.useState(false)
  const canCopyContents =
    context.canCopyFileReferenceContents?.(reference) ?? false

  const prefetch = (): void => {
    if (!absolutePath) return
    void prefetchExternalOpenTargets(absolutePath).catch(() => undefined)
  }
  const loadTargets = (): void => {
    if (!absolutePath) return
    setLoadingTargets(true)
    void loadExternalOpenTargets(absolutePath)
      .then(setOpenTargets)
      .catch(() => setOpenTargets([]))
      .finally(() => setLoadingTargets(false))
  }
  const open = (preview: boolean): void => {
    if (context.onOpenFileReference) {
      context.onOpenFileReference(reference, { preview })
      return
    }
    openFile(context, reference.path)
  }
  const openWithTarget = (targetId: string): void => {
    if (!absolutePath) return
    void openPathWithExternalTarget(absolutePath, targetId)
      .then(selected => {
        setOpenTargets(current =>
          current.map(target => ({
            ...target,
            preferred: target.id === selected.id,
          })),
        )
      })
      .catch(() => undefined)
  }
  const preferredTarget =
    openTargets.find(target => target.preferred) ?? openTargets[0]
  const targetActions: AppContextMenuAction[] = loadingTargets &&
    openTargets.length === 0
    ? [
        {
          kind: 'item',
          label: '正在查找打开方式…',
          disabled: true,
          onSelect: () => undefined,
        },
      ]
    : openTargets.length > 0
      ? [
          {
            kind: 'item',
            label: `使用 ${preferredTarget?.label ?? '首选应用'} 打开`,
            icon: openTargetIcon(preferredTarget),
            onSelect: () => {
              if (preferredTarget) openWithTarget(preferredTarget.id)
            },
          },
          {
            kind: 'sub',
            label: '打开方式',
            icon: (
              <Code2
                aria-hidden="true"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            ),
            children: openTargets.map(target => ({
              kind: 'item' as const,
              label: target.label,
              icon: openTargetIcon(target),
              onSelect: () => openWithTarget(target.id),
            })),
          },
        ]
      : [
          {
            kind: 'item',
            label: '没有可用的外部应用',
            disabled: true,
            onSelect: () => undefined,
          },
        ]
  const actions: AppContextMenuAction[] = [
    ...targetActions,
    { kind: 'separator' },
    {
      kind: 'item',
      label: '复制路径',
      icon: (
        <Copy
          aria-hidden="true"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      ),
      onSelect: () => {
        void navigator.clipboard
          .writeText(absolutePath ?? reference.path)
          .catch(() => undefined)
      },
    },
    {
      kind: 'item',
      label: '复制文件内容',
      disabled: !canCopyContents || !context.onCopyFileReferenceContents,
      icon: (
        <FileText
          aria-hidden="true"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      ),
      onSelect: () => {
        try {
          void Promise.resolve(
            context.onCopyFileReferenceContents?.(reference),
          ).catch(() => undefined)
        } catch {
          // The workspace handler reports copy failures through the app error UI.
        }
      },
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '在文件资源管理器中显示',
      disabled: !absolutePath,
      icon: (
        <FolderOpen
          aria-hidden="true"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      ),
      onSelect: () => {
        if (!absolutePath) return
        void desktopClient
          .revealPathInFolder(absolutePath)
          .catch(() => undefined)
      },
    },
  ]
  return (
    <AppContextMenu
      actions={actions}
      onOpenChange={open => {
        if (open) loadTargets()
      }}
      trigger={
        <span
          aria-label={`打开文件 ${reference.path}`}
          className={className}
          data-file-reference=""
          onClick={event => {
            if (event.detail > 1) return
            if (event.ctrlKey || event.altKey) {
              openFile(context, reference.path)
              return
            }
            open(true)
          }}
          onDoubleClick={event => {
            if (event.ctrlKey || event.altKey || !canCopyContents) return
            open(false)
          }}
          onFocus={prefetch}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            open(true)
          }}
          onMouseEnter={prefetch}
          onPointerDown={prefetch}
          role="button"
          tabIndex={0}
          title={title}
        >
          <span className="md-file-reference__content">
            <span aria-hidden="true" className="md-file-reference__icon">
              <FileTypeIcon
                path={reference.path}
                size={16}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </span>
            <span className="md-file-reference__label">{children}</span>
          </span>
        </span>
      }
      width={240}
    />
  )
}

function openTargetIcon(
  target: DesktopExternalOpenTarget | undefined,
): React.ReactNode {
  if (target?.iconDataUrl) {
    return (
      <img
        alt=""
        className="md-file-reference__target-icon"
        src={target.iconDataUrl}
      />
    )
  }
  return (
    <Code2
      aria-hidden="true"
      size={APP_ICON_SIZE}
      strokeWidth={APP_ICON_STROKE_WIDTH}
    />
  )
}
