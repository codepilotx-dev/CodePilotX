import type {
  DesktopComposerAttachment,
  DesktopReviewSource,
} from '../../../shared/types.js'
import {
  createDefaultWorkbenchTabsState,
  isWorkbenchTabEnabled,
  type WorkbenchFocusArea,
  type WorkbenchPanelSnapshot,
  type WorkbenchPanelTarget,
  type WorkbenchTabDescriptor,
  type WorkbenchTabId,
  type WorkbenchTabsState,
} from './rightDockState.js'

const STORAGE_PREFIX = 'conversation.ui-state.'

export type ReviewTabUiState = {
  source: DesktopReviewSource
  selectedFile: string | null
  selectedCommentId: string | null
  scrollTop: number
  diffExpansion: ReviewDiffExpansion
  viewedRevisions: Record<string, string>
  fileTreeVisible: boolean
  fileTreeWidth: number
  diffMode: 'inline' | 'split'
  wrapLines: boolean
  showWordDiff: boolean
  hideWhitespace: boolean
  richPreview: boolean
}

export type ReviewDiffExpansion =
  | { mode: 'all' }
  | { mode: 'none' }
  | { mode: 'custom'; expandedFiles: string[] }

export function isReviewDiffExpanded(
  expansion: ReviewDiffExpansion,
  path: string,
): boolean {
  if (expansion.mode === 'all') return true
  if (expansion.mode === 'none') return false
  return expansion.expandedFiles.includes(path)
}

export function toggleReviewDiffExpansion(
  expansion: ReviewDiffExpansion,
  allPaths: readonly string[],
  path: string,
): ReviewDiffExpansion {
  const expanded = new Set(
    allPaths.filter((candidate) =>
      isReviewDiffExpanded(expansion, candidate),
    ),
  )
  if (expanded.has(path)) expanded.delete(path)
  else expanded.add(path)

  if (expanded.size === 0) return { mode: 'none' }
  if (
    allPaths.length > 0 &&
    allPaths.every((candidate) => expanded.has(candidate))
  ) {
    return { mode: 'all' }
  }
  return {
    mode: 'custom',
    expandedFiles: allPaths.filter((candidate) => expanded.has(candidate)),
  }
}

export type ConversationUiStateV4 = {
  schemaVersion: 4
  workbench: WorkbenchTabsState
  mainScrollTop: number
  sideChatInput: string
  sideChatAttachments: DesktopComposerAttachment[]
  review: ReviewTabUiState
}

export type ConversationUiState = ConversationUiStateV4

export type ConversationUiValidationOptions = {
  debugMode?: boolean
  validPlanEventIds?: readonly string[]
  validSideTaskIds?: readonly string[]
  workspacePath?: string | null
}

export function createDefaultConversationUiState(): ConversationUiState {
  return {
    schemaVersion: 4,
    workbench: createDefaultWorkbenchTabsState(),
    mainScrollTop: 0,
    sideChatInput: '',
    sideChatAttachments: [],
    review: createDefaultReviewTabUiState(),
  }
}

export function createDefaultReviewTabUiState(): ReviewTabUiState {
  return {
    source: { kind: 'unstaged' },
    selectedFile: null,
    selectedCommentId: null,
    scrollTop: 0,
    diffExpansion: { mode: 'all' },
    viewedRevisions: {},
    fileTreeVisible: true,
    fileTreeWidth: 340,
    diffMode: 'inline',
    wrapLines: true,
    showWordDiff: true,
    hideWhitespace: false,
    richPreview: true,
  }
}

export function saveConversationUiState(
  sessionId: string,
  state: ConversationUiState,
): void {
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + sessionId,
      JSON.stringify(state),
    )
  } catch {
    /* localStorage full or disabled; silently ignore */
  }
}

export function loadConversationUiState(
  sessionId: string,
): ConversationUiState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + sessionId)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? (parsed as ConversationUiState) : null
  } catch {
    return null
  }
}

export function removeConversationUiState(sessionId: string): void {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + sessionId)
  } catch {
    /* localStorage disabled; silently ignore */
  }
}

