import { describe, expect, test } from "bun:test"
import type {
  WindowsSandboxUserStatus,
  WindowsWfpStatusResult,
} from "@anthropic-ai/sandbox-runtime"
import { RpcMethods } from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import {
  AnthropicSandboxRuntimeAdapter,
  classifyWindowsSandboxStatus,
  mapSandboxInitializationError,
  sandboxNotReadyError,
  sandboxStatusFailure,
  toPublicSandboxStatus,
  type SandboxStatus,
  type SandboxInstallationRecord,
} from "../src/sandbox/SandboxRuntimeAdapter"
import { requireAvailableSandbox } from "../src/sandbox/SandboxStatusView"
import type { SandboxWorkerPool } from "../src/sandbox/SandboxWorkerPool"

const userStatus = (
  overrides: Partial<WindowsSandboxUserStatus> = {},
): WindowsSandboxUserStatus => ({
  provisioned: true,
  groupExists: true,
  inBuiltinUsers: true,
  inSandboxGroup: true,
  hiddenFromLogon: true,
  credPresent: true,
  realUserSid: "S-1-5-21-real",
  ...overrides,
})

const wfpStatus = (
  state: WindowsWfpStatusResult["state"],
  overrides: Partial<WindowsWfpStatusResult> = {},
): WindowsWfpStatusResult => ({
  state,
  filters: state === "installed" ? 4 : 0,
  ...(state === "cannot-read"
    ? { hint: "BFE filter enumeration is admin-only" }
    : {}),
  ...overrides,
})

const internalStatus = (
  overrides: Partial<SandboxStatus> = {},
): SandboxStatus => ({
  state: "available",
  platform: "win32",
  architecture: "x64",
  runtimeVersion: "0.0.65",
  helperPath: "C:\\private\\srt-win.exe",
  helperSha256: "a".repeat(64),
  user: userStatus({
    sid: "S-1-5-21-sandbox",
    groupSid: "S-1-5-21-group",
  }),
  wfp: wfpStatus("installed"),
  error: null,
  ...overrides,
})

