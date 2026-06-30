import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildAgentsMdInstructions,
  buildSessionAppendSystemPrompt,
  discoverProjectAgentsMd,
  getGlobalAgentsMdPath,
  getGlobalAgentsOverrideMdPath,
  getGlobalConfigTomlPath,
  readGlobalAgentsMd,
  readGlobalAgentsMdEffective,
  readGlobalAgentAgentsMdConfig,
  saveGlobalAgentsMd,
} from './desktopAgentsMd.js'

const originalUserProfile = process.env.USERPROFILE

afterEach(() => {
  restoreEnv('USERPROFILE', originalUserProfile)
})

test('global AGENTS.override.md path lives under USERPROFILE .codepilotx', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root

  expect(getGlobalAgentsOverrideMdPath()).toBe(
    join(root, '.codepilotx', 'AGENTS.override.md'),
  )

  await rm(root, { recursive: true, force: true })
})

test('global config.toml path lives under USERPROFILE .codepilotx', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root

  expect(getGlobalConfigTomlPath()).toBe(
    join(root, '.codepilotx', 'config.toml'),
  )

  await rm(root, { recursive: true, force: true })
})

test('readGlobalAgentsMdEffective prefers override over AGENTS.md', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root
  await mkdir(join(root, '.codepilotx'), { recursive: true })
  await writeFile(join(root, '.codepilotx', 'AGENTS.md'), 'base instructions', 'utf8')
  await writeFile(join(root, '.codepilotx', 'AGENTS.override.md'), 'override instructions', 'utf8')

  expect(await readGlobalAgentsMdEffective()).toBe('override instructions')

  await rm(root, { recursive: true, force: true })
})

test('readGlobalAgentsMdEffective falls back to AGENTS.md when override is missing', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root
  await mkdir(join(root, '.codepilotx'), { recursive: true })
  await writeFile(join(root, '.codepilotx', 'AGENTS.md'), 'base instructions', 'utf8')

  expect(await readGlobalAgentsMdEffective()).toBe('base instructions')

  await rm(root, { recursive: true, force: true })
})

test('readGlobalAgentsMdEffective returns null when neither file exists', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root

  expect(await readGlobalAgentsMdEffective()).toBeNull()

  await rm(root, { recursive: true, force: true })
})

test('readGlobalAgentsMd still reads AGENTS.md directly (not override)', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root
  await mkdir(join(root, '.codepilotx'), { recursive: true })
  await writeFile(join(root, '.codepilotx', 'AGENTS.md'), 'base instructions', 'utf8')
  await writeFile(join(root, '.codepilotx', 'AGENTS.override.md'), 'override instructions', 'utf8')

  expect(await readGlobalAgentsMd(root)).toBe('base instructions')

  await rm(root, { recursive: true, force: true })
})

test('readGlobalAgentAgentsMdConfig reads project_doc settings from config.toml', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root
  await mkdir(join(root, '.codepilotx'), { recursive: true })
  await writeFile(
    join(root, '.codepilotx', 'config.toml'),
    `project_doc_fallback_filenames = ["CLAUDE.md", ".cursorrules"]
project_doc_max_bytes = 65536`,
    'utf8',
  )

  const config = await readGlobalAgentAgentsMdConfig()
  expect(config).not.toBeNull()
  expect(config!.project_doc_fallback_filenames).toEqual(['CLAUDE.md', '.cursorrules'])
  expect(config!.project_doc_max_bytes).toBe(65536)

  await rm(root, { recursive: true, force: true })
})

test('readGlobalAgentAgentsMdConfig returns null for missing file', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root

  expect(await readGlobalAgentAgentsMdConfig()).toBeNull()

  await rm(root, { recursive: true, force: true })
})

test('discoverProjectAgentsMd respects fallback filenames from config', async () => {
  const root = await makeTempDir()
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await writeFile(join(project, 'CLAUDE.md'), 'claude doc', 'utf8')

  const projectDocs = await discoverProjectAgentsMd({
    cwd: project,
    projectRoot: project,
    fallbackFilenames: ['CLAUDE.md', '.cursorrules'],
  })

  expect(projectDocs.map(doc => doc.content)).toEqual(['claude doc'])

  await rm(root, { recursive: true, force: true })
})

test('discoverProjectAgentsMd ignores fallback filenames when AGENTS.override.md exists', async () => {
  const root = await makeTempDir()
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await writeFile(join(project, 'AGENTS.override.md'), 'override doc', 'utf8')
  await writeFile(join(project, 'CLAUDE.md'), 'claude doc', 'utf8')

  const projectDocs = await discoverProjectAgentsMd({
    cwd: project,
    projectRoot: project,
    fallbackFilenames: ['CLAUDE.md'],
  })

  expect(projectDocs.map(doc => doc.content)).toEqual(['override doc'])

  await rm(root, { recursive: true, force: true })
})

test('discoverProjectAgentsMd respects maxBytes from config', async () => {
  const root = await makeTempDir()
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await writeFile(join(project, 'AGENTS.md'), 'abcdefgh', 'utf8')

  const projectDocs = await discoverProjectAgentsMd({
    cwd: project,
    projectRoot: project,
    maxBytes: 4,
  })

  expect(projectDocs.map(doc => doc.content)).toEqual(['abcd'])

  await rm(root, { recursive: true, force: true })
})