export function validateConversationUiState(
  state: unknown,
  optionsOrLegacyTools:
    | ConversationUiValidationOptions
    | readonly string[] = {},
): ConversationUiState {
  if (!isRecord(state)) return createDefaultConversationUiState()

  const options = normalizeOptions(optionsOrLegacyTools)
  const workbench =
    (state.schemaVersion === 2 ||
      state.schemaVersion === 3 ||
      state.schemaVersion === 4) &&
    isRecord(state.workbench)
      ? validateWorkbenchState(state.workbench, options)
      : migrateLegacyWorkbenchState(state, options)

  return {
    schemaVersion: 4,
    workbench,
    mainScrollTop: toFiniteNonNegativeNumber(state.mainScrollTop),
    sideChatInput:
      typeof state.sideChatInput === 'string' ? state.sideChatInput : '',
    sideChatAttachments: Array.isArray(state.sideChatAttachments)
      ? (state.sideChatAttachments as DesktopComposerAttachment[])
      : [],
    review: validateReviewTabUiState(state.review, state.schemaVersion),
  }
}

function validateReviewTabUiState(
  value: unknown,
  schemaVersion: unknown,
): ReviewTabUiState {
  const defaults = createDefaultReviewTabUiState()
  if (!isRecord(value)) return defaults
  const source = validateReviewSource(value.source)
  return {
    source: source ?? defaults.source,
    selectedFile:
      typeof value.selectedFile === 'string' ? value.selectedFile : null,
    selectedCommentId:
      typeof value.selectedCommentId === 'string'
        ? value.selectedCommentId
        : null,
    scrollTop: toFiniteNonNegativeNumber(value.scrollTop),
    diffExpansion:
      schemaVersion === 4
        ? validateReviewDiffExpansion(
            value.diffExpansion,
            defaults.diffExpansion,
          )
        : migrateLegacyReviewDiffExpansion(value.expandedFiles),
    viewedRevisions: normalizeStringRecord(value.viewedRevisions),
    fileTreeVisible:
      typeof value.fileTreeVisible === 'boolean'
        ? value.fileTreeVisible
        : defaults.fileTreeVisible,
    fileTreeWidth:
      typeof value.fileTreeWidth === 'number' &&
      Number.isFinite(value.fileTreeWidth)
        ? Math.min(520, Math.max(240, value.fileTreeWidth))
        : defaults.fileTreeWidth,
    diffMode:
      value.diffMode === 'split' || value.diffMode === 'inline'
        ? value.diffMode
        : defaults.diffMode,
    wrapLines:
      typeof value.wrapLines === 'boolean'
        ? value.wrapLines
        : defaults.wrapLines,
    showWordDiff:
      typeof value.showWordDiff === 'boolean'
        ? value.showWordDiff
        : defaults.showWordDiff,
    hideWhitespace:
      typeof value.hideWhitespace === 'boolean'
        ? value.hideWhitespace
        : defaults.hideWhitespace,
    richPreview:
      typeof value.richPreview === 'boolean'
        ? value.richPreview
        : defaults.richPreview,
  }
}

function validateReviewDiffExpansion(
  value: unknown,
  fallback: ReviewDiffExpansion,
): ReviewDiffExpansion {
  if (!isRecord(value)) return fallback
  if (value.mode === 'all' || value.mode === 'none') {
    return { mode: value.mode }
  }
  if (value.mode !== 'custom') return fallback
  const expandedFiles = normalizeStringList(value.expandedFiles)
  return expandedFiles.length > 0
    ? { mode: 'custom', expandedFiles }
    : { mode: 'none' }
}

function migrateLegacyReviewDiffExpansion(
  expandedFiles: unknown,
): ReviewDiffExpansion {
  const normalized = normalizeStringList(expandedFiles)
  return normalized.length > 0
    ? { mode: 'custom', expandedFiles: normalized }
    : { mode: 'all' }
}

