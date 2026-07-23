import { syntaxTree } from '@codemirror/language'
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MermaidRenderer } from '../markdown/MermaidRenderer.js'

type RichDecorationSets = {
  atomic: DecorationSet
  decorations: DecorationSet
}

type MarkdownSyntaxNode = {
  readonly from: number
  readonly name: string
  readonly parent: MarkdownSyntaxNode | null
  readonly to: number
  getChild(name: string): MarkdownSyntaxNode | null
  getChildren(name: string): MarkdownSyntaxNode[]
}

const hiddenMarker = Decoration.replace({})
const setRichDecorationSets = StateEffect.define<RichDecorationSets>()
const richDecorationField = StateField.define<RichDecorationSets>({
  create: () => ({
    atomic: Decoration.none,
    decorations: Decoration.none,
  }),
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setRichDecorationSets)) {
        return effect.value
      }
    }
    return value
  },
  provide: field => [
    EditorView.decorations.from(field, value => value.decorations),
    EditorView.atomicRanges.of(view => view.state.field(field).atomic),
  ],
})
const mermaidRoots = new WeakMap<HTMLElement, Root>()
const mermaidObservers = new WeakMap<HTMLElement, ResizeObserver>()

const headingClasses = new Map<string, string>([
  ['ATXHeading1', 'cm-md-rich-h1'],
  ['SetextHeading1', 'cm-md-rich-h1'],
  ['ATXHeading2', 'cm-md-rich-h2'],
  ['SetextHeading2', 'cm-md-rich-h2'],
  ['ATXHeading3', 'cm-md-rich-h3'],
  ['ATXHeading4', 'cm-md-rich-h4'],
  ['ATXHeading5', 'cm-md-rich-h5'],
  ['ATXHeading6', 'cm-md-rich-h6'],
])

const hiddenMarkerNames = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
])

/**
 * Presents a Markdown syntax tree as lightweight rich text without changing
 * the document or mounting executable HTML. The source marks remain available
 * whenever a selection enters their containing Markdown construct.
 */
export function createMarkdownRichExtensions(): Extension {
  return [
    EditorView.editorAttributes.of({ class: 'cm-markdown-rich' }),
    markdownRichTheme,
    richDecorationField,
    markdownRichPlugin,
  ]
}

const markdownRichPlugin = ViewPlugin.fromClass(
  class {
    private updateQueued = false

    constructor(view: EditorView) {
      this.queueUpdate(view)
    }

    update(update: ViewUpdate): void {
      const hasExternalEffect = update.transactions.some(transaction =>
        transaction.effects.some(effect => !effect.is(setRichDecorationSets)),
      )
      if (
        update.docChanged ||
        update.focusChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        hasExternalEffect ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.queueUpdate(update.view)
      }
    }

    private queueUpdate(view: EditorView): void {
      if (this.updateQueued) {
        return
      }
      this.updateQueued = true
      queueMicrotask(() => {
        this.updateQueued = false
        if (!view.dom.isConnected) {
          return
        }
        view.dispatch({
          effects: setRichDecorationSets.of(buildRichDecorations(view)),
        })
      })
    }
  },
)

