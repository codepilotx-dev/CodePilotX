import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expectSourceContains } from './SourceContract.js'

/**
 * 产品改名为 Pidex Desktop 后，Electron 默认 userData 目录会随应用名漂移。
 * main.ts 必须显式固定到改名前的目录，并保留显式目录的优先级，否则设置、
 * 会话索引与浏览器分区状态会失联。
 */
describe('desktop data directory stability across the rename', () => {
  test('pins the default userData directory to the pre-rename location', async () => {
    const source = await readSource('../src/Main.ts')
    expectSourceContains(source, "join(app.getPath('appData'), '@codepilotx', 'desktop-electron')")
    expectSourceContains(
      source,
      "app.setPath('userData', configuredUserDataDirectory ? resolve(configuredUserDataDirectory) : LEGACY_USER_DATA_DIRECTORY)",
    )
  })

  test('keeps the application id used by installers and Windows toasts', async () => {
    const source = await readSource('../src/Main.ts')
    expectSourceContains(source, "'com.codepilotx.desktop'")
    expect(source).toContain("process.env.CODEPILOTX_USER_DATA_DIR")
  })
})

async function readSource(relativePath: string): Promise<string> {
  const content = await readFile(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
  return content.replace(/\r\n/g, '\n')
}