test('readGlobalAgentsMd returns null for missing AGENTS.md even when override exists', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root
  await mkdir(join(root, '.codepilotx'), { recursive: true })
  await writeFile(join(root, '.codepilotx', 'AGENTS.override.md'), 'override', 'utf8')

  expect(await readGlobalAgentsMd(root)).toBeNull()

  await rm(root, { recursive: true, force: true })
})

test('buildSessionAppendSystemPrompt uses effective global instructions (override first)', async () => {
  const root = await makeTempDir()
  const project = join(root, 'project')
  process.env.USERPROFILE = root
  await mkdir(join(root, '.codepilotx'), { recursive: true })
  await mkdir(join(project, '.git'), { recursive: true })
  await writeFile(join(root, '.codepilotx', 'AGENTS.md'), 'base instructions', 'utf8')
  await writeFile(join(root, '.codepilotx', 'AGENTS.override.md'), 'effective instructions', 'utf8')

  const appendSystemPrompt = await buildSessionAppendSystemPrompt({
    configHomeDir: root,
    existingAppendSystemPrompt: 'existing append',
    projectRoot: project,
  })

  expect(appendSystemPrompt).toContain('effective instructions')
  expect(appendSystemPrompt).not.toContain('base instructions')

  await rm(root, { recursive: true, force: true })
})

test('global AGENTS.md path lives under USERPROFILE .codepilotx', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root

  expect(getGlobalAgentsMdPath('D:\\Config')).toBe(
    join(root, '.codepilotx', 'AGENTS.md'),
  )

  await rm(root, { recursive: true, force: true })
})

test('global and project AGENTS.md are rendered in Codex order', async () => {
  const root = await makeTempDir()
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await writeFile(join(project, 'AGENTS.md'), 'project doc', 'utf8')

  const projectDocs = await discoverProjectAgentsMd({
    cwd: project,
    projectRoot: project,
  })

  expect(buildAgentsMdInstructions('global doc', project, projectDocs)).toBe(
    '# AGENTS.md instructions for ' +
      project +
      '\n\n<INSTRUCTIONS>\nglobal doc\n\n--- project-doc ---\n\nproject doc\n</INSTRUCTIONS>',
  )

  await rm(root, { recursive: true, force: true })
})

test('project AGENTS.override.md is preferred over AGENTS.md', async () => {
  const root = await makeTempDir()
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await writeFile(join(project, 'AGENTS.md'), 'ignored', 'utf8')
  await writeFile(join(project, 'AGENTS.override.md'), 'override doc', 'utf8')

  const projectDocs = await discoverProjectAgentsMd({
    cwd: project,
    projectRoot: project,
  })

  expect(projectDocs.map(doc => doc.content)).toEqual(['override doc'])

  await rm(root, { recursive: true, force: true })
})

test('project AGENTS.md files are discovered from root to cwd and capped', async () => {
  const root = await makeTempDir()
  const project = join(root, 'project')
  const nested = join(project, 'apps', 'desktop')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(nested, { recursive: true })
  await writeFile(join(project, 'AGENTS.md'), 'root', 'utf8')
  await writeFile(join(nested, 'AGENTS.md'), 'abcdef', 'utf8')

  const projectDocs = await discoverProjectAgentsMd({
    cwd: nested,
    maxBytes: 7,
    projectRoot: project,
  })

  expect(projectDocs.map(doc => doc.content)).toEqual(['root', 'abc'])

  await rm(root, { recursive: true, force: true })
})

test('global AGENTS.md is saved and read as utf8', async () => {
  const root = await makeTempDir()
  process.env.USERPROFILE = root
  await saveGlobalAgentsMd('D:\\Config', '中文 instructions')

  expect(await readGlobalAgentsMd('D:\\Config')).toBe('中文 instructions')
  expect(
    await readFile(join(root, '.codepilotx', 'AGENTS.md'), 'utf8'),
  ).toBe('中文 instructions')

  await rm(root, { recursive: true, force: true })
})

test('session append prompt puts AGENTS.md instructions before existing append prompt', async () => {
  const root = await makeTempDir()
  const configHome = join(root, 'config')
  const project = join(root, 'project')
  process.env.USERPROFILE = root
  await mkdir(join(project, '.git'), { recursive: true })
  await saveGlobalAgentsMd(configHome, 'global doc')
  await writeFile(join(project, 'AGENTS.md'), 'project doc', 'utf8')

  const appendSystemPrompt = await buildSessionAppendSystemPrompt({
    configHomeDir: configHome,
    existingAppendSystemPrompt: 'existing append',
    projectRoot: project,
  })

  expect(appendSystemPrompt).toBe(
    '# AGENTS.md instructions for ' +
      project +
      '\n\n<INSTRUCTIONS>\nglobal doc\n\n--- project-doc ---\n\nproject doc\n</INSTRUCTIONS>\n\nexisting append',
  )

  await rm(root, { recursive: true, force: true })
})

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'desktop-agents-md-'))
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