function buildRichDecorations(view: EditorView): RichDecorationSets {
  const decorationRanges: Range<Decoration>[] = []
  const atomicRanges: Range<Decoration>[] = []
  const seenDecorations = new Set<string>()
  const seenAtomicRanges = new Set<string>()
  const tree = syntaxTree(view.state)

  for (const visibleRange of view.visibleRanges) {
    tree.iterate({
      from: visibleRange.from,
      to: visibleRange.to,
      enter: reference => {
        const node = reference.node as MarkdownSyntaxNode
        const headingClass = headingClasses.get(node.name)
        if (headingClass) {
          addLineDecoration(
            view.state,
            node.from,
            `cm-md-rich-heading ${headingClass}`,
            decorationRanges,
            seenDecorations,
          )
        }

        if (
          hiddenMarkerNames.has(node.name) ||
          (node.name === 'URL' && node.parent?.name === 'Link')
        ) {
          const parent = node.parent
          if (parent && !selectionEntersNode(view, parent)) {
            const key = `${node.from}:${node.to}`
            if (!seenAtomicRanges.has(key)) {
              seenAtomicRanges.add(key)
              const range = hiddenMarker.range(node.from, node.to)
              atomicRanges.push(range)
              decorationRanges.push(range)
            }
          }
          return
        }

        if (node.name === 'ListMark') {
          addListMarkDecoration(
            view,
            node,
            decorationRanges,
            atomicRanges,
            seenDecorations,
            seenAtomicRanges,
          )
          return
        }

        switch (node.name) {
          case 'Emphasis':
            addMarkDecoration(
              node,
              'cm-md-rich-emphasis',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'StrongEmphasis':
            addMarkDecoration(
              node,
              'cm-md-rich-strong',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'Strikethrough':
            addMarkDecoration(
              node,
              'cm-md-rich-strikethrough',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'InlineCode':
            addMarkDecoration(
              node,
              'cm-md-rich-inline-code',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'Link':
          case 'Autolink':
            addMarkDecoration(
              node,
              'cm-md-rich-link',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'Blockquote':
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-blockquote',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'ListItem':
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-list-item',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'HorizontalRule':
            addLineDecoration(
              view.state,
              node.from,
              'cm-md-rich-horizontal-rule',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'FencedCode':
            if (
              addMermaidDecoration(
                view,
                node,
                decorationRanges,
                atomicRanges,
                seenDecorations,
                seenAtomicRanges,
              )
            ) {
              return false
            }
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-code-block',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'CodeBlock':
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-code-block',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'Table':
            if (
              addTableDecoration(
                view,
                node,
                decorationRanges,
                atomicRanges,
                seenDecorations,
                seenAtomicRanges,
              )
            ) {
              return false
            }
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-table',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'TableHeader':
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-table-header',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'TableRow':
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-table-row',
              decorationRanges,
              seenDecorations,
            )
            break
        }
      },
    })
  }

  return {
    atomic: Decoration.set(atomicRanges, true),
    decorations: Decoration.set(decorationRanges, true),
  }
}

function addListMarkDecoration(
  view: EditorView,
  node: MarkdownSyntaxNode,
  decorationRanges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  seenDecorations: Set<string>,
  seenAtomicRanges: Set<string>,
): void {
  const parent = node.parent
  if (!parent || selectionEntersNode(view, parent)) {
    return
  }
  const source = view.state.doc.sliceString(node.from, node.to).trim()
  const label = /^\d+[.)]$/u.test(source) ? source : '•'
  const key = `list-mark:${node.from}:${node.to}:${label}`
  if (seenDecorations.has(key)) {
    return
  }
  seenDecorations.add(key)
  const decoration = Decoration.replace({
    widget: new MarkdownListMarkWidget(label),
  }).range(node.from, node.to)
  decorationRanges.push(decoration)
  if (!seenAtomicRanges.has(key)) {
    seenAtomicRanges.add(key)
    atomicRanges.push(decoration)
  }
}

class MarkdownListMarkWidget extends WidgetType {
  constructor(private readonly label: string) {
    super()
  }

  override eq(other: MarkdownListMarkWidget): boolean {
    return this.label === other.label
  }

  override toDOM(view: EditorView): HTMLElement {
    const marker = view.dom.ownerDocument.createElement('span')
    marker.className = 'cm-md-rich-list-marker'
    marker.textContent = this.label
    return marker
  }
}

function addTableDecoration(
  view: EditorView,
  node: MarkdownSyntaxNode,
  decorationRanges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  seenDecorations: Set<string>,
  seenAtomicRanges: Set<string>,
): boolean {
  if (selectionEntersNode(view, node)) {
    return false
  }
  const table = parseMarkdownTable(
    view.state.doc.sliceString(node.from, node.to),
  )
  if (!table) {
    return false
  }
  const from = view.state.doc.lineAt(node.from).from
  const to = view.state.doc.lineAt(node.to).to
  const key = `table:${from}:${to}`
  if (seenDecorations.has(key)) {
    return true
  }
  seenDecorations.add(key)
  const decoration = Decoration.replace({
    block: true,
    widget: new MarkdownTableWidget(table, from),
  }).range(from, to)
  decorationRanges.push(decoration)
  if (!seenAtomicRanges.has(key)) {
    seenAtomicRanges.add(key)
    atomicRanges.push(decoration)
  }
  return true
}

type MarkdownTableData = {
  alignments: Array<'center' | 'left' | 'right' | null>
  headers: string[]
  rows: string[][]
}

function parseMarkdownTable(source: string): MarkdownTableData | null {
  const lines = source
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length < 2) {
    return null
  }
  const headers = splitMarkdownTableRow(lines[0] ?? '')
  const separators = splitMarkdownTableRow(lines[1] ?? '')
  if (
    headers.length === 0 ||
    separators.length !== headers.length ||
    separators.some(cell => !/^:?-{3,}:?$/u.test(cell.replace(/\s+/gu, '')))
  ) {
    return null
  }
  const alignments = separators.map(cell => {
    const marker = cell.replace(/\s+/gu, '')
    if (marker.startsWith(':') && marker.endsWith(':')) return 'center'
    if (marker.endsWith(':')) return 'right'
    if (marker.startsWith(':')) return 'left'
    return null
  })
  const rows = lines.slice(2).map(line => {
    const cells = splitMarkdownTableRow(line)
    return headers.map((_, index) => cells[index] ?? '')
  })
  return { alignments, headers, rows }
}

function splitMarkdownTableRow(line: string): string[] {
  const source = line.replace(/^\s*\|/u, '').replace(/\|\s*$/u, '')
  const cells: string[] = []
  let cell = ''
  let escaped = false
  let codeDelimiterLength = 0
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? ''
    if (escaped) {
      cell += character
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '`') {
      let length = 1
      while (source[index + length] === '`') length += 1
      codeDelimiterLength =
        codeDelimiterLength === length ? 0 : codeDelimiterLength || length
      cell += '`'.repeat(length)
      index += length - 1
      continue
    }
    if (character === '|' && codeDelimiterLength === 0) {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += character
  }
  if (escaped) cell += '\\'
  cells.push(cell.trim())
  return cells
}

class MarkdownTableWidget extends WidgetType {
  private readonly signature: string

  constructor(
    private readonly table: MarkdownTableData,
    private readonly sourceFrom: number,
  ) {
    super()
    this.signature = JSON.stringify(table)
  }

  override eq(other: MarkdownTableWidget): boolean {
    return this.signature === other.signature
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = view.dom.ownerDocument.createElement('div')
    wrapper.className = 'cm-md-rich-table-widget'
    wrapper.title = '点击编辑 Markdown 表格'
    const table = view.dom.ownerDocument.createElement('table')
    const headerRow = table.createTHead().insertRow()
    this.table.headers.forEach((header, index) => {
      const cell = view.dom.ownerDocument.createElement('th')
      cell.textContent = header
      applyTableAlignment(cell, this.table.alignments[index])
      headerRow.append(cell)
    })
    const body = table.createTBody()
    this.table.rows.forEach(row => {
      const tableRow = body.insertRow()
      this.table.headers.forEach((_, index) => {
        const cell = tableRow.insertCell()
        cell.textContent = row[index] ?? ''
        applyTableAlignment(cell, this.table.alignments[index])
      })
    })
    wrapper.append(table)
    wrapper.addEventListener('pointerdown', event => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: this.sourceFrom } })
      view.focus()
    })
    return wrapper
  }
}

