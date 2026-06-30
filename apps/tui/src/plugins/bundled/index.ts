/**
 * Built-in Plugin Initialization
 *
 * Initializes built-in plugins that ship with the CLI and appear in the
 * /plugin UI for users to enable/disable.
 *
 * Not all bundled features should be built-in plugins — use this for
 * features that users should be able to explicitly enable/disable. For
 * features with complex setup or automatic-enabling logic (e.g.
 * claude-in-chrome), use src/skills/bundled/ instead.
 *
 * To add a new built-in plugin:
 * 1. Import registerBuiltinPlugin from '../builtinPlugins.js'
 * 2. Call registerBuiltinPlugin() with the plugin definition here
 */
import { registerBuiltinPlugin } from '../builtinPlugins.js'
import { BrowserUseTool } from './browser/BrowserUseTool.js'

/**
 * Initialize built-in plugins. Called during CLI startup.
 */
export function initBuiltinPlugins(): void {
  registerBuiltinPlugin({
    name: 'browser',
    description: 'Control the desktop in-app browser',
    version: '0.1.0',
    defaultEnabled: false,
    tools: [BrowserUseTool],
  })
}
