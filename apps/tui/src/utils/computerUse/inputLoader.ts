import type {
  ComputerUseInput,
  ComputerUseInputAPI,
} from '@ant/computer-use-input'
import {
  getOptionalPackageAvailability,
  requireOptionalPackage,
} from '../optionalPackage.js'

let cached: ComputerUseInputAPI | undefined

/**
 * Package's js/index.js reads COMPUTER_USE_INPUT_NODE_PATH (baked by
 * build-with-plugins.ts on darwin targets, unset otherwise — falls through to
 * the node_modules prebuilds/ path).
 *
 * The package exports a discriminated union on `isSupported` — narrowed here
 * once so callers get the bare `ComputerUseInputAPI` without re-checking.
 *
 * key()/keys() dispatch enigo work onto DispatchQueue.main via
 * dispatch2::run_on_main, then block a tokio worker on a channel. Under
 * Electron (CFRunLoop drains the main queue) this works; under libuv
 * (Node/bun) the main queue never drains and the promise hangs. The executor
 * calls these inside drainRunLoop().
 */
export function requireComputerUseInput(): ComputerUseInputAPI {
  if (cached) return cached
  const input = requireOptionalPackage<ComputerUseInput>(
    '@ant/computer-use-input',
  )
  if (!input) {
    const availability = getOptionalPackageAvailability('@ant/computer-use-input')
    throw new Error(
      `@ant/computer-use-input is unavailable: ${availability.reason}`,
    )
  }
  if (!input.isSupported) {
    throw new Error('@ant/computer-use-input is not supported on this platform')
  }
  return (cached = input)
}
