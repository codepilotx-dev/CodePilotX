import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
import {
  installDesktopSkill,
  listDesktopSkillCatalog,
} from './skillsCatalogService.js'

const envKeys = [
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
  'CODEPILOTX_SKILLS_API_BASE_URL',
  'VERCEL_OIDC_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
] as const

let configDir: string
let originalFetch: typeof fetch
let originalEnv: Record<string, string | undefined>

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'desktop-skills-catalog-'))
  originalFetch = globalThis.fetch
  originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))

  for (const key of envKeys) delete process.env[key]
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = configDir
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  for (const key of envKeys) restoreEnv(key, originalEnv[key])
  await rm(configDir, { force: true, recursive: true })
})

test('skills catalog fails fast with setup guidance when Vercel OIDC token is not configured', async () => {
  const requestedUrls: string[] = []
  globalThis.fetch = (async input => {
    requestedUrls.push(String(input))
    return jsonResponse({ data: [], pagination: { hasMore: false } })
  }) as typeof fetch

  await expect(listDesktopSkillCatalog()).rejects.toThrow(
    'https://www.skills.sh/docs/api#authentication',
  )
  await expect(listDesktopSkillCatalog()).rejects.toThrow('Vercel OIDC')
  await expect(listDesktopSkillCatalog()).rejects.toThrow('restart CodePilotX')
  expect(requestedUrls).toEqual([])
})

test('skills catalog uses the configured CodePilotX skills proxy without Anthropic auth headers', async () => {
  process.env.CODEPILOTX_SKILLS_API_BASE_URL = 'https://skills-proxy.example.com/'
  process.env.ANTHROPIC_AUTH_TOKEN = 'anthropic-token'
  process.env.ANTHROPIC_API_KEY = 'anthropic-api-key'
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      headers: headersRecord(init?.headers),
    })
    return jsonResponse({ data: [], pagination: { hasMore: false, total: 0 } })
  }) as typeof fetch

  await listDesktopSkillCatalog({
    owner: 'community',
    query: 'git',
    view: 'hot',
    page: 2,
    perPage: 12,
  })

  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe(
    'https://skills-proxy.example.com/api/codepilotx/skills?view=hot&page=2&per_page=12&q=git&owner=community',
  )
  expect(requests[0].headers).toEqual({ accept: 'application/json' })
})

test('skills catalog calls skills.sh directly with Vercel OIDC', async () => {
  process.env.VERCEL_OIDC_TOKEN = 'vercel-token'
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      headers: headersRecord(init?.headers),
    })
    return jsonResponse({ data: [], pagination: { hasMore: false, total: 0 } })
  }) as typeof fetch

  await listDesktopSkillCatalog({
    owner: 'community',
    query: 'git',
    perPage: 12,
  })

  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe(
    'https://skills.sh/api/v1/skills/search?q=git&limit=12&owner=community',
  )
  expect(requests[0].headers).toEqual({
    accept: 'application/json',
    authorization: 'Bearer vercel-token',
  })
})

test('skills catalog fetches audits from skills.sh for returned skills', async () => {
  process.env.VERCEL_OIDC_TOKEN = 'vercel-token'
  const requests: string[] = []
  globalThis.fetch = (async input => {
    const url = String(input)
    requests.push(url)
    if (url.includes('/audit/')) {
      return jsonResponse({
        audits: [
          {
            status: 'pass',
            summary: 'Looks safe',
            auditedAt: '2026-06-29T00:00:00.000Z',
          },
        ],
      })
    }
    return jsonResponse({
      data: [
        {
          id: 'owner/git-helper',
          slug: 'git-helper',
          name: 'Git Helper',
          source: 'https://github.com/owner/git-helper',
          sourceType: 'github',
          url: 'https://skills.sh/owner/git-helper',
          installs: 10,
        },
      ],
      pagination: { hasMore: false, total: 1 },
    })
  }) as typeof fetch

  const result = await listDesktopSkillCatalog({ owner: 'all' })

  expect(requests).toEqual([
    'https://skills.sh/api/v1/skills?view=trending&page=0&per_page=24',
    'https://skills.sh/api/v1/skills/audit/owner/git-helper',
  ])
  expect(result.skills[0].audit).toMatchObject({
    status: 'pass',
    summary: 'Looks safe',
  })
})

test('skill install fetches skill details from skills.sh', async () => {
  process.env.VERCEL_OIDC_TOKEN = 'vercel-token'
  const requests: string[] = []
  globalThis.fetch = (async input => {
    requests.push(String(input))
    return jsonResponse({
      id: 'owner/git-helper',
      slug: 'git-helper',
      source: 'https://github.com/owner/git-helper',
      hash: 'abc123',
      files: [{ path: 'SKILL.md', contents: '# Git Helper\n' }],
    })
  }) as typeof fetch

  const result = await installDesktopSkill({
    id: 'owner/git-helper',
    installUrl: 'https://skills.sh/owner/git-helper',
  })
  const installedSkill = await readFile(
    join(configDir, 'skills', 'git-helper', 'SKILL.md'),
    'utf8',
  )

  expect(requests).toEqual([
    'https://skills.sh/api/v1/skills/owner/git-helper',
  ])
  expect(result).toMatchObject({
    id: 'owner/git-helper',
    slug: 'git-helper',
    installed: true,
  })
  expect(installedSkill).toBe('# Git Helper\n')
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function headersRecord(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries())
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
