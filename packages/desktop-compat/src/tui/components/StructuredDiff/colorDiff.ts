import {
  ColorDiff as TsColorDiff,
  ColorFile as TsColorFile,
  getSyntaxTheme as getTsSyntaxTheme,
  type NativeModule,
  type SyntaxTheme,
} from '../../native-ts/color-diff/index.js'
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'
import { requireOptionalPackage } from '../../utils/optionalPackage.js'

export type ColorModuleUnavailableReason = 'env'

/**
 * Returns a static reason why the color-diff module is unavailable, or null if available.
 * 'env' = disabled via CLAUDE_CODE_SYNTAX_HIGHLIGHT
 *
 * The TS port of color-diff works in all build modes, so the only way to
 * disable it is via the env var.
 */
export function getColorModuleUnavailableReason(): ColorModuleUnavailableReason | null {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT)) {
    return 'env'
  }
  return null
}

let cachedColorModule: NativeModule | undefined

function getColorModule(): NativeModule {
  if (cachedColorModule) return cachedColorModule
  cachedColorModule =
    requireOptionalPackage<NativeModule>('color-diff-napi') ?? {
      ColorDiff: TsColorDiff,
      ColorFile: TsColorFile,
      getSyntaxTheme: getTsSyntaxTheme,
    }
  return cachedColorModule
}

export function expectColorDiff(): typeof TsColorDiff | null {
  return getColorModuleUnavailableReason() === null
    ? getColorModule().ColorDiff
    : null
}

export function expectColorFile(): typeof TsColorFile | null {
  return getColorModuleUnavailableReason() === null
    ? getColorModule().ColorFile
    : null
}

export function getSyntaxTheme(themeName: string): SyntaxTheme | null {
  return getColorModuleUnavailableReason() === null
    ? getColorModule().getSyntaxTheme(themeName)
    : null
}
