import { constants } from "node:fs"
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export const rendererDevURL = "http://127.0.0.1:7788" as const
export const agentDataDir = resolve(process.env.CODEPILOTX_DATA_DIR?.trim() || join(homedir(), ".codepilotx"))
export const runtimeDir = join(agentDataDir, "runtime")
export const runtimeFile = join(runtimeDir, "dev-agent-v1.json")
export const lockFile = join(runtimeDir, "dev-agent.lock")

const runtimeKeys = ["agentPid", "authToken", "instanceToken", "origin", "ownerPid", "rendererDevUrl", "schemaVersion"] as const

export type DevAgentRuntimeV1 = {
  schemaVersion: 1
  ownerPid: number
  agentPid: number
  origin: string
  authToken: string
  instanceToken: string
  rendererDevUrl: typeof rendererDevURL
}

type DevAgentLockV1 = { schemaVersion: 1; ownerPid: number; instanceToken: string }

function isPid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 512
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === keys[index])
}

export function parseDevAgentRuntime(text: string): DevAgentRuntimeV1 {
  if (text.length > 4_096) throw new Error("invalid runtime descriptor")
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid runtime descriptor")
  const record = value as Record<string, unknown>
  if (!hasExactKeys(record, runtimeKeys)) throw new Error("invalid runtime descriptor")
  if (record.schemaVersion !== 1 || !isPid(record.ownerPid) || !isPid(record.agentPid)) throw new Error("invalid runtime descriptor")
  if (!isToken(record.authToken) || !isToken(record.instanceToken) || record.rendererDevUrl !== rendererDevURL) {
    throw new Error("invalid runtime descriptor")
  }
  if (typeof record.origin !== "string" || record.origin.length > 128) throw new Error("invalid runtime descriptor")
  const origin = new URL(record.origin)
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.username || origin.password) {
    throw new Error("invalid runtime descriptor")
  }
  const port = Number(origin.port)
  if (origin.pathname !== "/" || origin.search || origin.hash || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("invalid runtime descriptor")
  }
  return record as DevAgentRuntimeV1
}

async function readRegularFile(path: string) {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("invalid runtime file")
  return await readFile(path, "utf8")
}

export async function readDevAgentRuntime() {
  return parseDevAgentRuntime(await readRegularFile(runtimeFile))
}

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

export async function verifyDevAgent(runtime: DevAgentRuntimeV1, timeout = 1_000) {
  try {
    const response = await fetch(`${runtime.origin}/api/ready`, {
      headers: { Authorization: `Bearer ${runtime.authToken}` },
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok) return false
    const body = await response.json() as { instanceToken?: unknown }
    return body.instanceToken === runtime.instanceToken
  } catch {
    return false
  }
}

export async function acquireDevAgentLock(instanceToken: string) {
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 })
  try {
    const runtime = await readDevAgentRuntime()
    if (await verifyDevAgent(runtime)) throw new Error("AGENT_ALREADY_RUNNING")
  } catch (error) {
    if (error instanceof Error && error.message === "AGENT_ALREADY_RUNNING") throw error
  }
  const lock: DevAgentLockV1 = { schemaVersion: 1, ownerPid: process.pid, instanceToken }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      try { await handle.writeFile(JSON.stringify(lock), "utf8") } finally { await handle.close() }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      for (let wait = 0; wait < 20; wait += 1) {
        try {
          const runtime = await readDevAgentRuntime()
          if (await verifyDevAgent(runtime)) throw new Error("AGENT_ALREADY_RUNNING")
        } catch (readError) {
          if (readError instanceof Error && readError.message === "AGENT_ALREADY_RUNNING") throw readError
        }
        await Bun.sleep(100)
      }
      let existing: DevAgentLockV1 | undefined
      try {
        const parsed: unknown = JSON.parse(await readRegularFile(lockFile))
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed as DevAgentLockV1
      } catch { /* malformed lock cannot be safely reclaimed */ }
      if (!existing || existing.schemaVersion !== 1 || !isPid(existing.ownerPid) || !isToken(existing.instanceToken)) {
        throw new Error("AGENT_LOCKED")
      }
      if (isProcessAlive(existing.ownerPid)) throw new Error("AGENT_LOCKED")
      try {
        const runtime = await readDevAgentRuntime()
        if (runtime.ownerPid === existing.ownerPid && runtime.instanceToken === existing.instanceToken) {
          await rm(runtimeFile, { force: true })
        }
      } catch { /* no matching stale descriptor to remove */ }
      await rm(lockFile, { force: true })
    }
  }
  throw new Error("AGENT_LOCKED")
}

export async function publishDevAgentRuntime(runtime: DevAgentRuntimeV1) {
  const temporary = join(runtimeDir, `.dev-agent-${process.pid}-${crypto.randomUUID()}.tmp`)
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  try { await handle.writeFile(JSON.stringify(runtime), "utf8") } finally { await handle.close() }
  try {
    await rename(temporary, runtimeFile)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function cleanupDevAgentRuntime(instanceToken: string) {
  try {
    const runtime = await readDevAgentRuntime()
    if (runtime.instanceToken === instanceToken) await rm(runtimeFile, { force: true })
  } catch { /* absent or replaced descriptor is not ours to clean */ }
  try {
    const parsed = JSON.parse(await readRegularFile(lockFile)) as Partial<DevAgentLockV1>
    if (parsed.instanceToken === instanceToken && parsed.ownerPid === process.pid) await rm(lockFile, { force: true })
  } catch { /* absent or replaced lock is not ours to clean */ }
}

export function localNoProxy(value: string | undefined) {
  const entries = new Set((value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean))
  entries.add("127.0.0.1")
  entries.add("localhost")
  entries.add("::1")
  return [...entries].join(",")
}

export function terminateProcessTree(child: ReturnType<typeof Bun.spawn>) {
  try {
    if (process.platform === "win32") {
      Bun.spawnSync(["taskkill.exe", "/PID", String(child.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" })
    } else child.kill()
  } catch { /* process tree already exited */ }
}
