import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { compile } from 'sass'

const repoRoot = join(import.meta.dirname, '..')
const indexPath = join(
  repoRoot,
  'apps/desktop/src/renderer/styles/index.scss',
)
const stylesRoot = dirname(indexPath)

const sameFileAllowlist = new Map(
  Object.entries({
    'apps/desktop/src/renderer/styles/base.scss::textarea':
      'Base cursor reset intentionally splits textarea cursor-specific rules.',
    'apps/desktop/src/renderer/styles/base.scss:::root.dark-theme.dracula-theme':
      'Dracula variables are grouped by token family.',
    'apps/desktop/src/renderer/styles/components/chip.scss::.menubar-trigger[data-highlighted]':
      'Highlighted and open menubar states intentionally share the same visual token block.',
    'apps/desktop/src/renderer/styles/components/chip.scss::.message-action[data-state="open"]':
      'Open message actions intentionally share chip active state tokens.',
    'apps/desktop/src/renderer/styles/components/chip.scss::.chip-button.active':
      'Accent chip state is a semantic variant layered on the shared active state.',
    'apps/desktop/src/renderer/styles/components/chip.scss::.chip-button[aria-expanded="true"]':
      'Accent chip state is a semantic variant layered on the shared active state.',
    'apps/desktop/src/renderer/styles/components/chip.scss::.chip-button[data-state="open"]':
      'Accent chip state is a semantic variant layered on the shared active state.',
    'apps/desktop/src/renderer/styles/components/chip.scss::.meta-chip.active':
      'Accent chip state is a semantic variant layered on the shared active state.',
    'apps/desktop/src/renderer/styles/components/chip.scss::.meta-chip[aria-expanded="true"]':
      'Accent chip state is a semantic variant layered on the shared active state.',
    'apps/desktop/src/renderer/styles/components/chip.scss::.meta-chip[data-state="open"]':
      'Accent chip state is a semantic variant layered on the shared active state.',
    'apps/desktop/src/renderer/styles/components/input.scss::.settings-input-number:focus':
      'Number input focus is grouped with generic input focus and keeps spinner-specific cleanup nearby.',
    'apps/desktop/src/renderer/styles/features/browser.scss::.browser-address-error':
      'Browser address error uses a narrow viewport adjustment.',
    'apps/desktop/src/renderer/styles/features/composer.scss::.composer-bottom':
      'Composer bottom has base layout plus compact viewport adjustment.',
    'apps/desktop/src/renderer/styles/features/composer.scss::.composer-model-chip':
      'Composer model chip has base sizing plus compact viewport adjustment.',
    'apps/desktop/src/renderer/styles/features/composer.scss::.composer-model-chip-thinking':
      'Thinking chip has base sizing plus compact viewport adjustment.',
    'apps/desktop/src/renderer/styles/features/composer.scss::.composer-plan-mode-chip-icon-exit':
      'Plan mode icon uses adjacent transition and positioned state rules.',
    'apps/desktop/src/renderer/styles/features/composer.scss::.permission-select-trigger':
      'Permission trigger has a compact viewport adjustment.',
    'apps/desktop/src/renderer/styles/features/composer.scss::.chat-input__dropdown-switch-thumb':
      'Switch thumb base and checked transform are intentionally adjacent.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.desktop-sidebar':
      'Sidebar root variables are layered across collapsed and hover overlay contexts.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.desktop-sidebar-hover-overlay':
      'Hover overlay inherits sidebar density variables before state positioning rules.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.sidebar-layout':
      'Sidebar layout has expanded and collapsed variants.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.sidebar-session-list':
      'Session list has base spacing and collapsed-state spacing.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.sidebar-row-trailing':
      'Trailing controls have default and visible action variants.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.sidebar-section-title':
      'Section title has base typography and compact collapsed variant.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.sidebar-nav-link.active':
      'Sidebar active rows share a common active-state token block.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.sidebar-session-row.active':
      'Sidebar active rows share a common active-state token block.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.sidebar-settings-link.active':
      'Sidebar active rows share a common active-state token block.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.sidebar-collapse-confirm-target':
      'Collapse confirmation has base positioning plus reduced-motion handling.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.sidebar-history-watermark':
      'History watermark has base visibility plus collapsed-state variant.',
    'apps/desktop/src/renderer/styles/features/layout-sidebar.scss::.sidebar-update-dot':
      'Update dot has base visual and animation state.',
    'apps/desktop/src/renderer/styles/features/layout.scss::.desktop-main-stage':
      'Desktop main stage has base layout and dock-state width rules.',
    'apps/desktop/src/renderer/styles/features/layout.scss::.desktop-main-route':
      'Desktop route has base minimum sizing and dock-state variants.',
    'apps/desktop/src/renderer/styles/features/layout.scss::.right-dock-controls':
      'Right dock controls have header and terminal composer contexts.',
    'apps/desktop/src/renderer/styles/features/layout.scss::.right-dock-tab-wrap':
      'Right dock tab wrapper has base transitions plus compact dock variants.',
    'apps/desktop/src/renderer/styles/features/layout.scss::.right-dock-add-button':
      'Right dock add/control buttons share base transition tokens.',
    'apps/desktop/src/renderer/styles/features/layout.scss::.right-dock-control':
      'Right dock controls share base transition tokens and header sizing.',
    'apps/desktop/src/renderer/styles/features/layout.scss::.right-dock-plan-scroll-content':
      'Right dock plan scroll content has panel and dock body padding variants.',
    'apps/desktop/src/renderer/styles/features/layout.scss::.right-dock-file-tree':
      'Right dock file tree has panel and dock body padding variants.',
    'apps/desktop/src/renderer/styles/features/layout.scss::.right-dock-search':
      'Right dock search inherits shared input radius then defines dock-local sizing.',
    'apps/desktop/src/renderer/styles/features/review.scss::.review-file-counts':
      'Review file counts have base and expanded-state layouts.',
    'apps/desktop/src/renderer/styles/features/review.scss::.timeline-file-event-review-button':
      'Review button has base and review-sidebar context rules.',
    'apps/desktop/src/renderer/styles/features/search.scss::.utility-view':
      'Utility view is shared with quick chat and has page-local layout.',
    'apps/desktop/src/renderer/styles/features/search.scss::.utility-view-header':
      'Utility header has base and utility page-specific layout.',
    'apps/desktop/src/renderer/styles/features/search.scss::.utility-view-header h1':
      'Utility header title has shared and page-specific typography.',
    'apps/desktop/src/renderer/styles/features/search.scss::.utility-grid':
      'Utility grid has base and utility page-specific layout.',
    'apps/desktop/src/renderer/styles/features/search.scss::.muted-copy':
      'Muted copy shares text tokens across utility and quick-chat copy.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-content-inner':
      'Settings content has base and appearance-page layout variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-page-title':
      'Settings page title is reused in settings subsections.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-section':
      'Settings section has base card and page-specific elevated variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-section-header':
      'Settings section header has base and compact viewport layouts.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-section-header-actions':
      'Settings section header actions have base and compact viewport layouts.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-row':
      'Settings row has base and compact viewport layouts.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-row-control':
      'Settings row controls have base and compact viewport layouts.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.archived-session-row':
      'Archived session row has base and compact viewport layouts.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-inline-actions':
      'Inline actions have base and compact viewport layouts.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-status-grid':
      'Status grid has base and compact viewport layouts.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-input-narrow':
      'Narrow input has base sizing and compact viewport layout.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-input-number:focus':
      'Number input focus is grouped with generic focus and settings-local validation focus.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-input-number::-webkit-inner-spin-button':
      'Spinner cleanup is repeated in settings-local numeric input context.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-input-number::-webkit-outer-spin-button':
      'Spinner cleanup is repeated in settings-local numeric input context.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-input-unit':
      'Input unit text is reused by settings unit controls.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.profile-stat-strip':
      'Profile stat strip has base layout plus appearance refresh tokens.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.profile-repository-row':
      'Repository row shares profile row primitives and has row-specific spacing.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.radio-card':
      'Radio card has base and refreshed surface variants kept in settings.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.segmented-control-item':
      'Segmented item has base interaction and refreshed motion tokens.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.theme-dropdown-trigger':
      'Theme dropdown has base and appearance-page trigger variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-dropdown-item-inner':
      'Dropdown item layout is reused by appearance dropdown content.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-dropdown-item-copy':
      'Dropdown item copy layout is reused by appearance dropdown content.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.appearance-preview-marker':
      'Preview marker uses adjacent positional variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.appearance-theme-controls-actions':
      'Appearance controls have base and compact workbench layouts.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.billing-expand-toggle':
      'Billing toggle has base and refreshed motion tokens.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.billing-usage-card':
      'Billing card has base and page-specific surface variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.billing-usage-card-header p':
      'Billing card header copy has base and compact viewport variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.billing-usage-meta':
      'Billing metadata has base and compact viewport variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.billing-metric-grid':
      'Billing metric grid has base and compact viewport variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.billing-usage-grid':
      'Billing usage grid has base and compact viewport variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.archived-session-row + .archived-session-row':
      'Adjacent row separators share settings row border tokens.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.billing-balance-row + .billing-balance-row':
      'Adjacent row separators share settings row border tokens.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.mcp-server-row + .mcp-server-row':
      'Adjacent row separators share settings row border tokens.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-hero-card':
      'Settings hero card has base and compact viewport variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.settings-empty-state':
      'Settings empty state has base and memory-settings context variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.keyboard-shortcut-unbound':
      'Keyboard shortcut unbound style has adjacent typography and color variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.keyboard-shortcuts-settings':
      'Keyboard shortcut page has base and content-width variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.memory-settings-item':
      'Memory item has base and selectable item variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.appearance-workbench':
      'Appearance workbench has base and compact viewport layouts.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.appearance-mode-sheet':
      'Appearance mode sheet has base and active mode variants.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.appearance-syntax-keyword':
      'Appearance preview syntax colors are repeated in the miniature workbench preview.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.appearance-syntax-string':
      'Appearance preview syntax colors are repeated in the miniature workbench preview.',
    'apps/desktop/src/renderer/styles/features/settings.scss::.appearance-syntax-number':
      'Appearance preview syntax colors are repeated in the miniature workbench preview.',
    'apps/desktop/src/renderer/styles/features/timeline.scss::.session-turn-row':
      'Timeline row has base and narrow viewport padding.',
    'apps/desktop/src/renderer/styles/features/timeline.scss::.user-message-bubble':
      'User message bubble has base and timeline-specific display variants.',
    'apps/desktop/src/renderer/styles/markdown.scss::.md-body h5':
      'Markdown heading levels share base typography and then specific colors.',
    'apps/desktop/src/renderer/styles/markdown.scss::.md-body h6':
      'Markdown heading levels share base typography and then specific colors.',
    'apps/desktop/src/renderer/styles/modal.scss::.git-workflow-modal':
      'Git workflow modal shares permission modal surface tokens before modal-specific sizing.',
    'apps/desktop/src/renderer/styles/modal.scss::.archive-session-toast':
      'Archive toast shares toast surface tokens before archive-specific sizing.',
    'apps/desktop/src/renderer/styles/modal.scss::.archive-session-toast-close':
      'Archive toast close button has base and hover/focus variants.',
    'apps/desktop/src/renderer/styles/modal.scss::.git-workflow-form textarea':
      'Git workflow textarea has base and focus variants.',
    'apps/desktop/src/renderer/styles/modal.scss::.git-workflow-check':
      'Git workflow check row has base and state-specific variants.',
    'apps/desktop/src/renderer/styles/modal.scss::.github-login-panel p':
      'GitHub login copy has base and secondary paragraph styling.',
    'apps/desktop/src/renderer/styles/modal.scss::.github-repository-empty':
      'GitHub repository empty state has base and icon-specific variants.',
    'apps/desktop/src/renderer/styles/popover.scss::[data-radix-popper-content-wrapper]:has(.rm-model-menu)':
      'Radix wrapper rules are split between generic and runtime positioning constraints.',
    'apps/desktop/src/renderer/styles/popover.scss::.settings-dropdown-content':
      'Settings dropdown content shares popover surface tokens before dropdown sizing.',
    'apps/desktop/src/renderer/styles/popover.scss::.popover-item-tooltip':
      'Popover tooltip has base and arrow-position variants.',
    'apps/desktop/src/renderer/styles/popover.scss::.popover-item-arrow':
      'Popover arrow has base and tooltip placement variants.',
  }),
)

