import { isInBundledMode } from '@codepilotx/tui/utils/bundledMode.js'
import { getCurrentInstallationType } from '@codepilotx/tui/utils/doctorDiagnostic.js'
import { isEnvTruthy } from '@codepilotx/tui/utils/envUtils.js'
import { useStartupNotification } from './useStartupNotification.js'

const NPM_DEPRECATION_MESSAGE =
  'CodePilotX has switched from npm to native installer. Run `codepilotx install` or see https://docs.anthropic.com/en/docs/claude-code/getting-started for more options.'

export function useNpmDeprecationNotification(): void {
  useStartupNotification(async () => {
    if (
      isInBundledMode() ||
      isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)
    ) {
      return null
    }
    const installationType = await getCurrentInstallationType()
    if (installationType === 'development') return null
    return {
      timeoutMs: 15000,
      key: 'npm-deprecation-warning',
      text: NPM_DEPRECATION_MESSAGE,
      color: 'warning',
      priority: 'high',
    }
  })
}
