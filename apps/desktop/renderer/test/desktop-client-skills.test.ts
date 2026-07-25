import { describe, expect, test } from 'bun:test'
import { createBrowserMockDesktopClient } from '../src/services/desktop-client/browser-mock-client.js'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

const workspace = 'F:\\CodeProject\\CodePilotX'
const skillPath = `${workspace}\\.agents\\skills\\review\\SKILL.md`
const wireSkill = {
  name: 'review',
  description: 'Review the current change.',
  path: skillPath,
  scope: 'workspace',
  format: 'agents',
  enabled: true,
} as const

describe('desktop runtime skills client', () => {
  test('uses the typed skill management RPC and maps workspace scope', async () => {
    const requests: Array<{ method: string; params: unknown }> = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      requests.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult())
      }
      if (body.method === 'initialized') {
        return new Response(null, { status: 204 })
      }
      if (body.method === 'skill/list') {
        return rpc(body.id, {
          skills: [wireSkill],
          generation: 2,
          updatedAt: 1_753_392_000_000,
        })
      }
      if (body.method === 'skill/read') {
        return rpc(body.id, {
          skill: wireSkill,
          content: '# Review\n',
        })
      }
      if (body.method === 'skill/setEnabled') {
        return rpc(body.id, {
          skill: { ...wireSkill, enabled: false },
          generation: 3,
          updatedAt: 1_753_392_001_000,
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    const catalog = await client.listRuntimeSkills(workspace, {
      forceReload: true,
    })
    const details = await client.readRuntimeSkill(skillPath, workspace)
    const disabled = await client.setRuntimeSkillEnabled(skillPath, false)

    expect(catalog).toEqual({
      state: 'ready',
      data: [{
        name: 'review',
        description: 'Review the current change.',
        path: skillPath,
        scope: 'repo',
        source: 'workspace',
        format: 'agents',
        enabled: true,
      }],
      updatedAt: new Date(1_753_392_000_000).toISOString(),
    })
    expect(details).toMatchObject({
      name: 'review',
      scope: 'repo',
      source: 'workspace',
      format: 'agents',
      content: '# Review\n',
    })
    expect(disabled.enabled).toBe(false)
    expect(requests.find(item => item.method === 'skill/list')?.params).toEqual({
      workspace,
      forceReload: true,
    })
    expect(requests.find(item => item.method === 'skill/read')?.params).toEqual({
      path: skillPath,
      workspace,
    })
    expect(requests.find(item => item.method === 'skill/setEnabled')?.params).toEqual({
      path: skillPath,
      enabled: false,
      operationId: expect.any(String),
    })
  })

  test('browser mock reports local skill management as unavailable', async () => {
    const client = createBrowserMockDesktopClient()

    await expect(client.listRuntimeSkills()).resolves.toEqual({
      state: 'unavailable',
      data: null,
      error: '浏览器预览环境不支持读取本机技能目录。',
    })
    await expect(client.readRuntimeSkill(skillPath)).rejects.toThrow(
      '浏览器预览环境不支持读取本机技能详情。',
    )
    await expect(client.setRuntimeSkillEnabled(skillPath, false)).rejects.toThrow(
      '浏览器预览环境不支持修改本机技能状态。',
    )
  })
})

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}

function initializedResult() {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: ['rpc.typed.v1', 'skills.manage.v1'],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}
