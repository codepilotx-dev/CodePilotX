import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { ExternalOpenTargetService } from "../src/ipc/external-open-targets"

const targetPath = "C:\\workspace\\src\\index.ts"

describe("ExternalOpenTargetService", () => {
  test("只列出固定 allowlist 中已安装的编辑器并返回应用图标", async () => {
    const localAppData = "C:\\Users\\test\\AppData\\Local"
    const vscode = join(localAppData, "Programs", "Microsoft VS Code", "Code.exe")
    const service = new ExternalOpenTargetService({
      platform: "win32",
      env: { LOCALAPPDATA: localAppData, WINDIR: "C:\\Windows" },
      fileExists: async path => path === vscode,
      getFileIconDataUrl: async path => `data:image/png;base64,${path === vscode ? "editor" : "default"}`,
      openPath: async () => "",
      revealPath: () => undefined,
      spawnProcess: () => ({ unref: () => undefined }),
    })

    await expect(service.listTargets(targetPath)).resolves.toEqual([
      {
        targetId: "default-app",
        label: "系统默认应用",
        kind: "default-app",
        iconDataUrl: "data:image/png;base64,default",
      },
      {
        targetId: "vscode",
        label: "Visual Studio Code",
        kind: "editor",
        iconDataUrl: "data:image/png;base64,editor",
      },
    ])
  })

  test("使用 shell:false 启动 allowlist 目标并拒绝任意 targetId", async () => {
    const localAppData = "C:\\Users\\test\\AppData\\Local"
    const vscode = join(localAppData, "Programs", "Microsoft VS Code", "Code.exe")
    const launches: unknown[][] = []
    let unrefCalled = false
    const service = new ExternalOpenTargetService({
      platform: "win32",
      env: { LOCALAPPDATA: localAppData },
      fileExists: async path => path === vscode,
      getFileIconDataUrl: async () => null,
      openPath: async () => "",
      revealPath: () => undefined,
      spawnProcess: (executablePath, args, options) => {
        launches.push([executablePath, args, options])
        return { unref: () => { unrefCalled = true } }
      },
    })

    await service.openPathWithTarget(targetPath, "vscode")

    expect(launches).toEqual([[
      vscode,
      [targetPath],
      { detached: true, shell: false, stdio: "ignore", windowsHide: true },
    ]])
    expect(unrefCalled).toBe(true)
    await expect(
      service.openPathWithTarget(targetPath, "C:\\malware.exe"),
    ).rejects.toThrow("不支持或未安装")
  })

  test("系统默认打开失败时回退到资源管理器，并拒绝相对路径", async () => {
    const revealed: string[] = []
    const service = new ExternalOpenTargetService({
      platform: "win32",
      env: {},
      fileExists: async () => false,
      getFileIconDataUrl: async () => null,
      openPath: async () => "No application is associated",
      revealPath: path => { revealed.push(path) },
      spawnProcess: () => ({ unref: () => undefined }),
    })

    await service.openPathWithTarget(targetPath, "default-app")

    expect(revealed).toEqual([targetPath])
    await expect(service.listTargets("relative.txt")).rejects.toThrow(
      "只允许打开绝对路径",
    )
    expect(() => service.revealPathInFolder("relative.txt")).toThrow(
      "只允许打开绝对路径",
    )
  })
})
