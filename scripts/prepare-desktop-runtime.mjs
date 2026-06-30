import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, rename, writeFile } from 'node:fs/promises'
import { get } from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = join(root, 'dist', 'desktop-runtime', 'win32-x64')
const cacheRoot = join(root, '.cache', 'desktop-runtime')
const nodeVersion = 'v24.18.0'
const pythonVersion = '3.12.8'
const expectedNodeSha256 =
  '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
const artifacts = {
  node: {
    url: `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-win-x64.zip`,
    archive: join(cacheRoot, `node-${nodeVersion}-win-x64.zip`),
    extractDir: join(cacheRoot, `node-${nodeVersion}-win-x64`),
    targetDir: join(runtimeRoot, 'node'),
    stripDir: `node-${nodeVersion}-win-x64`,
    sha256: expectedNodeSha256,
  },
  python: {
    url: `https://www.python.org/ftp/python/${pythonVersion}/python-${pythonVersion}-embed-amd64.zip`,
    archive: join(cacheRoot, `python-${pythonVersion}-embed-amd64.zip`),
    extractDir: join(cacheRoot, `python-${pythonVersion}-embed-amd64`),
    targetDir: join(runtimeRoot, 'python'),
    sha256: null,
  },
}

if (process.platform !== 'win32') {
  throw new Error('prepare-desktop-runtime currently supports win32-x64 only.')
}

await mkdir(cacheRoot, { recursive: true })
await rm(runtimeRoot, { recursive: true, force: true })
await mkdir(runtimeRoot, { recursive: true })

for (const artifact of Object.values(artifacts)) {
  await download(artifact.url, artifact.archive)
  const actualSha256 = await sha256File(artifact.archive)
  if (artifact.sha256 && actualSha256 !== artifact.sha256) {
    throw new Error(
      `Checksum mismatch for ${artifact.url}: expected ${artifact.sha256}, got ${actualSha256}`,
    )
  }
  await rm(artifact.extractDir, { recursive: true, force: true })
  await mkdir(artifact.extractDir, { recursive: true })
  await expandArchive(artifact.archive, artifact.extractDir)
  const extractedRoot = artifact.stripDir
    ? join(artifact.extractDir, artifact.stripDir)
    : artifact.extractDir
  await rm(artifact.targetDir, { recursive: true, force: true })
  await rename(extractedRoot, artifact.targetDir)
}

await writeFile(
  join(runtimeRoot, 'desktop-runtime-manifest.json'),
  JSON.stringify(
    {
      platform: 'win32-x64',
      toolchainVersion: 'v1',
      node: {
        version: nodeVersion,
        source: artifacts.node.url,
        sha256: expectedNodeSha256,
        pathEntry: 'node',
      },
      python: {
        version: pythonVersion,
        source: artifacts.python.url,
        distribution: 'python.org embeddable package',
        pathEntry: 'python',
        scriptsPathEntry: 'python/Scripts',
        warning:
          'Python 3.12.8 Windows binaries had signing certificates revoked by python.org; download, install, or execution may fail on some systems.',
      },
    },
    null,
    2,
  ),
  'utf8',
)

console.log(`Desktop runtime prepared at ${runtimeRoot}`)

async function download(url, target) {
  await mkdir(dirname(target), { recursive: true })
  const tempTarget = `${target}.tmp`
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rm(tempTarget, { force: true })
      await pipeline(await request(url), createWriteStream(tempTarget))
      await rename(tempTarget, target)
      return
    } catch (error) {
      lastError = error
      await rm(tempTarget, { force: true })
      if (attempt < 3) {
        await new Promise(resolveRetry => setTimeout(resolveRetry, attempt * 1000))
      }
    }
  }
  throw lastError
}

function request(url, redirects = 0) {
  return new Promise((resolveRequest, reject) => {
    get(url, response => {
      const location = response.headers.location
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        location
      ) {
        response.resume()
        if (redirects > 5) {
          reject(new Error(`Too many redirects while downloading ${url}`))
          return
        }
        resolveRequest(request(new URL(location, url).toString(), redirects + 1))
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Download failed for ${url}: HTTP ${response.statusCode}`))
        return
      }
      resolveRequest(response)
    }).on('error', reject)
  })
}

async function sha256File(path) {
  const hash = createHash('sha256')
  const { createReadStream } = await import('node:fs')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function expandArchive(archive, destination) {
  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }',
      archive,
      destination,
    ],
    { windowsHide: true },
  )
}
