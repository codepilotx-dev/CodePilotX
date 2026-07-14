import { describe, expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktopClient.js'

const provider = {
  provider: {
    id: 'minimax-cn-coding-plan',
    integrationID: 'minimax-cn-coding-plan',
    name: 'MiniMax Token Plan (minimaxi.com)',
    api: {
      type: 'aisdk',
      package: '@ai-sdk/anthropic',
      url: 'https://api.minimaxi.com/anthropic/v1',
    },
    request: { headers: {}, body: {} },
  },
  models: [
    {
      id: 'MiniMax-M3',
      providerID: 'minimax-cn-coding-plan',
      name: 'MiniMax-M3',
      family: 'minimax',
      api: {
        id: 'MiniMax-M3',
        type: 'aisdk',
        package: '@ai-sdk/anthropic',
        url: 'https://api.minimaxi.com/anthropic/v1',
      },
      capabilities: { tools: true, input: ['text'], output: ['text'] },
      request: { headers: {}, body: {} },
      variants: [],
      time: { released: 0 },
      cost: [],
      status: 'active',
      enabled: true,
      limit: { context: 204_800, output: 131_072 },
    },
  ],
}

describe('desktop provider client', () => {
  test('删除 API 密钥后重新读取 Integration，并返回真实未配置状态', async () => {
    const methods: string[] = []
    let connections: Array<Record<string, string>> = [
      { type: 'credential', id: 'credential-1', label: 'API Key' },
    ]
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      methods.push(body.method)
      if (body.method === 'model/list') {
        return rpc(body.id, {
          providers: [provider],
          defaultModel: {
            providerID: 'minimax-cn-coding-plan',
            id: 'MiniMax-M3',
          },
          reviewerModel: null,
        })
      }
      if (body.method === 'integration/list') {
        return rpc(body.id, {
          integrations: [
            {
              id: 'minimax-cn-coding-plan',
              name: 'MiniMax Token Plan (minimaxi.com)',
              methods: [{ type: 'key' }],
              connections,
            },
          ],
        })
      }
      if (body.method === 'integration/disconnect') {
        expect(body.params).toEqual({
          integrationID: 'minimax-cn-coding-plan',
          credentialID: 'credential-1',
        })
        connections = []
        return rpc(body.id, { ok: true })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const state = await createDesktopClient({ fetch: fetcher })
      .deleteProviderApiKey('minimax-cn-coding-plan')

    expect(state.apiKeyConfigured).toBe(false)
    expect(state.apiKeySource).toBeNull()
    expect(methods.filter(method => method === 'integration/list').length).toBeGreaterThanOrEqual(2)
    expect(methods).toContain('integration/disconnect')
  })
})

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}
