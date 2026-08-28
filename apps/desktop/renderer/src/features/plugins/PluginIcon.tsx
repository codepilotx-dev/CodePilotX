import type React from 'react'
import {
  Eye,
  FileSpreadsheet,
  GitBranch,
  Presentation,
  Sparkles,
} from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import type { PluginIconName } from './pluginCatalog.js'
import browserLogo from '../../assets/plugin-icons/browser.png'
import chromeLogo from '../../assets/plugin-icons/chrome.png'
import computerUseLogo from '../../assets/plugin-icons/computer-use.png'
import githubDarkLogo from '../../assets/plugin-icons/github-dark.png'
import githubLogo from '../../assets/plugin-icons/github.svg'
import presentationsLogo from '../../assets/plugin-icons/presentations.png'
import spreadsheetsLogo from '../../assets/plugin-icons/spreadsheets.png'

type Props = {
  name: PluginIconName
  className?: string
  logoSource?: string
  logoDarkSource?: string
}

type KnownPluginLogo = {
  source: string
  darkSource?: string
}

const KNOWN_PLUGIN_LOGOS: Partial<Record<PluginIconName, KnownPluginLogo>> = {
  browser: { source: browserLogo },
  chrome: { source: chromeLogo },
  'computer-use': { source: computerUseLogo },
  github: { source: githubLogo, darkSource: githubDarkLogo },
  presentations: { source: presentationsLogo },
  spreadsheets: { source: spreadsheetsLogo },
}

export function PluginIcon({
  name,
  className,
  logoDarkSource,
  logoSource,
}: Props): React.ReactNode {
  const knownLogo = KNOWN_PLUGIN_LOGOS[name]
  const source = logoSource ?? knownLogo?.source
  const darkSource = logoDarkSource ?? knownLogo?.darkSource

  if (source) {
    return (
      <span
        aria-hidden="true"
        className={`plugin-logo${darkSource ? ' plugin-logo--themed' : ''} ${className ?? ''}`.trim()}
      >
        <img alt="" className="plugin-logo__image plugin-logo__image--light" src={source} />
        {darkSource ? (
          <img alt="" className="plugin-logo__image plugin-logo__image--dark" src={darkSource} />
        ) : null}
      </span>
    )
  }

  const props = {
    'aria-hidden': true,
    className,
    size: APP_ICON_SIZE,
    strokeWidth: APP_ICON_STROKE_WIDTH,
  } as const

  switch (name) {
    case 'browser':
    case 'chrome':
      return <Eye {...props} />
    case 'spreadsheets':
      return <FileSpreadsheet {...props} />
    case 'presentations':
      return <Presentation {...props} />
    case 'github':
      return <GitBranch {...props} />
    case 'computer-use':
    case 'minimax':
      return <Sparkles {...props} />
  }
}
