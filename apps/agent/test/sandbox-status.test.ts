import { describe, expect, test } from "bun:test"
import type {
  WindowsSandboxUserStatus,
  WindowsWfpStatusResult,
} from "@anthropic-ai/sandbox-runtime"
import { RpcMethods } from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import {
  classifyWindowsSandboxStatus,
  mapSandboxInitializationError,
  sandboxNotReadyError,
  sandboxStatusFailure,
  toPublicSandboxStatus,
  type SandboxStatus,
} from "../src/sandbox/SandboxRuntimeAdapter"
import { requireAvailableSandbox } from "../src/sandbox/SandboxStatusView"

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
): WindowsWfpStatusResult => ({
  state,
  filters: state === "installed" ? 4 : 0,
  ...(state === "cannot-read"
    ? { hint: "BFE filter enumeration is admin-only" }
    : {}),
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
