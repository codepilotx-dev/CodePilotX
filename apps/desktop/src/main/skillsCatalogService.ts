import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { clearAllCaches } from '@codepilotx/tui/utils/plugins/cacheUtils.js'
import { getOpenAgentConfigHomeDir } from './desktopSettings.js'
import type {
  DesktopSkillCatalogItem,
  DesktopSkillCatalogOptions,
  DesktopSkillCatalogResult,
  DesktopSkillInstallResult,
  DesktopSkillOwnerFilter,
} from '../shared/types.js'

const SKILLS_SH_BASE_URL = 'https://skills.sh'
const DEFAULT_PRODUCT_API_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_SKILLS_PER_PAGE = 24
const MAX_SKILLS_PER_PAGE = 100

type SkillCatalogSource = 'proxy' | 'skills.sh'

type SkillsApiConfig = {
  baseUrl: string
  source: SkillCatalogSource
  headers: Record<string, string>
}

type RawSkill = {
  id?: unknown
  slug?: unknown
  name?: unknown
  source?: unknown
  installs?: unknown
  sourceType?: unknown
  installUrl?: unknown
  url?: unknown
  isDuplicate?: unknown
}

type RawSkillFile = {
  path?: unknown
  contents?: unknown
}

type RawSkillDetail = {
  id?: unknown
  source?: unknown
  slug?: unknown
  installs?: unknown
  hash?: unknown
  files?: unknown
}

type RawSkillListResponse = {
  data?: unknown
  pagination?: unknown
  count?: unknown
}

type RawCuratedOwner = {
  skills?: unknown
}

export async function listDesktopSkillCatalog(
  options: DesktopSkillCatalogOptions = {},
): Promise<DesktopSkillCatalogResult> {
  const config = getSkillsApiConfig()
  const page = normalizeInteger(options.page, 0, 0)
  const perPage = normalizeInteger(
    options.perPage,
    DEFAULT_SKILLS_PER_PAGE,
    1,
    MAX_SKILLS_PER_PAGE,
  )
  const owner = normalizeOwnerFilter(options.owner)
  const query = options.query?.trim() ?? ''
  const view = options.view ?? 'trending'
  const installedIds = await listInstalledSkillIds()

  const response = await fetchSkillsCatalog(config, {
    query,
    owner,
    page,
    perPage,
    view,
  })

  const data = flattenSkillData(response.data)
  let skills = data
    .map(parseSkill)
    .filter((skill): skill is DesktopSkillCatalogItem => skill !== null)

  if (owner === 'official') {
    skills = skills.filter(
      skill => skill.sourceType !== 'well-known' || skill.url.includes('/official'),
    )
  } else if (owner === 'community') {
    skills = skills.filter(skill => skill.sourceType !== 'well-known')
  }

  skills = skills.map(skill => ({
    ...skill,
    installed: installedIds.has(skill.id) || installedIds.has(skill.slug),
  }))

  return {
    skills,
    page,
    perPage,
    hasMore: readHasMore(response.pagination),
    total: readTotal(response.pagination),
  }
}

export async function installDesktopSkill(
  skillId: string,
): Promise<DesktopSkillInstallResult> {
  const normalizedSkillId = requireNonEmptyString(skillId, 'Skill id')
  const config = getSkillsApiConfig()
  const detail = await fetchSkillDetail(config, normalizedSkillId)
  const slug = requireNonEmptyString(detail.slug, 'Skill slug')
  const files = parseSkillFiles(detail.files)
  if (!files.some(file => normalizeSkillFilePath(file.path) === 'SKILL.md')) {
    throw new Error(`Skill "${normalizedSkillId}" did not include SKILL.md.`)
  }

  const skillDir = getSkillInstallDirectory(slug)
  await mkdir(skillDir, { recursive: true })

  for (const file of files) {
    const relativePath = normalizeSkillFilePath(file.path)
    const destination = join(skillDir, ...relativePath.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, file.contents, 'utf8')
  }

  clearAllCaches()

  return {
    id: normalizedSkillId,
    slug,
    installed: true,
    installPath: skillDir,
  }
}

async function fetchSkillsCatalog(
  config: SkillsApiConfig,
  options: {
    query: string
    owner: DesktopSkillOwnerFilter
    page: number
    perPage: number
    view: NonNullable<DesktopSkillCatalogOptions['view']>
  },
): Promise<RawSkillListResponse> {
  const url = new URL(
    config.source === 'proxy'
      ? `${config.baseUrl}/api/codepilotx/skills`
      : `${config.baseUrl}/api/v1/skills`,
  )

  if (
    config.source === 'skills.sh' &&
    options.owner === 'official' &&
    !options.query
  ) {
    url.pathname = '/api/v1/skills/curated'
  } else if (config.source === 'skills.sh' && options.query) {
    url.pathname = '/api/v1/skills/search'
    url.searchParams.set('q', options.query)
    url.searchParams.set('limit', String(options.perPage))
    if (options.owner !== 'all' && options.owner !== 'official') {
      url.searchParams.set('owner', options.owner)
    }
  } else {
    url.searchParams.set('view', options.view)
    url.searchParams.set('page', String(options.page))
    url.searchParams.set(
      config.source === 'proxy' ? 'per_page' : 'per_page',
      String(options.perPage),
    )
    if (options.query) url.searchParams.set('q', options.query)
    if (options.owner !== 'all') url.searchParams.set('owner', options.owner)
  }

  return fetchJson<RawSkillListResponse>(url, config.headers)
}

