import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { getAutoMemPath } from '../../memdir/paths.js'
import { MemoryTool } from './MemoryTool.js'

let tmpDir: string
let autoMemPath: string
let mockContext: any

beforeEach(async () => {
  tmpDir = join(tmpdir(), `memory-tool-test-${Date.now()}`)
  autoMemPath = join(tmpDir, 'memory')
  await mkdir(autoMemPath, { recursive: true })

  process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = autoMemPath
  getAutoMemPath.cache?.clear?.()

  mockContext = {
    readFileState: new Map(),
    messages: [],
    abortController: new AbortController(),
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], inactiveAgents: [] },
    },
    getAppState: mock(() => ({})),
    setAppState: mock(() => {}),
    setInProgressToolUseIDs: mock(() => {}),
    setResponseLength: mock(() => {}),
    updateFileHistoryState: mock(() => {}),
    updateAttributionState: mock(() => {}),
  }

  await writeFile(join(autoMemPath, 'MEMORY.md'), '# Memory Index\n\n- [Topic](topic.md)\n')
})

afterEach(async () => {
  delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  getAutoMemPath.cache?.clear?.()
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})

async function callTool(input: any) {
  const parentMessage = {
    type: 'assistant' as const,
    uuid: 'test-uuid',
    message: {
      id: 'test-id',
      content: [{ type: 'tool_use' as const, name: 'memory', id: 'test-tool-use', input }],
    },
  }
  return MemoryTool.call(input, mockContext, null as any, parentMessage)
}

