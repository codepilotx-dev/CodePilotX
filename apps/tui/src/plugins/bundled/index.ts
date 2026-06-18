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
import {
  MiniMaxImageTool,
  MiniMaxMusicTool,
  MiniMaxSpeechTool,
  MiniMaxVideoTool,
} from '../../tools/MiniMaxTool/MiniMaxTool.js'

/**
 * Initialize built-in plugins. Called during CLI startup.
 */
export function initBuiltinPlugins(): void {
  registerBuiltinPlugin({
    name: 'minimax',
    description:
      'Enable MiniMax media generation tools for images, speech, video, and music.',
    version: '1.0.0',
    defaultEnabled: false,
    tools: [
      MiniMaxImageTool,
      MiniMaxSpeechTool,
      MiniMaxVideoTool,
      MiniMaxMusicTool,
    ],
    systemPrompt: `# MiniMax media tools
The MiniMax built-in plugin is enabled. Use the MiniMax media tools when the user asks to generate or transform media:
- Use MiniMaxImage for image generation or image-to-image workflows.
- Use MiniMaxSpeech for text-to-speech audio.
- Use MiniMaxVideo to create, query, or download video generation tasks.
- Use MiniMaxMusic for music, lyrics, or cover workflows.

These tools require a configured MiniMax API key. If the key is missing, tell the user to run /connect or set MINIMAX_API_KEY.`,
  })
}
