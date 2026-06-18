import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build, createServer } from 'vite'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const electronPath = require('electron')
const rendererUrl = 'http://127.0.0.1:5173/'
const mainEntry = resolve(root, 'dist/desktop/main/index.js')
const desktopRuntimeEnv =
  process.env.CODEPILOTX_DESKTOP_RUNTIME ??
  process.env.CLAUDE_CODE_DESKTOP_RUNTIME
const runtimeMode =
  process.argv.includes('--subprocess') ||
  desktopRuntimeEnv === 'subprocess'
    ? 'subprocess'
    : desktopRuntimeEnv

let electronProcess = null
let restarting = false
let restartTimer = null
let shuttingDown = false
const cleanups = []

function log(message) {
  process.stdout.write(`[desktop:dev] ${message}\n`)
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('error', rejectRun)
    child.on('exit', code => {
      if (code === 0) {
        resolveRun()
      } else {
        rejectRun(
          new Error(`${command} ${args.join(' ')} exited with code ${code}`),
        )
      }
    })
  })
}

async function startRendererServer() {
  const server = await createServer({
    configFile: resolve(root, 'apps/desktop/vite.desktop.config.ts'),
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
  })
  await server.listen()
  server.printUrls()
  cleanups.push(() => server.close())
  return server
}

async function startBuildWatcher(label, configFile) {
  const watcher = await build({
    configFile,
    build: {
      watch: {},
    },
  })

  cleanups.push(() => watcher.close())

  return new Promise((resolveWatcher, rejectWatcher) => {
    let initialBuildDone = false

    watcher.on('event', event => {
      if (event.code === 'BUNDLE_END') {
        if (!initialBuildDone) {
          initialBuildDone = true
          log(`${label} initial build complete`)
          resolveWatcher(watcher)
          return
        }
        log(`${label} rebuilt`)
        queueElectronRestart()
      }

      if (event.code === 'ERROR') {
        if (!initialBuildDone) {
          rejectWatcher(event.error)
        }
      }
    })
  })
}

function startElectron() {
  if (shuttingDown) return

  log('starting Electron')
  electronProcess = spawn(electronPath, [mainEntry], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      CODEPILOTX_DESKTOP_RENDERER_URL: rendererUrl,
      CLAUDE_CODE_DESKTOP_RENDERER_URL: rendererUrl,
      ...(runtimeMode
        ? {
            CODEPILOTX_DESKTOP_RUNTIME: runtimeMode,
            CLAUDE_CODE_DESKTOP_RUNTIME: runtimeMode,
          }
        : {}),
    },
  })

  electronProcess.on('error', error => {
    process.stderr.write(`[desktop:dev] Electron failed to start: ${error}\n`)
  })

  electronProcess.on('exit', () => {
    electronProcess = null
    if (!restarting && !shuttingDown) {
      log('Electron exited')
    }
  })
}

function queueElectronRestart() {
  if (shuttingDown) return
  clearTimeout(restartTimer)
  restartTimer = setTimeout(restartElectron, 150)
}

function restartElectron() {
  if (shuttingDown || restarting) return
  restarting = true
  log('restarting Electron')

  const current = electronProcess
  if (!current) {
    restarting = false
    startElectron()
    return
  }

  current.once('exit', () => {
    restarting = false
    startElectron()
  })
  current.kill()
}

async function cleanup() {
  if (shuttingDown) return
  shuttingDown = true
  clearTimeout(restartTimer)

  if (electronProcess) {
    electronProcess.kill()
  }

  await Promise.allSettled(cleanups.map(close => close()))
}

async function main() {
  process.on('SIGINT', () => {
    cleanup().finally(() => process.exit(0))
  })
  process.on('SIGTERM', () => {
    cleanup().finally(() => process.exit(0))
  })

  if (runtimeMode === 'subprocess') {
    log('building desktop agent')
    await run('bun', ['run', 'desktop:agent:build'])
  }

  await startRendererServer()
  const mainReady = startBuildWatcher(
    'main',
    resolve(root, 'apps/desktop/vite.desktop.main.config.ts'),
  )
  const preloadReady = startBuildWatcher(
    'preload',
    resolve(root, 'apps/desktop/vite.desktop.preload.config.ts'),
  )
  await Promise.all([mainReady, preloadReady])

  startElectron()
}

main().catch(error => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  cleanup().finally(() => process.exit(1))
})
