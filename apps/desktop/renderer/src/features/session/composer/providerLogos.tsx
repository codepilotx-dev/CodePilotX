import React, { useState } from 'react'
import { Server } from 'lucide-react'

import { RemoteImage } from '../../../components/ui/RemoteImage.js'

/**
 * Provider logos always come from the catalogue `logoURL` so the composer
 * shows the same brand mark as the provider settings surface. Providers with no
 * catalogue logo fall back to the shared generic provider glyph, never to a
 * locally bundled brand mark.
 */
export function ProviderLogo({ logoURL }: { logoURL?: string }): React.ReactNode {
  const [loadedURL, setLoadedURL] = useState<string>()
  const fallback = <Server aria-hidden="true" size={14} data-icon-kind="artwork" strokeWidth={2} />

  return (
    <span
      aria-hidden="true"
      className="composer-provider-logo tw:relative tw:inline-flex tw:size-4.5 tw:shrink-0 tw:items-center tw:justify-center tw:text-inherit tw:[&>svg]:block tw:[&>svg]:size-full"
    >
      {logoURL ? (
        <RemoteImage
          alt=""
          className="composer-provider-logo-image"
          imageClassName="tw:invisible"
          fallback={fallback}
          src={logoURL}
          onLoad={() => setLoadedURL(logoURL)}
        />
      ) : (
        fallback
      )}
      {logoURL && loadedURL === logoURL ? (
        <span
          className="tw:pointer-events-none tw:absolute tw:inset-0 tw:bg-current tw:[mask-size:contain] tw:[mask-position:center] tw:[mask-repeat:no-repeat]"
          style={{ maskImage: `url(${JSON.stringify(logoURL)})` }}
        />
      ) : null}
    </span>
  )
}
