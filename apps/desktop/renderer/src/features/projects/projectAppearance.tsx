import type React from 'react'
import {
  BarChart3,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  CircleDollarSign,
  Dumbbell,
  Earth,
  FlaskConical,
  Flower2,
  Folder,
  GraduationCap,
  Heart,
  HeartPulse,
  NotebookTabs,
  Palette,
  PawPrint,
  PenLine,
  Popcorn,
  Scale,
  Settings2,
  Sparkles,
  Stethoscope,
  TerminalSquare,
  Wrench,
  type LucideIcon,
  Music2,
  Braces,
  Paintbrush,
  Plane,
  Sprout,
  Weight,
} from 'lucide-react'
import type {
  ProjectAppearance,
  ProjectAppearanceColor,
  ProjectAppearanceIcon,
} from '../../../shared/types.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'

export const DEFAULT_PROJECT_APPEARANCE: ProjectAppearance = {
  color: 'default',
  icon: 'folder',
}

export const PROJECT_APPEARANCE_COLORS: readonly ProjectAppearanceColor[] = [
  'default',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
]

const PROJECT_ICON_COMPONENTS: Record<ProjectAppearanceIcon, LucideIcon> = {
  folder: Folder,
  dollar: CircleDollarSign,
  book: BookOpen,
  graduation: GraduationCap,
  edit: PenLine,
  writing: NotebookTabs,
  function: Braces,
  terminal: TerminalSquare,
  music: Music2,
  popcorn: Popcorn,
  customize: Settings2,
  palette: Palette,
  stethoscope: Stethoscope,
  health: HeartPulse,
  plant: Sprout,
  suitcase: BriefcaseBusiness,
  chart: BarChart3,
  kettlebell: Weight,
  dumbbell: Dumbbell,
  logs: NotebookTabs,
  scale: Scale,
  globe: Earth,
  wrench: Wrench,
  paw: PawPrint,
  flask: FlaskConical,
  brain: Brain,
  heart: Heart,
  flower: Flower2,
  paintbrush: Paintbrush,
  plane: Plane,
}

export const PROJECT_APPEARANCE_ICONS = Object.keys(
  PROJECT_ICON_COMPONENTS,
) as ProjectAppearanceIcon[]

export function ProjectAppearanceGlyph({
  appearance = DEFAULT_PROJECT_APPEARANCE,
  className,
  size = APP_ICON_SIZE,
}: {
  appearance?: ProjectAppearance
  className?: string
  size?: number
}): React.ReactNode {
  const Icon = PROJECT_ICON_COMPONENTS[appearance.icon] ?? Sparkles
  return (
    <span
      aria-hidden="true"
      className={className}
      data-project-color={appearance.color}
    >
      <Icon size={size} strokeWidth={APP_ICON_STROKE_WIDTH} />
    </span>
  )
}
