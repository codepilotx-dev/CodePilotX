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
  MiniMaxFileTool,
  MiniMaxImageTool,
  MiniMaxMusicTool,
  MiniMaxQuotaTool,
  MiniMaxSpeechTool,
  MiniMaxTools,
  MiniMaxVideoTool,
  MiniMaxVisionTool,
} from '../../tools/MiniMaxTool/MiniMaxTool.js'
import type { Tool } from '../../Tool.js'

type MiniMaxSlashCommandDefinition = {
  tool: Tool
  description: string
  whenToUse: string
  instruction: string
}

const MINIMAX_SLASH_COMMANDS: MiniMaxSlashCommandDefinition[] = [
  {
    tool: MiniMaxImageTool,
    description: 'Generate images with MiniMax.',
    whenToUse: 'Use when the user wants MiniMax image generation or image-to-image workflows.',
    instruction:
      'Use MiniMaxImage to handle the request. Ask for missing prompt or image details only if they cannot be inferred from the slash command arguments.',
  },
  {
    tool: MiniMaxSpeechTool,
    description: 'Generate speech audio with MiniMax.',
    whenToUse: 'Use when the user wants MiniMax text-to-speech audio.',
    instruction:
      'Use MiniMaxSpeech to synthesize the requested speech. Infer reasonable voice and format defaults unless the user specifies them.',
  },
  {
    tool: MiniMaxVideoTool,
    description: 'Create, query, or download MiniMax video generation tasks.',
    whenToUse: 'Use when the user wants MiniMax video generation, status lookup, or download.',
    instruction:
      'Use MiniMaxVideo for the requested video workflow. Choose create, query, or download from the slash command arguments and ask for missing task_id or file_id when required.',
  },
  {
    tool: MiniMaxMusicTool,
    description: 'Generate music, lyrics, or covers with MiniMax.',
    whenToUse: 'Use when the user wants MiniMax music, lyrics, or cover workflows.',
    instruction:
      'Use MiniMaxMusic for the requested music workflow. Choose generate, lyrics, or cover from the slash command arguments and ask for missing audio or lyrics details when required.',
  },
  {
    tool: MiniMaxVisionTool,
    description: 'Describe or understand images with MiniMax vision.',
    whenToUse: 'Use when the user wants MiniMax image understanding or description.',
    instruction:
      'Use MiniMaxVision to inspect the image described in the slash command arguments. Ask for an image URL, local path, file ID, or base64 data if none is provided.',
  },
  {
    tool: MiniMaxFileTool,
    description: 'Manage files on the MiniMax platform.',
    whenToUse: 'Use when the user wants to upload, list, retrieve, download, or delete MiniMax platform files.',
    instruction:
      'Use MiniMaxFile for the requested file operation. Be careful with delete actions and rely on the tool permission flow for destructive confirmation.',
  },
  {
    tool: MiniMaxQuotaTool,
    description: 'Query MiniMax Token Plan or quota status.',
    whenToUse: 'Use when the user wants MiniMax quota or Token Plan status.',
    instruction:
      'Use MiniMaxQuota to query the account quota. This command does not need additional arguments.',
  },
]

/**
 * Initialize built-in plugins. Called during CLI startup.
 */
export function initBuiltinPlugins(): void {
  registerBuiltinPlugin({
    name: 'minimax',
    description:
      'Enable MiniMax generation, vision, file, and quota tools.',
    version: '1.0.0',
    defaultEnabled: false,
    tools: MiniMaxTools,
    skills: MINIMAX_SLASH_COMMANDS.map(
      ({ tool, description, whenToUse, instruction }) => ({
        name: tool.name,
        description,
        whenToUse,
        userInvocable: true,
        disableModelInvocation: true,
        allowedTools: [tool.name],
        async getPromptForCommand(args) {
          const trimmedArgs = args.trim()
          return [
            {
              type: 'text' as const,
              text: [
                instruction,
                '',
                `User request: ${trimmedArgs || '(no additional arguments provided)'}`,
                '',
                'Use only the allowed MiniMax tool for this slash command. If required inputs are missing, ask the user a concise follow-up question instead of guessing.',
              ].join('\n'),
            },
          ]
        },
      }),
    ),
    systemPrompt: `# MiniMax media tools
The MiniMax built-in plugin is enabled. Use the MiniMax tools when the user asks for MiniMax-backed media, file, vision, or quota workflows:
- Use MiniMaxImage for image generation or image-to-image workflows.
- Use MiniMaxSpeech for text-to-speech audio.
- Use MiniMaxVideo to create, query, or download video generation tasks.
- Use MiniMaxMusic for music, lyrics, or cover workflows.
- Use MiniMaxVision to describe or understand images.
- Use MiniMaxFile to upload, list, retrieve, download, or delete MiniMax platform files.
- Use MiniMaxQuota to query MiniMax Token Plan or quota status.

These tools require a configured MiniMax API key. If the key is missing, tell the user to run /connect or set MINIMAX_API_KEY.`,
  })
}
