/**
 * Desktop adapter for the core app runtime.
 *
 * Injects desktop-local implementations of auth, config, and settings into
 * `@codepilotx/core` so core shims work without importing from TUI.
 *
 * The desktop does not have the full OAuth / settings stacks that TUI has.
 * This adapter provides minimal implementations that read shared credentials
 * and config files directly from the filesystem, and delegate to desktop
 * settings for the settings API.
 *
 * Call once during app startup, before any core auth/config/settings shims
 * are invoked.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { configureCoreAppRuntime } from '@codepilotx/core/runtime/appRuntime.js'
import type { AppRuntime } from '@codepilotx/core/runtime/appRuntime.js'
import { readDesktopStoredSettings } from './desktopSettings.js'

// ─── Shared file paths ────────────────────────────────────────────────────

function configDir(): string {
  return (
    process.env.CODEPILOTX_CONFIG_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    join(homedir(), '.codepilotx')
  ).normalize('NFC')
}

function credentialsPath(): string {
  return join(configDir(), '.credentials.json')
}

function globalConfigPath(): string {
  return join(configDir(), 'config.json')
}

// ─── File I/O helpers ─────────────────────────────────────────────────────

function ensureDirSync(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // ignore if already exists
  }
}

function readJsonSync(filePath: string): Record<string, unknown> {
  try {
    const raw = readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function readJsonAsync(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function writeJsonAsync(
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
}

// ─── Auth implementation ──────────────────────────────────────────────────

function getAuthTokenSourceImpl(): { source: string; hasToken: boolean } {
  // Check env vars first
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { source: 'CLAUDE_CODE_OAUTH_TOKEN', hasToken: true }
  }

  // Check shared credentials for exchanged token
  const creds = readJsonSync(credentialsPath())
  const oauth = creds.claudeAiOauth as
    | { accessToken?: string; source?: string }
    | undefined
  if (oauth?.accessToken) {
    if (oauth.source === 'github_exchange') {
      return { source: 'github_exchange', hasToken: true }
    }
    if (oauth.accessToken) {
      return { source: 'claude.ai', hasToken: true }
    }
  }

  return { source: 'none', hasToken: false }
}

function getOauthAccountInfoImpl(): Record<string, unknown> | undefined {
  const config = readJsonSync(globalConfigPath())
  const account = config.oauthAccount as Record<string, unknown> | undefined
  return account ?? undefined
}

function hasAnthropicApiKeyAuthImpl(): boolean {
  // Check if there's an Anthropic API key in env or config
  if (process.env.ANTHROPIC_API_KEY) return true
  const config = readJsonSync(globalConfigPath())
  return !!config.primaryApiKey
}

// ─── Config implementation ────────────────────────────────────────────────

function getGlobalConfigImpl<T>(): T {
  return readJsonSync(globalConfigPath()) as T
}

function saveGlobalConfigImpl(
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): void {
  const current = readJsonSync(globalConfigPath())
  const updated = updater(current)
  ensureDirSync(configDir())
  writeFileSync(globalConfigPath(), JSON.stringify(updated, null, 2), 'utf8')
}

function enableConfigsImpl(): void {
  // Desktop config is file-based, always available
}

// ─── Settings implementation ──────────────────────────────────────────────

function getDesktopSettingsJson(): Record<string, unknown> {
  try {
    const settings = readDesktopStoredSettings()
    return settings as unknown as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Configure the core app runtime with desktop-local implementations.
 * Must be called once during app initialization.
 */
export function configureDesktopCoreAppRuntime(): void {
  const runtime: AppRuntime = {
    auth: {
      checkAndRefreshOAuthTokenIfNeeded: async () => {
        // Desktop doesn't support OAuth token refresh directly
        return false
      },
      getClaudeAIOAuthTokens: () => {
        const creds = readJsonSync(credentialsPath())
        const oauth = creds.claudeAiOauth as {
          accessToken?: string
          refreshToken?: string | null
          expiresAt?: number
          scopes?: string[]
          subscriptionType?: string | null
          rateLimitTier?: string | null
          source?: string
        } | undefined
        if (!oauth?.accessToken) return null
        return {
          accessToken: oauth.accessToken,
          refreshToken: oauth.refreshToken ?? null,
          expiresAt: oauth.expiresAt ?? null,
          scopes: oauth.scopes ?? [],
          subscriptionType: oauth.subscriptionType ?? null,
          rateLimitTier: oauth.rateLimitTier ?? null,
        }
      },
      hasProfileScope: () => {
        // GitHub-exchanged tokens don't have Anthropic profile scope
        return false
      },
      isClaudeAISubscriber: () => false,
      saveApiKey: async () => {
        // Desktop doesn't manage Anthropic API keys
      },
      getAnthropicApiKey: () => {
        // Desktop doesn't manage Anthropic API keys
        return null
      },
      getAuthTokenSource: getAuthTokenSourceImpl,
      getOauthAccountInfo: getOauthAccountInfoImpl,
      hasAnthropicApiKeyAuth: hasAnthropicApiKeyAuthImpl,
    },
    config: {
      enableConfigs: enableConfigsImpl,
      getGlobalConfig: getGlobalConfigImpl,
      saveGlobalConfig: saveGlobalConfigImpl,
    },
    settings: {
      getSettings_DEPRECATED: () => getDesktopSettingsJson(),
      getInitialSettings: () => getDesktopSettingsJson(),
      getSettingsForSource: () => undefined,
      updateSettingsForSource: () => {
        // Desktop settings are managed through desktop API
      },
    },
  }

  configureCoreAppRuntime(runtime)
}