describe('MemoryTool', () => {
  test('isEnabled is true when auto memory is enabled', () => {
    expect(MemoryTool.isEnabled()).toBe(true)
  })

  test('isReadOnly is true for view', () => {
    expect(MemoryTool.isReadOnly({ command: 'view', path: '/memories' })).toBe(true)
  })

  test('isReadOnly is false for write commands', () => {
    expect(MemoryTool.isReadOnly({ command: 'create', path: '/memories/test.md' })).toBe(false)
    expect(MemoryTool.isReadOnly({ command: 'delete', path: '/memories/test.md' })).toBe(false)
  })

  test('isDestructive is true for delete', () => {
    expect(MemoryTool.isDestructive({ command: 'delete', path: '/memories/test.md' })).toBe(true)
  })

  test('view /memories lists files', async () => {
    await writeFile(join(autoMemPath, 'topic.md'), '---\ntype: user\ndescription: test\n---\n# Topic')

    const result = await callTool({ command: 'view', path: '/memories' })
    const output = result.data as any
    expect(output.command).toBe('view')
    expect(output.files).toBeDefined()
    const names = output.files!.map((f: any) => f.path)
    expect(names).toContain('/memories/MEMORY.md')
    expect(names).toContain('/memories/topic.md')
  })

  test('view single file reads content', async () => {
    await writeFile(join(autoMemPath, 'test.md'), '# Test Memory\n\nSome content here.')

    const result = await callTool({ command: 'view', path: '/memories/test.md' })
    const output = result.data as any
    expect(output.command).toBe('view')
    expect(output.content).toContain('# Test Memory')
    expect(output.content).toContain('Some content here.')
  })

  test('view respects offset and limit', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`)
    await writeFile(join(autoMemPath, 'test.md'), lines.join('\n'))

    const result = await callTool({ command: 'view', path: '/memories/test.md', offset: 5, limit: 3 })
    const output = result.data as any
    expect(output.content).toContain('Line 6')
    expect(output.content).toContain('Line 7')
    expect(output.content).toContain('Line 8')
    expect(output.content).not.toContain('Line 5')
  })

  test('create creates a new file', async () => {
    const result = await callTool({
      command: 'create',
      path: '/memories/new-topic.md',
      file_text: '# New Memory\n\nContent here.',
    })
    const output = result.data as any
    expect(output.content).toContain('Created')
    const content = await readFile(join(autoMemPath, 'new-topic.md'), 'utf8')
    expect(content).toContain('# New Memory')
  })

  test('create fails on existing file', async () => {
    await writeFile(join(autoMemPath, 'exists.md'), '# Existing')
    const result = await callTool({
      command: 'create',
      path: '/memories/exists.md',
      file_text: '# New',
    })
    const output = result.data as any
    expect(output.content).toContain('already exists')
  })

  test('create rejects missing file_text', async () => {
    const validateResult = await MemoryTool.validateInput!(
      { command: 'create', path: '/memories/test.md' },
      mockContext,
    )
    expect(validateResult.result).toBe(false)
  })

  test('str_replace replaces text exactly once', async () => {
    await writeFile(join(autoMemPath, 'test.md'), '# Original\n\nSome content.')
    const result = await callTool({
      command: 'str_replace',
      path: '/memories/test.md',
      old_str: 'Original',
      new_str: 'Updated',
    })
    const output = result.data as any
    expect(output.content).toContain('Updated')
    const content = await readFile(join(autoMemPath, 'test.md'), 'utf8')
    expect(content).toContain('# Updated')
  })

  test('str_replace fails on missing string', async () => {
    await writeFile(join(autoMemPath, 'test.md'), '# Original')
    const result = await callTool({
      command: 'str_replace',
      path: '/memories/test.md',
      old_str: 'Nonexistent',
      new_str: 'New',
    })
    const output = result.data as any
    expect(output.content).toContain('not found')
  })

  test('str_replace fails on multiple matches', async () => {
    await writeFile(join(autoMemPath, 'test.md'), '# Duplicate\n\nSome Duplicate text.')
    const result = await callTool({
      command: 'str_replace',
      path: '/memories/test.md',
      old_str: 'Duplicate',
      new_str: 'Replaced',
    })
    const output = result.data as any
    expect(output.content).toContain('Found 2 matches')
  })

  test('str_replace rejects missing old_str', async () => {
    const validateResult = await MemoryTool.validateInput!(
      { command: 'str_replace', path: '/memories/test.md', new_str: 'new' },
      mockContext,
    )
    expect(validateResult.result).toBe(false)
  })

  test('insert inserts at line 0 (beginning)', async () => {
    await writeFile(join(autoMemPath, 'test.md'), 'Line 1\nLine 2')
    const result = await callTool({
      command: 'insert',
      path: '/memories/test.md',
      insert_line: 0,
      new_str: 'Inserted',
    })
    const output = result.data as any
    expect(output.content).toContain('Updated')
    const content = await readFile(join(autoMemPath, 'test.md'), 'utf8')
    expect(content).toBe('Inserted\nLine 1\nLine 2')
  })

  test('insert inserts at end when line exceeds file', async () => {
    await writeFile(join(autoMemPath, 'test.md'), 'Line 1')
    const result = await callTool({
      command: 'insert',
      path: '/memories/test.md',
      insert_line: 100,
      new_str: 'Appended',
    })
    const output = result.data as any
    expect(output.content).toContain('Updated')
    const content = await readFile(join(autoMemPath, 'test.md'), 'utf8')
    expect(content).toBe('Line 1\nAppended')
  })

  test('delete removes a file', async () => {
    await writeFile(join(autoMemPath, 'test.md'), '# To Delete')
    const result = await callTool({ command: 'delete', path: '/memories/test.md' })
    const output = result.data as any
    expect(output.content).toContain('Deleted')
    expect(existsSync(join(autoMemPath, 'test.md'))).toBe(false)
  })

  test('rename moves a file', async () => {
    await writeFile(join(autoMemPath, 'old.md'), '# Old Name')
    const result = await callTool({
      command: 'rename',
      path: '/memories/old.md',
      new_path: '/memories/new.md',
    })
    const output = result.data as any
    expect(output.content).toContain('Renamed')
    expect(existsSync(join(autoMemPath, 'old.md'))).toBe(false)
    expect(existsSync(join(autoMemPath, 'new.md'))).toBe(true)
  })

  test('rename to same path is rejected', async () => {
    const validateResult = await MemoryTool.validateInput!(
      { command: 'rename', path: '/memories/test.md', new_path: '/memories/test.md' },
      mockContext,
    )
    expect(validateResult.result).toBe(false)
  })

  test('rejects rename to existing file', async () => {
    await writeFile(join(autoMemPath, 'src.md'), '# Source')
    await writeFile(join(autoMemPath, 'dst.md'), '# Dest')
    const result = await callTool({
      command: 'rename',
      path: '/memories/src.md',
      new_path: '/memories/dst.md',
    })
    const output = result.data as any
    expect(output.content).toContain('already exists')
  })

  test('rejects non-md mutation in validateInput', async () => {
    const validateResult = await MemoryTool.validateInput!(
      { command: 'create', path: '/memories/test.txt', file_text: '# test' },
      mockContext,
    )
    expect(validateResult.result).toBe(false)
  })

  test('rejects non-md mutation at runtime', async () => {
    const validateResult = await MemoryTool.validateInput!(
      { command: 'create', path: '/memories/test.txt', file_text: '# test' },
      mockContext,
    )
    expect(validateResult.result).toBe(false)
  })

  test('rejects root directory mutation', async () => {
    const validateResult = await MemoryTool.validateInput!(
      { command: 'create', path: '/memories', file_text: '# test' },
      mockContext,
    )
    expect(validateResult.result).toBe(false)
  })

  test('rejects non-/memories paths', async () => {
    const validateResult = await MemoryTool.validateInput!(
      { command: 'view', path: '/etc/passwd' },
      mockContext,
    )
    expect(validateResult.result).toBe(false)
  })

  test('view returns file not found for nonexistent file', async () => {
    const result = await callTool({ command: 'view', path: '/memories/nonexistent.md' })
    const output = result.data as any
    expect(output.content).toContain('not found')
  })

  test('updates readFileState on view', async () => {
    await writeFile(join(autoMemPath, 'test.md'), '# Test\n\nContent')
    const result = await callTool({ command: 'view', path: '/memories/test.md' })
    const output = result.data as any
    expect(output.command).toBe('view')
    expect(output.content).toBeTruthy()
  })
})