const crossFileAllowlist = new Map(
  Object.entries({
    '.appearance-preview-codeblock':
      'Card primitive and settings preview intentionally share code surface tokens.',
    '.automation-button':
      'Automation feature owns button sizing while shared button CSS owns common control radius.',
    '.automation-button:not(.is-primary)':
      'Shared secondary button tokens apply to automation buttons.',
    '.automation-quick-button':
      'Quick automation button combines shared secondary button primitives with feature layout.',
    '.automation-quick-button:hover':
      'Shared hover token and feature hover surface intentionally align.',
    '.chip-button':
      'Chip button combines shared radius primitive with chip-local layout.',
    '.chip-button:hover':
      'Chip hover uses shared state tokens plus chip-specific hover grouping.',
    '.chat-input__dropdown-item':
      'Dropdown item combines shared menu primitive with composer-local spacing.',
    '.chat-input__dropdown-switch':
      'Switch primitive and composer dropdown switch intentionally share dimensions.',
    '.chat-input__dropdown-switch-thumb':
      'Switch primitive and composer dropdown switch thumb intentionally share dimensions.',
    '.composer .icon-button:hover':
      'Composer icon hover inherits shared chip hover tokens and composer-local color.',
    '.empty-canvas-card p':
      'Placeholder copy shares muted utility typography across utility pages.',
    '.message-action':
      'Message action combines shared control radius with message action sizing.',
    '.message-action:hover':
      'Message action hover shares chip hover state tokens.',
    '.message-action[data-state="open"]':
      'Message action open state shares chip active state tokens.',
    '.message-card p':
      'Placeholder copy shares muted utility typography across utility pages.',
    '.meta-chip':
      'Meta chip combines shared radius primitive with chip-local layout.',
    '.meta-chip:hover':
      'Meta chip hover uses shared state tokens plus chip-specific hover grouping.',
    '.muted-copy':
      'Muted utility copy is shared between search and session pages.',
    '.permission-select-content':
      'Permission select content uses shared popover sizing and composer-local content constraints.',
    '.placeholder-card p':
      'Placeholder copy shares muted utility typography across utility pages.',
    '.plugins-button:not(.is-primary)':
      'Shared secondary button tokens apply to plugin buttons.',
    '.plugins-card:hover':
      'Shared hover elevation and plugin card hover intentionally align.',
    '.plugins-empty':
      'Plugin empty state combines card primitive and marketplace-local layout.',
    '.plugins-filter':
      'Plugin filter combines shared control primitive with marketplace-local layout.',
    '.plugins-search':
      'Plugin search combines shared input primitive with marketplace-local layout.',
    '.quick-chat-hero p':
      'Quick chat hero copy shares muted utility typography with search utilities.',
    '.quick-chat-view':
      'Quick chat view is a utility page with session-local layout.',
    '.quick-chat-workspace.with-review-sidebar':
      'Review feature adds the review-sidebar layout variant to quick chat workspace.',
    '.right-dock .review-sidebar':
      'Review sidebar is hosted inside the right dock and shares dock constraints.',
    '.right-dock-file-preview':
      'Right dock file preview combines dock container and review preview layout.',
    '.right-dock-search':
      'Right dock search combines shared input radius and dock-local sizing.',
    '.right-dock-terminal-composer input':
      'Terminal composer input combines shared input radius and dock-local sizing.',
    '.search-input-row':
      'Search input row combines shared input surface and search-local layout.',
    '.search-result-row:hover':
      'Search result hover combines shared card hover and search-local hover.',
    '.settings-button':
      'Settings button combines shared button primitive and settings-local variants.',
    '.settings-button.primary':
      'Settings primary button combines shared primary tokens and settings-local selector legacy.',
    '.settings-button:not(.is-primary):not(.primary):not(.danger):not(.link)':
      'Shared secondary button tokens apply to settings buttons.',
    '.settings-dropdown':
      'Settings dropdown combines shared input primitive and settings-local variants.',
    '.settings-dropdown-content':
      'Settings dropdown content combines input and popover surface primitives.',
    '.settings-dropdown-icon':
      'Settings dropdown icon combines input primitive sizing and settings-local icon layout.',
    '.settings-dropdown-item[data-highlighted]':
      'Dropdown highlighted state combines menu primitive and popover item state.',
    '.settings-dropdown-item[data-disabled]':
      'Dropdown disabled state combines menu primitive and popover item state.',
    '.settings-dropdown-value':
      'Settings dropdown value combines input primitive and settings-local content layout.',
    '.settings-input':
      'Settings input combines shared input primitive and settings-local variants.',
    '.settings-input-compact':
      'Settings compact input combines shared input primitive and settings-local sizing.',
    '.settings-input-narrow':
      'Settings narrow input combines shared input primitive and settings-local sizing.',
    '.settings-input-number':
      'Settings numeric input combines shared input primitive and settings-local sizing.',
    '.settings-input-number:focus':
      'Numeric input focus combines shared input focus and settings-local validation focus.',
    '.settings-textarea':
      'Settings textarea combines shared input primitive and settings-local variants.',
    '.settings-nav-group-title':
      'Settings navigation title is rendered in the desktop sidebar and settings page.',
    '.sidebar-context-menu-content':
      'Sidebar context menu combines shared popover surface and sidebar-local sizing.',
    '.theme-dropdown-content':
      'Theme dropdown content combines shared popover surface and settings-local sizing.',
    '.timeline-file-event-ghost-button':
      'Timeline file ghost button shares review file action button primitives.',
    '.timeline-file-event-review-button':
      'Timeline file review button combines session event and review sidebar contexts.',
    '.utility-view':
      'Utility view is shared by search and quick-chat surfaces.',
    '.utility-view-header p':
      'Utility header copy shares muted utility typography.',
    '.workflow-composer-card-permission .inline-approval-submit':
      'Workflow permission submit uses shared primary button tokens.',
    '.workflow-composer-card-permission .inline-approval-submit:hover':
      'Workflow permission submit hover uses shared primary button tokens.',
    '.workflow-composer-card-plan .exit-plan-mode-submit':
      'Workflow plan submit uses shared primary button tokens.',
    '.workflow-composer-card-plan .exit-plan-mode-submit:hover':
      'Workflow plan submit hover uses shared primary button tokens.',
    '.workflow-composer-card-question .inline-approval-submit':
      'Workflow question submit uses shared primary button tokens.',
    '.workflow-composer-card-question .inline-approval-submit:hover':
      'Workflow question submit hover uses shared primary button tokens.',
  }),
)

