import React from 'react'
import { Server } from 'lucide-react'

import { RemoteImage } from '../../../components/ui/RemoteImage.js'

/**
 * Provider logos always come from the catalogue `logoURL` so the composer
 * shows the same brand mark as the provider settings surface. Providers with no
 * catalogue logo fall back to the shared generic provider glyph, never to a
 * locally bundled brand mark.
 */
export function ProviderLogo({ logoURL }: { logoURL?: string }): React.ReactNode {
  const fallback = <Server aria-hidden="true" size={14} data-icon-kind="artwork" strokeWidth={2} />

  return (
    <span aria-hidden="true" className="composer-provider-logo">
      {logoURL ? (
        <RemoteImage
          alt=""
          className="composer-provider-logo-image"
          fallback={fallback}
          src={logoURL}
        />
      ) : (
        fallback
      )}
    </span>
  )
}
