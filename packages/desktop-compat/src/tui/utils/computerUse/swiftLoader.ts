import type { ComputerUseAPI } from '@ant/computer-use-swift'
import {
  getOptionalPackageAvailability,
  requireOptionalPackage,
} from '../optionalPackage.js'

let cached: ComputerUseAPI | undefined

/**
 * Package's js/index.js reads COMPUTER_USE_SWIFT_NODE_PATH (baked by
 * build-with-plugins.ts on darwin targets, unset otherwise — falls through to
 * the node_modules prebuilds/ path). We cache the loaded native module.
 *
 * The four @MainActor methods (captureExcluding, captureRegion,
 * apps.listInstalled, resolvePrepareCapture) dispatch to DispatchQueue.main
 * and will hang under libuv unless CFRunLoop is pumped — call sites wrap
 * these in drainRunLoop().
 */
export function requireComputerUseSwift(): ComputerUseAPI {
  if (process.platform !== 'darwin') {
    throw new Error('@ant/computer-use-swift is macOS-only')
  }
  const swift = requireOptionalPackage<ComputerUseAPI>('@ant/computer-use-swift')
  if (!swift) {
    const availability = getOptionalPackageAvailability('@ant/computer-use-swift')
    throw new Error(
      `@ant/computer-use-swift is unavailable: ${availability.reason}`,
    )
  }
  return (cached ??= swift)
}

export type { ComputerUseAPI }