function validateReviewSource(value: unknown): DesktopReviewSource | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'unstaged' || value.kind === 'staged') {
    return { kind: value.kind }
  }
  if (value.kind === 'branch' && typeof value.baseBranch === 'string') {
    return { kind: 'branch', baseBranch: value.baseBranch }
  }
  if (value.kind === 'commit' && typeof value.commitSha === 'string') {
    return { kind: 'commit', commitSha: value.commitSha }
  }
  if (
    value.kind === 'last-turn' &&
    typeof value.threadId === 'string' &&
    typeof value.turnId === 'string'
  ) {
    return {
      kind: 'last-turn',
      threadId: value.threadId,
      turnId: value.turnId,
    }
  }
  if (
    value.kind === 'pull-request' &&
    typeof value.owner === 'string' &&
    typeof value.repository === 'string' &&
    Number.isSafeInteger(value.number) &&
    Number(value.number) > 0
  ) {
    return {
      kind: 'pull-request',
      owner: value.owner,
      repository: value.repository,
      number: Number(value.number),
    }
  }
  return null
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function validateWorkbenchState(
  value: Record<string, unknown>,
  options: ConversationUiValidationOptions,
): WorkbenchTabsState {
  const rawTabs = isRecord(value.tabsById) ? value.tabsById : {}
  const tabsById: WorkbenchTabsState['tabsById'] = {}
  for (const candidate of Object.values(rawTabs)) {
    const tab = validateTabDescriptor(candidate, options)
    if (tab) tabsById[tab.id] = tab
  }

  const rawRight = readPanel(value.right)
  const rawBottom = readPanel(value.bottom)
  const ownership = resolveTabOwnership(rawRight, rawBottom)
  const right = validatePanel(rawRight, 'right', ownership, tabsById)
  const bottom = validatePanel(rawBottom, 'bottom', ownership, tabsById)
  const referencedIds = new Set([...right.tabIds, ...bottom.tabIds])
  for (const tabId of Object.keys(tabsById) as WorkbenchTabId[]) {
    if (!referencedIds.has(tabId)) delete tabsById[tabId]
  }

  const focusArea = validateFocusArea(value.focusArea, right, bottom)
  return {
    schemaVersion: 2,
    tabsById,
    right,
    bottom,
    rightFullWidth: Boolean(value.rightFullWidth && right.open),
    restoreRightFullWidthOnNextOpen: Boolean(
      value.restoreRightFullWidthOnNextOpen,
    ),
    focusArea,
  }
}

function migrateLegacyWorkbenchState(
  value: Record<string, unknown>,
  options: ConversationUiValidationOptions,
): WorkbenchTabsState {
  const defaults = createDefaultWorkbenchTabsState()
  const panels = isRecord(value.panels) ? value.panels : null
  const rawRight =
    panels && isLegacyPanel(panels.right)
      ? panels.right
      : isLegacyPanel(value.rightDock)
        ? value.rightDock
        : null
  const rawBottom =
    panels && isLegacyPanel(panels.bottom) ? panels.bottom : null
  const legacyPlan = readLegacyPlan(value.plan)
  const tabsById: WorkbenchTabsState['tabsById'] = {}

  const right = migrateLegacyPanel(
    rawRight,
    tabsById,
    options,
    legacyPlan,
  )
  const bottom = migrateLegacyPanel(
    rawBottom,
    tabsById,
    options,
    legacyPlan,
  )
  removeDuplicateLegacyTabs(right, bottom)

  const panelRecord = panels ?? {}
  return {
    schemaVersion: 2,
    tabsById,
    right,
    bottom,
    rightFullWidth: Boolean(panelRecord.rightFullWidth && right.open),
    restoreRightFullWidthOnNextOpen: Boolean(
      panelRecord.restoreRightFullWidthOnNextOpen,
    ),
    focusArea: validateFocusArea(panelRecord.focusArea, right, bottom),
  }
}

type RawPanel = {
  open: boolean
  activeTabId: string | null
  tabIds: string[]
}

function readPanel(value: unknown): RawPanel {
  if (!isRecord(value)) {
    return { open: false, activeTabId: null, tabIds: [] }
  }
  return {
    open: Boolean(value.open),
    activeTabId:
      typeof value.activeTabId === 'string' ? value.activeTabId : null,
    tabIds: Array.isArray(value.tabIds)
      ? value.tabIds.filter((id): id is string => typeof id === 'string')
      : [],
  }
}

function resolveTabOwnership(
  right: RawPanel,
  bottom: RawPanel,
): Map<string, WorkbenchPanelTarget> {
  const ownership = new Map<string, WorkbenchPanelTarget>()
  for (const id of right.tabIds) ownership.set(id, 'right')
  for (const id of bottom.tabIds) {
    if (!ownership.has(id) || (bottom.activeTabId === id && right.activeTabId !== id)) {
      ownership.set(id, 'bottom')
    }
  }
  return ownership
}

function validatePanel(
  panel: RawPanel,
  target: WorkbenchPanelTarget,
  ownership: ReadonlyMap<string, WorkbenchPanelTarget>,
  tabsById: WorkbenchTabsState['tabsById'],
): WorkbenchPanelSnapshot {
  const tabIds = panel.tabIds.filter(
    (id, index): id is WorkbenchTabId =>
      id in tabsById &&
      ownership.get(id) === target &&
      panel.tabIds.indexOf(id) === index,
  )
  return {
    open: panel.open,
    activeTabId:
      panel.activeTabId && tabIds.includes(panel.activeTabId as WorkbenchTabId)
        ? (panel.activeTabId as WorkbenchTabId)
        : (tabIds[tabIds.length - 1] ?? null),
    tabIds,
  }
}

