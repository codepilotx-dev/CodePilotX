import React from 'react'
import type {
  MarkdownDirectiveRegistry,
  MarkdownDirectiveRenderer,
} from './types.js'

const BUILTIN_DIRECTIVES: ReadonlyArray<
  readonly [string, MarkdownDirectiveRenderer]
> = [
  [
    'note',
    ({ argument, children, name }) => (
      <aside
        className="md-directive md-directive-note"
        data-md-directive={name}
      >
        {argument ? <strong>{argument}</strong> : null}
        {children}
      </aside>
    ),
  ],
  [
    'tip',
    ({ argument, children, name }) => (
      <aside
        className="md-directive md-directive-tip"
        data-md-directive={name}
      >
        {argument ? <strong>{argument}</strong> : null}
        {children}
      </aside>
    ),
  ],
  [
    'warning',
    ({ argument, children, name }) => (
      <aside
        className="md-directive md-directive-warning"
        data-md-directive={name}
      >
        {argument ? <strong>{argument}</strong> : null}
        {children}
      </aside>
    ),
  ],
  [
    'danger',
    ({ argument, children, name }) => (
      <aside
        className="md-directive md-directive-danger"
        data-md-directive={name}
      >
        {argument ? <strong>{argument}</strong> : null}
        {children}
      </aside>
    ),
  ],
  [
    'details',
    ({ argument, children, name }) => (
      <details
        className="md-directive md-directive-details"
        data-md-directive={name}
      >
        <summary>{argument || '详情'}</summary>
        {children}
      </details>
    ),
  ],
]

export const DEFAULT_MARKDOWN_DIRECTIVES: MarkdownDirectiveRegistry = new Map(
  BUILTIN_DIRECTIVES,
)

export function createMarkdownDirectiveRegistry(
  entries: Iterable<readonly [string, MarkdownDirectiveRenderer]> = [],
): MarkdownDirectiveRegistry {
  const registry = new Map(DEFAULT_MARKDOWN_DIRECTIVES)
  for (const [name, renderer] of entries) {
    const normalizedName = normalizeDirectiveName(name)
    if (normalizedName) registry.set(normalizedName, renderer)
  }
  return registry
}

export function normalizeDirectiveName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]/gu, '')
}