function applyTableAlignment(
  cell: HTMLTableCellElement,
  alignment: MarkdownTableData['alignments'][number] | undefined,
): void {
  if (alignment) {
    cell.style.textAlign = alignment
  }
}

function addMermaidDecoration(
  view: EditorView,
  node: MarkdownSyntaxNode,
  decorationRanges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  seenDecorations: Set<string>,
  seenAtomicRanges: Set<string>,
): boolean {
  const info = node.getChild('CodeInfo')
  if (
    !info ||
    view.state.doc
      .sliceString(info.from, info.to)
      .trim()
      .split(/\s+/u, 1)[0]
      ?.toLowerCase() !== 'mermaid' ||
    selectionEntersNode(view, node)
  ) {
    return false
  }
  const definition = node
    .getChildren('CodeText')
    .map(child => view.state.doc.sliceString(child.from, child.to))
    .join('')
  const from = view.state.doc.lineAt(node.from).from
  const to = view.state.doc.lineAt(node.to).to
  const key = `mermaid:${from}:${to}`
  if (seenDecorations.has(key)) return true
  seenDecorations.add(key)
  const decoration = Decoration.replace({
    block: true,
    widget: new MermaidBlockWidget(definition),
  }).range(from, to)
  decorationRanges.push(decoration)
  if (!seenAtomicRanges.has(key)) {
    seenAtomicRanges.add(key)
    atomicRanges.push(decoration)
  }
  return true
}

class MermaidBlockWidget extends WidgetType {
  constructor(private readonly definition: string) {
    super()
  }