const scopedTargetAllowlist = new Map()

const stateSelectorPattern =
  /:(hover|focus|focus-visible|focus-within|active|disabled|checked|has|not|first|last|nth|root)|\[data-theme=|\[data-reduce-motion=/

const allowedOverlapProps = new Set([
  'animation',
  'animation-duration',
  'animation-iteration-count',
  'cursor',
  'outline',
  'scroll-behavior',
  'transition',
  'transition-duration',
  'user-select',
  '-webkit-user-select',
])

function normalizePath(filePath) {
  return relative(repoRoot, filePath).replaceAll('\\', '/')
}

function readImportedScssFiles() {
  const indexScss = readFileSync(indexPath, 'utf8')
  return [...indexScss.matchAll(/@use\s+['"](.+?)['"]/g)]
    .map(match => match[1])
    .filter(specifier => specifier !== 'vendor')
    .map(specifier => join(dirname(indexPath), specifier + '.scss'))
}

function readAllStyleFiles(directory = stylesRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      return readAllStyleFiles(entryPath)
    }
    return /\.(?:css|scss)$/.test(entry.name) ? [entryPath] : []
  })
}

function compileScssFile(filePath) {
  const result = compile(filePath, { style: 'expanded' })
  return result.css
}

function stripCommentsKeepLines(css) {
  let result = ''
  let state = 'normal'
  let urlDepth = 0

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    const next = css[index + 1]

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  '
        index += 1
        state = 'normal'
      } else {
        result += char === '\n' || char === '\r' ? char : ' '
      }
      continue
    }

    if (state === 'line-comment') {
      if (char === '\n' || char === '\r') {
        result += char
        state = 'normal'
      } else {
        result += ' '
      }
      continue
    }

    if (state === 'single-quote' || state === 'double-quote') {
      if (
        char === '\\' &&
        next !== undefined &&
        next !== '\n' &&
        next !== '\r'
      ) {
        result += '  '
        index += 1
      } else if (
        (state === 'single-quote' && char === "'") ||
        (state === 'double-quote' && char === '"')
      ) {
        result += char
        state = 'normal'
      } else {
        result += char === '\n' || char === '\r' ? char : ' '
      }
      continue
    }

    if (char === "'") {
      result += char
      state = 'single-quote'
      continue
    }
    if (char === '"') {
      result += char
      state = 'double-quote'
      continue
    }

    const urlMatch = css.slice(index).match(/^url\s*\(/i)
    if (urlDepth === 0 && urlMatch) {
      result += urlMatch[0]
      index += urlMatch[0].length - 1
      urlDepth = 1
      continue
    }
    if (urlDepth > 0) {
      if (char === '(') {
        result += char
        urlDepth += 1
      } else if (char === ')') {
        result += char
        urlDepth -= 1
      } else {
        result += char === '\n' || char === '\r' ? char : ' '
      }
      continue
    }

    if (char === '/' && next === '*') {
      result += '  '
      index += 1
      state = 'block-comment'
      continue
    }
    if (char === '/' && next === '/') {
      result += '  '
      index += 1
      state = 'line-comment'
      continue
    }

    result += char
  }

  return result
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length
}

