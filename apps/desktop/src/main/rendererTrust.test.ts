import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isTrustedRendererUrl } from './rendererTrust.js'

test('trusts the packaged renderer file and files under its real directory', async () => {
  await withRendererFiles(async ({ trustedFile, assetFile }) => {
    expect(isTrustedRendererUrl(pathToFileURL(trustedFile).toString(), pathToFileURL(trustedFile).toString())).toBe(true)
    expect(
      isTrustedRendererUrl(
        pathToFileURL(assetFile).toString(),
        pathToFileURL(trustedFile).toString(),
      ),
    ).toBe(true)
  })
})

test('rejects file URLs outside the trusted renderer directory', async () => {
  await withRendererFiles(async ({ trustedFile, siblingFile, rootDir }) => {
    const trustedUrl = pathToFileURL(trustedFile).toString()

    expect(
      isTrustedRendererUrl(pathToFileURL(siblingFile).toString(), trustedUrl),
    ).toBe(false)
    expect(
      isTrustedRendererUrl(
        pathToFileURL(join(rootDir, 'dist', 'renderer', '..', 'evil.html')).toString(),
        trustedUrl,
      ),
    ).toBe(false)
    expect(
      isTrustedRendererUrl(`file://evil${new URL(trustedUrl).pathname}`, trustedUrl),
    ).toBe(false)
  })
})

test('rejects renderer paths that resolve through a symlink outside the trusted tree', async () => {
  await withRendererFiles(async ({ trustedFile, rendererDir, outsideDir }) => {
    const linkPath = join(rendererDir, 'linked-outside')
    await symlink(outsideDir, linkPath, 'junction')
    const linkedFile = join(linkPath, 'external.html')

    expect(
      isTrustedRendererUrl(
        pathToFileURL(linkedFile).toString(),
        pathToFileURL(trustedFile).toString(),
      ),
    ).toBe(false)
  })
})

test('rejects mismatched protocols and untrusted dev origins', () => {
  const trustedUrl = pathToFileURL(
    join(process.cwd(), 'dist', 'renderer', 'index.html'),
  ).toString()
  expect(isTrustedRendererUrl('https://localhost:5173/', trustedUrl)).toBe(false)
  expect(
    isTrustedRendererUrl(
      'http://localhost:5174/index.html',
      'http://localhost:5173/index.html',
    ),
  ).toBe(false)
})

async function withRendererFiles(
  run: (paths: {
    rootDir: string
    rendererDir: string
    outsideDir: string
    trustedFile: string
    assetFile: string
    siblingFile: string
  }) => Promise<void>,
): Promise<void> {
  const rootDir = await mkdtemp(join(tmpdir(), 'desktop-renderer-trust-'))
  const rendererDir = join(rootDir, 'dist', 'renderer')
  const assetDir = join(rendererDir, 'assets')
  const outsideDir = join(rootDir, 'outside')
  const siblingDir = join(rootDir, 'dist', 'renderer-evil')
  const trustedFile = join(rendererDir, 'index.html')
  const assetFile = join(assetDir, 'app.js')
  const siblingFile = join(siblingDir, 'index.html')
  try {
    await mkdir(assetDir, { recursive: true })
    await mkdir(outsideDir, { recursive: true })
    await mkdir(siblingDir, { recursive: true })
    await writeFile(trustedFile, '<!doctype html>', 'utf8')
    await writeFile(assetFile, 'console.log("ok")', 'utf8')
    await writeFile(siblingFile, '<!doctype html>', 'utf8')
    await writeFile(join(outsideDir, 'external.html'), '<!doctype html>', 'utf8')
    await writeFile(join(rootDir, 'dist', 'evil.html'), '<!doctype html>', 'utf8')
    await run({
      rootDir,
      rendererDir,
      outsideDir,
      trustedFile,
      assetFile,
      siblingFile,
    })
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
}
