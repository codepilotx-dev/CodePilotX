import type { LabCategory, LabDemoDefinition } from './labTypes.js'

const demoModule = () => import('./LabSurfaceDemos.js')

function defineDemo(
  id: string,
  title: string,
  description: string,
  category: LabCategory,
  exportName: keyof typeof import('./LabSurfaceDemos.js'),
  sourceChunks: string[],
  selectors: string[],
  dataAttributes: string[] = [],
): LabDemoDefinition {
  return {
    id,
    title,
    description,
    category,
    status: 'visual-prototype',
    load: () =>
      demoModule().then(module => ({
        default: module[exportName],
      })),
    evidence: {
      confidence: 'confirmed',
      sourceChunks,
      selectors,
      themeTokens: [
        '--color-token-foreground',
        '--color-token-border',
        '--color-token-main-surface-primary',
      ],
      dataAttributes,
      runtimeVariables: [],
      platformVariants: ['electron', 'browser-mock', 'light', 'dark'],
    },
  }
}

export const LAB_DEMOS: readonly LabDemoDefinition[] = [
  defineDemo('avatar-overlay', 'Avatar Overlay', '像素 Avatar、活动胶囊与 resize 状态。', 'assistant', 'AvatarOverlayDemo', ['codex-avatar-CBhzyYwb.css', 'avatar-overlay-pill-material-BheeR2ow.css'], ['.codex-avatar', '.avatar-pill'], ['data-resizing']),
  defineDemo('global-dictation', 'Global Dictation', 'Orb、mini 与 expanded 听写表面。', 'assistant', 'GlobalDictationDemo', ['global-dictation-orb-BOlLShjq.css', 'global-dictation-page-DGhXs35T.css'], ['.dictation-orb', '.dictation-surface'], ['data-expanded']),
  defineDemo('model-picker', 'Model Picker', 'Power slider、Fast Mode 与 Ultra warning。', 'assistant', 'ModelPickerDemo', ['model-picker-power-slider-impl-DB_ZXGOd.css'], ['.model-power-slider'], ['data-fast', 'data-level']),
  defineDemo('artifact-editor', 'Artifact Editor', 'Magic Edit、writing block 与表格控制。', 'artifacts', 'ArtifactEditorDemo', ['app-initial~artifact-tab-content-B1OX0T1M.css'], ['.ProseMirror', '.writingBlockLoadingShimmer'], ['data-selected']),
  defineDemo('artifact-markdown', 'Artifact Markdown', 'Markdown、Mermaid、媒体与文件引用。', 'artifacts', 'ArtifactMarkdownDemo', ['app-initial~artifact-tab-content-DWZWEf8S.css'], ['.markdown', '[data-mermaid-overflow]'], ['data-mermaid-overflow']),
  defineDemo('pdf-preview', 'PDF Preview', 'Canvas、text layer 与 annotation layer。', 'artifacts', 'PdfPreviewDemo', ['pdf-preview-panel-BHPFKiOr.css'], ['.textLayer', '.annotationLayer']),
  defineDemo('presentation', 'Presentation', 'Thumbnail rail 与 stacked pages。', 'artifacts', 'PresentationDemo', ['PopcornElectronPresentationPanel-pMDpowHW.css'], ['.presentation-editor'], ['data-layout']),
  defineDemo('terminal', 'Terminal', 'xterm 宿主、ANSI 色与无障碍层。', 'developer', 'TerminalDemo', ['app-initial~app-main~new-thread-panel-page~onboarding-page~projects-index-page~appgen-libra~im95otkx-BrqwKW_G.css'], ['.xterm', '[data-codex-xterm]']),
  defineDemo('charts-maps', 'Charts & Maps', '主题化图表和离线地图骨架。', 'developer', 'ChartsMapsDemo', ['app-initial~avatarOverlayCompositionSurface~app-main~pet-install-modal-host~quick-chat-wind~oieh6gbs-W6svNPuO.css'], ['.recharts-wrapper', '.mapboxgl-map']),
  defineDemo('hotkey-window', 'Hotkey / Quick Chat', 'Tray、underlay 与浮动 composer。', 'shell', 'HotkeyWindowDemo', ['hotkey-window-home-page-C6z-fZIi.css'], ['.hotkey-window-home'], ['data-menu-open']),
  defineDemo('command-menu', 'Command & Process Menu', 'cmdk 的选择、禁用、加载和空状态。', 'shell', 'CommandMenuDemo', ['app-initial~artifact-tab-content-uRuhKLE-.css'], ['[data-cmdk-item]', '[data-cmdk-list]'], ['data-selected', 'data-disabled']),
  defineDemo('micro-bridge', 'Composer Micro Bridge', '蓝色焦点与绿色已选择状态。', 'assistant', 'MicroBridgeDemo', ['codex-micro-bridge-CRTmZgHP.css'], ['[data-composer-navigation-highlight]'], ['data-selected']),
  defineDemo('thread-rail', 'Thread Navigation Rail', '消息 scrubber、marker 距离与预览。', 'assistant', 'ThreadRailDemo', ['thread-user-message-navigation-rail-CM5rEI83.css'], ['.thread-navigation-rail'], ['data-scrubbing']),
  defineDemo('profile', 'Profile', '头像编辑 badge 与 loading shimmer。', 'system', 'ProfileDemo', ['profile-DOxOBCjz.css'], ['.profile-loading-shimmer']),
  defineDemo('remote-text', 'Remote Text Edit', 'Carlito 度量兼容文档排版。', 'artifacts', 'RemoteTextDemo', ['remote-text-edit-session-CW-aJKLZ.css'], ['@font-face Carlito']),
  defineDemo('motion-gallery', 'Loading & Motion', 'Shimmer、bloom、working dots 和状态动画。', 'system', 'MotionGalleryDemo', ['app-initial~app-main~onboarding-page~projects-index-page~plan-summary-page~hotkey-window-th~e5sxdgia-C6cWVbB-.css'], ['.cadencedShimmer'], ['data-reduce-motion']),
  defineDemo('layout-surfaces', 'Layout Surfaces', '单/双列、fade、floating inset 和 shell frame。', 'shell', 'LayoutSurfacesDemo', ['app-initial~avatarOverlayCompositionSurface~artifact-tab-content-DJDX7Pvr.css'], ['.app-shell-main-content-frame'], ['data-columns']),
  defineDemo('form-controls', 'Form Controls', '数字、颜色、slider 与 tooltip 定位。', 'system', 'FormControlsDemo', ['app-initial~app-main~new-thread-panel-page~onboarding-page~projects-index-page~appgen-libra~egjdcxue-CYswclfQ.css'], ['input[type=color]', '[data-side]']),
] as const

export const LAB_CATEGORY_LABELS: Record<LabCategory, string> = {
  assistant: '助手交互',
  artifacts: '制品与文档',
  developer: '开发工具',
  shell: '窗口与外壳',
  system: '系统组件',
}