function splitSelectors(selectorText) {
  const selectors = []
  let current = ''
  let depth = 0

  for (const char of selectorText) {
    if (char === '(' || char === '[') {
      depth += 1
    } else if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1)
    }

    if (char === ',' && depth === 0) {
      const selector = current.trim()
      if (selector) {
        selectors.push(selector.replace(/\s+/g, ' '))
      }
      current = ''
    } else {
      current += char
    }
  }

  const selector = current.trim()
  if (selector) {
    selectors.push(selector.replace(/\s+/g, ' '))
  }

  return selectors
}

function parseDeclarations(body) {
  const declarations = []
  const declarationPattern = /(^|;)\s*(--?[a-zA-Z0-9_-]+)\s*:/g
  for (const match of body.matchAll(declarationPattern)) {
    declarations.push(match[2])
  }
  return declarations
}

function isIgnorableRule(selectorText) {
  const trimmed = selectorText.trim()
  return (
    !trimmed ||
    trimmed.startsWith('@') ||
    trimmed === 'from' ||
    trimmed === 'to'
  )
}

function parseCssFromContent(cssContent, filePath, orderOffset) {
  const lines = stripCommentsKeepLines(cssContent).split(
    /\r?\n/,
  )
  const rules = []

  let selectorBuffer = ''
  let selectorText = ''
  let body = ''
  let startLine = 0
  let depth = 0
  let inRule = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (!inRule) {
      const braceIndex = line.indexOf('{')
      if (braceIndex === -1) {
        selectorBuffer += `\n${line}`
        continue
      }

      selectorBuffer += `\n${line.slice(0, braceIndex)}`
      selectorText = selectorBuffer.trim()
      selectorBuffer = ''

      if (isIgnorableRule(selectorText)) {
        continue
      }

      body = `${line.slice(braceIndex + 1)}\n`
      startLine = index + 1
      depth = 1
      inRule = true

      if (line.slice(braceIndex + 1).includes('}')) {
        body = line.slice(braceIndex + 1, line.indexOf('}', braceIndex + 1))
        inRule = false
        pushRules(rules, filePath, selectorText, body, startLine, orderOffset)
      }
      continue
    }

    depth += (line.match(/{/g) ?? []).length
    depth -= (line.match(/}/g) ?? []).length

    if (depth <= 0) {
      body += line.slice(0, line.lastIndexOf('}'))
      inRule = false
      pushRules(rules, filePath, selectorText, body, startLine, orderOffset)
      selectorText = ''
      body = ''
    } else {
      body += `${line}\n`
    }
  }

  return rules
}

