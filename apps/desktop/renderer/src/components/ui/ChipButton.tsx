import { forwardRef } from 'react'
import type React from 'react'
import { Slot, Slottable } from '@radix-ui/react-slot'
import { ChevronDown } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './iconTokens.js'
import { Spinner } from './Spinner.js'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode
  active?: boolean
  asChild?: boolean
  className?: string
  loading?: boolean
  showChevron?: boolean
  title: string
}

export const ChipButton = forwardRef<HTMLButtonElement, Props>(
  function ChipButton(
    {
      children,
      active,
      asChild,
      className = '',
      loading = false,
      showChevron = true,
      title,
      type = 'button',
      ...buttonProps
    },
    ref,
  ): React.ReactNode {
    const Comp = asChild ? Slot : 'button'
    const typedProps = asChild ? buttonProps : { ...buttonProps, type }

    return (
      <Comp
        {...typedProps}
        ref={ref}
        aria-expanded={active}
        className={[
          'interactive-row',
          'interactive-row--composer',
          'chip-button',
          className,
        ].join(' ')}
        title={title}
      >
        <Slottable>{children}</Slottable>
        {loading ? (
          <Spinner
            className="chip-button-spinner composer-model-loading-spinner"
          />
        ) : showChevron ? (
          <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        ) : null}
      </Comp>
    )
  },
)
