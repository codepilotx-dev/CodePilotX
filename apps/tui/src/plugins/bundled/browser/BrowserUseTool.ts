import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../../Tool.js'
import { lazySchema } from '../../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.object({
    action: z.enum([
      'open_url',
      'click',
      'type',
      'press',
      'wait_for',
      'snapshot',
      'screenshot',
      'evaluate_readonly',
      'get_resource',
    ]),
    url: z.string().optional(),
    selector: z.string().optional(),
    text: z.string().optional(),
    key: z.string().optional(),
    timeoutMs: z.number().optional(),
    script: z.string().optional(),
    resourceUrl: z.string().optional(),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => z.unknown())
type OutputSchema = ReturnType<typeof outputSchema>

export const BrowserUseTool = buildTool({
  name: 'WebBrowser',
  searchHint: 'control the desktop in-app browser',
  maxResultSizeChars: 120_000,
  async description(input) {
    return `Use the in-app browser action ${(input as { action?: string }).action ?? ''}`
  },
  userFacingName() {
    return 'Browser'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly(input) {
    const action = (input as { action?: string } | undefined)?.action
    return action === 'snapshot' || action === 'screenshot' || action === 'get_resource'
  },
  async prompt() {
    return `Use WebBrowser to operate the desktop in-app browser. Prefer it for local development previews and public pages. Available actions: open_url, click, type, press, wait_for, snapshot, screenshot, evaluate_readonly, get_resource. Do not use it for the user's real Chrome profile or authenticated sites unless the user has explicitly opened and allowed that site in the in-app browser.`
  },
  async call(input) {
    const bridgeURL = process.env.CODEPILOTX_DESKTOP_BROWSER_BRIDGE_URL
    const token = process.env.CODEPILOTX_DESKTOP_BROWSER_BRIDGE_TOKEN
    if (!bridgeURL || !token) {
      throw new Error('Browser plugin is not enabled in the desktop app.')
    }
    const response = await fetch(`${bridgeURL}/browser/action`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    })
    if (!response.ok) {
      throw new Error(await response.text())
    }
    return { data: await response.json() }
  },
  renderToolUseMessage(input) {
    return `Browser ${input.action}`
  },
  renderToolResultMessage(output) {
    return JSON.stringify(output, null, 2)
  },
} satisfies ToolDef<InputSchema, unknown>)