function parseCssRules(filePath, orderOffset) {
  return parseCssFromContent(readFileSync(filePath, 'utf8'), filePath, orderOffset)
}

function pushRules(rules, filePath, selectorText, body, line, orderOffset) {
  const declarations = parseDeclarations(body)
  if (declarations.length === 0) {
    return
  }

  for (const selector of splitSelectors(selectorText)) {
    rules.push({
      declarations,
      filePath,
      line,
      order: orderOffset + rules.length,
      selector,
    })
  }
}

function overlappingDeclarations(previousRules, currentRule) {
  const previousDeclarations = new Set(
    previousRules.flatMap(rule => rule.declarations),
  )
  return [...new Set(currentRule.declarations)].filter(
    declaration =>
      previousDeclarations.has(declaration) &&
      !allowedOverlapProps.has(declaration),
  )
}

function nonCustomDeclarations(rule) {
  return rule.declarations.filter(declaration => !declaration.startsWith('--'))
}

function lastCompoundSelector(selector) {
  const parts = []
  let current = ''
  let depth = 0

  for (const char of selector) {
    if (char === '(' || char === '[') {
      depth += 1
    } else if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1)
    }

    if (depth === 0 && /[\s>+~]/.test(char)) {
      const part = current.trim()
      if (part) {
        parts.push(part)
      }
      current = ''
    } else {
      current += char
    }
  }

  const part = current.trim()
  if (part) {
    parts.push(part)
  }

  return parts.at(-1) ?? selector
}

