import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { assertWindowsX64PE } from "./windows-pe"

const root = resolve(import.meta.dir, "..")
const applicationArgument = process.argv.find(argument => argument.startsWith("--application="))
const application = applicationArgument
  ? resolve(applicationArgument.slice("--application=".length))
  : resolve(root, "release/win-unpacked/CodePilotX.exe")
const resources = join(dirname(application), "resources")
const agent = join(resources, "agent/codepilotx-agent.exe")
if (!existsSync(application) || !existsSync(agent)) throw new Error("x64 冒烟所需的桌面程序或 Agent 不存在")
await assertWindowsX64PE(application)
await assertWindowsX64PE(agent)

const isolatedRoot = await mkdtemp(join(tmpdir(), "codepilotx-win-smoke-"))
const logDirectory = join(isolatedRoot, "logs")
const token = crypto.randomUUID().replaceAll("-", "")
const child = Bun.spawn([application, `--user-data-dir=${join(isolatedRoot, "profile")}`], {
  cwd: dirname(application),
  env: {
    ...process.env,
    APPDATA: join(isolatedRoot, "appdata"),
    LOCALAPPDATA: join(isolatedRoot, "localappdata"),
    CODEPILOTX_AUTH_TOKEN: token,
    CODEPILOTX_DATA_DIR: join(isolatedRoot, "agent-home"),
    CODEPILOTX_LOG_DIR: logDirectory,
  },
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
  windowsHide: true,
})

try {
  const ready = await waitForDesktopReady(join(logDirectory, "desktop.log"), 20_000)
  const response = await fetch(`${ready.origin}/api/ready`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(2_000),
  })
  if (!response.ok || (await response.json() as { ok?: boolean }).ok !== true) {
    throw new Error(`Agent /api/ready 冒烟失败：HTTP ${response.status}`)
  }
  console.log(`[CodePilotX] desktop.ready and /api/ready smoke passed: ${ready.origin}`)
} finally {
  child.kill()
  if (process.platform === "win32" && child.pid) {
    const cleanup = Bun.spawn(["taskkill.exe", "/PID", String(child.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" })
    await cleanup.exited
  }
  await rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined)
}

async function waitForDesktopReady(logPath: string, timeoutMs: number): Promise<{ origin: string }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await readFile(logPath, "utf8").catch(() => "")
    if (/ENOENT/i.test(text)) throw new Error("桌面启动日志出现 ENOENT")
    const records = text.split(/\r?\n/).flatMap(line => {
      try { return line ? [JSON.parse(line) as { event?: string; origin?: string }] : [] }
      catch { return [] }
    })
    const failure = records.find(record => record.event === "desktop.startup-failed")
    if (failure) throw new Error("桌面启动记录 desktop.startup-failed")
    const ready = records.find(record => record.event === "desktop.ready" && typeof record.origin === "string")
    if (ready?.origin) return { origin: ready.origin }
    await Bun.sleep(100)
  }
  throw new Error(`桌面程序 ${timeoutMs / 1_000} 秒内未记录 desktop.ready`)
}