function validateTabDescriptor(
  value: unknown,
  options: ConversationUiValidationOptions,
): WorkbenchTabDescriptor | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  const tab = value as Record<string, unknown>

  if (tab.id === 'review' && tab.kind === 'review') {
    return { id: 'review', kind: 'review' }
  }
  if (tab.id === 'browser' && tab.kind === 'browser') {
    return { id: 'browser', kind: 'browser' }
  }
  if (tab.id === 'file-browser' && tab.kind === 'file-browser') {
    const directoryPath =
      typeof tab.directoryPath === 'string' && isSafePath(tab.directoryPath, true)
        ? tab.directoryPath
        : undefined
    return {
      id: 'file-browser',
      kind: 'file-browser',
      ...(directoryPath ? { directoryPath } : {}),
    }
  }
  if (tab.id === 'side-chat' && tab.kind === 'side-chat') {
    return { id: 'side-chat', kind: 'side-chat' }
  }
  if (
    tab.kind === 'file-preview' &&
    typeof tab.id === 'string' &&
    tab.id.startsWith('file:') &&
    isSafePath(tab.workspacePath, false) &&
    isSafePath(tab.relativePath, true) &&
    (!options.workspacePath || tab.workspacePath === options.workspacePath)
  ) {
    return {
      id: tab.id as `file:${string}`,
      kind: 'file-preview',
      workspacePath: tab.workspacePath,
      relativePath: tab.relativePath,
      preview: Boolean(tab.preview),
      ...(tab.markdownViewMode === 'rich' ||
      tab.markdownViewMode === 'source'
        ? { markdownViewMode: tab.markdownViewMode }
        : {}),
      ...(isPositiveInteger(tab.line) ? { line: tab.line } : {}),
      ...(isPositiveInteger(tab.column) ? { column: tab.column } : {}),
      ...(isPositiveInteger(tab.endLine) ? { endLine: tab.endLine } : {}),
      ...(isPositiveInteger(tab.endColumn) ? { endColumn: tab.endColumn } : {}),
    }
  }
  if (
    tab.kind === 'plan' &&
    typeof tab.id === 'string' &&
    tab.id.startsWith('plan:') &&
    typeof tab.eventId === 'string' &&
    tab.eventId.length > 0 &&
    typeof tab.title === 'string' &&
    (typeof tab.legacyContent === 'string' ||
      !options.validPlanEventIds ||
      options.validPlanEventIds.includes(tab.eventId))
  ) {
    return {
      id: tab.id as `plan:${string}`,
      kind: 'plan',
      eventId: tab.eventId,
      title: tab.title,
      ...(typeof tab.legacyContent === 'string'
        ? { legacyContent: tab.legacyContent }
        : {}),
    }
  }
  if (
    tab.kind === 'side-task' &&
    typeof tab.id === 'string' &&
    tab.id.startsWith('side-task:') &&
    typeof tab.taskId === 'string' &&
    tab.taskId.length > 0 &&
    typeof tab.childThreadId === 'string' &&
    tab.childThreadId.length > 0 &&
    (!options.validSideTaskIds ||
      options.validSideTaskIds.includes(tab.taskId))
  ) {
    return {
      id: tab.id as `side-task:${string}`,
      kind: 'side-task',
      taskId: tab.taskId,
      childThreadId: tab.childThreadId,
    }
  }

  const debugTab = readDebugTab(tab)
  if (
    debugTab &&
    isWorkbenchTabEnabled(debugTab, { debugMode: Boolean(options.debugMode) })
  ) {
    return debugTab
  }
  return null
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function readDebugTab(
  value: Record<string, unknown>,
): WorkbenchTabDescriptor | null {
  if (value.id === 'tool-probe' && value.kind === 'tool-probe') {
    return { id: 'tool-probe', kind: 'tool-probe' }
  }
  if (value.id === 'dialog-debug' && value.kind === 'dialog-debug') {
    return { id: 'dialog-debug', kind: 'dialog-debug' }
  }
  if (
    value.id === 'performance-diagnostics' &&
    value.kind === 'performance-diagnostics'
  ) {
    return {
      id: 'performance-diagnostics',
      kind: 'performance-diagnostics',
    }
  }
  return null
}