  override eq(other: MermaidBlockWidget): boolean {
    return this.definition === other.definition
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = view.dom.ownerDocument.createElement('div')
    host.className = 'cm-md-rich-mermaid'
    const root = createRoot(host)
    mermaidRoots.set(host, root)
    root.render(React.createElement(MermaidRenderer, {
      definition: this.definition,
    }))
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => view.requestMeasure())
    observer?.observe(host)
    if (observer) {
      mermaidObservers.set(host, observer)
    }
    queueMicrotask(() => view.requestMeasure())
    return host
  }

  override destroy(dom: HTMLElement): void {
    mermaidObservers.get(dom)?.disconnect()
    mermaidObservers.delete(dom)
    const root = mermaidRoots.get(dom)
    mermaidRoots.delete(dom)
    queueMicrotask(() => root?.unmount())
  }
}

function selectionEntersNode(
  view: EditorView,
  node: MarkdownSyntaxNode,
): boolean {
  if (!view.hasFocus) {
    return false
  }
  return view.state.selection.ranges.some(range =>
    range.empty
      ? range.head >= node.from && range.head <= node.to
      : range.from < node.to && range.to > node.from,
  )
}

function addMarkDecoration(
  node: MarkdownSyntaxNode,
  className: string,
  ranges: Range<Decoration>[],
  seen: Set<string>,
): void {
  if (node.from === node.to) return
  const key = `mark:${className}:${node.from}:${node.to}`
  if (seen.has(key)) return
  seen.add(key)
  ranges.push(Decoration.mark({ class: className }).range(node.from, node.to))
}

function addVisibleLineDecorations(
  view: EditorView,
  node: MarkdownSyntaxNode,
  visibleRange: { from: number; to: number },
  className: string,
  ranges: Range<Decoration>[],
  seen: Set<string>,
): void {
  const from = Math.max(node.from, visibleRange.from)
  const to = Math.min(node.to, visibleRange.to)
  if (from > to) return
  let line = view.state.doc.lineAt(from)
  while (line.from <= to) {
    addLineDecoration(
      view.state,
      line.from,
      className,
      ranges,
      seen,
    )
    if (line.to >= to || line.number >= view.state.doc.lines) break
    line = view.state.doc.line(line.number + 1)
  }
}

function addLineDecoration(
  state: EditorState,
  position: number,
  className: string,
  ranges: Range<Decoration>[],
  seen: Set<string>,
): void {
  const lineFrom = state.doc.lineAt(position).from
  const key = `line:${className}:${lineFrom}`
  if (seen.has(key)) return
  seen.add(key)
  ranges.push(Decoration.line({ class: className }).range(lineFrom))
}