function isScopedTargetCandidate(rule) {
  if (stateSelectorPattern.test(rule.selector)) {
    return false
  }

  const target = lastCompoundSelector(rule.selector)
  return target.startsWith('.') || target.startsWith('[data-')
}

function scopedTargetOverlap(previousRules, currentRule) {
  const currentDeclarations = new Set(nonCustomDeclarations(currentRule))
  if (currentDeclarations.size === 0) {
    return []
  }

  const previousDeclarations = new Set(
    previousRules.flatMap(rule => nonCustomDeclarations(rule)),
  )

  return [...currentDeclarations].filter(
    declaration =>
      previousDeclarations.has(declaration) &&
      !allowedOverlapProps.has(declaration),
  )
}

function isAllowedScopedTargetOverlap(rule, previousRules) {
  for (const previousRule of previousRules) {
    const key = `${previousRule.selector} -> ${rule.selector}`
    if (scopedTargetAllowlist.has(key)) {
      return true
    }
  }

  return false
}

function isAllowedSameFileOverlap(rule, allRules) {
  const relativePath = normalizePath(rule.filePath)
  const key = `${relativePath}::${rule.selector}`
  if (sameFileAllowlist.has(key)) {
    return true
  }

  if (stateSelectorPattern.test(rule.selector)) {
    return true
  }

  const firstLine = allRules[0]?.line ?? rule.line
  return rule.line - firstLine < 8
}

