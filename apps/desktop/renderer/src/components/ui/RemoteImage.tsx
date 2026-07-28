import React, { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../../utils/cx.js'
import { SkeletonBlock } from './Skeleton.js'

type RemoteImageState = 'loading' | 'ready' | 'error'

export type RemoteImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src'
> & {
  src: string
  className?: string
  imageClassName?: string
  fallback: React.ReactNode
}

export function RemoteImage({
  src,
  className,
  imageClassName,
  fallback,
  alt,
  onLoad,
  onError,
  ...imageProps
}: RemoteImageProps): React.ReactNode {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [state, setState] = useState<RemoteImageState>('loading')

  useLayoutEffect(() => {
    setState('loading')
    const image = imageRef.current
    if (!image?.complete) return
    setState(image.naturalWidth > 0 ? 'ready' : 'error')
  }, [src])

  return (
    <span
      className={cx('ui-remote-image', className)}
      data-state={state}
    >
      {state === 'loading' ? (
        <SkeletonBlock className="ui-remote-image-skeleton" />
      ) : null}
      {state === 'error' ? (
        <span
          aria-hidden={alt === '' ? 'true' : undefined}
          className="ui-remote-image-fallback"
        >
          {fallback}
        </span>
      ) : (
        <img
          {...imageProps}
          alt={alt}
          className={cx('ui-remote-image-content', imageClassName)}
          onError={event => {
            setState('error')
            onError?.(event)
          }}
          onLoad={event => {
            setState('ready')
            onLoad?.(event)
          }}
          ref={imageRef}
          src={src}
        />
      )}
    </span>
  )
}
