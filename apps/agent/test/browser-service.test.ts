import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import { BrowserService, browserUrl } from '../src/browser/BrowserService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import type { ConfigService, ConfigEdit } from '../src/config/ConfigService'
import { initializeSchema } from '../src/storage/database/schema-initializer'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { browserToolDefinitions } from '../src/tool/Browser/definition'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { removeFixturePaths } from './fixture-cleanup'
const paths: string[] = []
const cleanups: Array<() => void> = []
afterEach(async () => {
  cleanups.splice(0).forEach((fn) => fn())
  await removeFixturePaths(paths.splice(0))
}, 30_000)
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cpx-browser-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'history.sqlite'))
  const configuration: Record<string, any> = {
    desktop: { browserSitePermissions: [], browserAllowedSites: [], unknown: 'keep' },
  }
  const config = {
    snapshot: () => configuration,
    read: async () => ({
      config: configuration,
      layers: [{ kind: 'user', version: 'test', config: configuration }],
    }),
    batchWrite: async ({ edits }: { edits: ConfigEdit[] }) => {
      for (const edit of edits) configuration.desktop[edit.keyPath[1]!] = edit.value
    },
  } as unknown as ConfigService
  const hub = await Effect.runPromise(EventHub.make)
  const browser = new BrowserService(db, hub, config)
  cleanups.push(() => {
    browser.dispose()
    db.close()
  })
  await browser.register('window:test', 'host:test', 'connection:test')
  return { db, config, browser, configuration, hub, root }
}
describe('BrowserService', () => {
  test('browser tools use host inspection identity and origin policy; screenshot audit omits base64', async () => {
    const { db, browser, root } = await fixture()
    const thread = db.createThread('工具')
    const tools = new ToolRegistry()
    for (const definition of browserToolDefinitions(browser)) tools.register(definition)
    const audit: unknown[] = []
    const executor = new ToolExecutor(tools, {
      dataDir: root,
      authorizeShell: async () => ({ decision: 'deny', risk: 'high', reason: 'fixture' }),
      recordToolCall: (_invocation, phase, result) => {
        if (phase === 'completed') audit.push(result)
      },
    })
    const context = {
      threadID: thread.id,
      turnID: 'turn:test',
      taskMode: 'chat' as const,
      workspace: await WorkspaceService.open(root),
      signal: new AbortController().signal,
      permissionConfig: {
        sandboxMode: 'workspace-write' as const,
        approvalPolicy: 'never' as const,
        approvalsReviewer: 'user' as const,
      },
    }
    const tab = await browser.create({ sourceThreadId: thread.id }, true)
    expect(await executor.execute('BrowserTabs', { action: 'list' }, context)).toHaveLength(1)
    await expect(
      executor.execute(
        'BrowserNavigate',
        { tabId: tab.tabId, operation: { action: 'navigate', url: 'https://example.test/' } },
        context,
      ),
    ).rejects.toThrow()
    expect(browser.permissions()).toEqual([])
    const result = executor.execute(
      'BrowserRead',
      { tabId: tab.tabId, operation: { action: 'screenshot' } },
      context,
    )
    const settled = result.then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    let next = await browser.next('window:test', 'host:test', 'connection:test')
    while (!next.command) next = await browser.next('window:test', 'host:test', 'connection:test')
    browser.complete('window:test', 'host:test', next.command.requestId, next.command.generation, {
      text: '截图',
      image: { mimeType: 'image/png', data: 'browser-image-fixture' },
    })
    expect(await settled).toMatchObject({
      value: { text: '截图', image: { data: 'browser-image-fixture' } },
    })
    expect(JSON.stringify(audit)).not.toContain('browser-image-fixture')
    expect(audit.at(-1)).toEqual({ text: '截图' })
  })
  test('manual handover is required; origin authorization is remembered without changing unrelated config', async () => {
    const { db, browser, configuration } = await fixture()
    const thread = db.createThread('浏览器测试')
    const tab = await browser.create({ sourceThreadId: thread.id, url: 'https://example.test/' })
    expect(() => browser.inspect(thread.id, tab.tabId, { action: 'snapshot' })).toThrow(
      '先将此标签交给',
    )
    await browser.control(tab.tabId, thread.id)
    expect(browser.inspect(thread.id, tab.tabId, { action: 'snapshot' }).ruleRequiresApproval).toBe(
      true,
    )
    await browser.setPermission('https://example.test', 'allow')
    expect(browser.inspect(thread.id, tab.tabId, { action: 'snapshot' }).ruleRequiresApproval).toBe(
      false,
    )
    expect(configuration.desktop.unknown).toBe('keep')
    await browser.setPermission('https://example.test', 'deny')
    expect(() => browser.inspect(thread.id, tab.tabId, { action: 'snapshot' })).toThrow('拒绝')
    configuration.desktop.browserAllowedSites.push('https://example.test/legacy-path')
    await browser.setPermission('https://example.test', 'remove')
    expect(browser.inspect(thread.id, tab.tabId, { action: 'snapshot' }).ruleRequiresApproval).toBe(
      true,
    )
  })
  test('dispatch binds generation; takeover cancels the operation and a late completion cannot revive it', async () => {
    const { db, browser } = await fixture()
    const thread = db.createThread('操作')
    const tab = await browser.create({ sourceThreadId: thread.id }, true)
    const operation = browser.execute(
      thread.id,
      tab.tabId,
      { action: 'snapshot' },
      new AbortController().signal,
    )
    const rejected = operation.catch((error) => error as Error)
    let next = await browser.next('window:test', 'host:test', 'connection:test')
    while (!next.command) next = await browser.next('window:test', 'host:test', 'connection:test')
    expect(next.command?.tabId).toBe(tab.tabId)
    expect(next.command?.generation).not.toBe(tab.generation)
    await browser.control(tab.tabId, null)
    const rejection = await rejected
    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).toContain('交接或关闭')
    browser.complete(
      'window:test',
      'host:test',
      next.command!.requestId,
      next.command!.generation,
      { text: 'late' },
    )
    expect(browser.require(tab.tabId)).toMatchObject({ controlThreadId: null, busy: false })
    expect(() => browser.host('window:test', 'old-host', 'connection:test')).toThrow('已失效')
    const generation = browser.require(tab.tabId).generation
    await browser.register('window:test', 'host:reloaded', 'connection:test')
    expect(browser.require(tab.tabId).state).toBe('suspended')
    expect(browser.require(tab.tabId).generation).not.toBe(generation)
    await expect(
      browser.report('window:test', 'host:reloaded', tab.tabId, generation, { title: 'stale' }),
    ).rejects.toThrow('已失效')
  })
  test('navigation and restore retain histories and unknown fields, without raw pageState', async () => {
    const { db, browser } = await fixture()
    const tab = await browser.create({ sourceThreadId: null })
    const row = db.sqlite.query('SELECT record FROM browser_tabs WHERE id = ?').get(tab.tabId) as {
      record: string
    }
    db.sqlite
      .query('UPDATE browser_tabs SET record = ? WHERE id = ?')
      .run(JSON.stringify({ ...JSON.parse(row.record), future: 'preserved' }), tab.tabId)
    await browser.report('window:test', 'host:test', tab.tabId, tab.generation, {
      history: [{ url: 'https://example.test/', title: 'example', pageState: 'do not store' }],
      historyIndex: 0,
    })
    const restored = await browser.restore('window:test', 'host:test', tab.tabId, tab.generation)
    expect(restored.history).toEqual([{ url: 'https://example.test/', title: 'example' }])
    expect(restored.generation).not.toBe(tab.generation)
    const saved = JSON.parse(
      (
        db.sqlite.query('SELECT record FROM browser_tabs WHERE id = ?').get(tab.tabId) as {
          record: string
        }
      ).record,
    )
    expect(saved.future).toBe('preserved')
    expect(JSON.stringify(saved)).not.toContain('pageState')
    await expect(
      browser.report('window:test', 'host:test', tab.tabId, tab.generation, { title: 'stale' }),
    ).rejects.toThrow('已失效')
    expect(
      db.sqlite.query("SELECT COUNT(*) AS n FROM events WHERE method = 'browser/changed'").get(),
    ).toMatchObject({ n: 3 })
  })
  test('forward migration adds only browser storage and a future user_version is preserved', async () => {
    const { db } = await fixture()
    const thread = db.createThread('保留聊天')
    db.sqlite.exec('DROP TABLE browser_tabs; PRAGMA user_version = 50')
    initializeSchema(db.sqlite)
    expect(db.getThread(thread.id)).not.toBeNull()
    expect(db.sqlite.query('PRAGMA user_version').get()).toMatchObject({ user_version: 51 })
    db.sqlite.exec(
      "ALTER TABLE browser_tabs ADD COLUMN future_note TEXT; INSERT INTO browser_tabs (id, record, future_note) VALUES ('future:tab', '{}', 'keep'); PRAGMA user_version = 50",
    )
    initializeSchema(db.sqlite)
    expect(db.sqlite.query('PRAGMA user_version').get()).toMatchObject({ user_version: 51 })
    expect(db.sqlite.query("SELECT * FROM browser_tabs WHERE id = 'future:tab'").get()).toEqual({
      id: 'future:tab',
      record: '{}',
      future_note: 'keep',
    })
    db.sqlite.exec('PRAGMA user_version = 72; CREATE TABLE future_browser_data (id TEXT)')
    initializeSchema(db.sqlite)
    expect(db.sqlite.query('PRAGMA user_version').get()).toMatchObject({ user_version: 72 })
    expect(
      db.sqlite.query("SELECT name FROM sqlite_master WHERE name = 'future_browser_data'").get(),
    ).not.toBeNull()
  })
  test('host and URL policy reject stale authority and unsafe navigation', async () => {
    const { browser } = await fixture()
    expect(() => browser.host('window:test', 'host:test', 'foreign')).toThrow('已失效')
    expect(browserUrl('localhost:3000')).toBe('http://localhost:3000/')
    for (const value of [
      'file:///C:/private',
      'javascript:alert(1)',
      'https://user:password@example.test/',
    ])
      expect(() => browserUrl(value)).toThrow()
  })
})