function isAllowedCrossFileOverlap(rule) {
  if (crossFileAllowlist.has(rule.selector)) {
    return true
  }

  return stateSelectorPattern.test(rule.selector)
}

function main() {
  const files = readImportedScssFiles()
  const typographyFiles = readAllStyleFiles()
  const typographyErrors = []
  const numericFontTokenPattern =
    /var\(\s*--font-size-\d+(?:\.\d+)?\b(?:\s*,[^)]*)?\)/g
  const fixedPixelFontSizePattern = /font-size\s*:\s*[0-9.]+px\b/g

  for (const filePath of typographyFiles) {
    const relativePath = normalizePath(filePath)
    if (relativePath.endsWith('/design-system/tokens.scss')) {
      continue
    }

    const content = stripCommentsKeepLines(readFileSync(filePath, 'utf8'))
    for (const match of content.matchAll(numericFontTokenPattern)) {
      typographyErrors.push({
        detail: `uses numeric font token ${match[0]}`,
        filePath,
        line: lineNumberAt(content, match.index),
      })
    }
    for (const match of content.matchAll(fixedPixelFontSizePattern)) {
      typographyErrors.push({
        detail: 'uses a fixed pixel font-size',
        filePath,
        line: lineNumberAt(content, match.index),
      })
    }
  }

  let allRules = []
  for (const filePath of files) {
    const css = compileScssFile(filePath)
    allRules = allRules.concat(parseCssFromContent(css, filePath, allRules.length))
  }

  const bySelector = new Map()
  for (const rule of allRules) {
    const rules = bySelector.get(rule.selector) ?? []
    rules.push(rule)
    bySelector.set(rule.selector, rules)
  }

  const errors = []
  const allowedSameFile = []
  const allowedCrossFile = []
  const allowedScopedTarget = []

  for (const [selector, rules] of bySelector) {
    if (rules.length < 2) {
      continue
    }

    for (let index = 1; index < rules.length; index += 1) {
      const rule = rules[index]
      const previousRules = rules.slice(0, index)
      const overlap = overlappingDeclarations(previousRules, rule)
      if (overlap.length === 0) {
        continue
      }

      const sameFilePreviousRules = previousRules.filter(
        previousRule => previousRule.filePath === rule.filePath,
      )
      const isSameFile = sameFilePreviousRules.length > 0

      if (isSameFile) {
        const sameFileRules = rules.filter(
          candidate => candidate.filePath === rule.filePath,
        )
        if (isAllowedSameFileOverlap(rule, sameFileRules)) {
          allowedSameFile.push({ overlap, rule, selector })
        } else {
          errors.push({
            kind: 'same-file',
            overlap,
            previousRules: sameFilePreviousRules,
            rule,
            selector,
          })
        }
        continue
      }

      if (isAllowedCrossFileOverlap(rule)) {
        allowedCrossFile.push({ overlap, previousRules, rule, selector })
      } else {
        errors.push({
          kind: 'cross-file',
          overlap,
          previousRules,
          rule,
          selector,
        })
      }
    }
  }

  const byScopedTarget = new Map()
  for (const rule of allRules) {
    if (!isScopedTargetCandidate(rule)) {
      continue
    }

    const target = lastCompoundSelector(rule.selector)
    const previousRules = (byScopedTarget.get(target) ?? []).filter(
      previousRule => previousRule.selector !== rule.selector,
    )
    const overlap = scopedTargetOverlap(previousRules, rule)

    if (overlap.length > 0) {
      if (isAllowedScopedTargetOverlap(rule, previousRules)) {
        allowedScopedTarget.push({ overlap, previousRules, rule, target })
      } else {
        errors.push({
          kind: 'scoped-target',
          overlap,
          previousRules,
          rule,
          selector: target,
        })
      }
    }

    byScopedTarget.set(target, [...(byScopedTarget.get(target) ?? []), rule])
  }

  if (errors.length > 0 || typographyErrors.length > 0) {
    for (const error of errors) {
      console.error(
        `${error.kind}: ${error.selector} redefines ${error.overlap.join(
          ', ',
        )}`,
      )
      for (const previousRule of error.previousRules.slice(-3)) {
        console.error(
          `  previous ${normalizePath(previousRule.filePath)}:${
            previousRule.line
          }`,
        )
      }
      console.error(`  current  ${normalizePath(error.rule.filePath)}:${error.rule.line}`)
    }
    for (const error of typographyErrors) {
      console.error(
        `typography: ${normalizePath(error.filePath)}:${error.line} ${error.detail}`,
      )
    }
    console.error(
      `\nDesktop CSS override check failed with ${errors.length} unapproved overlap(s) and ${typographyErrors.length} typography violation(s).`,
    )
    process.exit(1)
  }

  console.log(
    `Desktop CSS override check passed (${allowedSameFile.length} same-file, ${allowedCrossFile.length} cross-file, ${allowedScopedTarget.length} scoped-target approved overlap(s), and 0 typography violations).`,
  )
}

main()
