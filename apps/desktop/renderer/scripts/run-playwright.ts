import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const rendererRoot = fileURLToPath(new URL('..', import.meta.url))
const allowedConfigs = new Set([
  'playwright.a11y.config.ts',
  'playwright.config.ts',
])

async function allocateLoopbackPort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法分配 Playwright 回环端口'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

const configFile = process.argv[2]?.trim()
if (!configFile || !allowedConfigs.has(configFile)) {
  throw new Error(
    'Playwright 配置必须是 playwright.config.ts 或 playwright.a11y.config.ts，且只接受文件名',
  )
}

const port = await allocateLoopbackPort()
console.log(`[playwright] 使用动态回环端口 ${port}`)

const playwright = Bun.spawn(
  [process.execPath, 'x', 'playwright', 'test', '--config', configFile],
  {
    cwd: rendererRoot,
    env: {
      ...process.env,
      CODEPILOTX_VISUAL_PORT: String(port),
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  },
)

process.exit(await playwright.exited)
