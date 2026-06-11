import { mkdir, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { getProviderApiKey } from '../../utils/model/providerConfig.js'
import { expandPath } from '../../utils/path.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { formatMiniMaxError } from '../../services/api/minimax.js'

export const MINIMAX_API_BASE_URL = 'https://api.minimaxi.com'
export const MINIMAX_ARTIFACT_ROOT = join(
  homedir(),
  '.oh-my-openagent',
  'minimax',
  'artifacts',
)

export type MiniMaxJSON = Record<string, unknown>

export async function minimaxJSON<T = MiniMaxJSON>({
  path,
  method = 'POST',
  body,
  query,
  baseURL = MINIMAX_API_BASE_URL,
}: {
  path: string
  method?: 'GET' | 'POST' | 'DELETE'
  body?: MiniMaxJSON
  query?: Record<string, string | number | boolean | undefined>
  baseURL?: string
}): Promise<T> {
  const url = buildURL(baseURL, path, query)
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${requireMiniMaxApiKey()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return parseMiniMaxResponse<T>(response)
}

export async function minimaxUploadFile({
  filePath,
  purpose,
}: {
  filePath: string
  purpose: string
}): Promise<MiniMaxJSON> {
  const form = new FormData()
  form.set('purpose', purpose)
  form.set('file', Bun.file(expandPath(filePath)))
  const response = await fetch(buildURL(MINIMAX_API_BASE_URL, '/v1/files/upload'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireMiniMaxApiKey()}`,
    },
    body: form,
  })
  return parseMiniMaxResponse<MiniMaxJSON>(response)
}

export async function downloadToArtifact({
  url,
  outputPath,
  subdir,
  extension,
}: {
  url: string
  outputPath?: string
  subdir: string
  extension: string
}): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  return writeArtifactBytes({ bytes, outputPath, subdir, extension })
}

export async function writeArtifactBytes({
  bytes,
  outputPath,
  subdir,
  extension,
}: {
  bytes: Uint8Array
  outputPath?: string
  subdir: string
  extension: string
}): Promise<string> {
  const filePath =
    outputPath?.trim() ||
    join(MINIMAX_ARTIFACT_ROOT, subdir, `${Date.now()}-${randomUUID()}${extension}`)
  const resolved = expandPath(filePath)
  await mkdir(dirname(resolved), { recursive: true })
  await writeFile(resolved, bytes)
  return resolved
}

export async function saveBase64Artifacts({
  values,
  outputPath,
  subdir,
  extension,
}: {
  values: string[]
  outputPath?: string
  subdir: string
  extension: string
}): Promise<string[]> {
  const paths: string[] = []
  for (let i = 0; i < values.length; i++) {
    const path =
      outputPath && values.length === 1
        ? outputPath
        : outputPath
          ? appendIndex(outputPath, i + 1)
          : undefined
    paths.push(
      await writeArtifactBytes({
        bytes: Uint8Array.from(Buffer.from(values[i]!, 'base64')),
        outputPath: path,
        subdir,
        extension,
      }),
    )
  }
  return paths
}

export async function saveHexArtifact({
  value,
  outputPath,
  subdir,
  extension,
}: {
  value: string
  outputPath?: string
  subdir: string
  extension: string
}): Promise<string> {
  return writeArtifactBytes({
    bytes: Uint8Array.from(Buffer.from(value, 'hex')),
    outputPath,
    subdir,
    extension,
  })
}

export function extractMiniMaxBaseRespError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const baseResp = (data as { base_resp?: unknown }).base_resp
  if (!baseResp || typeof baseResp !== 'object') return null
  const statusCode = (baseResp as { status_code?: unknown }).status_code
  if (statusCode === 0 || statusCode === '0' || statusCode == null) return null
  return formatMiniMaxError({
    code: statusCode,
    message: (baseResp as { status_msg?: unknown }).status_msg,
  })
}

export function requireMiniMaxApiKey(): string {
  const apiKey = getProviderApiKey('minimax')
  if (!apiKey) {
    throw new Error(
      'MiniMax API key is not configured. Run /connect to save it, or set MINIMAX_API_KEY.',
    )
  }
  return apiKey
}

export function artifactSummary(result: MiniMaxJSON, localFiles: string[] = []): string {
  const lines = [jsonStringify(result)]
  if (localFiles.length > 0) {
    lines.push(`local_files:\n${localFiles.map(file => `- ${file}`).join('\n')}`)
  }
  return lines.join('\n\n')
}

async function parseMiniMaxResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let parsed: unknown = text
  if (text.trim()) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }
  if (!response.ok) {
    throw new Error(formatMiniMaxError({ status_code: response.status, parsed }))
  }
  const baseRespError = extractMiniMaxBaseRespError(parsed)
  if (baseRespError) {
    throw new Error(baseRespError)
  }
  return parsed as T
}

function buildURL(
  baseURL: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(`${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function appendIndex(path: string, index: number): string {
  const ext = extname(path)
  const name = basename(path, ext)
  return join(dirname(path), `${name}-${index}${ext}`)
}