describe("sandbox status", () => {
  test("状态读取复用缓存，显式刷新合并并发探测且失败保留旧值", async () => {
    const adapter = new AnthropicSandboxRuntimeAdapter()
    const probeTarget = adapter as unknown as {
      probeStatus(): Promise<SandboxStatus>
    }
    let probes = 0
    let releaseProbe: (() => void) | undefined
    let gate = new Promise<void>((resolve) => {
      releaseProbe = resolve
    })
    probeTarget.probeStatus = async () => {
      probes += 1
      await gate
      return internalStatus({ runtimeVersion: `probe-${probes}` })
    }

    const startupRefresh = adapter.refreshStatus()
    const initialRead = adapter.getStatus()
    await Promise.resolve()
    releaseProbe?.()
    const [refreshed, read] = await Promise.all([startupRefresh, initialRead])

    expect(probes).toBe(1)
    expect(read).toEqual(refreshed)
    expect(await adapter.getStatus()).toEqual(refreshed)
    expect(probes).toBe(1)

    gate = new Promise<void>((resolve) => {
      releaseProbe = resolve
    })
    const firstRefresh = adapter.refreshStatus()
    const secondRefresh = adapter.refreshStatus()
    await Promise.resolve()
    releaseProbe?.()
    const [firstResult, secondResult] = await Promise.all([
      firstRefresh,
      secondRefresh,
    ])

    expect(probes).toBe(2)
    expect(secondResult).toEqual(firstResult)

    probeTarget.probeStatus = async () => {
      throw new Error("probe failed")
    }
    await expect(adapter.refreshStatus()).rejects.toThrow("probe failed")
    expect(await adapter.getStatus()).toEqual(firstResult)
  })

  test("执行前只复核 helper，初始化失败后使状态缓存失效", async () => {
    const workerPool = {
      hasWork: () => false,
      run: async () => {
        throw new Error("initialize failed")
      },
      recycleIdleWorkers: async () => undefined,
      dispose: async () => undefined,
    } as unknown as SandboxWorkerPool
    const adapter = new AnthropicSandboxRuntimeAdapter({ workerPool })
    const target = adapter as unknown as {
      probeStatus(): Promise<SandboxStatus>
      resolvedHelper(): Promise<{ path: string; spawn: never }>
      validateHelper(path: string): string
    }
    let probes = 0
    let helperValidations = 0
    target.probeStatus = async () => {
      probes += 1
      return internalStatus()
    }
    target.resolvedHelper = async () => ({
      path: "C:\\CodePilotX\\srt-win.exe",
      spawn: undefined as never,
    })
    target.validateHelper = () => {
      helperValidations += 1
      return "a".repeat(64)
    }

    await adapter.refreshStatus()
    await expect(adapter.run({
      command: "echo sandbox",
      cwd: "C:\\workspace",
      config: {} as never,
    })).rejects.toMatchObject({ code: "SANDBOX_UNAVAILABLE" })

    expect(helperValidations).toBe(1)
    expect(probes).toBe(1)
    await adapter.getStatus()
    expect(probes).toBe(2)
  })

  test("未安装账号优先返回首次安装提示，不泄漏 BFE cannot-read hint", () => {
    expect(classifyWindowsSandboxStatus(
      userStatus({
        provisioned: false,
        groupExists: false,
        inBuiltinUsers: false,
        inSandboxGroup: false,
        hiddenFromLogon: false,
        credPresent: false,
      }),
      wfpStatus("cannot-read"),
    )).toEqual({
      state: "not-installed",
      error: "SRT 沙箱尚未安装，首次使用需要完成安装。",
    })
  })

  test("完整安装允许非管理员 cannot-read，缺失账号配置或 WFP 时要求修复", () => {
    expect(classifyWindowsSandboxStatus(
      userStatus(),
      wfpStatus("cannot-read"),
    )).toEqual({ state: "available", error: null })

    expect(classifyWindowsSandboxStatus(
      userStatus({
        credPresent: false,
        inSandboxGroup: false,
        hiddenFromLogon: false,
      }),
      wfpStatus("absent"),
    )).toEqual({
      state: "repair-required",
      error: expect.stringMatching(/沙箱账号凭据.*sandbox-runtime-users 组成员关系.*登录界面隐藏配置.*WFP 网络过滤器/),
    })
  })

  test("缺失安装代际或 WFP 端口不匹配时要求一次修复", async () => {
    let record: SandboxInstallationRecord | null = null
    const adapter = new AnthropicSandboxRuntimeAdapter({
      installationStore: {
        get: () => record,
        set: (value) => {
          record = value
        },
      },
    })
    const target = adapter as unknown as {
      api(): Promise<{
        getWindowsSandboxUserStatus(): WindowsSandboxUserStatus
        getWindowsWfpStatus(): WindowsWfpStatusResult
      }>
      resolvedHelper(): Promise<{ path: string; spawn: never }>
      validateHelper(path: string): string
    }
    let range: [number, number] = [60080, 60095]
    target.resolvedHelper = async () => ({
      path: "C:\\CodePilotX\\srt-win.exe",
      spawn: undefined as never,
    })
    target.validateHelper = () => "a".repeat(64)
    target.api = async () => ({
      getWindowsSandboxUserStatus: () => userStatus(),
      getWindowsWfpStatus: () => wfpStatus("installed", { portRange: range }),
    })

    await expect(adapter.refreshStatus()).resolves.toMatchObject({
      state: "repair-required",
      error: expect.stringContaining("安装代际"),
    })
    record = {
      generation: 2,
      runtimeVersion: "0.0.65",
      proxyPortRange: [60080, 60095],
      maxConcurrentCommands: 8,
      installed: true,
    }
    await expect(adapter.refreshStatus()).resolves.toMatchObject({ state: "available" })
    range = [60080, 60089]
    await expect(adapter.refreshStatus()).resolves.toMatchObject({
      state: "repair-required",
      error: expect.stringContaining("60080–60095"),
    })
  })

  test("运行中维护操作返回 SANDBOX_BUSY，不修改安装状态", async () => {
    const workerPool = {
      hasWork: () => true,
      run: async () => {
        throw new Error("not used")
      },
      recycleIdleWorkers: async () => undefined,
      dispose: async () => undefined,
    } as unknown as SandboxWorkerPool
    const adapter = new AnthropicSandboxRuntimeAdapter({ workerPool })
    await expect(adapter.install()).rejects.toMatchObject({ code: "SANDBOX_BUSY" })
    await expect(adapter.uninstall()).rejects.toMatchObject({ code: "SANDBOX_BUSY" })
  })

  test("安装成功后才写入 generation 2 记录，UAC 取消不写入", async () => {
    let record: SandboxInstallationRecord | null = null
    let cancelled = false
    let installedRange: readonly [number, number] | undefined
    const workerPool = {
      hasWork: () => false,
      run: async () => {
        throw new Error("not used")
      },
      recycleIdleWorkers: async () => undefined,
      dispose: async () => undefined,
    } as unknown as SandboxWorkerPool
    const adapter = new AnthropicSandboxRuntimeAdapter({
      workerPool,
      installationStore: {
        get: () => record,
        set: (value) => {
          record = value
        },
      },
    })
    const target = adapter as unknown as {
      api(): Promise<{
        installWindowsSandbox(options: {
          proxyPortRange: readonly [number, number]
        }): { cancelled: boolean }
      }>
      resolvedHelper(): Promise<{ path: string; spawn: never }>
      validateHelper(path: string): string
    }
    target.resolvedHelper = async () => ({
      path: "C:\\CodePilotX\\srt-win.exe",
      spawn: undefined as never,
    })
    target.validateHelper = () => "a".repeat(64)
    target.api = async () => ({
      installWindowsSandbox: (options) => {
        installedRange = options.proxyPortRange
        return { cancelled }
      },
    })

    await adapter.install()
    expect(installedRange).toEqual([60080, 60095])
    expect(record as SandboxInstallationRecord | null).toEqual({
      generation: 2,
      runtimeVersion: "0.0.65",
      proxyPortRange: [60080, 60095],
      maxConcurrentCommands: 8,
      installed: true,
    })
    record = null
    cancelled = true
    await expect(adapter.install()).rejects.toMatchObject({ code: "SANDBOX_INSTALL_CANCELLED" })
    expect(record).toBeNull()
  })

  test("公共 RPC view 符合协议并隐藏 helper、SID 和 WFP 诊断", () => {
    const view = toPublicSandboxStatus(internalStatus({
      state: "repair-required",
      error: "需要修复",
    }))
    expect(view).toEqual({
      state: "repair-required",
      platform: "win32",
      architecture: "x64",
      runtimeVersion: "0.0.65",
      maturity: "alpha",
      maxConcurrentCommands: 8,
      error: "需要修复",
      operations: {
        canInstall: false,
        canRepair: true,
        canUninstall: true,
      },
    })
    expect(() => Schema.decodeUnknownSync(
      RpcMethods["sandbox/status"].result,
      { onExcessProperty: "error" },
    )({ sandbox: view })).not.toThrow()
  })

  test("安装和修复只有重新检查为 available 才成功", () => {
    const status = internalStatus({
      state: "repair-required",
      error: "WFP 网络过滤器仍缺失",
    })
    expect(() => requireAvailableSandbox(status, "安装")).toThrow()
    expect(() => requireAvailableSandbox(status, "安装")).toThrow(
      expect.objectContaining({
        code: "SANDBOX_UNAVAILABLE",
        message: expect.stringContaining("安装后仍不可用"),
      }),
    )
    expect(() => requireAvailableSandbox(status, "修复")).toThrow(
      expect.objectContaining({
        code: "SANDBOX_UNAVAILABLE",
        message: expect.stringContaining("修复后仍不可用"),
      }),
    )
    expect(requireAvailableSandbox(internalStatus(), "安装")).toEqual({
      sandbox: toPublicSandboxStatus(internalStatus()),
    })
  })

  test("执行入口区分首次安装和修复错误码", () => {
    expect(sandboxNotReadyError(internalStatus({
      state: "not-installed",
      error: "首次使用需要安装",
    }))).toMatchObject({
      code: "SANDBOX_SETUP_REQUIRED",
      message: "首次使用需要安装",
    })
    expect(sandboxNotReadyError(internalStatus({
      state: "damaged",
      error: "helper 校验失败",
    }))).toMatchObject({
      code: "SANDBOX_REPAIR_REQUIRED",
      message: "helper 校验失败",
    })
  })

  test("初始化 ACL 和超时错误映射为稳定中文错误且不泄漏 helper 路径", () => {
    const acl = mapSandboxInitializationError(new Error(
      "srt-win acl grant exited 1: WIN32_ERROR=0x00000005 C:\\Windows\\System32",
    ))
    expect(acl).toMatchObject({
      code: "SANDBOX_PATH_ACCESS_DENIED",
      status: 503,
    })
    expect(acl.message).not.toContain("System32")

    const timeout = mapSandboxInitializationError(new Error(
      "spawnSync C:\\Software\\CodePilotX\\resources\\srt-win\\x64\\srt-win.exe ETIMEDOUT",
    ))
    expect(timeout).toMatchObject({
      code: "SANDBOX_RUNTIME_TIMEOUT",
      status: 504,
    })
    expect(timeout.message).not.toContain("C:\\Software")
  })

  test("状态检测错误统一脱敏并提供修复建议", () => {
    const timeout = sandboxStatusFailure(
      new Error("spawnSync C:\\private\\srt-win.exe ETIMEDOUT"),
      "runtime-status",
    )
    expect(timeout).toContain("状态检测超时")
    expect(timeout).not.toContain("C:\\private")

    const acl = sandboxStatusFailure(
      new Error("acl stamp: ERROR_ACCESS_DENIED at C:\\Windows\\System32"),
      "runtime-status",
    )
    expect(acl).toContain("无法检查沙箱权限")
    expect(acl).not.toContain("System32")
  })
})
