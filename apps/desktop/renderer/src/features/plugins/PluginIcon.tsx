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

type Props = {
  name: PluginIconName
  className?: string
}
export function PluginIcon({ name, className }: Props): React.ReactNode {
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