async function fetchSkillDetail(
  config: SkillsApiConfig,
  skillId: string,
): Promise<RawSkillDetail> {
  const encodedId = skillId
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')
  const url = new URL(
    config.source === 'proxy'
      ? `${config.baseUrl}/api/codepilotx/skills/${encodedId}`
      : `${config.baseUrl}/api/v1/skills/${encodedId}`,
  )
  return fetchJson<RawSkillDetail>(url, config.headers)
}

async function fetchJson<T>(
  url: URL,
  headers: Record<string, string>,
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  })
  const text = await response.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'message' in body &&
      typeof body.message === 'string'
        ? body.message
        : `Skills catalog request failed with HTTP ${response.status}.`
    throw new Error(message)
  }

  return body as T
}

function getSkillsApiConfig(): SkillsApiConfig {
  const configuredBase = process.env.CODEPILOTX_SKILLS_API_BASE_URL?.replace(
    /\/+$/,
    '',
  )
  if (configuredBase) {
    return {
      baseUrl: configuredBase,
      source: 'proxy',
      headers: buildProductApiHeaders(),
    }
  }

  const vercelOidcToken = process.env.VERCEL_OIDC_TOKEN
  if (vercelOidcToken) {
    return {
      baseUrl: SKILLS_SH_BASE_URL,
      source: 'skills.sh',
      headers: { Authorization: `Bearer ${vercelOidcToken}` },
    }
  }

  return {
    baseUrl: (
      process.env.ANTHROPIC_BASE_URL ?? DEFAULT_PRODUCT_API_BASE_URL
    ).replace(/\/+$/, ''),
    source: 'proxy',
    headers: buildProductApiHeaders(),
  }
}

function buildProductApiHeaders(): Record<string, string> {
  const token = process.env.ANTHROPIC_AUTH_TOKEN
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
    }
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    return { 'x-api-key': apiKey }
  }
  return {}
}

function parseSkill(raw: unknown): DesktopSkillCatalogItem | null {
  if (!raw || typeof raw !== 'object') return null
  const skill = raw as RawSkill
  const id = readString(skill.id)
  const slug = readString(skill.slug)
  const name = readString(skill.name) ?? slug
  const source = readString(skill.source)
  const sourceType = readString(skill.sourceType)
  const url = readString(skill.url)
  if (!id || !slug || !name || !source || !sourceType || !url) return null
  return {
    id,
    slug,
    name,
    source,
    installs: readNumber(skill.installs) ?? 0,
    sourceType,
    installUrl: readString(skill.installUrl),
    url,
    isDuplicate: skill.isDuplicate === true,
    installed: false,
  }
}

function flattenSkillData(data: unknown): unknown[] {
  if (!Array.isArray(data)) return []
  const flattened: unknown[] = []
  for (const entry of data) {
    if (
      entry &&
      typeof entry === 'object' &&
      Array.isArray((entry as RawCuratedOwner).skills)
    ) {
      flattened.push(...((entry as RawCuratedOwner).skills as unknown[]))
    } else {
      flattened.push(entry)
    }
  }
  return flattened
}

function parseSkillFiles(files: unknown): Array<{ path: string; contents: string }> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Skill files are unavailable for this catalog entry.')
  }
  return files.map(file => {
    if (!file || typeof file !== 'object') {
      throw new Error('Skill detail contained an invalid file entry.')
    }
    const rawFile = file as RawSkillFile
    const path = requireNonEmptyString(rawFile.path, 'Skill file path')
    const contents =
      typeof rawFile.contents === 'string' ? rawFile.contents : undefined
    if (contents === undefined) {
      throw new Error(`Skill file "${path}" did not include text contents.`)
    }
    normalizeSkillFilePath(path)
    return { path, contents }
  })
}

async function listInstalledSkillIds(): Promise<Set<string>> {
  const installed = new Set<string>()
  const skillsDir = join(getOpenAgentConfigHomeDir(), 'skills')
  let entries
  try {
    entries = await readdir(skillsDir, { withFileTypes: true })
  } catch {
    return installed
  }

  await Promise.all(
    entries.map(async entry => {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return
      const skillPath = join(skillsDir, entry.name, 'SKILL.md')
      try {
        await stat(skillPath)
        installed.add(entry.name)
      } catch {
        // Ignore directories that are not skills.
      }
    }),
  )
  return installed
}

function getSkillInstallDirectory(slug: string): string {
  const safeSlug = normalizeSkillSegment(slug)
  return join(getOpenAgentConfigHomeDir(), 'skills', safeSlug)
}

function normalizeSkillFilePath(filePath: string): string {
  const trimmed = requireNonEmptyString(filePath, 'Skill file path')
  const slashNormalized = trimmed.replace(/\\/g, '/')
  const parts = slashNormalized.split('/')
  const normalized = normalize(slashNormalized).replace(/\\/g, '/')
  if (
    isAbsolute(trimmed) ||
    parts.includes('..') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.includes('\0')
  ) {
    throw new Error(`Unsafe skill file path: ${filePath}`)
  }
  return normalized
}

function normalizeSkillSegment(segment: string): string {
  const normalized = normalizeSkillFilePath(segment)
  if (normalized.includes('/')) {
    throw new Error(`Unsafe skill slug: ${segment}`)
  }
  return normalized
}

function normalizeOwnerFilter(
  owner: DesktopSkillOwnerFilter | undefined,
): DesktopSkillOwnerFilter {
  return owner === 'official' || owner === 'community' ? owner : 'all'
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isInteger(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readHasMore(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'hasMore' in value &&
      value.hasMore === true,
  )
}

function readTotal(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || !('total' in value)) {
    return undefined
  }
  const total = (value as { total?: unknown }).total
  return typeof total === 'number' && Number.isFinite(total) ? total : undefined
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`)
  }
  return trimmed
}
