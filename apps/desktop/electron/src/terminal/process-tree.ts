import { spawn } from "node:child_process"

export interface ProcessTreeKiller {
  kill(pid: number): Promise<void>
}

export class HostProcessTreeKiller implements ProcessTreeKiller {
  async kill(pid: number): Promise<void> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return
    if (process.platform !== "win32") {
      try {
        process.kill(-pid, "SIGTERM")
      } catch {
        try {
          process.kill(pid, "SIGTERM")
        } catch {
          // The process has already exited.
        }
      }
      return
    }
    await new Promise<void>((resolveKill) => {
      const child = spawn(
        "taskkill.exe",
        ["/PID", String(pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      )
      child.once("error", () => resolveKill())
      child.once("exit", () => resolveKill())
    })
  }
}
