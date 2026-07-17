import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'

export type CodeMirrorSetupOptions = {
  onChange?: (value: string) => void
  onSave?: () => void
}

export function createCodeMirrorExtensions({
  onChange,
  onSave,
}: CodeMirrorSetupOptions): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(codePilotXHighlightStyle, { fallback: true }),
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          onSave?.()
          return true
        },
      },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    EditorView.lineWrapping,
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        onChange?.(update.state.doc.toString())
      }
    }),
    codePilotXEditorTheme,
  ]
}

export async function loadCodeMirrorLanguage(
  path?: string,
  language?: string,
): Promise<Extension> {
  const description = language
    ? LanguageDescription.matchLanguageName(languages, language, true)
    : path
      ? LanguageDescription.matchFilename(languages, path)
      : null

  return description ? description.load() : []
}

const codePilotXEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--vscode-editor-foreground, var(--color-text))',
    backgroundColor:
      'var(--vscode-editor-background, var(--surface-canvas))',
    fontFamily:
      'var(--vscode-editor-font-family, ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace)',
    fontSize: 'var(--font-size-code)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
    lineHeight: '1.8',
  },
  '.cm-content': {
    minHeight: '100%',
    caretColor:
      'var(--vscode-editorCursor-foreground, var(--color-accent))',
    padding: '0 16px 16px 0',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor:
      'var(--vscode-editorCursor-foreground, var(--color-accent))',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor:
      'var(--vscode-editor-selectionBackground, var(--color-accent-a3))',
  },
  '.cm-panels': {
    color: 'var(--vscode-editor-foreground, var(--color-text))',
    backgroundColor:
      'var(--vscode-editorWidget-background, var(--surface-panel))',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom:
      '1px solid var(--vscode-widget-border, var(--border-control))',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop:
      '1px solid var(--vscode-widget-border, var(--border-control))',
  },
  '.cm-searchMatch': {
    backgroundColor:
      'var(--vscode-editor-findMatchHighlightBackground, color-mix(in srgb, var(--color-accent) 24%, transparent))',
    outline:
      '1px solid var(--vscode-editor-findMatchHighlightBorder, color-mix(in srgb, var(--color-accent) 54%, transparent))',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor:
      'var(--vscode-editor-findMatchBackground, var(--color-accent-a3))',
  },
  '.cm-activeLine': {
    backgroundColor:
      'var(--vscode-editor-lineHighlightBackground, color-mix(in srgb, var(--color-ink) 4%, transparent))',
  },
  '.cm-selectionMatch': {
    backgroundColor:
      'var(--vscode-editor-selectionHighlightBackground, color-mix(in srgb, var(--color-accent) 16%, transparent))',
  },
  '.cm-gutters': {
    color:
      'var(--vscode-editorLineNumber-foreground, color-mix(in srgb, var(--color-text) 65%, transparent))',
    backgroundColor:
      'var(--vscode-editorGutter-background, var(--vscode-editor-background, var(--surface-canvas)))',
    borderRight: '0',
    paddingLeft: '2ch',
  },
  '.cm-activeLineGutter': {
    color:
      'var(--vscode-editorLineNumber-activeForeground, var(--vscode-editor-foreground, var(--color-text)))',
    backgroundColor:
      'var(--vscode-editor-lineHighlightBackground, color-mix(in srgb, var(--color-ink) 4%, transparent))',
  },
  '.cm-foldPlaceholder': {
    color:
      'var(--vscode-editor-foldPlaceholderForeground, var(--color-text-soft))',
    backgroundColor:
      'var(--vscode-editor-foldBackground, var(--surface-code-inline))',
    border:
      '1px solid var(--vscode-widget-border, var(--border-control))',
  },
  '.cm-tooltip': {
    color: 'var(--vscode-editorSuggestWidget-foreground, var(--color-text))',
    backgroundColor:
      'var(--vscode-editorSuggestWidget-background, var(--surface-raised))',
    border:
      '1px solid var(--vscode-editorSuggestWidget-border, var(--border-strong))',
    borderRadius: 'var(--radius-3)',
    boxShadow: 'var(--shadow-raised)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    color:
      'var(--vscode-editorSuggestWidget-selectedForeground, var(--color-text))',
    backgroundColor:
      'var(--vscode-editorSuggestWidget-selectedBackground, var(--state-selected))',
  },
})

const codePilotXHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.modifier,
    ],
    color: 'var(--syntax-keyword)',
  },
  {
    tag: [
      tags.typeName,
      tags.className,
      tags.namespace,
      tags.tagName,
      tags.heading,
    ],
    color: 'var(--syntax-type)',
  },
  {
    tag: [
      tags.propertyName,
      tags.attributeName,
      tags.function(tags.propertyName),
      tags.definition(tags.propertyName),
    ],
    color: 'var(--syntax-property)',
  },
  {
    tag: [
      tags.string,
      tags.special(tags.string),
      tags.regexp,
      tags.character,
      tags.escape,
    ],
    color: 'var(--syntax-string)',
  },
  {
    tag: [tags.number, tags.bool, tags.null],
    color: 'var(--syntax-number)',
  },
  {
    tag: [
      tags.operator,
      tags.operatorKeyword,
      tags.arithmeticOperator,
      tags.logicOperator,
      tags.bitwiseOperator,
      tags.compareOperator,
      tags.updateOperator,
    ],
    color: 'var(--syntax-operator)',
  },
  {
    tag: [
      tags.comment,
      tags.lineComment,
      tags.blockComment,
      tags.docComment,
    ],
    color: 'var(--syntax-comment)',
  },
  {
    tag: [
      tags.variableName,
      tags.local(tags.variableName),
      tags.definition(tags.variableName),
      tags.function(tags.variableName),
      tags.labelName,
    ],
    color: 'var(--syntax-variable)',
  },
  {
    tag: [
      tags.punctuation,
      tags.separator,
      tags.brace,
      tags.paren,
      tags.squareBracket,
    ],
    color: 'var(--syntax-punctuation)',
  },
  {
    tag: [tags.meta, tags.annotation, tags.processingInstruction],
    color: 'var(--color-text-meta)',
  },
  {
    tag: tags.invalid,
    color: 'var(--color-danger)',
  },
])
