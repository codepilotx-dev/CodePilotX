import * as Popover from '@radix-ui/react-popover'
import { Check } from 'lucide-react'
import { useState } from 'react'
import type React from 'react'
import type {
  ProjectAppearance,
  ProjectAppearanceColor,
  ProjectAppearanceIcon,
} from '../../../shared/types.js'
import { Button } from '../../components/ui/Button.js'
import { cx } from '../../utils/cx.js'
import {
  PROJECT_APPEARANCE_COLORS,
  PROJECT_APPEARANCE_ICONS,
  ProjectAppearanceGlyph,
} from './projectAppearance.js'

type Props = {
  appearance: ProjectAppearance
  disabled?: boolean
  onChange: (appearance: ProjectAppearance) => void
}

export function ProjectAppearancePicker({
  appearance,
  disabled = false,
  onChange,
}: Props): React.ReactNode {
  const [open, setOpen] = useState(false)

  function selectColor(color: ProjectAppearanceColor): void {
    onChange({ ...appearance, color })
  }

  function selectIcon(icon: ProjectAppearanceIcon): void {
    onChange({ ...appearance, icon })
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          aria-label="选择项目图标和颜色"
          className="project-appearance-trigger"
          disabled={disabled}
          type="button"
        >
          <ProjectAppearanceGlyph appearance={appearance} size={18} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          className="project-appearance-popover"
          collisionPadding={6}
          side="bottom"
          sideOffset={4}
        >
          <div
            aria-label="项目颜色"
            className="project-appearance-colors"
            role="radiogroup"
          >
            {PROJECT_APPEARANCE_COLORS.map(color => (
              <button
                aria-label={colorLabel(color)}
                aria-checked={appearance.color === color}
                className={cx(
                  'project-appearance-color',
                  appearance.color === color && 'is-selected',
                )}
                data-project-color={color}
                key={color}
                role="radio"
                type="button"
                onClick={() => selectColor(color)}
              >
                {appearance.color === color ? <Check size={14} /> : null}
              </button>
            ))}
          </div>
          <div
            aria-label="项目图标"
            className="project-appearance-icons"
            role="radiogroup"
          >
            {PROJECT_APPEARANCE_ICONS.map(icon => (
              <button
                aria-label={iconLabel(icon)}
                aria-checked={appearance.icon === icon}
                className={cx(
                  'project-appearance-icon',
                  appearance.icon === icon && 'is-selected',
                )}
                key={icon}
                role="radio"
                type="button"
                onClick={() => selectIcon(icon)}
              >
                <ProjectAppearanceGlyph
                  appearance={{ ...appearance, icon }}
                  size={19}
                />
              </button>
            ))}
          </div>
          <div className="project-appearance-footer">
            <Button onClick={() => setOpen(false)}>完成</Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function colorLabel(color: ProjectAppearanceColor): string {
  return {
    default: '默认',
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    green: '绿色',
    blue: '蓝色',
    purple: '紫色',
    pink: '粉色',
  }[color]
}

function iconLabel(icon: ProjectAppearanceIcon): string {
  return {
    folder: '文件夹',
    dollar: '货币',
    book: '书本',
    graduation: '教育',
    edit: '编辑',
    writing: '写作',
    function: '函数',
    terminal: '终端',
    music: '音乐',
    popcorn: '影视',
    customize: '自定义',
    palette: '调色板',
    stethoscope: '听诊器',
    health: '健康',
    plant: '植物',
    suitcase: '公文包',
    chart: '图表',
    kettlebell: '壶铃',
    dumbbell: '哑铃',
    logs: '日志',
    scale: '天平',
    globe: '地球',
    wrench: '扳手',
    paw: '爪印',
    flask: '烧瓶',
    brain: '大脑',
    heart: '爱心',
    flower: '花朵',
    paintbrush: '画笔',
    plane: '飞机',
  }[icon]
}