const markdownRichTheme = EditorView.theme({
  '&.cm-markdown-rich': {
    color: 'var(--color-token-foreground)',
    backgroundColor: 'var(--color-token-main-surface-primary)',
  },
  '&.cm-markdown-rich .cm-content': {
    fontFamily: 'var(--vscode-font-family)',
    fontSize: 'var(--font-size-ui)',
    padding: '24px',
  },
  '&.cm-markdown-rich .cm-line': {
    lineHeight: '1.65',
  },
  '&.cm-markdown-rich .cm-md-rich-heading': {
    color: 'var(--color-token-foreground)',
    fontFamily: 'var(--vscode-font-family)',
    fontWeight: '500',
    letterSpacing: '-0.015em',
  },
  '&.cm-markdown-rich .cm-md-rich-h1': {
    fontSize: '24px',
    lineHeight: '1.35',
  },
  '&.cm-markdown-rich .cm-md-rich-h2': {
    fontSize: '20px',
    lineHeight: '1.4',
  },
  '&.cm-markdown-rich .cm-md-rich-h3': {
    fontSize: '18px',
    lineHeight: '1.45',
  },
  '&.cm-markdown-rich .cm-md-rich-h4, &.cm-markdown-rich .cm-md-rich-h5, &.cm-markdown-rich .cm-md-rich-h6':
    {
      fontSize: 'var(--font-size-ui)',
      lineHeight: '1.65',
    },
  '&.cm-markdown-rich .cm-md-rich-emphasis': {
    fontStyle: 'italic',
  },
  '&.cm-markdown-rich .cm-md-rich-strong': {
    fontWeight: '600',
  },
  '&.cm-markdown-rich .cm-md-rich-strikethrough': {
    textDecoration: 'line-through',
  },
  '&.cm-markdown-rich .cm-md-rich-inline-code': {
    padding: '0.08em 0.3em',
    borderRadius: 'var(--radius-2)',
    color: 'var(--cm-editor-foreground, var(--color-token-foreground))',
    backgroundColor:
      'color-mix(in srgb, var(--cm-editor-background, var(--color-token-text-preformat-background)) 88%, var(--color-token-foreground) 12%)',
    fontFamily: 'var(--vscode-editor-font-family)',
    fontSize: 'var(--font-size-code)',
  },
  '&.cm-markdown-rich .cm-md-rich-link': {
    color: 'var(--color-token-text-link-foreground)',
    textDecoration: 'underline',
    textDecorationColor:
      'color-mix(in srgb, var(--color-token-text-link-foreground) 55%, transparent)',
    textUnderlineOffset: '0.16em',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-blockquote': {
    boxSizing: 'border-box',
    borderLeft: '3px solid var(--color-token-border-heavy)',
    paddingLeft: '12px',
    color: 'var(--color-token-text-secondary)',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-list-item': {
    paddingBlock: '1px',
  },
  '&.cm-markdown-rich .cm-md-rich-list-marker': {
    display: 'inline-block',
    width: '1.25em',
    color: 'var(--color-token-text-secondary)',
    fontFamily: 'var(--vscode-font-family)',
    fontWeight: '500',
    textAlign: 'center',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-horizontal-rule': {
    minHeight: '1.65em',
    borderTop: '1px solid var(--color-token-border)',
    color: 'transparent',
    transform: 'translateY(0.8em)',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-code-block': {
    boxSizing: 'border-box',
    paddingInline: '12px',
    color: 'var(--cm-editor-foreground, var(--color-token-foreground))',
    backgroundColor: 'var(--color-token-editor-background)',
    fontFamily: 'var(--vscode-editor-font-family)',
    fontSize: 'var(--font-size-code)',
    lineHeight: '1.6',
  },
  '&.cm-markdown-rich .cm-line:not(.cm-md-rich-code-block) + .cm-line.cm-md-rich-code-block, &.cm-markdown-rich .cm-line.cm-md-rich-code-block:first-child':
    {
      borderTopLeftRadius: 'var(--radius-lg, var(--radius-5))',
      borderTopRightRadius: 'var(--radius-lg, var(--radius-5))',
    },
  '&.cm-markdown-rich .cm-line.cm-md-rich-code-block:not(:has(+ .cm-line.cm-md-rich-code-block))':
    {
      borderBottomLeftRadius: 'var(--radius-lg, var(--radius-5))',
      borderBottomRightRadius: 'var(--radius-lg, var(--radius-5))',
    },
  '&.cm-markdown-rich .cm-md-rich-mermaid': {
    display: 'block',
    boxSizing: 'border-box',
    margin: '12px 24px',
    padding: '12px',
    border: '1px solid var(--color-token-border)',
    borderRadius: 'var(--radius-3)',
    backgroundColor:
      'var(--cm-editor-background, var(--color-token-editor-background, var(--color-token-text-preformat-background)))',
    overflow: 'auto',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-table': {
    boxSizing: 'border-box',
    borderBottom: '1px solid var(--color-token-border)',
    paddingInline: '8px',
    fontVariantNumeric: 'tabular-nums',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-table-header': {
    backgroundColor: 'var(--color-token-bg-fog)',
    fontWeight: '650',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-table-row': {
    backgroundColor: 'var(--color-token-editor-background)',
  },
  '&.cm-markdown-rich .cm-md-rich-table-widget': {
    display: 'block',
    boxSizing: 'border-box',
    marginBlock: '12px',
    borderRadius: 'var(--radius-lg, var(--radius-5))',
    backgroundColor: 'var(--color-token-editor-background)',
    overflowX: 'auto',
  },
  '&.cm-markdown-rich .cm-md-rich-table-widget table': {
    width: '100%',
    borderCollapse: 'collapse',
    backgroundColor: 'var(--color-token-editor-background)',
    color: 'var(--color-token-foreground)',
    fontFamily: 'var(--vscode-font-family)',
    fontSize: 'var(--font-size-ui)',
  },
  '&.cm-markdown-rich .cm-md-rich-table-widget th, &.cm-markdown-rich .cm-md-rich-table-widget td':
    {
      minWidth: '96px',
      padding: '8px 10px',
      border: '1px solid var(--color-token-border)',
      verticalAlign: 'top',
    },
  '&.cm-markdown-rich .cm-md-rich-table-widget th': {
    backgroundColor: 'var(--color-token-editor-widget-background)',
    fontWeight: '650',
  },
  '&.cm-markdown-rich .cm-md-rich-table-widget td': {
    backgroundColor: 'var(--color-token-editor-background)',
  },
})