type LegacyPanel = {
  open: boolean
  activeTool: string | null
  openTools: string[]
}

function isLegacyPanel(value: unknown): value is LegacyPanel {
  return isRecord(value) && Array.isArray(value.openTools)
}

function migrateLegacyPanel(
  panel: LegacyPanel | null,
  tabsById: WorkbenchTabsState['tabsById'],
  options: ConversationUiValidationOptions,
  legacyPlan: WorkbenchTabDescriptor | null,
): WorkbenchPanelSnapshot {
  const mapped: WorkbenchTabDescriptor[] = []
  for (const tool of panel?.openTools ?? []) {
    const tab = mapLegacyTool(tool, legacyPlan)
    if (
      tab &&
      isWorkbenchTabEnabled(tab, { debugMode: Boolean(options.debugMode) }) &&
      !mapped.some(existing => existing.id === tab.id)
    ) {
      mapped.push(tab)
      tabsById[tab.id] = tab
    }
  }
  const activeTab = mapLegacyTool(panel?.activeTool ?? '', legacyPlan)
  const tabIds = mapped.map(tab => tab.id)
  return {
    open: Boolean(panel?.open),
    activeTabId:
      activeTab && tabIds.includes(activeTab.id)
        ? activeTab.id
        : (tabIds[tabIds.length - 1] ?? null),
    tabIds,
  }
}

function mapLegacyTool(
  tool: string,
  legacyPlan: WorkbenchTabDescriptor | null,
): WorkbenchTabDescriptor | null {
  if (tool === 'review') return { id: 'review', kind: 'review' }
  if (tool === 'browser') return { id: 'browser', kind: 'browser' }
  if (tool === 'files') return { id: 'file-browser', kind: 'file-browser' }
  if (tool === 'sideChat') return { id: 'side-chat', kind: 'side-chat' }
  if (tool === 'plan') return legacyPlan
  if (tool === 'toolProbe') return { id: 'tool-probe', kind: 'tool-probe' }
  if (tool === 'dialogDebug') {
    return { id: 'dialog-debug', kind: 'dialog-debug' }
  }
  if (tool === 'performanceDiagnostics') {
    return {
      id: 'performance-diagnostics',
      kind: 'performance-diagnostics',
    }
  }
  return null
}

function readLegacyPlan(value: unknown): WorkbenchTabDescriptor | null {
  if (
    !isRecord(value) ||
    typeof value.title !== 'string' ||
    typeof value.content !== 'string'
  ) {
    return null
  }
  return {
    id: 'plan:legacy',
    kind: 'plan',
    eventId: 'legacy',
    title: value.title,
    legacyContent: value.content,
  }
}

function removeDuplicateLegacyTabs(
  right: WorkbenchPanelSnapshot,
  bottom: WorkbenchPanelSnapshot,
): void {
  const rightIds = new Set(right.tabIds)
  const duplicates = bottom.tabIds.filter(id => rightIds.has(id))
  for (const id of duplicates) {
    if (bottom.activeTabId === id && right.activeTabId !== id) {
      right.tabIds = right.tabIds.filter(tabId => tabId !== id)
      if (right.activeTabId === id) {
        right.activeTabId = right.tabIds[right.tabIds.length - 1] ?? null
      }
    } else {
      bottom.tabIds = bottom.tabIds.filter(tabId => tabId !== id)
      if (bottom.activeTabId === id) {
        bottom.activeTabId = bottom.tabIds[bottom.tabIds.length - 1] ?? null
      }
    }
  }
}

function validateFocusArea(
  value: unknown,
  right: WorkbenchPanelSnapshot,
  bottom: WorkbenchPanelSnapshot,
): WorkbenchFocusArea {
  if (value === 'right-panel' && right.open) return value
  if (value === 'bottom-panel' && bottom.open) return value
  return 'main'
}

function normalizeOptions(
  value: ConversationUiValidationOptions | readonly string[],
): ConversationUiValidationOptions {
  if (!Array.isArray(value)) return value as ConversationUiValidationOptions
  return {
    debugMode: value.some(
      tool =>
        tool === 'toolProbe' ||
        tool === 'dialogDebug' ||
        tool === 'performanceDiagnostics',
    ),
  }
}

function isSafePath(value: unknown, requireRelative: boolean): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    return false
  }
  if (!requireRelative) return true
  const normalized = value.replaceAll('\\', '/')
  return (
    !normalized.startsWith('/') &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split('/').includes('..')
  )
}

function toFiniteNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
